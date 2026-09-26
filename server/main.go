package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/symtab-pkm/server/internal/api"
	application "github.com/symtab-pkm/server/internal/app"
	"github.com/symtab-pkm/server/internal/appdata"
	"github.com/symtab-pkm/server/internal/config"
	"github.com/symtab-pkm/server/internal/runtimecoord"
	"github.com/symtab-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

func main() {
	if version := os.Getenv("SYMTAB_VERSION"); version != "" {
		application.Version = version
	}

	cfg := config.Load()
	runtimeLock, err := runtimecoord.Acquire(filepath.Join(cfg.AppDataDir, "runtime", "daemon.lock"))
	if errors.Is(err, runtimecoord.ErrLocked) {
		log.Fatal("Another Symtab runtime already owns this app-data directory. If the desktop app is open, it already provides the backend; do not run dev:server separately")
	}
	if err != nil {
		log.Fatalf("Failed to acquire Symtab runtime: %v", err)
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
	if cfg.Environment == "production" || cfg.Environment == "desktop" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()
	var lastActivity atomic.Int64
	lastActivity.Store(time.Now().UnixNano())
	router.Use(func(c *gin.Context) {
		lastActivity.Store(time.Now().UnixNano())
		c.Next()
	})

	// Setup CORS for the browser shell. Electron uses its preload bridge.
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", cfg.AllowedOrigin)
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, X-Symtab-Desktop-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, PATCH, DELETE")
		c.Writer.Header().Set("Vary", "Origin")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	api.RegisterRoutes(router, appService, api.WithAppData(appData), api.WithDesktopToken(cfg.DesktopToken))

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, appService.Status())
	})

	address := cfg.Host + ":" + cfg.Port
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", address, err)
	}
	defer listener.Close()
	log.Printf("Starting Symtab server on %s", listener.Addr())
	server := &http.Server{Handler: router, ReadHeaderTimeout: 10 * time.Second}
	descriptorPath := filepath.Join(cfg.AppDataDir, "runtime", "daemon.json")
	if cfg.Environment == "desktop" {
		origin := "http://" + listener.Addr().String()
		descriptor := runtimecoord.Descriptor{PID: os.Getpid(), Origin: origin, Token: cfg.DesktopToken, Version: application.Version, Protocol: 1}
		if err := runtimecoord.WriteDescriptor(descriptorPath, descriptor); err != nil {
			log.Fatalf("Failed to publish Symtab runtime: %v", err)
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
	idle := daemonIdleChannel(os.Getenv("SYMTAB_DAEMON_IDLE_TIMEOUT"), &lastActivity)
	select {
	case err := <-failed:
		if err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	case <-shutdownSignal.Done():
	case <-idle:
		log.Print("Symtab daemon idle; shutting down")
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
