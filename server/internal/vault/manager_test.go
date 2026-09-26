package vault

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestDevelopmentManagerOpensAndSwitchesRequestedVaults(t *testing.T) {
	firstRoot := t.TempDir()
	secondRoot := t.TempDir()
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })

	first, err := manager.Open(firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Open(secondRoot)
	if err != nil {
		t.Fatal(err)
	}
	if first.VaultInfo().ID == second.VaultInfo().ID {
		t.Fatal("switch kept previous vault identity")
	}
	if _, err := manager.Get(first.VaultInfo().ID); err != nil {
		t.Fatalf("first vault was closed after opening second: %v", err)
	}
	for _, root := range []string{firstRoot, secondRoot} {
		if _, err := os.Stat(filepath.Join(root, ".symtab", "vault.json")); err != nil {
			t.Fatalf("vault was not initialized at %s: %v", root, err)
		}
	}
}

func TestVaultLeaseRejectsSecondRuntime(t *testing.T) {
	root := t.TempDir()
	first := NewManager("", true)
	second := NewManager("", true)
	t.Cleanup(func() { _ = first.Close() })
	t.Cleanup(func() { _ = second.Close() })
	if _, err := first.Open(root); err != nil {
		t.Fatal(err)
	}
	if _, err := second.Open(root); !errors.Is(err, ErrVaultInUse) {
		t.Fatalf("expected ErrVaultInUse, got %v", err)
	}
}

func TestDuplicateIdentityDoesNotReplaceOpenContext(t *testing.T) {
	firstRoot := t.TempDir()
	secondRoot := t.TempDir()
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	first, err := manager.Open(firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := os.ReadFile(filepath.Join(firstRoot, ".symtab", "vault.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(secondRoot, ".symtab"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(secondRoot, ".symtab", "vault.json"), identity, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Open(secondRoot); !errors.Is(err, ErrDuplicateID) {
		t.Fatalf("expected ErrDuplicateID, got %v", err)
	}
	kept, err := manager.Get(first.VaultInfo().ID)
	if err != nil || !samePath(kept.root, firstRoot) {
		t.Fatalf("original context was replaced: %v", err)
	}
}

func TestIdleContextIsEvicted(t *testing.T) {
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	old, err := manager.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	current, err := manager.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	old.lastUsed.Store(time.Now().Add(-vaultIdleTTL - time.Minute).UnixNano())
	if _, err := manager.Get(current.VaultInfo().ID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Get(old.VaultInfo().ID); !errors.Is(err, ErrNotOpen) {
		t.Fatalf("expected idle context eviction, got %v", err)
	}
}

func TestContextLimitEvictsLeastRecentlyUsed(t *testing.T) {
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	contexts := make([]*Context, 0, maxVaultContexts)
	now := time.Now()
	for index := 0; index < maxVaultContexts; index++ {
		context, err := manager.Open(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		context.lastUsed.Store(now.Add(time.Duration(index-30) * time.Second).UnixNano())
		contexts = append(contexts, context)
	}

	newest, err := manager.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Get(contexts[0].VaultInfo().ID); !errors.Is(err, ErrNotOpen) {
		t.Fatalf("least recently used context was retained: %v", err)
	}
	for _, context := range append(contexts[1:], newest) {
		if _, err := manager.Get(context.VaultInfo().ID); err != nil {
			t.Fatalf("recent context was evicted: %v", err)
		}
	}
	manager.mu.RLock()
	count := len(manager.contexts)
	manager.mu.RUnlock()
	if count != maxVaultContexts {
		t.Fatalf("expected %d contexts, got %d", maxVaultContexts, count)
	}
}

func TestReopeningContextProtectsItFromEviction(t *testing.T) {
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	root := t.TempDir()
	protected, err := manager.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	for index := 1; index < maxVaultContexts; index++ {
		if _, err := manager.Open(t.TempDir()); err != nil {
			t.Fatal(err)
		}
	}
	protected.lastUsed.Store(time.Now().Add(-vaultIdleTTL - time.Second).UnixNano())

	reopened, err := manager.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if reopened != protected {
		t.Fatal("reopening warm vault replaced its context")
	}
	if _, err := manager.Get(protected.VaultInfo().ID); err != nil {
		t.Fatalf("requested context was evicted: %v", err)
	}
}

func TestContextLimitPreservesCurrentContext(t *testing.T) {
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	contexts := make([]*Context, 0, maxVaultContexts)
	for index := 0; index < maxVaultContexts; index++ {
		context, err := manager.Open(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		contexts = append(contexts, context)
	}
	now := time.Now()
	contexts[2].lastUsed.Store(now.Add(-30 * time.Second).UnixNano())
	contexts[0].lastUsed.Store(now.Add(-20 * time.Second).UnixNano())
	contexts[1].lastUsed.Store(now.Add(-10 * time.Second).UnixNano())

	if _, err := manager.Open(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Get(contexts[2].VaultInfo().ID); err != nil {
		t.Fatalf("current context was evicted: %v", err)
	}
	if _, err := manager.Get(contexts[0].VaultInfo().ID); !errors.Is(err, ErrNotOpen) {
		t.Fatalf("expected oldest idle context eviction, got %v", err)
	}
}

func TestIdleEvictionPreservesActiveRevisionWaiter(t *testing.T) {
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	vaultContext, err := manager.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manager.mu.Lock()
	manager.currentID = ""
	manager.mu.Unlock()
	vaultContext.lastUsed.Store(time.Now().Add(-vaultIdleTTL - time.Second).UnixNano())
	waitContext, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		vaultContext.WaitRevision(waitContext, vaultContext.Revision.Load())
		close(done)
	}()
	for vaultContext.waiters.Load() == 0 {
		runtime.Gosched()
	}

	manager.evictIdle(time.Now(), "")
	if _, err := manager.Get(vaultContext.VaultInfo().ID); err != nil {
		t.Fatalf("active event stream was evicted: %v", err)
	}
	cancel()
	<-done
}

func TestServerWithoutConfiguredRootRejectsArbitraryPaths(t *testing.T) {
	manager := NewManager("", false)
	if _, err := manager.Open(t.TempDir()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestStorageManagerKeepsVaultsInsideRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "vaults")
	manager := NewStorageManager(root)
	t.Cleanup(func() { _ = manager.Close() })
	if available, err := manager.Available(); err != nil || len(available) != 0 {
		t.Fatalf("fresh storage root was not initialized: %#v, %v", available, err)
	}
	created, err := manager.Create("notes")
	if err != nil {
		t.Fatal(err)
	}
	if created.VaultInfo().Name != "notes" {
		t.Fatalf("unexpected vault: %#v", created.VaultInfo())
	}
	available, err := manager.Available()
	if err != nil || len(available) != 1 || available[0].VaultID != created.VaultInfo().ID {
		t.Fatalf("unexpected available vaults: %#v, %v", available, err)
	}
	if _, err := manager.Create("../outside"); !errors.Is(err, ErrVaultMismatch) {
		t.Fatalf("expected storage-root rejection, got %v", err)
	}
	outside := t.TempDir()
	if _, err := manager.Open(outside); !errors.Is(err, ErrVaultMismatch) {
		t.Fatalf("expected outside open rejection, got %v", err)
	}
}

func TestCreateInitializesVaultAndRejectsNestedVault(t *testing.T) {
	root := filepath.Join(t.TempDir(), "new-vault")
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })

	created, err := manager.Create(root)
	if err != nil {
		t.Fatal(err)
	}
	if created.VaultInfo().ID == "" {
		t.Fatal("created vault has no identity")
	}
	for _, name := range []string{"vault.json", "index.db"} {
		if _, err := os.Stat(filepath.Join(root, ".symtab", name)); err != nil {
			t.Fatalf("vault metadata %s was not created: %v", name, err)
		}
	}
	if _, err := manager.Create(filepath.Join(root, "nested")); !errors.Is(err, ErrNestedVault) {
		t.Fatalf("expected ErrNestedVault, got %v", err)
	}
}

func TestCreateRejectsParentOfExistingVault(t *testing.T) {
	parent := t.TempDir()
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })
	if _, err := manager.Create(filepath.Join(parent, "nested")); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Create(parent); !errors.Is(err, ErrNestedVault) {
		t.Fatalf("expected ErrNestedVault, got %v", err)
	}
}

func TestConcurrentCreateDoesNotAllowNestedVaults(t *testing.T) {
	for iteration := 0; iteration < 10; iteration++ {
		parent := t.TempDir()
		manager := NewManager("", true)
		start := make(chan struct{})
		results := make(chan error, 2)
		for _, root := range []string{parent, filepath.Join(parent, "nested")} {
			go func() {
				<-start
				_, err := manager.Create(root)
				results <- err
			}()
		}
		close(start)
		first, second := <-results, <-results
		_ = manager.Close()
		if (first == nil) == (second == nil) ||
			(!errors.Is(first, ErrNestedVault) && !errors.Is(second, ErrNestedVault)) {
			t.Fatalf("expected one success and one ErrNestedVault, got %v and %v", first, second)
		}
	}
}
