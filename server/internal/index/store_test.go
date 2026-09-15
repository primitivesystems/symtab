package index

import (
	"path"
	"strings"
	"testing"
	"time"

	"github.com/flux-pkm/server/internal/domain"
)

func TestIndexFileTracksHashesAndInvalidatesChangedMetadata(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	entry := domain.FileEntry{Path: "note.md", Name: "note.md", Kind: domain.FileKindMarkdown, SizeBytes: 5, ModifiedAt: time.Now().UTC()}
	if err := store.IndexFile(entry, strings.NewReader("hello")); err != nil {
		t.Fatal(err)
	}
	current, err := store.IsCurrent(entry)
	if err != nil || !current {
		t.Fatalf("indexed file not current: %v, %v", current, err)
	}
	entry.SizeBytes++
	entry.ModifiedAt = entry.ModifiedAt.Add(time.Second)
	if err := store.UpsertFile(entry); err != nil {
		t.Fatal(err)
	}
	current, err = store.IsCurrent(entry)
	if err != nil || current {
		t.Fatalf("changed file remained current: %v, %v", current, err)
	}
}

func TestIndexPreparedCommitsBatch(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	prepared := make([]PreparedFile, 0, 3)
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		entry := domain.FileEntry{Path: name, Name: name, Kind: domain.FileKindMarkdown, SizeBytes: 4, ModifiedAt: time.Now().UTC()}
		file, err := PrepareFile(entry, strings.NewReader("note"))
		if err != nil {
			t.Fatal(err)
		}
		prepared = append(prepared, file)
	}
	if err := store.IndexPrepared(prepared); err != nil {
		t.Fatal(err)
	}
	entries, err := store.ListFiles()
	if err != nil || len(entries) != len(prepared) {
		t.Fatalf("unexpected indexed batch: %#v, %v", entries, err)
	}
}

func TestExtractLinksIgnoresMarkdownCodeExamples(t *testing.T) {
	content := "[[Visible]] `[[Inline]]`\n```md\n[[Fenced]]\n[also fenced](Hidden.md)\n```\n~~~\n[[Tilde fenced]]\n~~~\n[Real](Real.md)"
	links := extractLinks(content)
	if len(links) != 2 || links[0].target != "Visible" || links[1].target != "Real.md" {
		t.Fatalf("code examples leaked into graph links: %#v", links)
	}
}

func TestIndexStoresTagAndPropertyFacets(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now().UTC()
	inputs := map[string]string{
		"one.md": "---\ntags: [project/flux, active]\nstatus: draft\n---\n#inline",
		"two.md": "---\ntags:\n  - active\nowner: flux\n---\n#project/flux",
	}
	for filePath, content := range inputs {
		entry := domain.FileEntry{
			Path: filePath, Name: filePath, Kind: domain.FileKindMarkdown,
			SizeBytes: int64(len(content)), ModifiedAt: now,
		}
		if err := store.IndexFile(entry, strings.NewReader(content)); err != nil {
			t.Fatal(err)
		}
	}
	facets, err := store.Facets()
	if err != nil {
		t.Fatal(err)
	}
	tagCounts := map[string]int{}
	for _, facet := range facets.Tags {
		tagCounts[facet.Name] = facet.Count
	}
	if tagCounts["active"] != 2 || tagCounts["project/flux"] != 2 || tagCounts["inline"] != 1 {
		t.Fatalf("unexpected tag facets: %#v", facets.Tags)
	}
	propertyCounts := map[string]int{}
	for _, facet := range facets.Properties {
		propertyCounts[facet.Name] = facet.Count
	}
	if propertyCounts["tags"] != 2 || propertyCounts["status"] != 1 || propertyCounts["owner"] != 1 {
		t.Fatalf("unexpected property facets: %#v", facets.Properties)
	}
}

func TestMissingFacetTablesInvalidateMarkdownForBackfill(t *testing.T) {
	databasePath := t.TempDir() + "/index.db"
	store, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	entry := domain.FileEntry{
		Path: "note.md", Name: "note.md", Kind: domain.FileKindMarkdown,
		SizeBytes: 4, ModifiedAt: time.Now().UTC(),
	}
	if err := store.IndexFile(entry, strings.NewReader("note")); err != nil {
		t.Fatal(err)
	}
	if err := store.db.Migrator().DropTable(&TagRecord{}, &PropertyRecord{}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	current, err := reopened.IsCurrent(entry)
	if err != nil {
		t.Fatal(err)
	}
	if current {
		t.Fatal("markdown remained current after facet tables were added")
	}
}

func TestDeletePathRemovesDirectoryDescendants(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, path := range []string{"folder", "folder/a.md", "other.md"} {
		entry := domain.FileEntry{Path: path, Name: path, Kind: domain.FileKindMarkdown, ModifiedAt: time.Now().UTC()}
		if err := store.IndexFile(entry, strings.NewReader("")); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.DeletePath("folder"); err != nil {
		t.Fatal(err)
	}
	var paths []string
	if err := store.db.Model(&FileRecord{}).Order("relative_path").Pluck("relative_path", &paths).Error; err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != "other.md" {
		t.Fatalf("unexpected remaining paths: %#v", paths)
	}
}

func TestResetClearsDerivedIndex(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	entry := domain.FileEntry{Path: "note.md", Name: "note.md", Kind: domain.FileKindMarkdown, SizeBytes: 4, ModifiedAt: time.Now().UTC()}
	if err := store.IndexFile(entry, strings.NewReader("note")); err != nil {
		t.Fatal(err)
	}
	if err := store.Reset(); err != nil {
		t.Fatal(err)
	}
	entries, err := store.ListFiles()
	if err != nil || len(entries) != 0 {
		t.Fatalf("derived index was not cleared: %#v, %v", entries, err)
	}
}

func TestGraphUsesPathsAndNeverCollapsesDuplicateNames(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now().UTC()
	inputs := []struct {
		path, content string
		kind          domain.FileKind
	}{
		{"notes/start.md", "[[../one/route.md]] [[route]] [[target]] [[Not created]]", domain.FileKindMarkdown},
		{"notes/target.md", "---\ntags: [focus]\n---\ntarget", domain.FileKindMarkdown},
		{"one/route.md", "one", domain.FileKindMarkdown},
		{"two/route.md", "two", domain.FileKindMarkdown},
		{"src/ignored.ts", "export const ignored = true", domain.FileKindText},
	}
	for _, input := range inputs {
		entry := domain.FileEntry{Path: input.path, Name: path.Base(input.path), Kind: input.kind, SizeBytes: int64(len(input.content)), ModifiedAt: now}
		if err := store.IndexFile(entry, strings.NewReader(input.content)); err != nil {
			t.Fatal(err)
		}
	}
	graph, err := store.Graph()
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Nodes) != 6 {
		t.Fatalf("duplicate paths collapsed: %#v", graph.Nodes)
	}
	labels := map[string]string{}
	for _, node := range graph.Nodes {
		labels[node.Path] = node.Label
		if node.Path == "notes/target.md" && (len(node.Tags) != 1 || node.Tags[0] != "focus") {
			t.Fatalf("graph omitted indexed tags: %#v", node)
		}
	}
	if labels["one/route.md"] != "route.md" || labels["two/route.md"] != "route.md" {
		t.Fatalf("duplicate nodes lost their display names: %#v", labels)
	}
	if _, exists := labels["src/ignored.ts"]; exists {
		t.Fatalf("code file leaked into knowledge graph: %#v", graph.Nodes)
	}
	edges := map[string]bool{}
	for _, edge := range graph.Edges {
		edges[edge.Source+"->"+edge.Target] = true
	}
	if !edges["notes/start.md->one/route.md"] || !edges["notes/start.md->notes/target.md"] {
		t.Fatalf("expected exact and relative graph edges: %#v", graph.Edges)
	}
	if edges["notes/start.md->two/route.md"] {
		t.Fatalf("ambiguous basename was silently resolved: %#v", graph.Edges)
	}
	if !edges["notes/start.md->missing:notes/Not created"] {
		t.Fatalf("unresolved links were not represented: %#v", graph.Edges)
	}
	missing := false
	for _, node := range graph.Nodes {
		if node.ID == "missing:notes/Not created" && node.Kind == "missing" && node.Path == "" {
			missing = true
		}
	}
	if !missing {
		t.Fatalf("missing graph node was not represented: %#v", graph.Nodes)
	}
	sources, err := store.LinkSourcePathsForMove("notes/target.md")
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources[0] != "notes/start.md" {
		t.Fatalf("move rewrite scanned unrelated sources: %#v", sources)
	}
}

func TestGraphCacheIsIsolatedAndInvalidated(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	empty, err := store.Graph()
	if err != nil || empty.Nodes == nil || empty.Edges == nil {
		t.Fatalf("empty graph changed JSON shape: %#v, %v", empty, err)
	}
	now := time.Now().UTC()
	entry := domain.FileEntry{Path: "one.md", Name: "one.md", Kind: domain.FileKindMarkdown, SizeBytes: 6, ModifiedAt: now}
	if err := store.IndexFile(entry, strings.NewReader("#focus")); err != nil {
		t.Fatal(err)
	}
	first, err := store.Graph()
	if err != nil || store.graphCache == nil {
		t.Fatalf("graph was not cached: %v", err)
	}
	first.Nodes[0].ID = "corrupted"
	first.Nodes[0].Tags[0] = "corrupted"
	second, err := store.Graph()
	if err != nil || second.Nodes[0].ID != "one.md" || second.Nodes[0].Tags[0] != "focus" {
		t.Fatalf("caller mutated cached graph: %#v, %v", second, err)
	}
	entry = domain.FileEntry{Path: "two.md", Name: "two.md", Kind: domain.FileKindMarkdown, SizeBytes: 3, ModifiedAt: now}
	if err := store.IndexFile(entry, strings.NewReader("two")); err != nil {
		t.Fatal(err)
	}
	third, err := store.Graph()
	if err != nil || len(third.Nodes) != 2 {
		t.Fatalf("graph cache was not invalidated: %#v, %v", third, err)
	}
}
