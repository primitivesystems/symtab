package vault

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// Run with SYMTAB_LARGE_VAULT_FILES=10000 (or 50000/100000).
func TestLargeVaultReopen(t *testing.T) {
	count, err := strconv.Atoi(os.Getenv("SYMTAB_LARGE_VAULT_FILES"))
	if err != nil || count <= 0 {
		t.Skip("set SYMTAB_LARGE_VAULT_FILES to run scale verification")
	}
	root := t.TempDir()
	content := []byte("# Durable note\n\nProduction vault scale verification.\n")
	for index := 0; index < count; index++ {
		directory := filepath.Join(root, fmt.Sprintf("area-%03d", index%100))
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, fmt.Sprintf("note-%06d.md", index)), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	firstStart := time.Now()
	manager := NewManager(root, false)
	context, err := manager.Open("")
	if err != nil {
		t.Fatal(err)
	}
	firstOpen := time.Since(firstStart)
	firstIndexStart := time.Now()
	waitForActive(t, context, 5*time.Minute)
	firstIndex := time.Since(firstIndexStart)
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}

	reopenStart := time.Now()
	manager = NewManager(root, false)
	context, err = manager.Open("")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })
	reopen := time.Since(reopenStart)
	entries, err := context.ListFiles()
	if err != nil || len(entries) != count+100 {
		t.Fatalf("cached manifest mismatch: got %d, err %v", len(entries), err)
	}
	reconcileStart := time.Now()
	waitForActive(t, context, 5*time.Minute)
	reconcile := time.Since(reconcileStart)

	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	fileDescriptors := -1
	if descriptors, _ := os.ReadDir("/dev/fd"); len(descriptors) > 0 {
		fileDescriptors = len(descriptors)
		if fileDescriptors > 1_024 {
			t.Fatalf("watcher retained too many file descriptors: %d", fileDescriptors)
		}
	}
	database, err := os.Stat(filepath.Join(root, ".symtab", "index.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf(
		"files=%d first_open=%s first_index=%s reopen=%s reconcile=%s index=%dMB heap=%dMB fds=%d",
		count,
		firstOpen,
		firstIndex,
		reopen,
		reconcile,
		database.Size()/(1024*1024),
		memory.Alloc/(1024*1024),
		fileDescriptors,
	)
}

func waitForActive(t *testing.T, context *Context, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		state := context.VaultInfo().State
		if state == "active" {
			return
		}
		if state == "degraded" {
			t.Fatalf("vault degraded during indexing: %#v", context.VaultInfo())
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("vault did not finish indexing: %#v", context.VaultInfo())
}
