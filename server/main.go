package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/flux-pkm/server/internal/agent"
	"github.com/flux-pkm/server/internal/api"
	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/appdata"
	"github.com/flux-pkm/server/internal/auth"
	"github.com/flux-pkm/server/internal/config"
	"github.com/flux-pkm/server/internal/modelproviders"
	"github.com/flux-pkm/server/internal/runtimecoord"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

func main() {
	if version := os.Getenv("FLUX_VERSION"); version != "" {
		application.Version = version
	}

	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		if err := runMCPBridge(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}

	// Load configuration
	cfg := config.Load()
	runtimeLock, err := runtimecoord.Acquire(filepath.Join(cfg.AppDataDir, "runtime", "daemon.lock"))
	if errors.Is(err, runtimecoord.ErrLocked) {
		log.Fatal("Another Flux runtime already owns this app-data directory. If the desktop app is open, it already provides the backend; do not run dev:server separately")
	}
	if err != nil {
		log.Fatalf("Failed to acquire Flux runtime: %v", err)
	}
	defer runtimeLock.Close()

	if cfg.Environment == "desktop" && cfg.DesktopToken == "" {
		cfg.DesktopToken = randomToken()
	}

	// The server starts without touching a vault. Persistent state is initialized
	// only after OpenVault succeeds for the configured vault path.
	allowAnyVaultPath := (cfg.Environment == "development" || cfg.Environment == "desktop") &&
		(cfg.Host == "localhost" || net.ParseIP(cfg.Host).IsLoopback())
	vaultManager := vault.NewManager(cfg.VaultPath, allowAnyVaultPath)
	if cfg.VaultRoot != "" && cfg.VaultPath == "" {
		vaultManager = vault.NewStorageManager(cfg.VaultRoot)
	}
	defer func() {
		if err := vaultManager.Close(); err != nil {
			log.Printf("Failed to close vault: %v", err)
		}
	}()
	appService := application.NewService(vaultManager)
	appData, err := appdata.Open(filepath.Join(cfg.AppDataDir, "app.db"))
	if err != nil {
		log.Fatalf("Failed to open app data: %v", err)
	}
	defer func() {
		if err := appData.Close(); err != nil {
			log.Printf("Failed to close app data: %v", err)
		}
	}()
	// Initialize model providers service
	modelProviderService, err := modelproviders.NewService(cfg.AppDataDir)
	if err != nil {
		log.Printf("Failed to initialize model providers service: %v", err)
		// Continue without model providers service - it's not critical for basic functionality
		modelProviderService = nil
	}
	var agentService *agent.Service
	// Preserve the local-provider boundary; hosted execution is not enabled by UI restoration.
	if cfg.Environment != "production" {
		agentService, err = agent.NewService(appData.Database(), func(vaultID string) (string, error) {
			if path, pathErr := appService.VaultPath(vaultID); pathErr == nil {
				return path, nil
			}
			recent, recentErr := appData.RecentVaults()
			if recentErr != nil {
				return "", recentErr
			}
			for _, item := range recent {
				if item.VaultID != vaultID {
					continue
				}
				info, openErr := appService.OpenVault(item.Path)
				if openErr != nil {
					return "", openErr
				}
				if info.ID != vaultID {
					return "", fmt.Errorf("vault identity changed for %s", vaultID)
				}
				return appService.VaultPath(vaultID)
			}
			return "", fmt.Errorf("vault %s is not registered", vaultID)
		})
		if err != nil {
			log.Fatalf("Failed to initialize agent service: %v", err)
		}
		defer agentService.Close()
	}

	// Set Gin mode
	if cfg.Environment == "production" || cfg.Environment == "desktop" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Create router
	router := gin.Default()
	if cfg.Environment == "production" {
		router.Use(api.BrowserOriginGuard(cfg.AllowedOrigin))
	}
	var lastActivity atomic.Int64
	lastActivity.Store(time.Now().UnixNano())
	router.Use(func(c *gin.Context) {
		lastActivity.Store(time.Now().UnixNano())
		c.Next()
	})

	// Setup CORS for the browser shell. Electron uses its preload bridge.
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", cfg.AllowedOrigin)
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, X-Flux-Desktop-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")
		c.Writer.Header().Set("Vary", "Origin")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Register API routes
	var routeOptions []api.RouteOption
	if cfg.Environment == "production" {
		ownerAuth, authErr := auth.New(appData.Database(), cfg.AllowedOrigin, os.Getenv("FLUX_SETUP_KEY"))
		if authErr != nil {
			log.Fatalf("Failed to initialize web authentication: %v", authErr)
		}
		ownerAuth.Register(router)
		routeOptions = append(routeOptions, api.WithAuthentication(ownerAuth.Protect))
	} else {
		router.GET("/api/v1/auth/status", func(c *gin.Context) {
			c.Header("Cache-Control", "no-store")
			c.JSON(http.StatusOK, gin.H{"enabled": false})
		})
	}
	routeOptions = append(routeOptions, api.WithAppData(appData), api.WithDesktopToken(cfg.DesktopToken))
	if agentService != nil {
		routeOptions = append(routeOptions, api.WithAgent(agentService))
		if modelProviderService != nil {
			routeOptions = append(routeOptions, api.WithModelProviders(modelProviderService))
		}
	}
	api.RegisterRoutes(router, appService, routeOptions...)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		if cfg.Environment == "production" {
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
			return
		}
		c.JSON(http.StatusOK, appService.Status())
	})

	// Start server
	address := cfg.Host + ":" + cfg.Port
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", address, err)
	}
	defer listener.Close()
	log.Printf("Starting FLUX server on %s", listener.Addr())
	server := &http.Server{Handler: router, ReadHeaderTimeout: 10 * time.Second}
	descriptorPath := filepath.Join(cfg.AppDataDir, "runtime", "daemon.json")
	if cfg.Environment == "desktop" {
		origin := "http://" + listener.Addr().String()
		descriptor := runtimecoord.Descriptor{PID: os.Getpid(), Origin: origin, Token: cfg.DesktopToken, Version: application.Version, Protocol: 1}
		if err := runtimecoord.WriteDescriptor(descriptorPath, descriptor); err != nil {
			log.Fatalf("Failed to publish Flux runtime: %v", err)
		}
		defer os.Remove(descriptorPath)
	}
	failed := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			failed <- err
		}
		close(failed)
	}()
	shutdownSignal, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	idle := daemonIdleChannel(os.Getenv("FLUX_DAEMON_IDLE_TIMEOUT"), &lastActivity)
	select {
	case err := <-failed:
		if err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	case <-shutdownSignal.Done():
	case <-idle:
		log.Print("Flux daemon idle; shutting down")
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		log.Printf("Failed to shut down server cleanly: %v", err)
	}
}

func daemonIdleChannel(value string, lastActivity *atomic.Int64) <-chan struct{} {
	timeout, err := time.ParseDuration(value)
	if value == "" || err != nil || timeout <= 0 {
		return nil
	}
	idle := make(chan struct{})
	go func() {
		interval := timeout / 4
		if interval > 30*time.Second {
			interval = 30 * time.Second
		}
		if interval < time.Second {
			interval = time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			if time.Since(time.Unix(0, lastActivity.Load())) >= timeout {
				close(idle)
				return
			}
		}
	}()
	return idle
}

func randomToken() string {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		log.Fatalf("Failed to create desktop token: %v", err)
	}
	return hex.EncodeToString(buffer)
}
