package api

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/appdata"
	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/plugins"
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

type acceptingPluginRuntime struct{}

func (acceptingPluginRuntime) ValidatePackage(context.Context, plugins.InstalledPlugin, plugins.Manifest) error {
	return nil
}

func TestOpenUserSelectedVault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager))

	body, err := json.Marshal(map[string]string{"path": t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/vaults/open", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
	}
	var info domain.VaultInfo
	if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil || info.ID == "" {
		t.Fatalf("invalid vault response: %#v, %v", info, err)
	}
}

func TestCreateVault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager))

	root := filepath.Join(t.TempDir(), "created-vault")
	body, err := json.Marshal(map[string]string{"path": root})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/vaults/create", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, ".flux", "vault.json")); err != nil {
		t.Fatalf("vault identity was not created: %v", err)
	}
}

func TestRawFileAndWatcherRevision(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	pdf := []byte("%PDF-1.4\nraw-test")
	if err := os.WriteFile(filepath.Join(root, "test.pdf"), pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	service := application.NewService(manager)
	info, err := service.OpenVault(root)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterRoutes(router, service)

	rawRequest := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/files/raw?path=test.pdf", nil)
	rawResponse := httptest.NewRecorder()
	router.ServeHTTP(rawResponse, rawRequest)
	if rawResponse.Code != http.StatusOK || !bytes.Equal(rawResponse.Body.Bytes(), pdf) {
		t.Fatalf("unexpected raw response %d: %q", rawResponse.Code, rawResponse.Body.Bytes())
	}
	requestJSON(t, router, http.MethodPost, "/api/v1/vaults/"+info.ID+"/index/rebuild", nil, http.StatusAccepted)

	revision := func() uint64 {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/revision", nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("unexpected revision status %d", response.Code)
		}
		var body struct {
			Revision uint64 `json:"revision"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Revision
	}
	before := revision()
	changed := make(chan uint64, 1)
	go func() {
		waitContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		next, _ := service.WaitVaultRevision(waitContext, info.ID, before)
		changed <- next
	}()
	if err := os.WriteFile(filepath.Join(root, "external.pdf"), pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case next := <-changed:
		if next == 0 || next == before {
			t.Fatalf("watcher revision did not advance: %d", next)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("watcher did not signal after revision advanced")
	}
}

func TestAppDataRoutesPersistAndBootstrap(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	store, err := appdata.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager), WithAppData(store))

	vaultRoot := t.TempDir()
	requestJSON(t, router, http.MethodPost, "/api/v1/vaults/open", map[string]any{"path": vaultRoot}, http.StatusOK)
	requestJSON(t, router, http.MethodPut, "/api/v1/workspace-sessions/window-1", map[string]any{
		"vaultId": "vault-1",
		"state":   map[string]any{"tabs": []string{"notes.md"}},
	}, http.StatusNoContent)
	requestJSON(t, router, http.MethodPut, "/api/v1/app-settings/theme", map[string]any{"value": "dark"}, http.StatusNoContent)

	request := httptest.NewRequest(http.MethodGet, "/api/v1/bootstrap?windowId=window-1", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected bootstrap status %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		RecentVaults []appdata.RecentVault      `json:"recentVaults"`
		Workspace    *appdata.WorkspaceResponse `json:"workspace"`
		Settings     map[string]any             `json:"settings"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	rememberedSamePath := len(body.RecentVaults) == 1 && sameTestPath(body.RecentVaults[0].Path, vaultRoot)
	if !rememberedSamePath {
		t.Fatalf("vault open was not remembered: %#v", body.RecentVaults)
	}
	if body.Workspace == nil || body.Workspace.VaultID != "vault-1" {
		t.Fatalf("workspace was not restored: %#v", body.Workspace)
	}
	if body.Settings["theme"] != "dark" {
		t.Fatalf("settings were not restored: %#v", body.Settings)
	}
}

func sameTestPath(left, right string) bool {
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	return leftErr == nil && rightErr == nil && os.SameFile(leftInfo, rightInfo)
}

func TestDesktopTokenProtectsAPIRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager), WithDesktopToken("secret"))

	unauthorized := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	unauthorizedResponse := httptest.NewRecorder()
	router.ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", unauthorizedResponse.Code)
	}

	authorized := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	authorized.Header.Set("X-Flux-Desktop-Token", "secret")
	authorizedResponse := httptest.NewRecorder()
	router.ServeHTTP(authorizedResponse, authorized)
	if authorizedResponse.Code != http.StatusOK {
		t.Fatalf("expected authorized request, got %d", authorizedResponse.Code)
	}
}

func TestDeferredRoutesDisabledByDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := vault.NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	store, err := appdata.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(manager), WithAppData(store))

	for _, path := range []string{
		"/api/v1/mcp-connections",
		"/api/v1/plugins",
		"/api/v1/model-providers",
		"/api/v1/agent/providers",
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("expected %s to be absent by default, got %d", path, response.Code)
		}
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected core status route to remain available, got %d", response.Code)
	}
}

func TestPluginLifecycleRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	appDirectory := t.TempDir()
	store, err := appdata.Open(filepath.Join(appDirectory, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	pluginStore, err := plugins.NewMetadataStore(store.Database(), false)
	if err != nil {
		t.Fatal(err)
	}
	pluginManager, err := plugins.NewManager(appDirectory, pluginStore, acceptingPluginRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	vaultManager := vault.NewManager("", true)
	t.Cleanup(func() { _ = vaultManager.Close() })
	service := application.NewService(vaultManager)
	router := gin.New()
	RegisterRoutes(router, service, WithAppData(store), WithPlugins(pluginManager))

	archive := pluginArchive(t)
	digest := sha256.Sum256(archive)
	requestJSON(t, router, http.MethodPost, "/api/v1/plugins/install", map[string]any{
		"packageBase64": base64.StdEncoding.EncodeToString(archive),
		"sha256":        hex.EncodeToString(digest[:]),
	}, http.StatusCreated)
	requestJSON(t, router, http.MethodPost, "/api/v1/plugins/example.plugin/1.0.0/activate", nil, http.StatusNoContent)

	vaultRoot := t.TempDir()
	info, err := service.OpenVault(vaultRoot)
	if err != nil {
		t.Fatal(err)
	}
	requestJSON(t, router, http.MethodPut, "/api/v1/vaults/"+info.ID+"/plugins/example.plugin", map[string]any{
		"grantedPermissions": []string{"vault.read"},
	}, http.StatusOK)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/plugins", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":true`) {
		t.Fatalf("plugin was not enabled: %d %s", response.Code, response.Body.String())
	}
	requestJSON(t, router, http.MethodPut, "/api/v1/vaults/"+info.ID+"/plugins/example.plugin/settings", map[string]any{
		"values": map[string]any{"example.plugin.label": "vault value"},
	}, http.StatusNoContent)
	settingsRequest := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/plugins/example.plugin/settings", nil)
	settingsResponse := httptest.NewRecorder()
	router.ServeHTTP(settingsResponse, settingsRequest)
	if settingsResponse.Code != http.StatusOK || !strings.Contains(settingsResponse.Body.String(), `"vault value"`) {
		t.Fatalf("plugin settings missing: %d %s", settingsResponse.Code, settingsResponse.Body.String())
	}
	bundleRequest := httptest.NewRequest(http.MethodGet, "/api/v1/vaults/"+info.ID+"/plugin-bundles", nil)
	bundleResponse := httptest.NewRecorder()
	router.ServeHTTP(bundleResponse, bundleRequest)
	if bundleResponse.Code != http.StatusOK || !strings.Contains(bundleResponse.Body.String(), `"vault value"`) {
		t.Fatalf("runtime settings missing: %d %s", bundleResponse.Code, bundleResponse.Body.String())
	}
}

func pluginArchive(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	manifest := `{"schemaVersion":1,"id":"example.plugin","name":"Example","version":"1.0.0","apiVersion":"1","entry":"dist/main.js","requiredPermissions":["vault.read"],"contributes":{"settings":[{"id":"example.plugin.label","title":"Label","type":"string","default":"hello"}]}}`
	for name, content := range map[string]string{
		plugins.ManifestFile: manifest,
		"dist/main.js":       "export default { activate() {} };",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func requestJSON(t *testing.T, router http.Handler, method, path string, body any, expectedStatus int) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != expectedStatus {
		t.Fatalf("unexpected status %d for %s: %s", response.Code, path, response.Body.String())
	}
}
