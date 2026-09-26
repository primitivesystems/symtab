package plugins

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
)

const ManifestFile = "symtab.plugin.json"

var (
	pluginIDPattern   = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)
	versionPattern    = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)
	capabilityPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$`)
)

var supportedCapabilities = map[string]bool{
	"vault.read": true, "vault.write": true, "vault.move": true, "vault.delete": true,
	"vault.search": true, "documents.parse": true, "tasks.query": true, "tasks.update": true,
	"ui.command": true, "ui.view": true, "ui.external": true, "network.fetch": true, "background.run": true,
	"git.status": true, "git.init": true, "git.stage": true, "git.unstage": true,
	"git.commit": true, "git.pull": true, "git.push": true, "git.fetch": true, "git.diff": true,
	"git.remote.set": true, "git.remote.remove": true,
	"git.discard": true, "git.branches": true, "git.checkout": true, "git.branch.create": true,
	"git.history": true, "git.resolve": true,
	"ai.providers": true, "ai.chat": true,
}

var supportedViewLocations = map[string]bool{
	"": true, "modal": true, "left-sidebar": true, "right-sidebar": true, "workspace": true,
}

var supportedViewIcons = map[string]bool{
	"": true, "puzzle": true, "sparkles": true, "panel-left": true, "panel-right": true,
	"layout-dashboard": true, "calendar": true, "list": true, "git-branch": true,
}

type Manifest struct {
	SchemaVersion       int           `json:"schemaVersion"`
	ID                  string        `json:"id"`
	Name                string        `json:"name"`
	Description         string        `json:"description,omitempty"`
	Publisher           string        `json:"publisher,omitempty"`
	Version             string        `json:"version"`
	APIVersion          string        `json:"apiVersion"`
	Entry               string        `json:"entry"`
	RequiredPermissions []string      `json:"requiredPermissions,omitempty"`
	OptionalPermissions []string      `json:"optionalPermissions,omitempty"`
	ActivationEvents    []string      `json:"activationEvents,omitempty"`
	Contributions       Contributions `json:"contributes,omitempty"`
}

type Contributions struct {
	Commands []CommandContribution `json:"commands,omitempty"`
	Views    []ViewContribution    `json:"views,omitempty"`
	Settings []SettingContribution `json:"settings,omitempty"`
}

type CommandContribution struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type ViewContribution struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Entry    string `json:"entry"`
	Location string `json:"location,omitempty"`
	Icon     string `json:"icon,omitempty"`
	IconPath string `json:"iconPath,omitempty"`
}

func (v ViewContribution) EffectiveLocation() string {
	if v.Location == "" {
		return "left-sidebar"
	}
	return v.Location
}

type SettingContribution struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description,omitempty"`
	Type        string          `json:"type"`
	Default     json.RawMessage `json:"default,omitempty"`
}

func (m Manifest) Validate() error {
	if m.SchemaVersion != 1 {
		return fmt.Errorf("unsupported manifest schema version %d", m.SchemaVersion)
	}
	if !pluginIDPattern.MatchString(m.ID) {
		return errors.New("plugin ID must be lowercase and contain only letters, numbers, dots, or hyphens")
	}
	if strings.TrimSpace(m.Name) == "" || len(m.Name) > 120 {
		return errors.New("plugin name is required and must not exceed 120 characters")
	}
	if !versionPattern.MatchString(m.Version) {
		return errors.New("plugin version must be semantic versioning")
	}
	if strings.TrimSpace(m.APIVersion) == "" {
		return errors.New("plugin API version is required")
	}
	if err := validateEntry(m.Entry); err != nil {
		return err
	}
	required, err := validateCapabilities(m.RequiredPermissions)
	if err != nil {
		return fmt.Errorf("required permissions: %w", err)
	}
	optional, err := validateCapabilities(m.OptionalPermissions)
	if err != nil {
		return fmt.Errorf("optional permissions: %w", err)
	}
	for permission := range required {
		if _, exists := optional[permission]; exists {
			return fmt.Errorf("permission %q cannot be both required and optional", permission)
		}
	}
	if slices.Contains(m.ActivationEvents, "*") {
		return errors.New("unbounded activation event is not allowed")
	}
	if err := m.validateContributions(); err != nil {
		return err
	}
	return nil
}

func (m Manifest) validateContributions() error {
	seen := make(map[string]struct{})
	validateID := func(id, title string) error {
		if !pluginIDPattern.MatchString(id) || !strings.HasPrefix(id, m.ID+".") {
			return fmt.Errorf("contribution ID %q must be scoped to %q", id, m.ID)
		}
		if strings.TrimSpace(title) == "" {
			return fmt.Errorf("contribution %q requires a title", id)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("duplicate contribution ID %q", id)
		}
		seen[id] = struct{}{}
		return nil
	}
	for _, command := range m.Contributions.Commands {
		if err := validateID(command.ID, command.Title); err != nil {
			return err
		}
	}
	for _, view := range m.Contributions.Views {
		if err := validateID(view.ID, view.Title); err != nil {
			return err
		}
		if view.Entry == "" || strings.Contains(view.Entry, `\`) || path.IsAbs(view.Entry) || path.Clean(view.Entry) != view.Entry || strings.HasPrefix(view.Entry, "../") || strings.ToLower(path.Ext(view.Entry)) != ".html" {
			return fmt.Errorf("view %q entry must be a clean relative .html path", view.ID)
		}
		if !supportedViewLocations[view.Location] {
			return fmt.Errorf("view %q has unsupported location %q", view.ID, view.Location)
		}
		if !supportedViewIcons[view.Icon] {
			return fmt.Errorf("view %q has unsupported icon %q", view.ID, view.Icon)
		}
		if view.IconPath != "" && !validPluginAsset(view.IconPath, ".svg") {
			return fmt.Errorf("view %q iconPath must be a clean relative .svg path", view.ID)
		}
	}
	for _, setting := range m.Contributions.Settings {
		if err := validateID(setting.ID, setting.Title); err != nil {
			return err
		}
		if setting.Type != "string" && setting.Type != "number" && setting.Type != "boolean" {
			return fmt.Errorf("setting %q has unsupported type %q", setting.ID, setting.Type)
		}
		if len(setting.Default) != 0 && !json.Valid(setting.Default) {
			return fmt.Errorf("setting %q has invalid default JSON", setting.ID)
		}
		if len(setting.Default) != 0 {
			var value any
			if err := json.Unmarshal(setting.Default, &value); err != nil {
				return fmt.Errorf("setting %q has invalid default JSON", setting.ID)
			}
			matches := false
			switch setting.Type {
			case "string":
				_, matches = value.(string)
			case "number":
				_, matches = value.(float64)
			case "boolean":
				_, matches = value.(bool)
			}
			if !matches {
				return fmt.Errorf("setting %q default does not match type %q", setting.ID, setting.Type)
			}
		}
	}
	return nil
}

func validPluginAsset(value, extension string) bool {
	return value != "" && !strings.Contains(value, `\`) && !path.IsAbs(value) &&
		path.Clean(value) == value && !strings.HasPrefix(value, "../") &&
		strings.EqualFold(path.Ext(value), extension)
}

func validateEntry(entry string) error {
	if entry == "" || strings.Contains(entry, `\`) || path.IsAbs(entry) || path.Clean(entry) != entry || strings.HasPrefix(entry, "../") {
		return errors.New("plugin entry must be a clean relative path")
	}
	ext := strings.ToLower(path.Ext(entry))
	if ext != ".js" && ext != ".mjs" {
		return errors.New("plugin entry must be a bundled .js or .mjs file")
	}
	return nil
}

func validateCapabilities(values []string) (map[string]struct{}, error) {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		if !capabilityPattern.MatchString(value) {
			return nil, fmt.Errorf("invalid capability %q", value)
		}
		if !supportedCapabilities[value] {
			return nil, fmt.Errorf("unsupported capability %q", value)
		}
		if _, exists := result[value]; exists {
			return nil, fmt.Errorf("duplicate capability %q", value)
		}
		result[value] = struct{}{}
	}
	return result, nil
}
