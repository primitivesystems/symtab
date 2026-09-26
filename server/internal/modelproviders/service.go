package modelproviders

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/symtab-pkm/server/internal/domain"
)

var (
	ErrProviderNotFound = errors.New("model provider not found")
	ErrInvalidConfig    = errors.New("invalid provider config")
)

type Service struct {
	configPath string
	mu         sync.RWMutex
	providers  map[string]domain.ModelProvider
	runtimes   map[string]domain.AIRuntime
	chatMu     sync.Mutex
	chatSeq    atomic.Uint64
	chats      map[string]ChatStream
}

type ChatStream struct {
	Reply string `json:"reply"`
	Done  bool   `json:"done"`
	Error string `json:"error,omitempty"`
}

func NewService(appDataDir string) (*Service, error) {
	configPath := filepath.Join(appDataDir, "model-providers.json")
	s := &Service{
		configPath: configPath,
		providers:  make(map[string]domain.ModelProvider),
		runtimes:   make(map[string]domain.AIRuntime),
		chats:      make(map[string]ChatStream),
	}

	if err := s.load(); err != nil {
		// If config doesn't exist, initialize with default providers
		if os.IsNotExist(err) {
			if err := s.initializeDefaults(); err != nil {
				return nil, fmt.Errorf("failed to initialize default providers: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to load providers config: %w", err)
		}
	}
	s.ensureDefaults()

	return s, nil
}

func defaultProviders() []domain.ModelProvider {
	return []domain.ModelProvider{
		{ID: "codex", Type: domain.ModelProviderTypeCodex, Name: "Codex", Description: "Codex CLI", Capabilities: []string{"chat", "streaming", "tool-calling"}, Config: map[string]interface{}{}},
		{ID: "claude", Type: domain.ModelProviderTypeAnthropic, Name: "Claude", Description: "Claude Code CLI", Capabilities: []string{"chat", "streaming", "tool-calling"}, Config: map[string]interface{}{}},
		{ID: "opencode", Type: domain.ModelProviderTypeOpenCode, Name: "OpenCode", Description: "OpenCode CLI", Capabilities: []string{"chat", "streaming", "tool-calling"}, Config: map[string]interface{}{}},
		{ID: "ollama", Type: domain.ModelProviderTypeOllama, Name: "Ollama", Description: "Local Ollama server", Capabilities: []string{"chat", "streaming", "embeddings"}, Config: map[string]interface{}{"url": "http://localhost:11434"}},
		{ID: "lmstudio", Type: domain.ModelProviderTypeLMStudio, Name: "LM Studio", Description: "Local LM Studio server", Capabilities: []string{"chat", "streaming"}, Config: map[string]interface{}{"url": "http://localhost:1234"}},
	}
}

func (s *Service) ensureDefaults() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, provider := range defaultProviders() {
		if _, exists := s.providers[provider.ID]; !exists {
			s.providers[provider.ID] = provider
		}
	}
}

func (s *Service) initializeDefaults() error {
	providers := []domain.ModelProvider{
		{
			ID:           "codex",
			Type:         domain.ModelProviderTypeCodex,
			Name:         "Codex",
			Description:  "OpenAI Codex integration",
			Enabled:      false,
			Config:       make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming", "tool-calling", "external-agent-loop"},
		},
		{
			ID:           "copilot",
			Type:         domain.ModelProviderTypeCopilot,
			Name:         "GitHub Copilot",
			Description:  "GitHub Copilot integration",
			Enabled:      false,
			Config:       make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming", "tool-calling"},
		},
		{
			ID:           "opencode",
			Type:         domain.ModelProviderTypeOpenCode,
			Name:         "OpenCode",
			Description:  "OpenCode integration",
			Enabled:      false,
			Config:       make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming", "tool-calling"},
		},
		{
			ID:           "antigravity",
			Type:         domain.ModelProviderTypeAntigravity,
			Name:         "Antigravity CLI",
			Description:  "Antigravity CLI integration",
			Enabled:      false,
			Config:       make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming"},
		},
		{
			ID:          "ollama",
			Type:        domain.ModelProviderTypeOllama,
			Name:        "Ollama",
			Description: "Local Ollama instance",
			Enabled:     true,
			Config: map[string]interface{}{
				"url":   "http://localhost:11434",
				"model": "llama3.2:1b",
			},
			Capabilities: []string{"chat", "streaming", "embeddings"},
		},
		{
			ID:          "lmstudio",
			Type:        domain.ModelProviderTypeLMStudio,
			Name:        "LM Studio",
			Description: "LM Studio local server",
			Enabled:     false,
			Config: map[string]interface{}{
				"url":   "http://localhost:1234",
				"model": "",
			},
			Capabilities: []string{"chat", "streaming"},
		},
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, provider := range providers {
		s.providers[provider.ID] = provider
	}

	return s.save()
}

func (s *Service) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	content, err := os.ReadFile(s.configPath)
	if err != nil {
		return err
	}

	var config struct {
		Providers []domain.ModelProvider `json:"providers"`
		Runtimes  []domain.AIRuntime     `json:"runtimes"`
	}

	if err := json.Unmarshal(content, &config); err != nil {
		return err
	}

	s.providers = make(map[string]domain.ModelProvider)
	s.runtimes = make(map[string]domain.AIRuntime)

	for _, provider := range config.Providers {
		s.providers[provider.ID] = provider
	}

	for _, runtime := range config.Runtimes {
		s.runtimes[runtime.ID] = runtime
	}

	return nil
}

func (s *Service) save() error {
	config := struct {
		Providers []domain.ModelProvider `json:"providers"`
		Runtimes  []domain.AIRuntime     `json:"runtimes"`
	}{
		Providers: make([]domain.ModelProvider, 0, len(s.providers)),
		Runtimes:  make([]domain.AIRuntime, 0, len(s.runtimes)),
	}

	for _, provider := range s.providers {
		config.Providers = append(config.Providers, provider)
	}

	for _, runtime := range s.runtimes {
		config.Runtimes = append(config.Runtimes, runtime)
	}

	content, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(s.configPath), 0o755); err != nil {
		return err
	}

	return os.WriteFile(s.configPath, content, 0o644)
}

func (s *Service) ListProviders() []domain.ModelProvider {
	s.mu.RLock()
	providersByID := make(map[string]domain.ModelProvider, len(s.providers))
	for id, provider := range s.providers {
		providersByID[id] = provider
	}
	s.mu.RUnlock()

	for id, command := range map[string]string{"codex": "codex", "claude": "claude", "opencode": "opencode"} {
		provider, ok := providersByID[id]
		if !ok {
			continue
		}
		path, err := exec.LookPath(command)
		provider.Available = err == nil
		if err == nil {
			if provider.Config == nil {
				provider.Config = map[string]interface{}{}
			}
			provider.Config["path"] = path
			if id == "opencode" {
				provider.Models = commandLines(path, "models")
			}
		}
		providersByID[id] = provider
	}
	scanLocalProvider(providersByID, "ollama", "/api/tags", true)
	scanLocalProvider(providersByID, "lmstudio", "/v1/models", false)

	providers := make([]domain.ModelProvider, 0, len(s.providers))
	for _, provider := range providersByID {
		providers = append(providers, provider)
	}
	sort.Slice(providers, func(i, j int) bool { return providers[i].Name < providers[j].Name })
	return providers
}

func scanLocalProvider(providers map[string]domain.ModelProvider, id, endpoint string, ollama bool) {
	provider, ok := providers[id]
	if !ok {
		return
	}
	baseURL, _ := provider.Config["url"].(string)
	client := http.Client{Timeout: 350 * time.Millisecond}
	response, err := client.Get(strings.TrimRight(baseURL, "/") + endpoint)
	if err != nil || response.StatusCode >= 300 {
		provider.Available = false
		providers[id] = provider
		if response != nil {
			_ = response.Body.Close()
		}
		return
	}
	defer response.Body.Close()
	provider.Available = true
	if ollama {
		var body struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
		}
		if json.NewDecoder(response.Body).Decode(&body) == nil {
			for _, model := range body.Models {
				provider.Models = append(provider.Models, model.Name)
			}
		}
	} else {
		var body struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if json.NewDecoder(response.Body).Decode(&body) == nil {
			for _, model := range body.Data {
				provider.Models = append(provider.Models, model.ID)
			}
		}
	}
	providers[id] = provider
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (s *Service) Chat(ctx context.Context, workspace, providerID, model string, messages []ChatMessage, onChunk func(string)) (string, error) {
	provider, err := s.GetProvider(providerID)
	if err != nil {
		return "", err
	}
	baseURL, _ := provider.Config["url"].(string)
	if model == "" && len(provider.Models) > 0 {
		model = provider.Models[0]
	}
	if configured, ok := provider.Config["model"].(string); model == "" && ok {
		model = configured
	}
	var endpoint string
	var payload any
	switch providerID {
	case "opencode", "claude", "codex":
		return chatWithCLI(ctx, workspace, providerID, model, messages, onChunk)
	case "ollama":
		endpoint = strings.TrimRight(baseURL, "/") + "/api/chat"
		payload = map[string]any{"model": model, "messages": messages, "stream": false}
	case "lmstudio":
		endpoint = strings.TrimRight(baseURL, "/") + "/v1/chat/completions"
		payload = map[string]any{"model": model, "messages": messages, "stream": false}
	default:
		return "", fmt.Errorf("%s chat adapter is not available yet", provider.Name)
	}
	body, _ := json.Marshal(payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		return "", fmt.Errorf("%s returned %s", provider.Name, response.Status)
	}
	if providerID == "ollama" {
		var result struct {
			Message ChatMessage `json:"message"`
		}
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			return "", err
		}
		if onChunk != nil {
			onChunk(result.Message.Content)
		}
		return result.Message.Content, nil
	}
	var result struct {
		Choices []struct {
			Message ChatMessage `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Choices) == 0 {
		return "", errors.New("provider returned no response")
	}
	reply := result.Choices[0].Message.Content
	if onChunk != nil {
		onChunk(reply)
	}
	return reply, nil
}

func (s *Service) StartChat(workspace, providerID, model string, messages []ChatMessage) string {
	id := fmt.Sprintf("chat-%d", s.chatSeq.Add(1))
	s.chatMu.Lock()
	s.chats[id] = ChatStream{}
	s.chatMu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		reply, err := s.Chat(ctx, workspace, providerID, model, messages, func(chunk string) {
			s.chatMu.Lock()
			stream := s.chats[id]
			stream.Reply += chunk
			s.chats[id] = stream
			s.chatMu.Unlock()
		})
		s.chatMu.Lock()
		stream := s.chats[id]
		if stream.Reply == "" {
			stream.Reply = reply
		}
		if err != nil {
			stream.Error = err.Error()
		}
		stream.Done = true
		s.chats[id] = stream
		s.chatMu.Unlock()
	}()
	return id
}

func (s *Service) PollChat(id string) (ChatStream, error) {
	s.chatMu.Lock()
	defer s.chatMu.Unlock()
	stream, ok := s.chats[id]
	if !ok {
		return ChatStream{}, errors.New("chat stream not found")
	}
	if stream.Done {
		delete(s.chats, id)
	}
	return stream, nil
}

func commandLines(path string, args ...string) []string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, args...).Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return nil
	}
	return lines
}

func chatWithCLI(ctx context.Context, workspace, providerID, model string, messages []ChatMessage, onChunk func(string)) (string, error) {
	commandName := map[string]string{"opencode": "opencode", "claude": "claude", "codex": "codex"}[providerID]
	path, err := exec.LookPath(commandName)
	if err != nil {
		return "", fmt.Errorf("%s is not installed", commandName)
	}
	prompt := chatPrompt(messages)
	if providerID == "opencode" {
		args := []string{"run", "--format", "json", "--dir", workspace}
		if model != "" {
			args = append(args, "--model", model)
		}
		args = append(args, prompt)
		command := exec.CommandContext(ctx, path, args...)
		var stderr bytes.Buffer
		command.Stderr = &stderr
		stdout, err := command.StdoutPipe()
		if err != nil {
			return "", err
		}
		if err := command.Start(); err != nil {
			return "", err
		}
		var reply strings.Builder
		var providerError string
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64<<10), 2<<20)
		for scanner.Scan() {
			var event struct {
				Type  string `json:"type"`
				Error struct {
					Data struct {
						Message string `json:"message"`
					} `json:"data"`
				} `json:"error"`
				Part struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"part"`
			}
			if json.Unmarshal(scanner.Bytes(), &event) == nil && event.Type == "text" && event.Part.Type == "text" {
				reply.WriteString(event.Part.Text)
				if onChunk != nil {
					onChunk(event.Part.Text)
				}
			}
			if event.Type == "error" {
				providerError = event.Error.Data.Message
			}
		}
		if err := command.Wait(); err != nil {
			return "", fmt.Errorf("OpenCode failed: %s", strings.TrimSpace(stderr.String()))
		}
		if err := scanner.Err(); err != nil {
			return "", err
		}
		if reply.Len() == 0 {
			if providerError != "" {
				return "", errors.New(providerError)
			}
			return "", errors.New("OpenCode returned no response")
		}
		return reply.String(), nil
	}
	if providerID == "claude" {
		args := []string{"--print", "--output-format", "text", "--no-session-persistence"}
		if model != "" {
			args = append(args, "--model", model)
		}
		args = append(args, prompt)
		command := exec.CommandContext(ctx, path, args...)
		command.Dir = workspace
		output, err := command.CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("Claude failed: %s", strings.TrimSpace(string(output)))
		}
		reply := strings.TrimSpace(string(output))
		if onChunk != nil {
			onChunk(reply)
		}
		return reply, nil
	}
	outputFile, err := os.CreateTemp("", "symtab-codex-response-*.txt")
	if err != nil {
		return "", err
	}
	outputPath := outputFile.Name()
	_ = outputFile.Close()
	defer os.Remove(outputPath)
	args := []string{"exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "-C", workspace, "--output-last-message", outputPath}
	if model != "" {
		args = append(args, "--model", model)
	}
	args = append(args, prompt)
	output, err := exec.CommandContext(ctx, path, args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("Codex failed: %s", strings.TrimSpace(string(output)))
	}
	reply, err := os.ReadFile(outputPath)
	if err != nil {
		return "", err
	}
	result := strings.TrimSpace(string(reply))
	if onChunk != nil {
		onChunk(result)
	}
	return result, nil
}

func chatPrompt(messages []ChatMessage) string {
	var prompt strings.Builder
	for _, message := range messages {
		prompt.WriteString(strings.ToUpper(message.Role))
		prompt.WriteString(": ")
		prompt.WriteString(message.Content)
		prompt.WriteString("\n\n")
	}
	prompt.WriteString("Respond to the latest USER message. Do not edit files or run tools.")
	return prompt.String()
}

func (s *Service) GetProvider(id string) (domain.ModelProvider, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	provider, exists := s.providers[id]
	if !exists {
		return domain.ModelProvider{}, ErrProviderNotFound
	}
	return provider, nil
}

func (s *Service) UpdateProvider(id string, config map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	provider, exists := s.providers[id]
	if !exists {
		return ErrProviderNotFound
	}

	provider.Config = config
	s.providers[id] = provider

	return s.save()
}

func (s *Service) ListRuntimes() []domain.AIRuntime {
	s.mu.RLock()
	defer s.mu.RUnlock()

	runtimes := make([]domain.AIRuntime, 0, len(s.runtimes))
	for _, runtime := range s.runtimes {
		runtimes = append(runtimes, runtime)
	}
	return runtimes
}

func (s *Service) GetRuntime(id string) (domain.AIRuntime, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	runtime, exists := s.runtimes[id]
	if !exists {
		return domain.AIRuntime{}, ErrProviderNotFound
	}
	return runtime, nil
}
