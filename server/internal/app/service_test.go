package app

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/symtab-pkm/server/internal/domain"
	"github.com/symtab-pkm/server/internal/files"
	"github.com/symtab-pkm/server/internal/vault"
)

func TestVaultFileLifecycle(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Welcome.md"), []byte("# Welcome\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)

	if service.Status().OpenVault != nil {
		t.Fatal("server opened the configured vault during startup")
	}
	if _, err := os.Stat(filepath.Join(root, ".symtab")); !os.IsNotExist(err) {
		t.Fatalf("vault was mutated before OpenVault: %v", err)
	}

	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	var entries []domain.FileEntry
	deadline := time.Now().Add(3 * time.Second)
	for len(entries) == 0 && time.Now().Before(deadline) {
		entries, err = service.ListFiles(info.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) == 0 {
			time.Sleep(10 * time.Millisecond)
		}
	}
	if len(entries) != 1 || entries[0].Path != "Welcome.md" {
		t.Fatalf("unexpected files: %#v", entries)
	}

	document, err := service.ReadFile(info.ID, "Welcome.md")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SaveFile(info.ID, "Welcome.md", "# Updated\n", document.ContentHash)
	if err != nil {
		t.Fatal(err)
	}
	if result.ContentHash == document.ContentHash {
		t.Fatal("save did not return a new content hash")
	}
	content, err := os.ReadFile(filepath.Join(root, "Welcome.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "# Updated\n" {
		t.Fatalf("canonical file was not updated: %q", content)
	}
	for _, derivedPath := range []string{"vault.json", "index.db"} {
		if _, err := os.Stat(filepath.Join(root, ".symtab", derivedPath)); err != nil {
			t.Fatalf("missing derived vault state %s: %v", derivedPath, err)
		}
	}
}

func TestVaultConfigUsesProtectedAtomicStorage(t *testing.T) {
	root := t.TempDir()
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SaveVaultConfig(info.ID, []byte(`{"dailyFolder":"Journal"}`)); err != nil {
		t.Fatal(err)
	}
	config, err := service.VaultConfig(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(config) != `{"dailyFolder":"Journal"}` {
		t.Fatalf("unexpected config: %s", config)
	}
	if _, err := service.ReadFile(info.ID, ".symtab/config.json"); err == nil {
		t.Fatal("generic file API exposed protected vault metadata")
	}
	if err := service.SaveVaultConfig(info.ID, []byte(`{"dailyFolder":"../outside"}`)); err == nil {
		t.Fatal("unsafe config path was accepted")
	}
}

func TestInterruptedVaultPlanRecoversBeforeReopen(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "existing.md"), []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager(root, false)
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	document, err := service.ReadFile(info.ID, "existing.md")
	if err != nil {
		t.Fatal(err)
	}
	journal := vaultPlanJournal{
		Version: vaultPlanJournalVersion,
		ID:      "interrupted",
		Operations: []vaultPlanJournalOperation{
			{Action: "update", Path: "existing.md", OriginalContent: "before", OriginalHash: document.ContentHash, TargetHash: contentHash("after")},
			{Action: "create", Path: "created.md", TargetHash: contentHash("created")},
		},
	}
	if _, err := writeJournal(root, journal); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveFile(info.ID, "existing.md", "after", document.ContentHash); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateFile(info.ID, "created.md", "created"); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := vault.NewManager(root, false)
	t.Cleanup(func() { _ = reopened.Close() })
	recoveredService := NewService(reopened)
	recovered, err := recoveredService.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	restored, err := recoveredService.ReadFile(recovered.ID, "existing.md")
	if err != nil || restored.Content != "before" {
		t.Fatalf("update was not recovered: %q, %v", restored.Content, err)
	}
	if _, err := recoveredService.ReadFile(recovered.ID, "created.md"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("created file survived interrupted plan: %v", err)
	}
}

func TestVaultPlanRecoveryNeverOverwritesUnknownContent(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("external"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	context, err := manager.Open("")
	if err != nil {
		t.Fatal(err)
	}
	journal := vaultPlanJournal{
		Version: vaultPlanJournalVersion, ID: "conflict",
		Operations: []vaultPlanJournalOperation{{
			Action: "update", Path: "note.md", OriginalContent: "before",
			OriginalHash: contentHash("before"), TargetHash: contentHash("after"),
		}},
	}
	if _, err := writeJournal(root, journal); err != nil {
		t.Fatal(err)
	}
	if err := recoverVaultPlans(context); err == nil {
		t.Fatal("recovery overwrote or accepted unknown content")
	}
	content, err := os.ReadFile(filepath.Join(root, "note.md"))
	if err != nil || string(content) != "external" {
		t.Fatalf("external content changed: %q, %v", content, err)
	}
}

func TestCommittedVaultPlanJournalDoesNotRollback(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("after"), 0o600); err != nil {
		t.Fatal(err)
	}
	journal := vaultPlanJournal{
		Version: vaultPlanJournalVersion, ID: "committed",
		Operations: []vaultPlanJournalOperation{{
			Action: "update", Path: "note.md", OriginalContent: "before",
			OriginalHash: contentHash("before"), TargetHash: contentHash("after"),
		}},
	}
	journalPath, err := writeJournal(root, journal)
	if err != nil {
		t.Fatal(err)
	}
	if err := commitJournal(journalPath, journal); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	document, err := service.ReadFile(info.ID, "note.md")
	if err != nil || document.Content != "after" {
		t.Fatalf("committed plan rolled back: %q, %v", document.Content, err)
	}
}

func TestIndexFailureDoesNotBlockVaultFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Welcome.md"), []byte("# Welcome\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".symtab", "index.db"), 0o700); err != nil {
		t.Fatal(err)
	}

	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	if info.State != "degraded" || service.Status().Status != "degraded" {
		t.Fatalf("index failure not reported as degraded: %#v", service.Status())
	}
	entries, err := service.ListFiles(info.ID)
	if err != nil || len(entries) != 1 || entries[0].Path != "Welcome.md" {
		t.Fatalf("canonical files unavailable after index failure: %#v, %v", entries, err)
	}
}

func TestExpectedHashProtectsMoveAndDelete(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	original, err := service.ReadFile(info.ID, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveFile(info.ID, "note.md", "changed", original.ContentHash); err != nil {
		t.Fatal(err)
	}
	if _, err := service.MoveFileExpected(info.ID, "note.md", "moved.md", original.ContentHash); !errors.Is(err, files.ErrConflict) {
		t.Fatalf("stale move allowed: %v", err)
	}
	current, err := service.ReadFile(info.ID, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.MoveFileExpected(info.ID, "note.md", "moved.md", current.ContentHash); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DeleteFileExpected(info.ID, "moved.md", original.ContentHash); !errors.Is(err, files.ErrConflict) {
		t.Fatalf("stale delete allowed: %v", err)
	}
	moved, err := service.ReadFile(info.ID, "moved.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.DeleteFileExpected(info.ID, "moved.md", moved.ContentHash); err != nil {
		t.Fatal(err)
	}
}

func TestVaultPlanPreflightIsAllOrNothing(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "existing.md"), []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	before, err := service.ReadFile(info.ID, "existing.md")
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.ApplyVaultPlan(info.ID, []domain.VaultPlanOperation{
		{Action: "create", Path: "created.md", Content: "created"},
		{Action: "update", Path: "existing.md", Content: "after", ExpectedHash: "stale"},
	})
	if !errors.Is(err, files.ErrConflict) {
		t.Fatalf("stale plan allowed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "created.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("preflight left created file: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(root, "existing.md"))
	if err != nil || string(content) != "before" {
		t.Fatalf("preflight changed existing file: %q, %v", content, err)
	}

	result, err := service.ApplyVaultPlan(info.ID, []domain.VaultPlanOperation{
		{Action: "create", Path: "created.md", Content: "created"},
		{Action: "update", Path: "existing.md", Content: "after", ExpectedHash: before.ContentHash},
	})
	if err != nil || len(result.Files) != 2 {
		t.Fatalf("valid plan failed: %#v, %v", result, err)
	}
	for path, expected := range map[string]string{"created.md": "created", "existing.md": "after"} {
		content, err := os.ReadFile(filepath.Join(root, path))
		if err != nil || string(content) != expected {
			t.Fatalf("unexpected %s: %q, %v", path, content, err)
		}
	}
	journals, err := os.ReadDir(vaultPlanJournalDirectory(root))
	if err != nil || len(journals) != 0 {
		t.Fatalf("committed plan left recovery journal: %#v, %v", journals, err)
	}
}

func TestVaultPlanRejectsDuplicateAndOversizedInput(t *testing.T) {
	root := t.TempDir()
	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	checks := [][]domain.VaultPlanOperation{
		{
			{Action: "create", Path: "folder/../same.md", Content: "one"},
			{Action: "create", Path: "same.md", Content: "two"},
		},
		{{Action: "create", Path: "large.md", Content: string(make([]byte, maxVaultPlanBytes+1))}},
	}
	for _, operations := range checks {
		if _, err := service.ApplyVaultPlan(info.ID, operations); !errors.Is(err, ErrInvalidVaultPlan) {
			t.Fatalf("invalid plan allowed: %v", err)
		}
	}
	tooMany := make([]domain.VaultPlanOperation, maxVaultPlanOperations+1)
	if _, err := service.ApplyVaultPlan(info.ID, tooMany); !errors.Is(err, ErrInvalidVaultPlan) {
		t.Fatalf("oversized operation count allowed: %v", err)
	}
}
