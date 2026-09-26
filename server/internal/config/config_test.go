package config

import (
	"path/filepath"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("ENVIRONMENT", "")
	t.Setenv("HOST", "")
	t.Setenv("SYMTAB_VAULT_PATH", "")
	t.Setenv("SYMTAB_VAULT_ROOT", "")
	t.Setenv("CORS_ALLOWED_ORIGIN", "")
	t.Setenv("PORT", "")
	t.Setenv("SYMTAB_APP_DATA_DIR", "")
	t.Setenv("SYMTAB_DESKTOP_TOKEN", "")

	cfg := Load()
	if cfg.Environment != "development" {
		t.Fatalf("expected development environment, got %q", cfg.Environment)
	}
	if cfg.Port != "8080" {
		t.Fatalf("expected port 8080, got %q", cfg.Port)
	}
	if cfg.Host != "127.0.0.1" {
		t.Fatalf("unexpected development host %q", cfg.Host)
	}
	if cfg.AllowedOrigin != "http://localhost:3000" {
		t.Fatalf("unexpected allowed origin %q", cfg.AllowedOrigin)
	}
	if cfg.VaultPath != "" {
		t.Fatalf("unexpected default vault path %q", cfg.VaultPath)
	}
	if cfg.VaultRoot != filepath.Join(cfg.AppDataDir, "vaults") {
		t.Fatalf("unexpected development vault root %q", cfg.VaultRoot)
	}
	if cfg.AppDataDir == "" || cfg.DesktopToken != "" {
		t.Fatalf("unexpected app data defaults: %#v", cfg)
	}
}

func TestProductionDefaultsToPersistentVaultRoot(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	t.Setenv("SYMTAB_VAULT_PATH", "")
	t.Setenv("SYMTAB_VAULT_ROOT", "")
	if cfg := Load(); cfg.VaultRoot != "/data/vaults" {
		t.Fatalf("unexpected production vault root: %q", cfg.VaultRoot)
	}
}

func TestDesktopKeepsNativeDirectoryAccess(t *testing.T) {
	t.Setenv("ENVIRONMENT", "desktop")
	t.Setenv("SYMTAB_VAULT_PATH", "")
	t.Setenv("SYMTAB_VAULT_ROOT", "")
	if cfg := Load(); cfg.VaultRoot != "" {
		t.Fatalf("desktop should use its native directory picker, got root %q", cfg.VaultRoot)
	}
}

func TestLoadEnvironment(t *testing.T) {
	t.Setenv("ENVIRONMENT", "test")
	t.Setenv("HOST", "0.0.0.0")
	t.Setenv("SYMTAB_VAULT_PATH", "/tmp/symtab-vault")
	t.Setenv("SYMTAB_VAULT_ROOT", "/tmp/symtab-vaults")
	t.Setenv("CORS_ALLOWED_ORIGIN", "https://symtab.example")
	t.Setenv("PORT", "9090")
	t.Setenv("SYMTAB_APP_DATA_DIR", "/tmp/symtab-app-data")
	t.Setenv("SYMTAB_DESKTOP_TOKEN", "secret")

	cfg := Load()
	if cfg.Environment != "test" || cfg.VaultPath != "/tmp/symtab-vault" || cfg.VaultRoot != "/tmp/symtab-vaults" {
		t.Fatalf("environment values were not loaded: %#v", cfg)
	}
	if cfg.Host != "0.0.0.0" || cfg.Port != "9090" {
		t.Fatalf("runtime values were not loaded: %#v", cfg)
	}
	if cfg.AllowedOrigin != "https://symtab.example" {
		t.Fatalf("unexpected allowed origin %q", cfg.AllowedOrigin)
	}
	if cfg.AppDataDir != "/tmp/symtab-app-data" || cfg.DesktopToken != "secret" {
		t.Fatalf("app data values were not loaded: %#v", cfg)
	}
}
