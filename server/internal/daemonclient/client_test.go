package daemonclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/symtab-pkm/server/internal/domain"
)

func TestClientAuthenticatesAndDecodesStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Symtab-Desktop-Token") != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"healthy","version":"test","vaultConfigured":true,"openVault":null}`))
	}))
	defer server.Close()
	client, err := New(server.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	status, err := client.Status(context.Background())
	if err != nil || status.Version != "test" {
		t.Fatalf("unexpected status %#v, %v", status, err)
	}
}

func TestClientAppliesVaultPlan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/vaults/vault-a/files/plan" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		var body struct {
			Operations []domain.VaultPlanOperation `json:"operations"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil || len(body.Operations) != 1 {
			t.Fatalf("unexpected body %#v, %v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"files":[{"path":"new.md","contentHash":"hash","modifiedAt":"2026-01-01T00:00:00Z"}]}`))
	}))
	defer server.Close()
	client, err := New(server.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.ApplyVaultPlan("vault-a", []domain.VaultPlanOperation{{Action: "create", Path: "new.md", Content: "new"}})
	if err != nil || len(result.Files) != 1 || result.Files[0].Path != "new.md" {
		t.Fatalf("unexpected result %#v, %v", result, err)
	}
}
