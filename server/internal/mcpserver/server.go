package mcpserver

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/symtab-pkm/server/internal/capability"
	"github.com/symtab-pkm/server/internal/domain"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type vaultService interface {
	ListFiles(string) ([]domain.FileEntry, error)
	ReadFile(string, string) (domain.FileDocument, error)
	Graph(string) (domain.VaultGraph, error)
	VaultRevision(string) (uint64, error)
	CreateFile(string, string, string) (domain.FileDocument, error)
	SaveFile(string, string, string, string) (domain.SaveResult, error)
	ApplyVaultPlan(string, []domain.VaultPlanOperation) (domain.VaultPlanResult, error)
	MoveFileExpected(string, string, string, string) (domain.FileEntry, error)
	DeleteFileExpected(string, string, string) (domain.TrashEntry, error)
}

type Server struct {
	app    vaultService
	policy *capability.Policy
}

func New(app vaultService, policy *capability.Policy, version string) *mcp.Server {
	h := &Server{app: app, policy: policy}
	server := mcp.NewServer(&mcp.Implementation{Name: "symtab", Version: version}, nil)
	h.addReadTools(server)
	h.addWriteTools(server)
	return server
}

type vaultInput struct {
	VaultID string `json:"vaultId" jsonschema:"vault identifier"`
}

type pathInput struct {
	VaultID string `json:"vaultId" jsonschema:"vault identifier"`
	Path    string `json:"path" jsonschema:"vault-relative file path"`
}

type fileListOutput struct {
	Files []domain.FileEntry `json:"files"`
}

type vaultListOutput struct {
	VaultIDs []string `json:"vaultIds"`
}

type graphOutput struct {
	Nodes         []domain.GraphNode `json:"nodes"`
	Edges         []domain.GraphEdge `json:"edges"`
	IndexRevision uint64             `json:"indexRevision"`
	Partial       bool               `json:"partial"`
}

type graphQueryInput struct {
	VaultID  string `json:"vaultId" jsonschema:"vault identifier"`
	Path     string `json:"path" jsonschema:"vault-relative seed path"`
	Depth    int    `json:"depth,omitempty" jsonschema:"traversal depth from 1 to 3"`
	MaxNodes int    `json:"maxNodes,omitempty" jsonschema:"maximum nodes from 1 to 200"`
}

type createInput struct {
	VaultID string `json:"vaultId" jsonschema:"vault identifier"`
	Path    string `json:"path" jsonschema:"new vault-relative file path"`
	Content string `json:"content" jsonschema:"initial file content"`
}

type saveInput struct {
	VaultID      string `json:"vaultId" jsonschema:"vault identifier"`
	Path         string `json:"path" jsonschema:"vault-relative file path"`
	Content      string `json:"content" jsonschema:"replacement file content"`
	ExpectedHash string `json:"expectedHash" jsonschema:"content hash returned by symtab_read_file"`
}

type moveInput struct {
	VaultID         string `json:"vaultId" jsonschema:"vault identifier"`
	SourcePath      string `json:"sourcePath" jsonschema:"existing vault-relative file path"`
	DestinationPath string `json:"destinationPath" jsonschema:"new vault-relative file path"`
	ExpectedHash    string `json:"expectedHash" jsonschema:"source content hash returned by symtab_read_file"`
}

type deleteInput struct {
	VaultID      string `json:"vaultId" jsonschema:"vault identifier"`
	Path         string `json:"path" jsonschema:"vault-relative file path"`
	ExpectedHash string `json:"expectedHash" jsonschema:"content hash returned by symtab_read_file"`
}

type vaultPlanInput struct {
	VaultID    string                      `json:"vaultId" jsonschema:"vault identifier"`
	Operations []domain.VaultPlanOperation `json:"operations" jsonschema:"ordered create and update operations"`
}

func (h *Server) addReadTools(server *mcp.Server) {
	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true}
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_list_vaults", Description: "List vault identifiers authorized for this MCP connection.", Annotations: readOnly}, h.listVaults)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_list_files", Description: "List files in an authorized Symtab vault.", Annotations: readOnly}, h.listFiles)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_read_file", Description: "Read one vault file with content hash for conflict-safe writes.", Annotations: readOnly}, h.readFile)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_get_graph", Description: "Read complete indexed vault graph. Prefer focused graph tools for large vaults.", Annotations: readOnly}, h.graph)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_get_graph_neighbors", Description: "Read bounded graph neighborhood around one path.", Annotations: readOnly}, h.neighbors)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_get_backlinks", Description: "Read notes linking to one path.", Annotations: readOnly}, h.backlinks)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_get_outgoing_links", Description: "Read notes linked from one path.", Annotations: readOnly}, h.outgoing)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_get_broken_links", Description: "Read unresolved graph links.", Annotations: readOnly}, h.brokenLinks)
}

func (h *Server) addWriteTools(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_create_file", Description: "Create one file after policy approval."}, h.createFile)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_save_file", Description: "Replace one file when expected content hash still matches."}, h.saveFile)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_apply_vault_plan", Description: "Apply up to 100 preflighted create/update operations with conflict checks and crash-recovery rollback journal."}, h.applyVaultPlan)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_move_file", Description: "Move one file when expected source content hash still matches."}, h.moveFile)
	mcp.AddTool(server, &mcp.Tool{Name: "symtab_delete_file", Description: "Move one file to Symtab trash when expected content hash still matches."}, h.deleteFile)
}

func (h *Server) listVaults(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, vaultListOutput, error) {
	if err := h.policy.Validate(ctx); err != nil {
		return nil, vaultListOutput{}, err
	}
	return nil, vaultListOutput{VaultIDs: h.policy.VaultIDs()}, nil
}

type sessionContextKey struct{}

func ElicitationApprover(ctx context.Context, request capability.ApprovalRequest) (bool, error) {
	session, _ := ctx.Value(sessionContextKey{}).(*mcp.ServerSession)
	if session == nil {
		return false, capability.ErrApprovalRequired
	}
	result, err := session.Elicit(ctx, &mcp.ElicitParams{
		Message: fmt.Sprintf("Symtab client %s requests permission in vault %s:\n%s", quoted(request.ClientID), quoted(request.VaultID), bounded(request.Action, 4000)),
		RequestedSchema: &jsonschema.Schema{
			Type: "object",
			Properties: map[string]*jsonschema.Schema{
				"confirmed": {Type: "boolean", Description: "Approve this exact action"},
			},
			Required: []string{"confirmed"},
		},
	})
	if err != nil {
		return false, fmt.Errorf("request approval: %w", err)
	}
	if result == nil {
		return false, fmt.Errorf("request approval: empty response")
	}
	confirmed, ok := result.Content["confirmed"].(bool)
	return result.Action == "accept" && ok && confirmed, nil
}

func quoted(value string) string {
	return strconv.QuoteToASCII(value)
}

func contentSummary(content string) string {
	digest := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%d bytes, sha256 %x", len([]byte(content)), digest[:8])
}

func bounded(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "... (truncated)"
}

func (h *Server) authorize(ctx context.Context, request *mcp.CallToolRequest, vaultID string, capabilityName capability.Capability, action string) error {
	if h.policy == nil {
		return capability.ErrAccessDenied
	}
	if request != nil {
		ctx = context.WithValue(ctx, sessionContextKey{}, request.Session)
	}
	return h.policy.Authorize(ctx, vaultID, capabilityName, action)
}

func (h *Server) listFiles(ctx context.Context, request *mcp.CallToolRequest, input vaultInput) (*mcp.CallToolResult, fileListOutput, error) {
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultRead, "list files"); err != nil {
		return nil, fileListOutput{}, err
	}
	entries, err := h.app.ListFiles(input.VaultID)
	return nil, fileListOutput{Files: entries}, err
}

func (h *Server) readFile(ctx context.Context, request *mcp.CallToolRequest, input pathInput) (*mcp.CallToolResult, domain.FileDocument, error) {
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultRead, "read "+input.Path); err != nil {
		return nil, domain.FileDocument{}, err
	}
	document, err := h.app.ReadFile(input.VaultID, input.Path)
	return nil, document, err
}

func (h *Server) graph(ctx context.Context, request *mcp.CallToolRequest, input vaultInput) (*mcp.CallToolResult, graphOutput, error) {
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultRead, "read graph"); err != nil {
		return nil, graphOutput{}, err
	}
	graph, err := h.app.Graph(input.VaultID)
	if err != nil {
		return nil, graphOutput{}, err
	}
	return nil, h.graphOutput(input.VaultID, graph, false), nil
}

func (h *Server) neighbors(ctx context.Context, request *mcp.CallToolRequest, input graphQueryInput) (*mcp.CallToolResult, graphOutput, error) {
	return h.subgraph(ctx, request, input, "both")
}

func (h *Server) backlinks(ctx context.Context, request *mcp.CallToolRequest, input graphQueryInput) (*mcp.CallToolResult, graphOutput, error) {
	input.Depth = 1
	return h.subgraph(ctx, request, input, "incoming")
}

func (h *Server) outgoing(ctx context.Context, request *mcp.CallToolRequest, input graphQueryInput) (*mcp.CallToolResult, graphOutput, error) {
	input.Depth = 1
	return h.subgraph(ctx, request, input, "outgoing")
}

func (h *Server) subgraph(ctx context.Context, request *mcp.CallToolRequest, input graphQueryInput, direction string) (*mcp.CallToolResult, graphOutput, error) {
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultRead, "read graph around "+input.Path); err != nil {
		return nil, graphOutput{}, err
	}
	if input.Depth == 0 {
		input.Depth = 1
	}
	if input.MaxNodes == 0 {
		input.MaxNodes = 50
	}
	if input.Depth < 1 || input.Depth > 3 || input.MaxNodes < 1 || input.MaxNodes > 200 {
		return nil, graphOutput{}, fmt.Errorf("depth must be 1..3 and maxNodes must be 1..200")
	}
	graph, err := h.app.Graph(input.VaultID)
	if err != nil {
		return nil, graphOutput{}, err
	}
	filtered, partial, err := selectSubgraph(graph, input.Path, direction, input.Depth, input.MaxNodes)
	if err != nil {
		return nil, graphOutput{}, err
	}
	return nil, h.graphOutput(input.VaultID, filtered, partial), nil
}

func (h *Server) brokenLinks(ctx context.Context, request *mcp.CallToolRequest, input vaultInput) (*mcp.CallToolResult, graphOutput, error) {
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultRead, "read broken links"); err != nil {
		return nil, graphOutput{}, err
	}
	graph, err := h.app.Graph(input.VaultID)
	if err != nil {
		return nil, graphOutput{}, err
	}
	missing := map[string]bool{}
	nodeByID := make(map[string]domain.GraphNode, len(graph.Nodes))
	selected := map[string]bool{}
	for _, node := range graph.Nodes {
		nodeByID[node.ID] = node
		if node.Kind == "missing" {
			missing[node.ID] = true
			selected[node.ID] = true
		}
	}
	edges := make([]domain.GraphEdge, 0)
	for _, edge := range graph.Edges {
		if missing[edge.Target] {
			edges = append(edges, edge)
			selected[edge.Source] = true
		}
	}
	nodes := make([]domain.GraphNode, 0, len(selected))
	for id := range selected {
		nodes = append(nodes, nodeByID[id])
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	return nil, h.graphOutput(input.VaultID, domain.VaultGraph{Nodes: nodes, Edges: edges}, false), nil
}

func (h *Server) graphOutput(vaultID string, graph domain.VaultGraph, partial bool) graphOutput {
	revision, _ := h.app.VaultRevision(vaultID)
	return graphOutput{Nodes: graph.Nodes, Edges: graph.Edges, IndexRevision: revision, Partial: partial}
}

func (h *Server) createFile(ctx context.Context, request *mcp.CallToolRequest, input createInput) (*mcp.CallToolResult, domain.FileDocument, error) {
	action := fmt.Sprintf("create %s (%s)", quoted(input.Path), contentSummary(input.Content))
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultWrite, action); err != nil {
		return nil, domain.FileDocument{}, err
	}
	document, err := h.app.CreateFile(input.VaultID, input.Path, input.Content)
	return nil, document, err
}

func (h *Server) saveFile(ctx context.Context, request *mcp.CallToolRequest, input saveInput) (*mcp.CallToolResult, domain.SaveResult, error) {
	action := fmt.Sprintf("replace %s (%s; expected hash %s)", quoted(input.Path), contentSummary(input.Content), quoted(input.ExpectedHash))
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultWrite, action); err != nil {
		return nil, domain.SaveResult{}, err
	}
	result, err := h.app.SaveFile(input.VaultID, input.Path, input.Content, input.ExpectedHash)
	return nil, result, err
}

func (h *Server) applyVaultPlan(ctx context.Context, request *mcp.CallToolRequest, input vaultPlanInput) (*mcp.CallToolResult, domain.VaultPlanResult, error) {
	actions := make([]string, 0, len(input.Operations))
	for _, operation := range input.Operations {
		action := fmt.Sprintf("%s %s (%s", operation.Action, quoted(operation.Path), contentSummary(operation.Content))
		if operation.ExpectedHash != "" {
			action += "; expected hash " + quoted(operation.ExpectedHash)
		}
		actions = append(actions, action+")")
	}
	action := bounded("apply vault plan: "+strings.Join(actions, ", "), 4000)
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultWrite, action); err != nil {
		return nil, domain.VaultPlanResult{}, err
	}
	result, err := h.app.ApplyVaultPlan(input.VaultID, input.Operations)
	return nil, result, err
}

func (h *Server) moveFile(ctx context.Context, request *mcp.CallToolRequest, input moveInput) (*mcp.CallToolResult, domain.FileEntry, error) {
	action := fmt.Sprintf("move %s to %s (expected hash %s)", quoted(input.SourcePath), quoted(input.DestinationPath), quoted(input.ExpectedHash))
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultMove, action); err != nil {
		return nil, domain.FileEntry{}, err
	}
	entry, err := h.app.MoveFileExpected(input.VaultID, input.SourcePath, input.DestinationPath, input.ExpectedHash)
	return nil, entry, err
}

func (h *Server) deleteFile(ctx context.Context, request *mcp.CallToolRequest, input deleteInput) (*mcp.CallToolResult, domain.TrashEntry, error) {
	action := fmt.Sprintf("delete %s (expected hash %s)", quoted(input.Path), quoted(input.ExpectedHash))
	if err := h.authorize(ctx, request, input.VaultID, capability.VaultDelete, action); err != nil {
		return nil, domain.TrashEntry{}, err
	}
	entry, err := h.app.DeleteFileExpected(input.VaultID, input.Path, input.ExpectedHash)
	return nil, entry, err
}

func selectSubgraph(graph domain.VaultGraph, seed, direction string, depth, maxNodes int) (domain.VaultGraph, bool, error) {
	nodeByID := make(map[string]domain.GraphNode, len(graph.Nodes))
	adjacency := make(map[string][]string)
	for _, node := range graph.Nodes {
		nodeByID[node.ID] = node
	}
	if _, ok := nodeByID[seed]; !ok {
		return domain.VaultGraph{}, false, fmt.Errorf("graph node %q not found", seed)
	}
	for _, edge := range graph.Edges {
		if direction == "both" || direction == "outgoing" {
			adjacency[edge.Source] = append(adjacency[edge.Source], edge.Target)
		}
		if direction == "both" || direction == "incoming" {
			adjacency[edge.Target] = append(adjacency[edge.Target], edge.Source)
		}
	}
	for id := range adjacency {
		sort.Strings(adjacency[id])
	}
	selected := map[string]bool{seed: true}
	frontier := []string{seed}
	partial := false
	for level := 0; level < depth && len(frontier) > 0; level++ {
		next := make([]string, 0)
		for _, id := range frontier {
			for _, neighbor := range adjacency[id] {
				if selected[neighbor] {
					continue
				}
				if len(selected) == maxNodes {
					partial = true
					continue
				}
				selected[neighbor] = true
				next = append(next, neighbor)
			}
		}
		frontier = next
	}
	nodes := make([]domain.GraphNode, 0, len(selected))
	for id := range selected {
		nodes = append(nodes, nodeByID[id])
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	edges := make([]domain.GraphEdge, 0)
	for _, edge := range graph.Edges {
		if selected[edge.Source] && selected[edge.Target] {
			edges = append(edges, edge)
		}
	}
	return domain.VaultGraph{Nodes: nodes, Edges: edges}, partial, nil
}
