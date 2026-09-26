package plugins

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRegistryVerifiesSignedMetadata(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	index := MarketplaceIndex{
		SchemaVersion: 1,
		UpdatedAt:     time.Now().UTC(),
		Plugins: []MarketplacePlugin{{
			Manifest: Manifest{
				SchemaVersion: 1, ID: "example.plugin", Name: "Example", Version: "1.0.0",
				APIVersion: "1", Entry: "dist/index.js", Publisher: "Example",
			},
			Publisher: "Example", Repository: "https://example.com/plugin",
			DownloadURL: "https://example.com/plugin.symtab-plugin",
			SHA256:      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			PublishedAt: time.Now().UTC(),
		}},
	}
	payload, err := json.Marshal(index)
	if err != nil {
		t.Fatal(err)
	}
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/registry.json.sig" {
			_, _ = response.Write([]byte(signature))
			return
		}
		_, _ = response.Write(payload)
	}))
	defer server.Close()
	registry, err := NewRegistry(
		server.URL+"/registry.json",
		server.URL+"/registry.json.sig",
		base64.StdEncoding.EncodeToString(publicKey),
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := registry.List(context.Background())
	if err != nil || len(result.Plugins) != 1 {
		t.Fatalf("signed registry failed: %#v, %v", result, err)
	}
}

func TestMarketplaceInstallUsesSignedChecksumAndManifest(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	manifest := testManifest("1.0.0")
	archivePath := createPackageFromManifest(t, manifest, manifest.Entry)
	archive, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	checksum, err := checksumFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	var payload []byte
	var signature string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/registry.json":
			_, _ = response.Write(payload)
		case "/registry.json.sig":
			_, _ = response.Write([]byte(signature))
		case "/plugin.symtab-plugin":
			_, _ = response.Write(archive)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	index := MarketplaceIndex{
		SchemaVersion: 1, UpdatedAt: time.Now().UTC(),
		Plugins: []MarketplacePlugin{{
			Manifest: manifest, Publisher: "Example", Repository: server.URL + "/source",
			DownloadURL: server.URL + "/plugin.symtab-plugin", SHA256: checksum,
			PublishedAt: time.Now().UTC(),
		}},
	}
	payload, err = json.Marshal(index)
	if err != nil {
		t.Fatal(err)
	}
	signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	registry, err := NewRegistry(
		server.URL+"/registry.json",
		server.URL+"/registry.json.sig",
		base64.StdEncoding.EncodeToString(publicKey),
	)
	if err != nil {
		t.Fatal(err)
	}
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	manager.SetRegistry(registry)
	result, err := manager.InstallMarketplace(context.Background(), manifest.ID)
	if err != nil || result.Plugin.Status != StatusStaged {
		t.Fatalf("marketplace install failed: %#v, %v", result, err)
	}
}
