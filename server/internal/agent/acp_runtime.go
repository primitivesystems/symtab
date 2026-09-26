package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/google/uuid"
)

const fileDeltaChunkSize = 16 << 10

type acpRuntime struct {
	cmd          *exec.Cmd
	conn         *acp.ClientSideConnection
	client       *acpClient
	sessionID    acp.SessionId
	capabilities acp.AgentCapabilities
	done         chan struct{}
	closeOnce    sync.Once
}

type acpClient struct {
	service  *Service
	threadID string
	root     string

	mu               sync.Mutex
	turnID           string
	reasoningID      string
	messageID        string
	fileTextByChange map[string]string
}

func startACPRuntime(
	ctx context.Context,
	service *Service,
	thread *Thread,
	root string,
	spec providerSpec,
) (*acpRuntime, error) {
	command := exec.Command(spec.command, spec.args...)
	command.Dir = root
	command.Stderr = io.Discard
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}
	client := &acpClient{
		service: service, threadID: thread.ID, root: root,
		fileTextByChange: make(map[string]string),
	}
	runtime := &acpRuntime{cmd: command, client: client, done: make(chan struct{})}
	go func() {
		_ = command.Wait()
		close(runtime.done)
	}()
	runtime.conn = acp.NewClientSideConnection(client, stdin, stdout)
	initializeContext, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	response, err := runtime.conn.Initialize(initializeContext, acp.InitializeRequest{
		ProtocolVersion: acp.ProtocolVersionNumber,
		ClientInfo:      &acp.Implementation{Name: "Symtab", Version: "0.0.1"},
		ClientCapabilities: acp.ClientCapabilities{
			Fs: acp.FileSystemCapabilities{ReadTextFile: true, WriteTextFile: true},
		},
	})
	if err != nil {
		runtime.Close()
		return nil, fmt.Errorf("initialize %s: %w", spec.name, err)
	}
	runtime.capabilities = response.AgentCapabilities
	var options []acp.SessionConfigOption
	if thread.ProviderSessionID != "" && response.AgentCapabilities.LoadSession {
		loaded, loadErr := runtime.conn.LoadSession(initializeContext, acp.LoadSessionRequest{
			SessionId: acp.SessionId(thread.ProviderSessionID), Cwd: root, McpServers: []acp.McpServer{},
		})
		if loadErr == nil {
			runtime.sessionID = acp.SessionId(thread.ProviderSessionID)
			options = loaded.ConfigOptions
		}
	}
	if runtime.sessionID == "" {
		created, createErr := runtime.conn.NewSession(initializeContext, acp.NewSessionRequest{
			Cwd: root, McpServers: []acp.McpServer{},
		})
		if createErr != nil {
			runtime.Close()
			return nil, fmt.Errorf("create %s session: %w", spec.name, createErr)
		}
		runtime.sessionID = created.SessionId
		options = created.ConfigOptions
		thread.ProviderSessionID = string(created.SessionId)
		thread.UpdatedAt = time.Now().UTC()
		if err := service.store.UpdateThread(*thread); err != nil {
			runtime.Close()
			return nil, err
		}
	}
	if err := runtime.configure(initializeContext, thread.Configuration, options); err != nil {
		runtime.Close()
		return nil, err
	}
	return runtime, nil
}

func (r *acpRuntime) configure(ctx context.Context, configuration Configuration, options []acp.SessionConfigOption) error {
	values := map[acp.SessionConfigOptionCategory]string{
		acp.SessionConfigOptionCategoryModel:        configuration.Model,
		acp.SessionConfigOptionCategoryThoughtLevel: configuration.ReasoningEffort,
		acp.SessionConfigOptionCategoryMode:         configuration.Mode,
	}
	for _, option := range options {
		if option.Select == nil || option.Select.Category == nil {
			continue
		}
		target := values[*option.Select.Category]
		if target == "" {
			continue
		}
		value, ok := findConfigValue(option.Select.Options, target)
		if !ok || value == option.Select.CurrentValue {
			continue
		}
		_, err := r.conn.SetSessionConfigOption(ctx, acp.SetSessionConfigOptionRequest{
			ValueId: &acp.SetSessionConfigOptionValueId{
				ConfigId: option.Select.Id, SessionId: r.sessionID, Value: value,
			},
		})
		if err != nil {
			return fmt.Errorf("set %s: %w", *option.Select.Category, err)
		}
	}
	return nil
}

func findConfigValue(options acp.SessionConfigSelectOptions, target string) (acp.SessionConfigValueId, bool) {
	target = strings.ToLower(strings.TrimSpace(target))
	check := func(option acp.SessionConfigSelectOption) (acp.SessionConfigValueId, bool) {
		return option.Value, strings.EqualFold(string(option.Value), target) || strings.EqualFold(option.Name, target)
	}
	if options.Ungrouped != nil {
		for _, option := range *options.Ungrouped {
			if value, ok := check(option); ok {
				return value, true
			}
		}
	}
	if options.Grouped != nil {
		for _, group := range *options.Grouped {
			for _, option := range group.Options {
				if value, ok := check(option); ok {
					return value, true
				}
			}
		}
	}
	return "", false
}

func (r *acpRuntime) Prompt(ctx context.Context, turnID, prompt string) (acp.PromptResponse, error) {
	r.client.beginTurn(turnID)
	return r.conn.Prompt(ctx, acp.PromptRequest{
		SessionId: r.sessionID,
		Prompt:    []acp.ContentBlock{acp.TextBlock(prompt)},
	})
}

func (r *acpRuntime) Cancel() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = r.conn.Cancel(ctx, acp.CancelNotification{SessionId: r.sessionID})
}

func (r *acpRuntime) Close() {
	r.closeOnce.Do(func() {
		if r.cmd.Process != nil {
			_ = r.cmd.Process.Kill()
		}
		select {
		case <-r.done:
		case <-time.After(2 * time.Second):
		}
	})
}

func (c *acpClient) beginTurn(turnID string) {
	c.mu.Lock()
	c.turnID = turnID
	c.reasoningID = ""
	c.messageID = ""
	c.fileTextByChange = make(map[string]string)
	c.mu.Unlock()
}

func (c *acpClient) currentTurn() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.turnID
}

func (c *acpClient) RequestPermission(ctx context.Context, request acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	requestID := uuid.NewString()
	decision := make(chan string, 1)
	c.service.mu.Lock()
	c.service.approvals[requestID] = pendingApproval{
		threadID: c.threadID, turnID: c.currentTurn(), decision: decision,
	}
	c.service.mu.Unlock()
	options := make([]map[string]any, 0, len(request.Options))
	for _, option := range request.Options {
		options = append(options, map[string]any{
			"id": string(option.OptionId), "label": option.Name, "kind": permissionKind(option.Kind),
		})
	}
	title := "Permission required"
	if request.ToolCall.Title != nil {
		title = *request.ToolCall.Title
	}
	detail, _ := json.Marshal(request.ToolCall.RawInput)
	if _, err := c.service.emit(c.threadID, c.currentTurn(), "approval.requested", map[string]any{
		"requestId": requestID, "toolCallId": string(request.ToolCall.ToolCallId),
		"title": title, "detail": string(detail), "options": options,
	}); err != nil {
		c.service.removeApproval(requestID)
		return acp.RequestPermissionResponse{}, err
	}
	select {
	case <-ctx.Done():
		c.service.removeApproval(requestID)
		return acp.RequestPermissionResponse{Outcome: acp.RequestPermissionOutcome{
			Cancelled: &acp.RequestPermissionOutcomeCancelled{Outcome: "cancelled"},
		}}, nil
	case optionID := <-decision:
		_, _ = c.service.emit(c.threadID, c.currentTurn(), "approval.resolved", map[string]any{
			"requestId": requestID, "optionId": optionID,
		})
		return acp.RequestPermissionResponse{Outcome: acp.RequestPermissionOutcome{
			Selected: &acp.RequestPermissionOutcomeSelected{
				Outcome: "selected", OptionId: acp.PermissionOptionId(optionID),
			},
		}}, nil
	}
}

func permissionKind(kind acp.PermissionOptionKind) string {
	switch kind {
	case acp.PermissionOptionKindAllowOnce:
		return "allow_once"
	case acp.PermissionOptionKindAllowAlways:
		return "allow_always"
	case acp.PermissionOptionKindRejectOnce:
		return "reject_once"
	case acp.PermissionOptionKindRejectAlways:
		return "reject_always"
	default:
		return "other"
	}
}

func (c *acpClient) SessionUpdate(_ context.Context, notification acp.SessionNotification) error {
	turnID := c.currentTurn()
	update := notification.Update
	switch {
	case update.AgentThoughtChunk != nil:
		return c.streamContent(turnID, update.AgentThoughtChunk.MessageId, update.AgentThoughtChunk.Content, true)
	case update.AgentMessageChunk != nil:
		return c.streamContent(turnID, update.AgentMessageChunk.MessageId, update.AgentMessageChunk.Content, false)
	case update.ToolCall != nil:
		tool := update.ToolCall
		_, err := c.service.emit(c.threadID, turnID, "tool.started", map[string]any{
			"toolCallId": string(tool.ToolCallId), "name": string(tool.Kind), "title": tool.Title,
		})
		if err != nil {
			return err
		}
		return c.emitToolContent(turnID, string(tool.ToolCallId), tool.Content, tool.Locations, tool.Status)
	case update.ToolCallUpdate != nil:
		tool := update.ToolCallUpdate
		status := "running"
		if tool.Status != nil {
			status = toolStatus(*tool.Status)
		}
		detail := toolDetail(tool.RawOutput, tool.Content)
		if _, err := c.service.emit(c.threadID, turnID, "tool.updated", map[string]any{
			"toolCallId": string(tool.ToolCallId), "status": status, "detail": detail,
		}); err != nil {
			return err
		}
		return c.emitToolContent(turnID, string(tool.ToolCallId), tool.Content, tool.Locations, valueOrPending(tool.Status))
	case update.Plan != nil:
		entries := make([]map[string]any, 0, len(update.Plan.Entries))
		for index, entry := range update.Plan.Entries {
			entries = append(entries, map[string]any{
				"id": fmt.Sprintf("plan-%d", index), "text": entry.Content, "status": string(entry.Status),
			})
		}
		_, err := c.service.emit(c.threadID, turnID, "plan.updated", map[string]any{"entries": entries})
		return err
	case update.UsageUpdate != nil:
		payload := map[string]any{"used": update.UsageUpdate.Used, "size": update.UsageUpdate.Size}
		if update.UsageUpdate.Cost != nil {
			payload["cost"], payload["currency"] = update.UsageUpdate.Cost.Amount, update.UsageUpdate.Cost.Currency
		}
		_, err := c.service.emit(c.threadID, turnID, "usage.updated", payload)
		return err
	}
	return nil
}

func (c *acpClient) streamContent(turnID string, providedID *string, content acp.ContentBlock, reasoning bool) error {
	if content.ResourceLink != nil {
		title := content.ResourceLink.Name
		if content.ResourceLink.Title != nil {
			title = *content.ResourceLink.Title
		}
		_, err := c.service.emit(c.threadID, turnID, "source.added", map[string]any{
			"sourceId": uuid.NewString(), "title": title, "url": content.ResourceLink.Uri,
		})
		return err
	}
	if content.Text == nil || content.Text.Text == "" {
		return nil
	}
	c.mu.Lock()
	id := ""
	if providedID != nil {
		id = *providedID
	}
	if reasoning {
		if id == "" {
			id = c.reasoningID
		}
		if id == "" {
			id = uuid.NewString()
		}
		previous := c.reasoningID
		c.reasoningID = id
		c.mu.Unlock()
		if previous != "" && previous != id {
			_, _ = c.service.emit(c.threadID, turnID, "reasoning.completed", map[string]any{"itemId": previous})
		}
		_, err := c.service.emit(c.threadID, turnID, "reasoning.delta", map[string]any{
			"itemId": id, "delta": content.Text.Text,
		})
		return err
	}
	if id == "" {
		id = c.messageID
	}
	if id == "" {
		id = uuid.NewString()
	}
	previous := c.messageID
	c.messageID = id
	c.mu.Unlock()
	if previous != "" && previous != id {
		_, _ = c.service.emit(c.threadID, turnID, "message.completed", map[string]any{"messageId": previous})
	}
	_, err := c.service.emit(c.threadID, turnID, "message.delta", map[string]any{
		"messageId": id, "delta": content.Text.Text,
	})
	return err
}

func (c *acpClient) completeContent(turnID string) {
	c.mu.Lock()
	reasoningID, messageID := c.reasoningID, c.messageID
	c.reasoningID, c.messageID = "", ""
	c.mu.Unlock()
	if reasoningID != "" {
		_, _ = c.service.emit(c.threadID, turnID, "reasoning.completed", map[string]any{"itemId": reasoningID})
	}
	if messageID != "" {
		_, _ = c.service.emit(c.threadID, turnID, "message.completed", map[string]any{"messageId": messageID})
	}
}

func (c *acpClient) emitToolContent(
	turnID, toolCallID string,
	content []acp.ToolCallContent,
	locations []acp.ToolCallLocation,
	status acp.ToolCallStatus,
) error {
	paths := make([]string, 0, len(locations))
	for _, location := range locations {
		paths = append(paths, location.Path)
	}
	for _, item := range content {
		if item.Diff == nil {
			continue
		}
		path := item.Diff.Path
		changeID := toolCallID + ":" + path
		c.mu.Lock()
		previous, seen := c.fileTextByChange[changeID]
		current := item.Diff.NewText
		if !seen || !strings.HasPrefix(current, previous) {
			previous = ""
			c.fileTextByChange[changeID] = ""
		}
		c.mu.Unlock()
		if !seen || previous == "" {
			payload := map[string]any{"changeId": changeID, "path": path}
			if item.Diff.OldText != nil {
				payload["oldText"] = *item.Diff.OldText
			}
			if _, err := c.service.emit(c.threadID, turnID, "file.change.started", payload); err != nil {
				return err
			}
		}
		for offset := len(previous); offset < len(current); offset += fileDeltaChunkSize {
			end := min(offset+fileDeltaChunkSize, len(current))
			if _, err := c.service.emit(c.threadID, turnID, "file.change.delta", map[string]any{
				"changeId": changeID, "offset": offset, "delta": current[offset:end],
			}); err != nil {
				return err
			}
		}
		c.mu.Lock()
		c.fileTextByChange[changeID] = current
		c.mu.Unlock()
		if status == acp.ToolCallStatusCompleted {
			if _, err := c.service.emit(c.threadID, turnID, "file.change.completed", map[string]any{
				"changeId": changeID, "path": path,
			}); err != nil {
				return err
			}
			paths = append(paths, path)
		}
	}
	if status == acp.ToolCallStatusCompleted && len(paths) > 0 {
		_, err := c.service.emit(c.threadID, turnID, "files.changed", map[string]any{"paths": paths})
		return err
	}
	return nil
}

func valueOrPending(status *acp.ToolCallStatus) acp.ToolCallStatus {
	if status == nil {
		return acp.ToolCallStatusPending
	}
	return *status
}

func toolStatus(status acp.ToolCallStatus) string {
	switch status {
	case acp.ToolCallStatusCompleted:
		return "completed"
	case acp.ToolCallStatusFailed:
		return "failed"
	default:
		return "running"
	}
}

func toolDetail(raw any, content []acp.ToolCallContent) string {
	if raw != nil {
		if value, err := json.Marshal(raw); err == nil {
			return string(value)
		}
	}
	for _, item := range content {
		if item.Content != nil && item.Content.Content.Text != nil {
			return item.Content.Content.Text.Text
		}
	}
	return ""
}

func (c *acpClient) ReadTextFile(_ context.Context, request acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	path, err := safeWorkspacePath(c.root, request.Path, false)
	if err != nil {
		return acp.ReadTextFileResponse{}, err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return acp.ReadTextFileResponse{}, err
	}
	text := string(content)
	if request.Line != nil || request.Limit != nil {
		lines := strings.Split(text, "\n")
		start := 0
		if request.Line != nil && *request.Line > 0 {
			start = min(*request.Line-1, len(lines))
		}
		end := len(lines)
		if request.Limit != nil && *request.Limit > 0 {
			end = min(start+*request.Limit, end)
		}
		text = strings.Join(lines[start:end], "\n")
	}
	return acp.ReadTextFileResponse{Content: text}, nil
}

func (c *acpClient) WriteTextFile(_ context.Context, request acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	path, err := safeWorkspacePath(c.root, request.Path, true)
	if err != nil {
		return acp.WriteTextFileResponse{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return acp.WriteTextFileResponse{}, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".symtab-agent-*")
	if err != nil {
		return acp.WriteTextFileResponse{}, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o644); err == nil {
		_, err = temporary.WriteString(request.Content)
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryPath, path)
	}
	return acp.WriteTextFileResponse{}, err
}

func safeWorkspacePath(root, requested string, writing bool) (string, error) {
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	path := requested
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	path = filepath.Clean(path)
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("path is outside the active workspace")
	}
	check := path
	if writing {
		check = filepath.Dir(path)
	}
	for {
		resolved, resolveErr := filepath.EvalSymlinks(check)
		if resolveErr == nil {
			relative, err = filepath.Rel(root, resolved)
			if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return "", errors.New("path resolves outside the active workspace")
			}
			break
		}
		parent := filepath.Dir(check)
		if parent == check {
			return "", resolveErr
		}
		check = parent
	}
	if !writing {
		return filepath.EvalSymlinks(path)
	}
	return path, nil
}

var errTerminalUnsupported = errors.New("ACP terminal capability is disabled")

func (*acpClient) CreateTerminal(context.Context, acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	return acp.CreateTerminalResponse{}, errTerminalUnsupported
}
func (*acpClient) KillTerminal(context.Context, acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	return acp.KillTerminalResponse{}, errTerminalUnsupported
}
func (*acpClient) TerminalOutput(context.Context, acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	return acp.TerminalOutputResponse{}, errTerminalUnsupported
}
func (*acpClient) ReleaseTerminal(context.Context, acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	return acp.ReleaseTerminalResponse{}, errTerminalUnsupported
}
func (*acpClient) WaitForTerminalExit(context.Context, acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	return acp.WaitForTerminalExitResponse{}, errTerminalUnsupported
}
