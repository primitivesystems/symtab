package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/appdata"
	"github.com/flux-pkm/server/internal/capability"
	"github.com/flux-pkm/server/internal/config"
	"github.com/flux-pkm/server/internal/daemonclient"
	"github.com/flux-pkm/server/internal/mcpserver"
	"github.com/flux-pkm/server/internal/runtimecoord"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func runMCPBridge(arguments []string) error {
	flags := flag.NewFlagSet("symtab mcp", flag.ContinueOnError)
	vaultPath := flags.String("vault", "", "vault directory exposed to this MCP client")
	connectionID := flags.String("connection", "", "saved MCP connection ID")
	connectionSecret := flags.String("secret", "", "saved MCP connection secret")
	clientID := flags.String("client", "local-mcp", "stable MCP client identity")
	modeValue := flags.String("mode", string(capability.ReadOnly), "read_only, guided_write, or trusted_workspace")
	appData := flags.String("app-data", "", "Symtab app-data directory")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *connectionSecret == "" {
		*connectionSecret = os.Getenv("FLUX_MCP_SECRET")
	}
	if *vaultPath == "" && (*connectionID == "" || *connectionSecret == "") {
		return errors.New("--connection and --secret are required; use --vault only for development")
	}
	if *vaultPath != "" && *connectionID != "" {
		return errors.New("--vault cannot be combined with a saved --connection")
	}
	cfg := config.Load()
	if *appData != "" {
		cfg.AppDataDir = *appData
	}
	grantedVaults := make(map[string]bool)
	var connectionStore *appdata.Store
	if *connectionID != "" {
		store, err := appdata.Open(filepath.Join(cfg.AppDataDir, "app.db"))
		if err != nil {
			return err
		}
		connection, authErr := store.AuthenticateMCPConnection(*connectionID, *connectionSecret)
		recent, recentErr := store.RecentVaults()
		if authErr != nil {
			_ = store.Close()
			return errors.New("invalid or revoked MCP connection")
		}
		if recentErr != nil {
			_ = store.Close()
			return recentErr
		}
		connectionStore = store
		defer connectionStore.Close()
		*clientID = connection.ID
		*modeValue = connection.Mode
		allowed := make(map[string]bool, len(connection.VaultIDs))
		for _, vaultID := range connection.VaultIDs {
			allowed[vaultID] = true
		}
		for _, recentVault := range recent {
			if allowed[recentVault.VaultID] {
				grantedVaults[recentVault.Path] = true
			}
		}
		if len(grantedVaults) != len(allowed) {
			return errors.New("one or more granted vaults are no longer available")
		}
	}
	mode := capability.ApprovalMode(*modeValue)
	if mode != capability.ReadOnly && mode != capability.Guided && mode != capability.Trusted {
		return errors.New("--mode must be read_only, guided_write, or trusted_workspace")
	}
	client, err := connectDaemon(context.Background(), cfg.AppDataDir)
	if err != nil {
		return err
	}
	if *vaultPath != "" {
		grantedVaults[*vaultPath] = true
	}
	vaultIDs := make(map[string]bool, len(grantedVaults))
	for path := range grantedVaults {
		vault, openErr := client.OpenVault(context.Background(), path)
		if openErr != nil {
			return fmt.Errorf("open MCP vault: %w", openErr)
		}
		vaultIDs[vault.ID] = true
	}
	grants := map[capability.Capability]bool{capability.VaultRead: true}
	if mode != capability.ReadOnly {
		grants[capability.VaultWrite] = true
		grants[capability.VaultMove] = true
		grants[capability.VaultDelete] = true
	}
	var approver capability.Approver
	if mode == capability.Guided {
		approver = mcpserver.ElicitationApprover
	}
	policy, err := capability.NewPolicy(capability.Principal{
		ID: *clientID, Mode: mode,
		Vaults: vaultIDs, Capabilities: grants,
	}, approver)
	if err != nil {
		return err
	}
	if connectionStore != nil {
		policy.SetValidator(func(context.Context) error {
			_, validateErr := connectionStore.AuthenticateMCPConnection(*connectionID, *connectionSecret)
			return validateErr
		})
	}
	server := mcpserver.New(client, policy, application.Version)
	runContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	for vaultID := range vaultIDs {
		go keepDaemonAlive(runContext, client, vaultID)
	}
	return server.Run(runContext, &mcp.StdioTransport{})
}

func keepDaemonAlive(ctx context.Context, client *daemonclient.Client, vaultID string) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = client.VaultRevision(vaultID)
		}
	}
}

func connectDaemon(ctx context.Context, appDataDirectory string) (*daemonclient.Client, error) {
	descriptorPath := filepath.Join(appDataDirectory, "runtime", "daemon.json")
	if client := descriptorClient(ctx, descriptorPath); client != nil {
		return client, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	command := exec.Command(executable, "serve")
	command.Env = append(os.Environ(),
		"ENVIRONMENT=desktop",
		"HOST=127.0.0.1",
		"PORT=0",
		"FLUX_APP_DATA_DIR="+appDataDirectory,
		"FLUX_DESKTOP_TOKEN=",
		"FLUX_DAEMON_IDLE_TIMEOUT=2m",
	)
	// Never let daemon output corrupt MCP stdout.
	command.Stdout = os.Stderr
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	_ = command.Process.Release()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if client := descriptorClient(ctx, descriptorPath); client != nil {
			return client, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, errors.New("Symtab daemon did not become ready")
}

func descriptorClient(ctx context.Context, descriptorPath string) *daemonclient.Client {
	descriptor, err := runtimecoord.ReadDescriptor(descriptorPath)
	if err != nil {
		return nil
	}
	client, err := daemonclient.New(descriptor.Origin, descriptor.Token)
	if err != nil {
		return nil
	}
	check, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	if _, err := client.Status(check); err != nil {
		return nil
	}
	return client
}
