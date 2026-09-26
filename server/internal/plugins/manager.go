package plugins

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	maxArchiveBytes   = 25 * 1024 * 1024
	maxExtractedBytes = 100 * 1024 * 1024
	maxArchiveEntries = 4096
	maxManifestBytes  = 1024 * 1024
)

var (
	ErrChecksumMismatch   = errors.New("plugin package checksum mismatch")
	ErrRuntimeUnavailable = errors.New("isolated plugin runtime is unavailable")
	ErrVersionExists      = errors.New("plugin version is already installed")
)

// Runtime validates bundles inside an isolated JavaScript host. Implementations
// must not expose Node.js, shell, filesystem, Electron, or Go internals.
type Runtime interface {
	ValidatePackage(context.Context, InstalledPlugin, Manifest) error
}

type Manager struct {
	root     string
	store    *MetadataStore
	runtime  Runtime
	registry *Registry
	mu       sync.Mutex
}

type InstallResult struct {
	Manifest Manifest        `json:"manifest"`
	Plugin   InstalledPlugin `json:"plugin"`
}

type CatalogPlugin struct {
	Manifest  Manifest          `json:"manifest"`
	Plugin    InstalledPlugin   `json:"plugin"`
	Active    bool              `json:"active"`
	ViewIcons map[string]string `json:"viewIcons,omitempty"`
}

type RuntimeBundle struct {
	Manifest            Manifest       `json:"manifest"`
	Source              string         `json:"source"`
	GrantedCapabilities []string       `json:"grantedCapabilities"`
	Settings            map[string]any `json:"settings"`
}

func (m *Manager) List() ([]CatalogPlugin, error) {
	installed, err := m.store.ListInstalled()
	if err != nil {
		return nil, err
	}
	active, err := m.store.ListActive()
	if err != nil {
		return nil, err
	}
	activeVersions := make(map[string]string, len(active))
	for _, item := range active {
		activeVersions[item.PluginID] = item.ActiveVersion
	}
	result := make([]CatalogPlugin, 0, len(installed))
	for _, item := range installed {
		var manifest Manifest
		if err := json.Unmarshal([]byte(item.ManifestJSON), &manifest); err != nil {
			return nil, err
		}
		viewIcons := make(map[string]string)
		for _, view := range manifest.Contributions.Views {
			if view.IconPath == "" {
				continue
			}
			data, readErr := os.ReadFile(filepath.Join(item.InstallPath, filepath.FromSlash(view.IconPath)))
			if readErr != nil || len(data) > 64*1024 {
				continue
			}
			viewIcons[view.ID] = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString(data)
		}
		result = append(result, CatalogPlugin{Manifest: manifest, Plugin: item, Active: activeVersions[item.PluginID] == item.Version, ViewIcons: viewIcons})
	}
	return result, nil
}

func (m *Manager) ListForVault(vaultID string) ([]VaultPluginResponse, error) {
	return m.store.ListForVault(vaultID)
}

func (m *Manager) RuntimeBundles(vaultID, vaultRoot string) ([]RuntimeBundle, error) {
	vaultPlugins, err := m.store.ListForVault(vaultID)
	if err != nil {
		return nil, err
	}
	result := make([]RuntimeBundle, 0, len(vaultPlugins))
	for _, enabled := range vaultPlugins {
		if !enabled.Enabled {
			continue
		}
		active, err := m.store.Active(enabled.PluginID)
		if err != nil {
			return nil, err
		}
		plugin, manifest, err := m.load(enabled.PluginID, active.ActiveVersion)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(filepath.Join(plugin.InstallPath, filepath.FromSlash(manifest.Entry)))
		if err != nil {
			return nil, err
		}
		if len(data) > maxRuntimeEntryBytes {
			return nil, errors.New("plugin entry exceeds runtime limit")
		}
		settings, err := m.ReadSettings(vaultRoot, enabled.PluginID)
		if err != nil {
			return nil, err
		}
		result = append(result, RuntimeBundle{
			Manifest: manifest, Source: string(data),
			GrantedCapabilities: enabled.GrantedPermissions, Settings: settings,
		})
	}
	return result, nil
}

func (m *Manager) AuthorizeVaultCapability(vaultID, pluginID, capability string) error {
	items, err := m.store.ListForVault(vaultID)
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.PluginID != pluginID || !item.Enabled {
			continue
		}
		for _, granted := range item.GrantedPermissions {
			if granted == capability {
				return nil
			}
		}
	}
	return errors.New("plugin capability is not granted")
}

func (m *Manager) ReadView(vaultID, pluginID, viewID string) (ViewContribution, string, error) {
	if err := m.AuthorizeVaultCapability(vaultID, pluginID, "ui.view"); err != nil {
		return ViewContribution{}, "", err
	}
	active, err := m.store.Active(pluginID)
	if err != nil {
		return ViewContribution{}, "", err
	}
	plugin, manifest, err := m.load(pluginID, active.ActiveVersion)
	if err != nil {
		return ViewContribution{}, "", err
	}
	for _, view := range manifest.Contributions.Views {
		if view.ID != viewID {
			continue
		}
		data, err := os.ReadFile(filepath.Join(plugin.InstallPath, filepath.FromSlash(view.Entry)))
		if err != nil {
			return ViewContribution{}, "", err
		}
		if len(data) > 1<<20 {
			return ViewContribution{}, "", errors.New("plugin view exceeds 1 MiB")
		}
		return view, string(data), nil
	}
	return ViewContribution{}, "", ErrPluginNotFound
}

func NewManager(appDataDirectory string, store *MetadataStore, runtime Runtime) (*Manager, error) {
	if store == nil {
		return nil, errors.New("plugin metadata store is required")
	}
	absolute, err := filepath.Abs(appDataDirectory)
	if err != nil {
		return nil, err
	}
	root := filepath.Join(absolute, "plugins")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &Manager{root: root, store: store, runtime: runtime}, nil
}

func (m *Manager) SetRegistry(registry *Registry) {
	m.registry = registry
}

func (m *Manager) InstallPackage(ctx context.Context, archivePath, expectedSHA256 string) (InstallResult, error) {
	return m.installPackage(ctx, archivePath, expectedSHA256, false)
}

// InstallDevelopmentPackage replaces a local same-version build. It is exposed
// only through the authenticated desktop API; marketplace installs never use it.
func (m *Manager) InstallDevelopmentPackage(ctx context.Context, archivePath, expectedSHA256 string) (InstallResult, error) {
	return m.installPackage(ctx, archivePath, expectedSHA256, true)
}

func (m *Manager) installPackage(ctx context.Context, archivePath, expectedSHA256 string, development bool) (InstallResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := ctx.Err(); err != nil {
		return InstallResult{}, err
	}
	checksum, err := checksumFile(archivePath)
	if err != nil {
		return InstallResult{}, err
	}
	if len(expectedSHA256) != sha256.Size*2 || !strings.EqualFold(checksum, expectedSHA256) {
		return InstallResult{}, ErrChecksumMismatch
	}
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return InstallResult{}, fmt.Errorf("open plugin package: %w", err)
	}
	defer archive.Close()

	manifest, files, err := inspectArchive(&archive.Reader)
	if err != nil {
		return InstallResult{}, err
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return InstallResult{}, err
	}
	target := filepath.Join(m.root, manifest.ID, manifest.Version)
	existing, existingErr := m.store.Version(manifest.ID, manifest.Version)
	reloading := existingErr == nil
	if existingErr != nil && !errors.Is(existingErr, ErrPluginNotFound) {
		return InstallResult{}, existingErr
	}
	if reloading {
		if strings.EqualFold(existing.Checksum, checksum) {
			if existing.Development != development {
				existing.Development = development
				if err := m.store.Stage(existing); err != nil {
					return InstallResult{}, err
				}
			}
			return InstallResult{Manifest: manifest, Plugin: existing}, nil
		}
		if existing.ManifestJSON != string(manifestJSON) && !development {
			return InstallResult{}, fmt.Errorf("%w: change version when manifest changes", ErrVersionExists)
		}
		if existing.ManifestJSON != string(manifestJSON) {
			var previous Manifest
			if err := json.Unmarshal([]byte(existing.ManifestJSON), &previous); err != nil {
				return InstallResult{}, err
			}
			if !slices.Equal(previous.RequiredPermissions, manifest.RequiredPermissions) {
				return InstallResult{}, errors.New("development reload cannot change required permissions; disable and reinstall the plugin")
			}
		}
	}
	if _, err := os.Stat(target); err == nil {
		if !reloading {
			// Recover a bundle rename completed before its metadata transaction.
			if err := os.RemoveAll(target); err != nil {
				return InstallResult{}, err
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return InstallResult{}, err
	} else if reloading {
		return InstallResult{}, errors.New("installed plugin files are missing")
	}

	stagingRoot := filepath.Join(m.root, ".staging")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return InstallResult{}, err
	}
	temporary, err := os.MkdirTemp(stagingRoot, manifest.ID+"-")
	if err != nil {
		return InstallResult{}, err
	}
	defer os.RemoveAll(temporary)
	if err := extractArchive(ctx, temporary, files); err != nil {
		return InstallResult{}, err
	}
	entryInfo, err := os.Stat(filepath.Join(temporary, filepath.FromSlash(manifest.Entry)))
	if err != nil || !entryInfo.Mode().IsRegular() {
		return InstallResult{}, fmt.Errorf("plugin entry %q is missing", manifest.Entry)
	}
	for _, view := range manifest.Contributions.Views {
		viewInfo, err := os.Stat(filepath.Join(temporary, filepath.FromSlash(view.Entry)))
		if err != nil || !viewInfo.Mode().IsRegular() {
			return InstallResult{}, fmt.Errorf("plugin view entry %q is missing", view.Entry)
		}
		if view.IconPath != "" {
			iconInfo, iconErr := os.Stat(filepath.Join(temporary, filepath.FromSlash(view.IconPath)))
			if iconErr != nil || !iconInfo.Mode().IsRegular() || iconInfo.Size() > 64*1024 {
				return InstallResult{}, fmt.Errorf("plugin view icon %q is missing or exceeds 64 KiB", view.IconPath)
			}
		}
	}
	plugin := InstalledPlugin{
		PluginID: manifest.ID, Version: manifest.Version, ManifestJSON: string(manifestJSON),
		Checksum: checksum, InstallPath: target, Development: development,
		Status: StatusStaged, InstalledAt: time.Now().UTC(),
	}
	if reloading {
		plugin.Status = existing.Status
		plugin.ActivatedAt = existing.ActivatedAt
		if existing.Status == StatusActive && m.runtime != nil {
			candidate := plugin
			candidate.InstallPath = temporary
			if err := m.runtime.ValidatePackage(ctx, candidate, manifest); err != nil {
				return InstallResult{}, err
			}
		}
		backup := target + ".reload"
		_ = os.RemoveAll(backup)
		if err := os.Rename(target, backup); err != nil {
			return InstallResult{}, err
		}
		if err := os.Rename(temporary, target); err != nil {
			_ = os.Rename(backup, target)
			return InstallResult{}, err
		}
		if err := m.store.Stage(plugin); err != nil {
			_ = os.RemoveAll(target)
			_ = os.Rename(backup, target)
			return InstallResult{}, err
		}
		_ = os.RemoveAll(backup)
		return InstallResult{Manifest: manifest, Plugin: plugin}, nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return InstallResult{}, err
	}
	if err := os.Rename(temporary, target); err != nil {
		return InstallResult{}, err
	}
	if err := m.store.Stage(plugin); err != nil {
		_ = os.RemoveAll(target)
		return InstallResult{}, err
	}
	return InstallResult{Manifest: manifest, Plugin: plugin}, nil
}

func (m *Manager) Activate(ctx context.Context, pluginID, version string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runtime == nil {
		return ErrRuntimeUnavailable
	}
	if active, err := m.store.Active(pluginID); err == nil && active.ActiveVersion == version {
		return nil
	} else if err != nil && !errors.Is(err, ErrPluginNotFound) {
		return err
	}
	plugin, manifest, err := m.load(pluginID, version)
	if err != nil {
		return err
	}
	// Runtime validation happens outside SQLite transactions.
	if err := m.runtime.ValidatePackage(ctx, plugin, manifest); err != nil {
		_ = m.store.MarkFailed(pluginID, version, err.Error())
		return err
	}
	return m.store.Activate(pluginID, version)
}

func (m *Manager) Rollback(ctx context.Context, pluginID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runtime == nil {
		return ErrRuntimeUnavailable
	}
	active, err := m.store.Active(pluginID)
	if err != nil {
		return err
	}
	if active.PreviousVersion == "" {
		return errors.New("plugin has no previous version")
	}
	plugin, manifest, err := m.load(pluginID, active.PreviousVersion)
	if err != nil {
		return err
	}
	if err := m.runtime.ValidatePackage(ctx, plugin, manifest); err != nil {
		_ = m.store.MarkFailed(pluginID, active.PreviousVersion, err.Error())
		return err
	}
	return m.store.Rollback(pluginID)
}

// Uninstall removes only global bundle files. Per-vault state stays retained.
func (m *Manager) Uninstall(pluginID, version string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !pluginIDPattern.MatchString(pluginID) || !versionPattern.MatchString(version) {
		return ErrPluginNotFound
	}
	plugin, err := m.store.Version(pluginID, version)
	if err != nil {
		return err
	}
	expectedPath := filepath.Join(m.root, pluginID, version)
	if filepath.Clean(plugin.InstallPath) != expectedPath {
		return errors.New("plugin install path does not match managed root")
	}
	active, activeErr := m.store.Active(pluginID)
	if plugin.Status == StatusActive || (activeErr == nil && active.ActiveVersion == version) {
		pluginRoot := filepath.Join(m.root, pluginID)
		if err := os.RemoveAll(pluginRoot); err != nil {
			return err
		}
		return m.store.DeletePlugin(pluginID)
	}
	if activeErr != nil && !errors.Is(activeErr, ErrPluginNotFound) {
		return activeErr
	}
	oldStatus, err := m.store.BeginUninstall(pluginID, version)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(expectedPath); err != nil {
		_ = m.store.RestoreStatus(pluginID, version, oldStatus)
		return err
	}
	return m.store.DeleteVersion(pluginID, version)
}

func (m *Manager) EnableForVault(vaultID, vaultRoot, pluginID string, granted []string) (VaultPaths, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	paths, err := EnsureVaultPaths(vaultRoot, pluginID)
	if err != nil {
		return VaultPaths{}, err
	}
	if err := m.store.EnableVaultPlugin(vaultID, pluginID, granted); err != nil {
		return VaultPaths{}, err
	}
	return paths, nil
}

func (m *Manager) DisableForVault(vaultID, pluginID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.store.DisableVaultPlugin(vaultID, pluginID)
}

func (m *Manager) ApproveUpdateForVault(vaultID, pluginID, version string, granted []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.store.ApproveVaultPluginUpdate(vaultID, pluginID, version, granted)
}

func (m *Manager) load(pluginID, version string) (InstalledPlugin, Manifest, error) {
	plugin, err := m.store.Version(pluginID, version)
	if err != nil {
		return InstalledPlugin{}, Manifest{}, err
	}
	var manifest Manifest
	if err := json.Unmarshal([]byte(plugin.ManifestJSON), &manifest); err != nil {
		return InstalledPlugin{}, Manifest{}, err
	}
	if err := manifest.Validate(); err != nil {
		return InstalledPlugin{}, Manifest{}, err
	}
	return plugin, manifest, nil
}

type VaultPaths struct {
	State string `json:"state"`
	Cache string `json:"cache"`
}

func PathsForVault(vaultRoot, pluginID string) (VaultPaths, error) {
	if !pluginIDPattern.MatchString(pluginID) {
		return VaultPaths{}, errors.New("invalid plugin ID")
	}
	absolute, err := filepath.Abs(vaultRoot)
	if err != nil {
		return VaultPaths{}, err
	}
	return VaultPaths{
		State: filepath.Join(absolute, ".symtab", "plugins", pluginID, "state"),
		Cache: filepath.Join(absolute, ".symtab", "cache", "plugins", pluginID),
	}, nil
}

func EnsureVaultPaths(vaultRoot, pluginID string) (VaultPaths, error) {
	paths, err := PathsForVault(vaultRoot, pluginID)
	if err != nil {
		return VaultPaths{}, err
	}
	if err := os.MkdirAll(paths.State, 0o700); err != nil {
		return VaultPaths{}, err
	}
	if err := os.MkdirAll(paths.Cache, 0o700); err != nil {
		return VaultPaths{}, err
	}
	return paths, nil
}

func checksumFile(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > maxArchiveBytes {
		return "", errors.New("plugin package must be a regular file no larger than 50 MiB")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func inspectArchive(archive *zip.Reader) (Manifest, []*zip.File, error) {
	if len(archive.File) == 0 || len(archive.File) > maxArchiveEntries {
		return Manifest{}, nil, errors.New("plugin package has invalid entry count")
	}
	seen := make(map[string]struct{}, len(archive.File))
	var total uint64
	var manifestFile *zip.File
	for _, file := range archive.File {
		name := file.Name
		if name == "" || strings.Contains(name, `\`) || path.IsAbs(name) || path.Clean(name) != strings.TrimSuffix(name, "/") || strings.HasPrefix(name, "../") {
			return Manifest{}, nil, fmt.Errorf("unsafe plugin package path %q", name)
		}
		clean := strings.TrimSuffix(name, "/")
		if _, exists := seen[clean]; exists {
			return Manifest{}, nil, fmt.Errorf("duplicate plugin package path %q", clean)
		}
		seen[clean] = struct{}{}
		if file.Mode()&os.ModeSymlink != 0 || (!file.FileInfo().IsDir() && !file.Mode().IsRegular()) {
			return Manifest{}, nil, fmt.Errorf("unsupported plugin package entry %q", name)
		}
		total += file.UncompressedSize64
		if total > maxExtractedBytes {
			return Manifest{}, nil, errors.New("plugin package expands beyond 100 MiB")
		}
		if clean == ManifestFile {
			manifestFile = file
		}
	}
	if manifestFile == nil || manifestFile.UncompressedSize64 > maxManifestBytes {
		return Manifest{}, nil, errors.New("plugin package must contain a root symtab.plugin.json")
	}
	reader, err := manifestFile.Open()
	if err != nil {
		return Manifest{}, nil, err
	}
	defer reader.Close()
	manifestBytes, err := io.ReadAll(io.LimitReader(reader, maxManifestBytes+1))
	if err != nil {
		return Manifest{}, nil, err
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return Manifest{}, nil, fmt.Errorf("decode plugin manifest: %w", err)
	}
	if err := manifest.Validate(); err != nil {
		return Manifest{}, nil, err
	}
	return manifest, archive.File, nil
}

func extractArchive(ctx context.Context, destination string, files []*zip.File) error {
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		target := filepath.Join(destination, filepath.FromSlash(file.Name))
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return err
		}
		reader, err := file.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			reader.Close()
			return err
		}
		_, copyErr := io.Copy(output, reader)
		closeErr := output.Close()
		readerErr := reader.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if readerErr != nil {
			return readerErr
		}
	}
	return nil
}
