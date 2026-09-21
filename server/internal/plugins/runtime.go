package plugins

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const maxRuntimeEntryBytes = 20 * 1024 * 1024

var (
	ambientRuntimePattern = regexp.MustCompile(`\b(?:require\s*\(|process\s*\.|global\s*\.|Buffer\s*\.|Bun\s*\.|Deno\s*\.)|["']node:`)
	importPattern         = regexp.MustCompile(`(?m)(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']`)
)

// NodeSyntaxRuntime performs bounded package preflight only. It never executes
// plugin code. A real capability-only JS sandbox must replace it before plugins
// can run.
type NodeSyntaxRuntime struct {
	NodeBinary string
	Timeout    time.Duration
}

// BundleRuntime performs dependency-free package preflight. Execution happens
// only inside renderer SES compartments; Go never evaluates plugin JavaScript.
type BundleRuntime struct{}

func (BundleRuntime) ValidatePackage(_ context.Context, plugin InstalledPlugin, manifest Manifest) error {
	entry := filepath.Join(plugin.InstallPath, filepath.FromSlash(manifest.Entry))
	data, err := os.ReadFile(entry)
	if err != nil {
		return err
	}
	if len(data) > maxRuntimeEntryBytes {
		return errors.New("plugin entry exceeds 20 MiB runtime limit")
	}
	source := string(data)
	if ambientRuntimePattern.MatchString(source) || !strings.Contains(source, "__fluxRegisterPlugin") {
		return errors.New("plugin entry is not a self-contained Symtab runtime bundle")
	}
	return nil
}

func NewNodeSyntaxRuntime(nodeBinary string, timeout time.Duration) NodeSyntaxRuntime {
	if nodeBinary == "" {
		nodeBinary = "node"
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return NodeSyntaxRuntime{NodeBinary: nodeBinary, Timeout: timeout}
}

func (r NodeSyntaxRuntime) ValidatePackage(ctx context.Context, plugin InstalledPlugin, manifest Manifest) error {
	entry := filepath.Join(plugin.InstallPath, filepath.FromSlash(manifest.Entry))
	data, err := os.ReadFile(entry)
	if err != nil {
		return err
	}
	if len(data) > maxRuntimeEntryBytes {
		return errors.New("plugin entry exceeds 20 MiB runtime limit")
	}
	source := string(data)
	if ambientRuntimePattern.MatchString(source) {
		return errors.New("plugin entry references a forbidden ambient runtime API")
	}
	for _, match := range importPattern.FindAllStringSubmatch(source, -1) {
		specifier := match[1]
		if !strings.HasPrefix(specifier, "./") && !strings.HasPrefix(specifier, "../") {
			return fmt.Errorf("plugin entry contains unbundled import %q", specifier)
		}
	}

	checkContext, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()
	command := exec.CommandContext(checkContext, r.NodeBinary, "--input-type=module", "--check")
	command.Stdin = strings.NewReader(source)
	output, err := command.CombinedOutput()
	if errors.Is(checkContext.Err(), context.DeadlineExceeded) {
		return errors.New("plugin syntax validation timed out")
	}
	if errors.Is(err, exec.ErrNotFound) {
		return ErrRuntimeUnavailable
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 1000 {
			message = message[:1000]
		}
		return fmt.Errorf("plugin syntax validation failed: %s", message)
	}
	return nil
}
