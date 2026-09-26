package plugins

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"
)

const (
	maxRegistryBytes = 5 << 20
	maxReadmeBytes   = 256 << 10
)

var ErrRegistryUnavailable = errors.New("plugin marketplace is not configured")

type MarketplaceIndex struct {
	SchemaVersion int                 `json:"schemaVersion"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	Plugins       []MarketplacePlugin `json:"plugins"`
}

type MarketplacePlugin struct {
	Manifest    Manifest  `json:"manifest"`
	Publisher   string    `json:"publisher"`
	Repository  string    `json:"repository"`
	DownloadURL string    `json:"downloadUrl"`
	SHA256      string    `json:"sha256"`
	README      string    `json:"readme,omitempty"`
	Changelog   string    `json:"changelog,omitempty"`
	PublishedAt time.Time `json:"publishedAt"`
}

type Registry struct {
	indexURL     string
	signatureURL string
	publicKey    ed25519.PublicKey
	client       *http.Client
	mu           sync.Mutex
	cached       MarketplaceIndex
	expires      time.Time
}

func NewRegistry(indexURL, signatureURL, publicKey string) (*Registry, error) {
	if indexURL == "" && publicKey == "" {
		return nil, nil
	}
	if indexURL == "" || publicKey == "" {
		return nil, errors.New("plugin registry URL and public key must be configured together")
	}
	if signatureURL == "" {
		signatureURL = indexURL + ".sig"
	}
	if err := validateRegistryURL(indexURL); err != nil {
		return nil, err
	}
	if err := validateRegistryURL(signatureURL); err != nil {
		return nil, err
	}
	decoded, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil || len(decoded) != ed25519.PublicKeySize {
		return nil, errors.New("plugin registry public key must be base64 Ed25519")
	}
	return &Registry{
		indexURL: indexURL, signatureURL: signatureURL, publicKey: decoded,
		client: &http.Client{Timeout: 20 * time.Second},
	}, nil
}

func (r *Registry) List(ctx context.Context) (MarketplaceIndex, error) {
	if r == nil {
		return MarketplaceIndex{}, ErrRegistryUnavailable
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Now().Before(r.expires) {
		return r.cached, nil
	}
	indexBytes, err := r.get(ctx, r.indexURL, maxRegistryBytes)
	if err != nil {
		return MarketplaceIndex{}, err
	}
	signatureText, err := r.get(ctx, r.signatureURL, 1024)
	if err != nil {
		return MarketplaceIndex{}, err
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(signatureText)))
	if err != nil || !ed25519.Verify(r.publicKey, indexBytes, signature) {
		return MarketplaceIndex{}, errors.New("plugin registry signature is invalid")
	}
	var index MarketplaceIndex
	if err := json.Unmarshal(indexBytes, &index); err != nil {
		return MarketplaceIndex{}, fmt.Errorf("decode plugin registry: %w", err)
	}
	if err := index.Validate(); err != nil {
		return MarketplaceIndex{}, err
	}
	r.cached, r.expires = index, time.Now().Add(5*time.Minute)
	return index, nil
}

func (r *Registry) Package(ctx context.Context, pluginID string) (MarketplacePlugin, []byte, error) {
	index, err := r.List(ctx)
	if err != nil {
		return MarketplacePlugin{}, nil, err
	}
	for _, item := range index.Plugins {
		if item.Manifest.ID != pluginID {
			continue
		}
		data, err := r.get(ctx, item.DownloadURL, maxArchiveBytes)
		if err != nil {
			return MarketplacePlugin{}, nil, err
		}
		sum := sha256.Sum256(data)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), item.SHA256) {
			return MarketplacePlugin{}, nil, ErrChecksumMismatch
		}
		return item, data, nil
	}
	return MarketplacePlugin{}, nil, ErrPluginNotFound
}

func (index MarketplaceIndex) Validate() error {
	if index.SchemaVersion != 1 {
		return fmt.Errorf("unsupported plugin registry schema version %d", index.SchemaVersion)
	}
	seen := make(map[string]struct{}, len(index.Plugins))
	for _, item := range index.Plugins {
		if err := item.Manifest.Validate(); err != nil {
			return fmt.Errorf("%s: %w", item.Manifest.ID, err)
		}
		if item.Publisher == "" || item.Repository == "" {
			return fmt.Errorf("%s: publisher and repository are required", item.Manifest.ID)
		}
		if item.Manifest.Publisher != "" && item.Manifest.Publisher != item.Publisher {
			return fmt.Errorf("%s: publisher does not match manifest", item.Manifest.ID)
		}
		if len(item.README) > maxReadmeBytes {
			return fmt.Errorf("%s: README exceeds 256 KiB", item.Manifest.ID)
		}
		if len(item.SHA256) != sha256.Size*2 {
			return fmt.Errorf("%s: invalid SHA-256", item.Manifest.ID)
		}
		if _, err := hex.DecodeString(item.SHA256); err != nil {
			return fmt.Errorf("%s: invalid SHA-256", item.Manifest.ID)
		}
		if err := validateRegistryURL(item.Repository); err != nil {
			return fmt.Errorf("%s repository: %w", item.Manifest.ID, err)
		}
		if err := validateRegistryURL(item.DownloadURL); err != nil {
			return fmt.Errorf("%s download: %w", item.Manifest.ID, err)
		}
		if _, exists := seen[item.Manifest.ID]; exists {
			return fmt.Errorf("duplicate marketplace plugin %q", item.Manifest.ID)
		}
		seen[item.Manifest.ID] = struct{}{}
	}
	return nil
}

func (r *Registry) get(ctx context.Context, address string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	response, err := r.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if err := validateRegistryURL(response.Request.URL.String()); err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("plugin registry request failed with status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("plugin registry response exceeds size limit")
	}
	return data, nil
}

func validateRegistryURL(address string) error {
	parsed, err := url.Parse(address)
	if err != nil || parsed.Host == "" {
		return errors.New("invalid URL")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost" || parsed.Hostname() == "::1")) {
		return errors.New("URL must use HTTPS or loopback HTTP")
	}
	if parsed.User != nil {
		return errors.New("URL credentials are not allowed")
	}
	return nil
}

func (m *Manager) Marketplace(ctx context.Context) (MarketplaceIndex, error) {
	return m.registry.List(ctx)
}

func (m *Manager) InstallMarketplace(ctx context.Context, pluginID string) (InstallResult, error) {
	item, data, err := m.registry.Package(ctx, pluginID)
	if err != nil {
		return InstallResult{}, err
	}
	temporary, err := os.CreateTemp("", "symtab-marketplace-*.symtab-plugin")
	if err != nil {
		return InstallResult{}, err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return InstallResult{}, err
	}
	if err := temporary.Close(); err != nil {
		return InstallResult{}, err
	}
	result, err := m.InstallPackage(ctx, name, item.SHA256)
	if err != nil {
		return InstallResult{}, err
	}
	if !reflect.DeepEqual(result.Manifest, item.Manifest) {
		_ = m.Uninstall(result.Manifest.ID, result.Manifest.Version)
		return InstallResult{}, errors.New("marketplace package manifest does not match signed registry")
	}
	return result, nil
}
