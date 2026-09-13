package api

import (
	"bytes"
	"context"
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
	"github.com/flux-pkm/server/internal/vault"
	"github.com/gin-gonic/gin"
)

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

func TestExcludedV1RoutesAreUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	vaultManager := vault.NewManager("", true)
	t.Cleanup(func() { _ = vaultManager.Close() })
	router := gin.New()
	RegisterRoutes(router, application.NewService(vaultManager))
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/plugins"},
		{http.MethodPost, "/api/v1/plugins/install"},
		{http.MethodGet, "/api/v1/model-providers"},
		{http.MethodGet, "/api/v1/ai-runtimes"},
		{http.MethodGet, "/api/v1/agent/providers"},
		{http.MethodGet, "/api/v1/mcp-connections"},
		{http.MethodPost, "/api/v1/vaults/vault/files/plan"},
		{http.MethodGet, "/api/v1/vaults/vault/plugin-bundles"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("excluded route %s returned %d", route.path, response.Code)
		}
	}
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
