package index

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/symtab-pkm/server/internal/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const MaxIndexedTextBytes int64 = 5 * 1024 * 1024

type FileRecord struct {
	ID           uint      `gorm:"primaryKey"`
	RelativePath string    `gorm:"uniqueIndex;not null"`
	DisplayName  string    `gorm:"not null"`
	Kind         string    `gorm:"not null"`
	SizeBytes    int64     `gorm:"not null"`
	ModifiedAt   time.Time `gorm:"not null"`
	ContentHash  string    `gorm:"not null;default:''"`
	IndexedHash  string    `gorm:"not null;default:''"`
	GraphIndexed bool      `gorm:"not null;default:false"`
	IndexedAt    *time.Time
}

func (FileRecord) TableName() string { return "files" }

type LinkRecord struct {
	ID         uint   `gorm:"primaryKey"`
	SourcePath string `gorm:"index;not null"`
	RawTarget  string `gorm:"not null"`
	Position   int    `gorm:"not null"`
}

func (LinkRecord) TableName() string { return "links" }

type TagRecord struct {
	ID         uint   `gorm:"primaryKey"`
	SourcePath string `gorm:"uniqueIndex:idx_tag_source;index;not null"`
	Tag        string `gorm:"uniqueIndex:idx_tag_source;index;not null"`
}

func (TagRecord) TableName() string { return "tags" }

type PropertyRecord struct {
	ID         uint   `gorm:"primaryKey"`
	SourcePath string `gorm:"uniqueIndex:idx_property_source;index;not null"`
	Key        string `gorm:"uniqueIndex:idx_property_source;index;not null"`
}

func (PropertyRecord) TableName() string { return "properties" }

type Store struct {
	db         *gorm.DB
	writer     sync.Mutex
	graphMu    sync.Mutex
	graphCache *domain.VaultGraph
	ftsEnabled bool
}

type Fingerprint struct {
	SizeBytes    int64
	ModifiedAt   time.Time
	ContentHash  string
	IndexedHash  string
	GraphIndexed bool
}

// PreparedFile keeps file I/O outside the SQLite writer lock while allowing
// the background indexer to commit a bounded group of files together.
type PreparedFile struct {
	entry        domain.FileEntry
	contentHash  string
	searchText   string
	writableText bool
	indexedAt    time.Time
	tags         []string
	properties   []string
}

func (fingerprint Fingerprint) Current(entry domain.FileEntry) bool {
	return fingerprint.SizeBytes == entry.SizeBytes &&
		fingerprint.ModifiedAt.Equal(entry.ModifiedAt) &&
		fingerprint.ContentHash != "" &&
		fingerprint.ContentHash == fingerprint.IndexedHash &&
		fingerprint.GraphIndexed
}

func Open(databasePath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, err
	}
	db, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 3000",
		"PRAGMA wal_autocheckpoint = 1000",
	} {
		if err := db.Exec(pragma).Error; err != nil {
			_ = store.Close()
			return nil, err
		}
	}
	hadFacetIndex := db.Migrator().HasTable(&TagRecord{}) && db.Migrator().HasTable(&PropertyRecord{})
	if err := db.AutoMigrate(&FileRecord{}, &LinkRecord{}, &TagRecord{}, &PropertyRecord{}); err != nil {
		_ = store.Close()
		return nil, err
	}
	if !hadFacetIndex {
		if err := db.Model(&FileRecord{}).
			Where("kind = ?", string(domain.FileKindMarkdown)).
			Updates(map[string]any{"indexed_hash": "", "graph_indexed": false}).Error; err != nil {
			_ = store.Close()
			return nil, err
		}
	}
	var fts5 int
	if db.Raw("SELECT sqlite_compileoption_used('ENABLE_FTS5')").Scan(&fts5).Error == nil && fts5 == 1 {
		store.ftsEnabled = db.Exec("CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(relative_path UNINDEXED, content)").Error == nil
	}
	return store, nil
}

// ReplaceFiles is reserved for explicit repair/rebuild paths.
func (s *Store) ReplaceFiles(entries []domain.FileEntry) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	err := s.db.Transaction(func(tx *gorm.DB) error {
		paths := make([]string, 0, len(entries))
		for _, entry := range entries {
			paths = append(paths, entry.Path)
			if err := upsertMetadata(tx, entry); err != nil {
				return err
			}
		}
		return s.deleteMissing(tx, paths)
	})
	if err == nil {
		s.invalidateGraph()
	}
	return err
}

func (s *Store) UpsertFile(entry domain.FileEntry) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	err := upsertMetadata(s.db, entry)
	if err == nil {
		s.invalidateGraph()
	}
	return err
}

func (s *Store) ListFiles() ([]domain.FileEntry, error) {
	var records []FileRecord
	if err := s.db.Order("relative_path").Find(&records).Error; err != nil {
		return nil, err
	}
	entries := make([]domain.FileEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, domain.FileEntry{
			Path: record.RelativePath, Name: record.DisplayName, Kind: domain.FileKind(record.Kind),
			SizeBytes: record.SizeBytes, ModifiedAt: record.ModifiedAt,
		})
	}
	return entries, nil
}

func (s *Store) LinkSourcePathsForMove(sourcePath string) ([]string, error) {
	graph, err := s.Graph()
	if err != nil {
		return nil, err
	}
	affected := make(map[string]struct{})
	moved := func(candidate string) bool {
		return candidate == sourcePath || strings.HasPrefix(candidate, sourcePath+"/")
	}
	for _, edge := range graph.Edges {
		if moved(edge.Source) || moved(edge.Target) {
			affected[edge.Source] = struct{}{}
		}
	}
	paths := make([]string, 0, len(affected))
	for candidate := range affected {
		paths = append(paths, candidate)
	}
	sort.Strings(paths)
	return paths, nil
}

func (s *Store) ListChildren(parent, cursor string, limit int) ([]domain.FileEntry, string, error) {
	if limit < 1 || limit > 500 {
		limit = 250
	}
	query := s.db.Model(&FileRecord{})
	if parent == "" {
		query = query.Where("instr(relative_path, '/') = 0")
	} else {
		prefix := strings.TrimSuffix(parent, "/") + "/"
		query = query.Where(
			"substr(relative_path, 1, ?) = ? AND instr(substr(relative_path, ?), '/') = 0",
			len(prefix), prefix, len(prefix)+1,
		)
	}
	if cursor != "" {
		query = query.Where("relative_path > ?", cursor)
	}
	var records []FileRecord
	if err := query.Order("relative_path").Limit(limit + 1).Find(&records).Error; err != nil {
		return nil, "", err
	}
	next := ""
	if len(records) > limit {
		records = records[:limit]
		next = records[len(records)-1].RelativePath
	}
	entries := make([]domain.FileEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, domain.FileEntry{
			Path: record.RelativePath, Name: record.DisplayName, Kind: domain.FileKind(record.Kind),
			SizeBytes: record.SizeBytes, ModifiedAt: record.ModifiedAt,
		})
	}
	return entries, next, nil
}

func (s *Store) Search(text string, limit int) ([]domain.SearchResult, error) {
	return s.SearchPage(text, limit, 0)
}

func (s *Store) SearchPage(text string, limit, offset int) ([]domain.SearchResult, error) {
	return s.SearchPageCase(text, limit, offset, false)
}

func (s *Store) SearchPageCase(text string, limit, offset int, caseSensitive bool) ([]domain.SearchResult, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	if !s.ftsEnabled {
		return []domain.SearchResult{}, nil
	}
	var contentTerms []string
	var caseTerms []string
	var pathFilter, tagFilter, propertyFilter string
	for _, token := range strings.Fields(text) {
		name, value, hasOperator := strings.Cut(token, ":")
		value = strings.Trim(value, `"'`)
		if hasOperator && value != "" {
			switch strings.ToLower(name) {
			case "path", "file":
				pathFilter = value
				continue
			case "tag":
				tagFilter = strings.TrimPrefix(value, "#")
				continue
			case "property":
				propertyFilter = value
				continue
			}
		}
		contentTerms = append(contentTerms, searchTerms(token)...)
		caseTerms = append(caseTerms, strings.Trim(token, `"'`))
	}
	if len(contentTerms) == 0 && pathFilter == "" && tagFilter == "" && propertyFilter == "" {
		return []domain.SearchResult{}, nil
	}
	args := make([]any, 0, 5)
	query := "SELECT relative_path, '' AS excerpt FROM files WHERE kind IN ('markdown', 'text')"
	if len(contentTerms) > 0 {
		query = "SELECT relative_path, snippet(files_fts, 1, '', '', ' … ', 24) AS excerpt FROM files_fts WHERE files_fts MATCH ?"
		args = append(args, strings.Join(contentTerms, " AND "))
		if caseSensitive {
			for _, term := range caseTerms {
				query += " AND instr(content, ?) > 0"
				args = append(args, term)
			}
		}
	}
	if pathFilter != "" {
		query += " AND lower(relative_path) LIKE lower(?)"
		args = append(args, "%"+pathFilter+"%")
	}
	if tagFilter != "" {
		query += " AND relative_path IN (SELECT source_path FROM tags WHERE lower(tag) = lower(?))"
		args = append(args, tagFilter)
	}
	if propertyFilter != "" {
		query += " AND relative_path IN (SELECT source_path FROM properties WHERE lower(key) = lower(?))"
		args = append(args, propertyFilter)
	}
	query += " ORDER BY relative_path LIMIT ? OFFSET ?"
	args = append(args, limit, offset)
	var rows []struct {
		RelativePath string
		Excerpt      string
	}
	err := s.db.Raw(query, args...).Scan(&rows).Error
	results := make([]domain.SearchResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, domain.SearchResult{Path: row.RelativePath, Title: path.Base(row.RelativePath), Excerpt: row.Excerpt})
	}
	return results, err
}

func (s *Store) IsCurrent(entry domain.FileEntry) (bool, error) {
	var record FileRecord
	result := s.db.Where("relative_path = ?", entry.Path).Limit(1).Find(&record)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}
	return record.SizeBytes == entry.SizeBytes && record.ModifiedAt.Equal(entry.ModifiedAt) &&
		record.ContentHash != "" && record.ContentHash == record.IndexedHash && record.GraphIndexed, nil
}

func (s *Store) Fingerprints() (map[string]Fingerprint, error) {
	var records []FileRecord
	if err := s.db.Select("relative_path", "size_bytes", "modified_at", "content_hash", "indexed_hash", "graph_indexed").Find(&records).Error; err != nil {
		return nil, err
	}
	fingerprints := make(map[string]Fingerprint, len(records))
	for _, record := range records {
		fingerprints[record.RelativePath] = Fingerprint{
			SizeBytes: record.SizeBytes, ModifiedAt: record.ModifiedAt,
			ContentHash: record.ContentHash, IndexedHash: record.IndexedHash,
			GraphIndexed: record.GraphIndexed,
		}
	}
	return fingerprints, nil
}

// IndexFile hashes full content while retaining searchable text only for bounded text files.
func (s *Store) IndexFile(entry domain.FileEntry, reader io.Reader) error {
	prepared, err := PrepareFile(entry, reader)
	if err != nil {
		return err
	}
	return s.IndexPrepared([]PreparedFile{prepared})
}

func PrepareFile(entry domain.FileEntry, reader io.Reader) (PreparedFile, error) {
	hasher := sha256.New()
	var text bytes.Buffer
	writableText := (entry.Kind == domain.FileKindMarkdown || entry.Kind == domain.FileKindText) && entry.SizeBytes <= MaxIndexedTextBytes
	var destination io.Writer = hasher
	if writableText {
		destination = io.MultiWriter(hasher, &text)
	}
	if reader != nil {
		if _, err := io.Copy(destination, reader); err != nil {
			return PreparedFile{}, err
		}
	}
	prepared := PreparedFile{
		entry: entry, contentHash: hex.EncodeToString(hasher.Sum(nil)), searchText: text.String(),
		writableText: writableText, indexedAt: time.Now().UTC(),
	}
	if entry.Kind == domain.FileKindMarkdown && writableText {
		prepared.tags, prepared.properties = extractFacets(prepared.searchText)
	}
	return prepared, nil
}

func (s *Store) IndexPrepared(files []PreparedFile) error {
	if len(files) == 0 {
		return nil
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	err := s.db.Transaction(func(tx *gorm.DB) error {
		records := make([]FileRecord, 0, len(files))
		paths := make([]string, 0, len(files))
		type searchRow struct {
			RelativePath string `gorm:"column:relative_path"`
			Content      string `gorm:"column:content"`
		}
		searchRows := make([]searchRow, 0, len(files))
		links := make([]LinkRecord, 0)
		tags := make([]TagRecord, 0)
		properties := make([]PropertyRecord, 0)
		for _, file := range files {
			indexedAt := file.indexedAt
			records = append(records, FileRecord{
				RelativePath: file.entry.Path, DisplayName: file.entry.Name, Kind: string(file.entry.Kind),
				SizeBytes: file.entry.SizeBytes, ModifiedAt: file.entry.ModifiedAt,
				ContentHash: file.contentHash, IndexedHash: file.contentHash, IndexedAt: &indexedAt,
				GraphIndexed: true,
			})
			paths = append(paths, file.entry.Path)
			if file.writableText {
				searchRows = append(searchRows, searchRow{RelativePath: file.entry.Path, Content: file.searchText})
			}
			if file.entry.Kind == domain.FileKindMarkdown {
				for _, link := range extractLinks(file.searchText) {
					links = append(links, LinkRecord{SourcePath: file.entry.Path, RawTarget: link.target, Position: link.position})
				}
				for _, tag := range file.tags {
					tags = append(tags, TagRecord{SourcePath: file.entry.Path, Tag: tag})
				}
				for _, key := range file.properties {
					properties = append(properties, PropertyRecord{SourcePath: file.entry.Path, Key: key})
				}
			}
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "relative_path"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"display_name", "kind", "size_bytes", "modified_at", "content_hash", "indexed_hash", "graph_indexed", "indexed_at",
			}),
		}).CreateInBatches(records, 100).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path IN ?", paths).Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path IN ?", paths).Delete(&TagRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path IN ?", paths).Delete(&PropertyRecord{}).Error; err != nil {
			return err
		}
		if len(links) > 0 {
			if err := tx.CreateInBatches(links, 200).Error; err != nil {
				return err
			}
		}
		if len(tags) > 0 {
			if err := tx.CreateInBatches(tags, 200).Error; err != nil {
				return err
			}
		}
		if len(properties) > 0 {
			if err := tx.CreateInBatches(properties, 200).Error; err != nil {
				return err
			}
		}
		if !s.ftsEnabled {
			return nil
		}
		if err := tx.Exec("DELETE FROM files_fts WHERE relative_path IN ?", paths).Error; err != nil {
			return err
		}
		if len(searchRows) > 0 {
			return tx.Table("files_fts").CreateInBatches(searchRows, 100).Error
		}
		return nil
	})
	if err == nil {
		s.invalidateGraph()
	}
	return err
}

func (s *Store) DeletePath(relativePath string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	prefix := relativePath + "/"
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var paths []string
		if err := tx.Model(&FileRecord{}).
			Where("relative_path = ? OR substr(relative_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Pluck("relative_path", &paths).Error; err != nil {
			return err
		}
		if err := tx.Where("relative_path = ? OR substr(relative_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Delete(&FileRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path = ? OR substr(source_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path = ? OR substr(source_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Delete(&TagRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path = ? OR substr(source_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Delete(&PropertyRecord{}).Error; err != nil {
			return err
		}
		return s.deleteFTS(tx, paths)
	})
	if err == nil {
		s.invalidateGraph()
	}
	return err
}

func (s *Store) DeleteMissing(entries []domain.FileEntry) error {
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		paths = append(paths, entry.Path)
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	err := s.db.Transaction(func(tx *gorm.DB) error {
		return s.deleteMissing(tx, paths)
	})
	if err == nil {
		s.invalidateGraph()
	}
	return err
}

func (s *Store) deleteMissing(tx *gorm.DB, paths []string) error {
	if len(paths) == 0 {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&FileRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&TagRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&PropertyRecord{}).Error; err != nil {
			return err
		}
		return s.clearFTS(tx)
	}
	if err := tx.Exec("DROP TABLE IF EXISTS temp.symtab_live_paths").Error; err != nil {
		return err
	}
	if err := tx.Exec("CREATE TEMP TABLE symtab_live_paths(path TEXT PRIMARY KEY)").Error; err != nil {
		return err
	}
	defer tx.Exec("DROP TABLE IF EXISTS temp.symtab_live_paths")
	type livePath struct{ Path string }
	rows := make([]livePath, len(paths))
	for index, path := range paths {
		rows[index].Path = path
	}
	if err := tx.Table("symtab_live_paths").CreateInBatches(rows, 500).Error; err != nil {
		return err
	}
	var stale []string
	if err := tx.Raw("SELECT relative_path FROM files WHERE NOT EXISTS (SELECT 1 FROM symtab_live_paths WHERE path = files.relative_path)").Scan(&stale).Error; err != nil {
		return err
	}
	if err := tx.Exec("DELETE FROM files WHERE NOT EXISTS (SELECT 1 FROM symtab_live_paths WHERE path = files.relative_path)").Error; err != nil {
		return err
	}
	if err := tx.Exec("DELETE FROM links WHERE NOT EXISTS (SELECT 1 FROM symtab_live_paths WHERE path = links.source_path)").Error; err != nil {
		return err
	}
	if err := tx.Exec("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM symtab_live_paths WHERE path = tags.source_path)").Error; err != nil {
		return err
	}
	if err := tx.Exec("DELETE FROM properties WHERE NOT EXISTS (SELECT 1 FROM symtab_live_paths WHERE path = properties.source_path)").Error; err != nil {
		return err
	}
	return s.deleteFTS(tx, stale)
}

func (s *Store) Checkpoint() error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Exec("PRAGMA wal_checkpoint(PASSIVE)").Error
}

func (s *Store) Reset() error {
	s.writer.Lock()
	defer s.writer.Unlock()
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&FileRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&TagRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&PropertyRecord{}).Error; err != nil {
			return err
		}
		return s.clearFTS(tx)
	})
	if err == nil {
		s.invalidateGraph()
	}
	return err
}

func (s *Store) Close() error {
	_ = s.Checkpoint()
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func (s *Store) clearFTS(db *gorm.DB) error {
	if !s.ftsEnabled {
		return nil
	}
	return db.Exec("DELETE FROM files_fts").Error
}

func (s *Store) deleteFTS(db *gorm.DB, paths []string) error {
	if !s.ftsEnabled || len(paths) == 0 {
		return nil
	}
	for start := 0; start < len(paths); start += 500 {
		end := min(start+500, len(paths))
		if err := db.Exec("DELETE FROM files_fts WHERE relative_path IN ?", paths[start:end]).Error; err != nil {
			return err
		}
	}
	return nil
}

func upsertMetadata(db *gorm.DB, entry domain.FileEntry) error {
	record := FileRecord{
		RelativePath: entry.Path, DisplayName: entry.Name, Kind: string(entry.Kind),
		SizeBytes: entry.SizeBytes, ModifiedAt: entry.ModifiedAt,
	}
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "relative_path"}},
		DoUpdates: clause.Assignments(map[string]any{
			"display_name":  gorm.Expr("excluded.display_name"),
			"kind":          gorm.Expr("excluded.kind"),
			"content_hash":  gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN '' ELSE files.content_hash END"),
			"indexed_hash":  gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN '' ELSE files.indexed_hash END"),
			"graph_indexed": gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN false ELSE files.graph_indexed END"),
			"indexed_at":    gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN NULL ELSE files.indexed_at END"),
			"size_bytes":    gorm.Expr("excluded.size_bytes"),
			"modified_at":   gorm.Expr("excluded.modified_at"),
		}),
	}).Create(&record).Error
}

var (
	wikiLinkPattern     = regexp.MustCompile(`!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]`)
	markdownLinkPattern = regexp.MustCompile(`!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)`)
	externalLinkPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)
	inlineTagPattern    = regexp.MustCompile(`(?:^|\s)#([\p{L}\p{N}_/-]+)`)
	propertyPattern     = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$`)
)

type parsedLink struct {
	target   string
	position int
}

func extractFacets(content string) ([]string, []string) {
	tagSet := make(map[string]struct{})
	propertySet := make(map[string]struct{})
	masked := maskMarkdownCode(content)
	body := masked
	if strings.HasPrefix(masked, "---\n") {
		if end := strings.Index(masked[4:], "\n---"); end >= 0 {
			frontmatter := content[4 : 4+end]
			body = masked[4+end+4:]
			activeKey := ""
			for _, line := range strings.Split(frontmatter, "\n") {
				if match := propertyPattern.FindStringSubmatch(line); match != nil {
					activeKey = strings.ToLower(match[1])
					propertySet[activeKey] = struct{}{}
					if activeKey == "tags" {
						addTagValues(tagSet, match[2])
					}
					continue
				}
				if activeKey == "tags" {
					trimmed := strings.TrimSpace(line)
					if strings.HasPrefix(trimmed, "- ") {
						addTagValues(tagSet, strings.TrimPrefix(trimmed, "- "))
					}
				}
			}
		}
	}
	for _, match := range inlineTagPattern.FindAllStringSubmatch(body, -1) {
		if tag := strings.Trim(match[1], "/"); tag != "" {
			tagSet[tag] = struct{}{}
		}
	}
	tags := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		tags = append(tags, tag)
	}
	properties := make([]string, 0, len(propertySet))
	for key := range propertySet {
		properties = append(properties, key)
	}
	sort.Strings(tags)
	sort.Strings(properties)
	return tags, properties
}

func addTagValues(tags map[string]struct{}, value string) {
	value = strings.TrimSpace(strings.Trim(value, "[]"))
	for _, item := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || unicode.IsSpace(r)
	}) {
		item = strings.Trim(strings.TrimSpace(item), `"'#/`)
		if item != "" {
			tags[item] = struct{}{}
		}
	}
}

func extractLinks(content string) []parsedLink {
	masked := maskMarkdownCode(content)
	links := make([]parsedLink, 0)
	for _, pattern := range []*regexp.Regexp{wikiLinkPattern, markdownLinkPattern} {
		for _, match := range pattern.FindAllStringSubmatchIndex(masked, -1) {
			if len(match) >= 4 {
				links = append(links, parsedLink{target: strings.TrimSpace(content[match[2]:match[3]]), position: match[0]})
			}
		}
	}
	sort.Slice(links, func(i, j int) bool { return links[i].position < links[j].position })
	return links
}

// maskMarkdownCode preserves byte offsets while hiding inline and fenced code,
// matching Obsidian's rule that example links are not graph relationships.
func maskMarkdownCode(content string) string {
	masked := []byte(content)
	inFence := false
	fenceMarker := byte(0)
	for offset := 0; offset < len(masked); {
		lineLength := strings.IndexByte(content[offset:], '\n')
		lineEnd := len(masked)
		if lineLength >= 0 {
			lineEnd = offset + lineLength
		}
		trimmed := strings.TrimSpace(content[offset:lineEnd])
		isBacktickFence := strings.HasPrefix(trimmed, "```")
		isTildeFence := strings.HasPrefix(trimmed, "~~~")
		if (!inFence && (isBacktickFence || isTildeFence)) ||
			(inFence && ((fenceMarker == '`' && isBacktickFence) || (fenceMarker == '~' && isTildeFence))) {
			if !inFence {
				fenceMarker = trimmed[0]
			}
			blankBytes(masked[offset:lineEnd])
			inFence = !inFence
		} else if inFence {
			blankBytes(masked[offset:lineEnd])
		} else {
			inInline := false
			for index := offset; index < lineEnd; index++ {
				if content[index] == '`' {
					inInline = !inInline
					masked[index] = ' '
				} else if inInline {
					masked[index] = ' '
				}
			}
		}
		offset = lineEnd + 1
	}
	return string(masked)
}

func blankBytes(content []byte) {
	for index := range content {
		content[index] = ' '
	}
}

func normalizeLinkTarget(raw string) string {
	target := strings.Trim(strings.TrimSpace(raw), "<>")
	if decoded, err := url.PathUnescape(target); err == nil {
		target = decoded
	}
	if cut := strings.IndexAny(target, "?#"); cut >= 0 {
		target = target[:cut]
	}
	target = strings.ReplaceAll(target, `\`, "/")
	return path.Clean(target)
}

func extensionCandidates(target string) []string {
	if path.Ext(target) != "" {
		return []string{target}
	}
	return []string{target, target + ".md", target + ".markdown"}
}

func (s *Store) Graph() (domain.VaultGraph, error) {
	s.graphMu.Lock()
	defer s.graphMu.Unlock()
	if s.graphCache != nil {
		return cloneGraph(*s.graphCache), nil
	}
	var records []FileRecord
	if err := s.db.Select("relative_path", "display_name", "kind").Where("kind IN ?", []string{
		string(domain.FileKindMarkdown),
		string(domain.FileKindBinary),
	}).Order("relative_path").Find(&records).Error; err != nil {
		return domain.VaultGraph{}, err
	}
	byPath := make(map[string]FileRecord, len(records))
	byName := make(map[string][]string, len(records))
	for _, record := range records {
		byPath[record.RelativePath] = record
		name := strings.ToLower(record.DisplayName)
		byName[name] = append(byName[name], record.RelativePath)
		if record.Kind == string(domain.FileKindMarkdown) {
			stem := strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(record.DisplayName, ".md"), ".markdown"))
			if stem != name {
				byName[stem] = append(byName[stem], record.RelativePath)
			}
		}
	}
	var tagRecords []TagRecord
	if err := s.db.Select("source_path", "tag").Order("source_path, tag").Find(&tagRecords).Error; err != nil {
		return domain.VaultGraph{}, err
	}
	tagsByPath := make(map[string][]string)
	for _, tag := range tagRecords {
		tagsByPath[tag.SourcePath] = append(tagsByPath[tag.SourcePath], tag.Tag)
	}
	nodes := make([]domain.GraphNode, 0, len(records))
	for _, record := range records {
		label := record.DisplayName
		nodes = append(nodes, domain.GraphNode{ID: record.RelativePath, Path: record.RelativePath, Label: label, Kind: record.Kind, Tags: tagsByPath[record.RelativePath]})
	}
	var linkRecords []LinkRecord
	if err := s.db.Select("source_path", "raw_target").Order("source_path, position").Find(&linkRecords).Error; err != nil {
		return domain.VaultGraph{}, err
	}
	edgeSet := make(map[string]domain.GraphEdge)
	missingNodes := make(map[string]domain.GraphNode)
	for _, link := range linkRecords {
		target := normalizeLinkTarget(link.RawTarget)
		if target == "" || target == "." || externalLinkPattern.MatchString(target) {
			continue
		}
		resolved := ""
		if !strings.HasPrefix(target, "../") {
			for _, candidate := range extensionCandidates(strings.TrimPrefix(target, "./")) {
				if _, ok := byPath[candidate]; ok {
					resolved = candidate
					break
				}
			}
		}
		if resolved == "" {
			relativeTarget := path.Join(path.Dir(link.SourcePath), target)
			if relativeTarget != ".." && !strings.HasPrefix(relativeTarget, "../") {
				for _, candidate := range extensionCandidates(relativeTarget) {
					if _, ok := byPath[candidate]; ok {
						resolved = candidate
						break
					}
				}
			}
		}
		if resolved == "" {
			matches := byName[strings.ToLower(path.Base(target))]
			if len(matches) == 1 {
				resolved = matches[0]
			}
		}
		if resolved != "" {
			key := link.SourcePath + "\n" + resolved
			edgeSet[key] = domain.GraphEdge{Source: link.SourcePath, Target: resolved}
			continue
		}
		missingTarget := path.Join(path.Dir(link.SourcePath), target)
		if strings.HasPrefix(target, "/") {
			missingTarget = strings.TrimPrefix(path.Clean(target), "/")
		}
		if missingTarget == ".." || strings.HasPrefix(missingTarget, "../") {
			continue
		}
		missingID := "missing:" + missingTarget
		label := path.Base(missingTarget)
		if label == "." || label == "/" || label == "" {
			label = target
		}
		missingNodes[missingID] = domain.GraphNode{ID: missingID, Label: label, Kind: "missing"}
		edgeSet[link.SourcePath+"\n"+missingID] = domain.GraphEdge{Source: link.SourcePath, Target: missingID}
	}
	for _, node := range missingNodes {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	edges := make([]domain.GraphEdge, 0, len(edgeSet))
	for _, edge := range edgeSet {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].Source == edges[j].Source {
			return edges[i].Target < edges[j].Target
		}
		return edges[i].Source < edges[j].Source
	})
	graph := domain.VaultGraph{Nodes: nodes, Edges: edges}
	s.graphCache = &graph
	return cloneGraph(graph), nil
}

func (s *Store) invalidateGraph() {
	s.graphMu.Lock()
	s.graphCache = nil
	s.graphMu.Unlock()
}

func cloneGraph(graph domain.VaultGraph) domain.VaultGraph {
	clone := domain.VaultGraph{
		Nodes: append([]domain.GraphNode{}, graph.Nodes...),
		Edges: append([]domain.GraphEdge{}, graph.Edges...),
	}
	for index := range clone.Nodes {
		if clone.Nodes[index].Tags != nil {
			clone.Nodes[index].Tags = append([]string{}, clone.Nodes[index].Tags...)
		}
	}
	return clone
}
