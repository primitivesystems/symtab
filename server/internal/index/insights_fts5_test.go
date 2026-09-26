//go:build sqlite_fts5

package index

import (
	"strings"
	"testing"
	"time"

	"github.com/symtab-pkm/server/internal/domain"
)

func TestSearchOperatorsAndDocumentReferences(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now().UTC()
	inputs := map[string]string{
		"notes/target.md":   "---\ntags: [focus]\nstatus: active\n---\n# Target\n[[other]]",
		"notes/linked.md":   "See [[target]] here.\nAnother [[target|label]].",
		"notes/unlinked.md": "Target appears as plain text.",
		"notes/code.md":     "`Target` and `[[target]]` are examples.",
		"notes/other.md":    "# Other",
	}
	for filePath, content := range inputs {
		entry := domain.FileEntry{
			Path: filePath, Name: pathBase(filePath), Kind: domain.FileKindMarkdown,
			SizeBytes: int64(len(content)), ModifiedAt: now,
		}
		if err := store.IndexFile(entry, strings.NewReader(content)); err != nil {
			t.Fatal(err)
		}
	}

	results, err := store.Search("tag:focus property:status path:notes", 20)
	if err != nil || len(results) != 1 || results[0].Path != "notes/target.md" {
		t.Fatalf("search filters failed: %#v, %v", results, err)
	}
	results, err = store.Search("plain", 20)
	if err != nil || len(results) != 1 || results[0].Path != "notes/unlinked.md" {
		t.Fatalf("fts content search failed: %#v, %v", results, err)
	}
	results, err = store.SearchPageCase("PLAIN", 20, 0, true)
	if err != nil || len(results) != 0 {
		t.Fatalf("case-sensitive search ignored casing: %#v, %v", results, err)
	}
	firstPage, err := store.SearchPage("target", 1, 0)
	if err != nil || len(firstPage) != 1 {
		t.Fatalf("first search page failed: %#v, %v", firstPage, err)
	}
	secondPage, err := store.SearchPage("target", 1, 1)
	if err != nil || len(secondPage) != 1 || secondPage[0].Path == firstPage[0].Path {
		t.Fatalf("search pagination failed: %#v then %#v, %v", firstPage, secondPage, err)
	}

	references, err := store.References("notes/target.md", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(references.Linked) != 2 || references.Linked[0].Source != "notes/linked.md" {
		t.Fatalf("linked references failed: %#v", references.Linked)
	}
	if len(references.Unlinked) != 1 || references.Unlinked[0].Source != "notes/unlinked.md" {
		t.Fatalf("unlinked references leaked code or links: %#v", references.Unlinked)
	}
	if len(references.Outgoing) != 1 || references.Outgoing[0] != "notes/other.md" {
		t.Fatalf("outgoing links failed: %#v", references.Outgoing)
	}
	lazyReferences, err := store.References("notes/target.md", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(lazyReferences.Linked) != 2 || len(lazyReferences.Unlinked) != 0 {
		t.Fatalf("lazy references did eager unlinked work: %#v", lazyReferences)
	}
}

func pathBase(value string) string {
	for index := len(value) - 1; index >= 0; index-- {
		if value[index] == '/' {
			return value[index+1:]
		}
	}
	return value
}
