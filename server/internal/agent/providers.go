package agent

import "os/exec"

type providerSpec struct {
	id      string
	name    string
	command string
	args    []string
}

var providerSpecs = []providerSpec{
	{id: "opencode", name: "OpenCode", command: "opencode", args: []string{"acp"}},
	{id: "gemini", name: "Gemini CLI", command: "gemini", args: []string{"--acp"}},
	{id: "codex", name: "Codex", command: "codex-acp"},
	{id: "claude", name: "Claude Code", command: "claude-agent-acp"},
	{id: "copilot", name: "GitHub Copilot", command: "copilot", args: []string{"--acp"}},
}

var acpCapabilities = ProviderCapabilities{
	Streaming: true, Reasoning: true, Tools: true, Files: true, Images: true, Plans: true,
}

func Providers() []Provider {
	providers := make([]Provider, 0, len(providerSpecs)+1)
	for _, spec := range providerSpecs {
		_, err := exec.LookPath(spec.command)
		status := "ready"
		if err != nil {
			status = "not_installed"
		}
		providers = append(providers, Provider{
			ID: spec.id, Name: spec.name, Available: err == nil,
			Status: status, Capabilities: acpCapabilities,
		})
	}
	providers = append(providers, Provider{
		ID: "demo", Name: "Symtab Demo", Available: true, Status: "ready",
		Capabilities: acpCapabilities,
	})
	return providers
}

func findProvider(id string) (providerSpec, bool) {
	for _, spec := range providerSpecs {
		if spec.id == id {
			_, err := exec.LookPath(spec.command)
			return spec, err == nil
		}
	}
	return providerSpec{}, false
}
