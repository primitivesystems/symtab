package git

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/symtab-pkm/server/internal/domain"
)

func TestRepositoryFlow(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	if err := Enable(ctx, root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".symtab"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".symtab", "index.db"), []byte("internal"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err := Status(ctx, root)
	if err != nil || !status.Available || !status.Initialized || len(status.Changes) != 2 {
		t.Fatalf("unexpected status: %#v, %v", status, err)
	}
	if err := Stage(ctx, root, []string{"note.md"}); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || changeStatus(status, "note.md") != "A" {
		t.Fatalf("file was not staged: %#v, %v", status, err)
	}
	if err := Unstage(ctx, root, []string{"note.md"}); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || changeStatus(status, "note.md") != "?" {
		t.Fatalf("file was not unstaged: %#v, %v", status, err)
	}
	ignored, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil || string(ignored) != ".symtab/\n" {
		t.Fatalf("unexpected ignore file: %q, %v", ignored, err)
	}
	if _, err := run(ctx, root, "config", "user.email", "symtab@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := run(ctx, root, "config", "user.name", "Symtab Test"); err != nil {
		t.Fatal(err)
	}
	if err := Stage(ctx, root, nil); err != nil {
		t.Fatal(err)
	}
	if err := Commit(ctx, root, "initial", nil); err != nil {
		t.Fatal(err)
	}
	remote := filepath.Join(t.TempDir(), "remote.git")
	if _, err := run(ctx, root, "init", "--bare", remote); err != nil {
		t.Fatal(err)
	}
	if err := SetRemote(ctx, root, "origin", remote); err != nil {
		t.Fatal(err)
	}
	if err := Push(ctx, root); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || status.Origin != remote || status.Upstream == "" {
		t.Fatalf("unexpected remote status: %#v, %v", status, err)
	}
	if err := SetRemote(ctx, root, "backup", "git@example.com:example/backup.git"); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || len(status.Remotes) != 2 || !slices.ContainsFunc(status.Remotes, func(remote domain.GitRemote) bool { return remote.Name == "backup" }) {
		t.Fatalf("second remote was not added: %#v, %v", status.Remotes, err)
	}
	if err := SetRemote(ctx, root, "origin", "git@example.com:example/changed.git"); err != nil {
		t.Fatal(err)
	}
	if err := RemoveRemote(ctx, root, "backup"); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || status.Origin != "git@example.com:example/changed.git" || len(status.Remotes) != 1 {
		t.Fatalf("unexpected remotes after update: %#v, %v", status.Remotes, err)
	}
	if history, err := History(ctx, root, 10); err != nil || len(history) != 1 || history[0].Subject != "initial" {
		t.Fatalf("unexpected history: %#v, %v", history, err)
	}
	if err := Checkout(ctx, root, "feature/test", true); err != nil {
		t.Fatal(err)
	}
	if branches, err := Branches(ctx, root); err != nil || len(branches) != 2 || !slices.ContainsFunc(branches, func(branch domain.GitBranch) bool { return branch.Name == "feature/test" && branch.Current }) {
		t.Fatalf("unexpected branches: %#v, %v", branches, err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Discard(ctx, root, []string{"note.md"}); err != nil {
		t.Fatal(err)
	}
	if content, err := os.ReadFile(filepath.Join(root, "note.md")); err != nil || string(content) != "hello" {
		t.Fatalf("discard failed: %q, %v", content, err)
	}
}

func changeStatus(status domain.GitStatus, path string) string {
	for _, change := range status.Changes {
		if change.Path == path {
			return change.IndexStatus
		}
	}
	return ""
}

func TestRejectsOutsidePath(t *testing.T) {
	if _, err := pathArgs(nil, []string{"../outside"}); err != ErrInvalidPath {
		t.Fatalf("expected invalid path, got %v", err)
	}
	if _, err := pathArgs(nil, []string{".symtab/index.db"}); err != ErrInvalidPath {
		t.Fatalf("expected internal path rejection, got %v", err)
	}
}
