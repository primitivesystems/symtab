package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/symtab-pkm/server/internal/app"
	"github.com/symtab-pkm/server/internal/capability"
	"github.com/symtab-pkm/server/internal/domain"
	"github.com/symtab-pkm/server/internal/vault"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestSelectSubgraphUsesPathIdentityAndBoundsResult(t *testing.T) {
	graph := domain.VaultGraph{
		Nodes: []domain.GraphNode{
			{ID: "a/route.ts", Path: "a/route.ts"},
			{ID: "b/route.ts", Path: "b/route.ts"},
			{ID: "c.md", Path: "c.md"},
		},
		Edges: []domain.GraphEdge{
			{Source: "a/route.ts", Target: "b/route.ts"},
			{Source: "b/route.ts", Target: "c.md"},
		},
	}

	result, partial, err := selectSubgraph(graph, "a/route.ts", "outgoing", 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !partial || len(result.Nodes) != 2 {
		t.Fatalf("expected bounded result, got partial=%v nodes=%#v", partial, result.Nodes)
	}
	if result.Nodes[0].ID != "a/route.ts" || result.Nodes[1].ID != "b/route.ts" {
		t.Fatalf("path identities collapsed: %#v", result.Nodes)
	}
}

func TestMCPReadAndConflictSafeWritePolicy(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := app.NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	document, err := service.ReadFile(info.ID, "note.md")
	if err != nil {
		t.Fatal(err)
	}

	principal := capability.Principal{
		ID: "codex", Mode: capability.ReadOnly,
		Vaults:       map[string]bool{info.ID: true},
		Capabilities: map[capability.Capability]bool{capability.VaultRead: true, capability.VaultWrite: true},
	}
	readOnlyPolicy, err := capability.NewPolicy(principal, nil)
	if err != nil {
		t.Fatal(err)
	}
	client, closeClient := connectTestClient(t, New(service, readOnlyPolicy, "test"))
	defer closeClient()
	tools, err := client.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	validToolName := regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	for _, tool := range tools.Tools {
		if !validToolName.MatchString(tool.Name) {
			t.Fatalf("MCP-incompatible tool name %q", tool.Name)
		}
	}
	vaults, err := client.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_list_vaults", Arguments: map[string]any{},
	})
	if err != nil || vaults.IsError || !resultContains(vaults, info.ID) {
		t.Fatalf("authorized vault discovery failed: result=%#v err=%v", vaults, err)
	}
	result, err := client.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_read_file", Arguments: map[string]any{"vaultId": info.ID, "path": "note.md"},
	})
	if err != nil || result.IsError {
		t.Fatalf("read failed: result=%#v err=%v", result, err)
	}
	result, err = client.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_save_file", Arguments: map[string]any{
			"vaultId": info.ID, "path": "note.md", "content": "blocked", "expectedHash": document.ContentHash,
		},
	})
	if err != nil || !result.IsError || !resultContains(result, "read-only") {
		t.Fatalf("read-only write not rejected: result=%#v err=%v", result, err)
	}

	principal.Mode = capability.Trusted
	trustedPolicy, err := capability.NewPolicy(principal, nil)
	if err != nil {
		t.Fatal(err)
	}
	trusted, closeTrusted := connectTestClient(t, New(service, trustedPolicy, "test"))
	defer closeTrusted()
	result, err = trusted.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_save_file", Arguments: map[string]any{
			"vaultId": info.ID, "path": "note.md", "content": "stale", "expectedHash": "wrong",
		},
	})
	if err != nil || !result.IsError || !resultContains(result, "changed") {
		t.Fatalf("stale write not rejected: result=%#v err=%v", result, err)
	}
	result, err = trusted.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_save_file", Arguments: map[string]any{
			"vaultId": info.ID, "path": "note.md", "content": "after", "expectedHash": document.ContentHash,
		},
	})
	if err != nil || result.IsError {
		t.Fatalf("trusted write failed: result=%#v err=%v", result, err)
	}
	content, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil || string(content) != "after" {
		t.Fatalf("canonical file not updated: %q, %v", content, err)
	}
	after, err := service.ReadFile(info.ID, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	result, err = trusted.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_apply_vault_plan", Arguments: map[string]any{
			"vaultId": info.ID,
			"operations": []map[string]any{
				{"action": "create", "path": "created.md", "content": "created"},
				{"action": "update", "path": "note.md", "content": "planned", "expectedHash": after.ContentHash},
			},
		},
	})
	if err != nil || result.IsError {
		t.Fatalf("vault plan failed: result=%#v err=%v", result, err)
	}
	for path, expected := range map[string]string{"created.md": "created", "note.md": "planned"} {
		content, err := os.ReadFile(filepath.Join(root, path))
		if err != nil || string(content) != expected {
			t.Fatalf("unexpected %s: %q, %v", path, content, err)
		}
	}
}

func TestGuidedWriteUsesClientElicitation(t *testing.T) {
	root := t.TempDir()
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := app.NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	policy, err := capability.NewPolicy(capability.Principal{
		ID: "codex", Mode: capability.Guided,
		Vaults:       map[string]bool{info.ID: true},
		Capabilities: map[capability.Capability]bool{capability.VaultWrite: true},
	}, ElicitationApprover)
	if err != nil {
		t.Fatal(err)
	}
	var prompt string
	client, closeClient := connectTestClient(t, New(service, policy, "test"), &mcp.ClientOptions{
		ElicitationHandler: func(_ context.Context, request *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
			prompt = request.Params.Message
			schema, ok := request.Params.RequestedSchema.(map[string]any)
			if !ok {
				t.Fatalf("unexpected schema type %T", request.Params.RequestedSchema)
			}
			properties, _ := schema["properties"].(map[string]any)
			if _, ok := properties["confirmed"]; !ok {
				t.Fatalf("confirmation schema missing confirmed field: %#v", schema)
			}
			return &mcp.ElicitResult{Action: "accept", Content: map[string]any{"confirmed": true}}, nil
		},
	})
	defer closeClient()
	result, err := client.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_create_file", Arguments: map[string]any{
			"vaultId": info.ID, "path": "approved.md", "content": "approved",
		},
	})
	if err != nil || result.IsError {
		t.Fatalf("guided write failed: result=%#v err=%v", result, err)
	}
	if !strings.Contains(prompt, `create "approved.md"`) || !strings.Contains(prompt, "sha256") {
		t.Fatalf("prompt does not identify exact action: %q", prompt)
	}
	if content, err := os.ReadFile(filepath.Join(root, "approved.md")); err != nil || string(content) != "approved" {
		t.Fatalf("approved write missing: %q, %v", content, err)
	}
}

func TestGuidedWriteFailsWithoutElicitationSupport(t *testing.T) {
	root := t.TempDir()
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := app.NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	policy, err := capability.NewPolicy(capability.Principal{
		ID: "codex", Mode: capability.Guided,
		Vaults:       map[string]bool{info.ID: true},
		Capabilities: map[capability.Capability]bool{capability.VaultWrite: true},
	}, ElicitationApprover)
	if err != nil {
		t.Fatal(err)
	}
	client, closeClient := connectTestClient(t, New(service, policy, "test"))
	defer closeClient()
	result, err := client.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "symtab_create_file", Arguments: map[string]any{
			"vaultId": info.ID, "path": "blocked.md", "content": "blocked",
		},
	})
	if err != nil || !result.IsError || !resultContains(result, "does not support elicitation") {
		t.Fatalf("unsupported elicitation did not fail safely: result=%#v err=%v", result, err)
	}
	if _, err := os.Stat(filepath.Join(root, "blocked.md")); !os.IsNotExist(err) {
		t.Fatalf("blocked write reached filesystem: %v", err)
	}
}

func connectTestClient(t *testing.T, server *mcp.Server, options ...*mcp.ClientOptions) (*mcp.ClientSession, func()) {
	t.Helper()
	ctx := context.Background()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	var clientOptions *mcp.ClientOptions
	if len(options) > 0 {
		clientOptions = options[0]
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, clientOptions)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		_ = serverSession.Close()
		t.Fatal(err)
	}
	return clientSession, func() {
		_ = clientSession.Close()
		_ = serverSession.Close()
	}
}

func resultContains(result *mcp.CallToolResult, text string) bool {
	for _, content := range result.Content {
		if item, ok := content.(*mcp.TextContent); ok && strings.Contains(item.Text, text) {
			return true
		}
	}
	return false
}
