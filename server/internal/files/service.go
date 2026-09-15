package files

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/flux-pkm/server/internal/domain"
	"github.com/google/uuid"
)

var (
	ErrInvalidPath = errors.New("invalid vault-relative path")
	ErrConflict    = errors.New("file changed since it was read")
	ErrInvalidEdit = errors.New("invalid text edit")
	ErrRetention   = errors.New("retention days must be 7, 30, or 90")
	ErrLinkRewrite = errors.New("move completed but link rewriting was incomplete")
)

type Service struct {
	root  string
	tree  sync.RWMutex
	locks sync.Map
}

func New(root string) *Service {
	return &Service{root: root}
}

func (s *Service) List() ([]domain.FileEntry, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	entries := make([]domain.FileEntry, 0)
	err := filepath.WalkDir(s.root, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if currentPath == s.root {
			return nil
		}

		relativePath, err := filepath.Rel(s.root, currentPath)
		if err != nil {
			return err
		}
		relativePath = filepath.ToSlash(relativePath)
		if IsIgnored(relativePath) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() == ".DS_Store" {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !entry.IsDir() && !IsSupportedVaultFile(relativePath) {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}
		entries = append(entries, fileEntry(relativePath, info))
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return entries, nil
}

func (s *Service) Metadata(relativePath string) (domain.FileEntry, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, resolvedPath); err != nil {
		return domain.FileEntry{}, err
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return fileEntry(normalizedPath, info), nil
}

func (s *Service) CreateDirectory(relativePath string) (domain.FileEntry, error) {
	s.tree.Lock()
	defer s.tree.Unlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, filepath.Dir(resolvedPath)); err != nil {
		return domain.FileEntry{}, err
	}
	if err := os.MkdirAll(resolvedPath, 0o755); err != nil {
		return domain.FileEntry{}, err
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return fileEntry(normalizedPath, info), nil
}

func (s *Service) Create(relativePath, content string) (domain.FileDocument, domain.FileEntry, error) {
	s.tree.Lock()
	defer s.tree.Unlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, filepath.Dir(resolvedPath)); err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	file, err := os.OpenFile(resolvedPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	failed := true
	defer func() {
		file.Close()
		if failed {
			_ = os.Remove(resolvedPath)
		}
	}()
	if _, err := file.WriteString(content); err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	if err := file.Sync(); err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	if err := file.Close(); err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	failed = false
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return domain.FileDocument{}, domain.FileEntry{}, err
	}
	contentHash := hash([]byte(content))
	return domain.FileDocument{
		Path:        normalizedPath,
		Content:     content,
		ContentHash: contentHash,
		ModifiedAt:  info.ModTime(),
	}, fileEntry(normalizedPath, info), nil
}

func (s *Service) Read(relativePath string) (domain.FileDocument, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.FileDocument{}, err
	}
	if err := rejectSymlinks(s.root, resolvedPath); err != nil {
		return domain.FileDocument{}, err
	}

	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return domain.FileDocument{}, err
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return domain.FileDocument{}, err
	}
	if !info.Mode().IsRegular() {
		return domain.FileDocument{}, fmt.Errorf("%w: path is not a regular file", ErrInvalidPath)
	}

	return domain.FileDocument{
		Path:        normalizedPath,
		Content:     string(content),
		ContentHash: hash(content),
		ModifiedAt:  info.ModTime(),
	}, nil
}

func (s *Service) OpenRaw(relativePath string) (*os.File, domain.FileEntry, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return nil, domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, resolvedPath); err != nil {
		return nil, domain.FileEntry{}, err
	}
	file, err := os.Open(resolvedPath)
	if err != nil {
		return nil, domain.FileEntry{}, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		if err != nil {
			return nil, domain.FileEntry{}, err
		}
		return nil, domain.FileEntry{}, fmt.Errorf("%w: path is not a regular file", ErrInvalidPath)
	}
	return file, fileEntry(normalizedPath, info), nil
}

func (s *Service) Save(relativePath, content, expectedHash string) (domain.SaveResult, domain.FileEntry, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, filepath.Dir(resolvedPath)); err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	fileLock := s.fileLock(resolvedPath)
	fileLock.Lock()
	defer fileLock.Unlock()

	mode := os.FileMode(0o600)
	if current, readErr := os.ReadFile(resolvedPath); readErr == nil {
		if expectedHash == "" || hash(current) != expectedHash {
			return domain.SaveResult{}, domain.FileEntry{}, ErrConflict
		}
		if info, statErr := os.Stat(resolvedPath); statErr == nil {
			mode = info.Mode().Perm()
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return domain.SaveResult{}, domain.FileEntry{}, readErr
	} else if expectedHash != "" {
		return domain.SaveResult{}, domain.FileEntry{}, ErrConflict
	}

	info, err := writeAtomic(resolvedPath, content, mode)
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	contentHash := hash([]byte(content))
	return domain.SaveResult{
		Path:        normalizedPath,
		ContentHash: contentHash,
		ModifiedAt:  info.ModTime(),
	}, fileEntry(normalizedPath, info), nil
}

func (s *Service) Patch(relativePath, expectedHash string, edits []domain.TextEdit) (domain.SaveResult, domain.FileEntry, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, resolvedPath); err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	lock := s.fileLock(resolvedPath)
	lock.Lock()
	defer lock.Unlock()

	current, err := os.ReadFile(resolvedPath)
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	if expectedHash == "" || hash(current) != expectedHash {
		return domain.SaveResult{}, domain.FileEntry{}, ErrConflict
	}
	updated, err := applyEdits(current, edits)
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	info, err = writeAtomic(resolvedPath, string(updated), info.Mode().Perm())
	if err != nil {
		return domain.SaveResult{}, domain.FileEntry{}, err
	}
	contentHash := hash(updated)
	return domain.SaveResult{
		Path:        normalizedPath,
		ContentHash: contentHash,
		ModifiedAt:  info.ModTime(),
	}, fileEntry(normalizedPath, info), nil
}

func (s *Service) Move(sourcePath, destinationPath string) (domain.FileEntry, error) {
	return s.move(sourcePath, destinationPath, nil, nil)
}

// MoveIndexed uses the completed vault index to avoid walking and reading every
// Markdown file for link rewrites on each move.
func (s *Service) MoveIndexed(
	sourcePath, destinationPath string,
	entries []domain.FileEntry,
	linkSources []string,
) (domain.FileEntry, error) {
	return s.move(sourcePath, destinationPath, entries, linkSources)
}

func (s *Service) move(
	sourcePath, destinationPath string,
	entries []domain.FileEntry,
	linkSources []string,
) (domain.FileEntry, error) {
	s.tree.Lock()
	defer s.tree.Unlock()
	source, normalizedSource, err := s.resolve(sourcePath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	destination, normalizedDestination, err := s.resolve(destinationPath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, source); err != nil {
		return domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, filepath.Dir(destination)); err != nil {
		return domain.FileEntry{}, err
	}
	if source == destination {
		info, err := os.Stat(source)
		if err != nil {
			return domain.FileEntry{}, err
		}
		return fileEntry(normalizedDestination, info), nil
	}
	if strings.HasPrefix(normalizedDestination, normalizedSource+"/") {
		return domain.FileEntry{}, ErrInvalidPath
	}
	var rewrites []linkRewrite
	if entries != nil && linkSources != nil {
		rewrites, err = s.planLinkRewritesFromCatalog(
			normalizedSource,
			normalizedDestination,
			entries,
			linkSources,
		)
	} else {
		rewrites, err = s.planLinkRewrites(normalizedSource, normalizedDestination)
	}
	if err != nil {
		return domain.FileEntry{}, err
	}
	sourceInfo, err := os.Stat(source)
	if err != nil {
		return domain.FileEntry{}, err
	}
	if destinationInfo, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		if err == nil && os.SameFile(sourceInfo, destinationInfo) {
			if err := renameCaseOnly(source, destination); err != nil {
				return domain.FileEntry{}, err
			}
			info, err := os.Stat(destination)
			if err != nil {
				return domain.FileEntry{}, err
			}
			entry := fileEntry(normalizedDestination, info)
			if err := s.applyLinkRewrites(rewrites); err != nil {
				return entry, fmt.Errorf("%w: %v", ErrLinkRewrite, err)
			}
			return entry, nil
		}
		if err == nil {
			return domain.FileEntry{}, os.ErrExist
		}
		return domain.FileEntry{}, err
	}
	if err := os.Rename(source, destination); err != nil {
		return domain.FileEntry{}, err
	}
	info, err := os.Stat(destination)
	if err != nil {
		return domain.FileEntry{}, err
	}
	entry := fileEntry(normalizedDestination, info)
	if err := s.applyLinkRewrites(rewrites); err != nil {
		return entry, fmt.Errorf("%w: %v", ErrLinkRewrite, err)
	}
	return entry, nil
}

func renameCaseOnly(source, destination string) error {
	temporary, err := os.CreateTemp(filepath.Dir(source), ".flux-rename-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Remove(temporaryPath); err != nil {
		return err
	}
	if err := os.Rename(source, temporaryPath); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		_ = os.Rename(temporaryPath, source)
		return err
	}
	return nil
}

func (s *Service) Delete(relativePath string) (domain.TrashEntry, error) {
	s.tree.Lock()
	defer s.tree.Unlock()
	resolvedPath, normalizedPath, err := s.resolve(relativePath)
	if err != nil {
		return domain.TrashEntry{}, err
	}
	if err := rejectSymlinks(s.root, resolvedPath); err != nil {
		return domain.TrashEntry{}, err
	}
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return domain.TrashEntry{}, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return domain.TrashEntry{}, err
	}
	size, err := pathSize(resolvedPath, info)
	if err != nil {
		return domain.TrashEntry{}, err
	}
	entry := domain.TrashEntry{ID: id.String(), OriginalPath: normalizedPath, DeletedAt: time.Now().UTC(), SizeBytes: size}
	itemDirectory := filepath.Join(s.root, ".flux", "trash", entry.ID)
	if err := os.MkdirAll(itemDirectory, 0o700); err != nil {
		return domain.TrashEntry{}, err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(itemDirectory)
		}
	}()
	metadata, err := json.Marshal(entry)
	if err != nil {
		return domain.TrashEntry{}, err
	}
	if err := os.WriteFile(filepath.Join(itemDirectory, "metadata.json"), metadata, 0o600); err != nil {
		return domain.TrashEntry{}, err
	}
	if err := os.Rename(resolvedPath, filepath.Join(itemDirectory, "data")); err != nil {
		return domain.TrashEntry{}, err
	}
	cleanup = false
	return entry, nil
}

func (s *Service) ListTrash() ([]domain.TrashEntry, error) {
	s.tree.RLock()
	defer s.tree.RUnlock()
	return s.listTrash()
}

func (s *Service) PermanentlyDelete(trashID string) error {
	s.tree.Lock()
	defer s.tree.Unlock()
	itemDirectory, err := s.trashItemDirectory(trashID)
	if err != nil {
		return err
	}
	if _, err := os.Stat(itemDirectory); err != nil {
		return err
	}
	return os.RemoveAll(itemDirectory)
}

func (s *Service) PurgeTrash(retention time.Duration, now time.Time) (int, error) {
	if retention < 0 {
		return 0, ErrInvalidPath
	}
	s.tree.Lock()
	defer s.tree.Unlock()
	entries, err := s.listTrash()
	if err != nil {
		return 0, err
	}
	cutoff := now.Add(-retention)
	deleted := 0
	for _, entry := range entries {
		if entry.DeletedAt.After(cutoff) {
			continue
		}
		itemDirectory, err := s.trashItemDirectory(entry.ID)
		if err != nil {
			return deleted, err
		}
		if err := os.RemoveAll(itemDirectory); err != nil {
			return deleted, err
		}
		deleted++
	}
	return deleted, nil
}

func (s *Service) listTrash() ([]domain.TrashEntry, error) {
	trashDirectory := filepath.Join(s.root, ".flux", "trash")
	items, err := os.ReadDir(trashDirectory)
	if errors.Is(err, os.ErrNotExist) {
		return []domain.TrashEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	entries := make([]domain.TrashEntry, 0, len(items))
	for _, item := range items {
		if !item.IsDir() {
			continue
		}
		metadata, readErr := os.ReadFile(filepath.Join(trashDirectory, item.Name(), "metadata.json"))
		if readErr != nil {
			continue
		}
		var entry domain.TrashEntry
		if json.Unmarshal(metadata, &entry) != nil || entry.ID != item.Name() {
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].DeletedAt.After(entries[j].DeletedAt) })
	return entries, nil
}

func (s *Service) trashItemDirectory(trashID string) (string, error) {
	parsed, err := uuid.Parse(trashID)
	if err != nil || parsed.String() != trashID {
		return "", ErrInvalidPath
	}
	return filepath.Join(s.root, ".flux", "trash", trashID), nil
}

func (s *Service) Restore(trashID string) (domain.FileEntry, error) {
	s.tree.Lock()
	defer s.tree.Unlock()
	if _, err := uuid.Parse(trashID); err != nil {
		return domain.FileEntry{}, ErrInvalidPath
	}
	itemDirectory := filepath.Join(s.root, ".flux", "trash", trashID)
	metadata, err := os.ReadFile(filepath.Join(itemDirectory, "metadata.json"))
	if err != nil {
		return domain.FileEntry{}, err
	}
	var entry domain.TrashEntry
	if err := json.Unmarshal(metadata, &entry); err != nil || entry.ID != trashID {
		return domain.FileEntry{}, ErrInvalidPath
	}
	destination, normalizedPath, err := s.resolve(entry.OriginalPath)
	if err != nil {
		return domain.FileEntry{}, err
	}
	if err := rejectSymlinks(s.root, filepath.Dir(destination)); err != nil {
		return domain.FileEntry{}, err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return domain.FileEntry{}, err
	}
	if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		if err == nil {
			return domain.FileEntry{}, os.ErrExist
		}
		return domain.FileEntry{}, err
	}
	if err := os.Rename(filepath.Join(itemDirectory, "data"), destination); err != nil {
		return domain.FileEntry{}, err
	}
	_ = os.RemoveAll(itemDirectory)
	info, err := os.Stat(destination)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return fileEntry(normalizedPath, info), nil
}

func pathSize(resolvedPath string, info os.FileInfo) (int64, error) {
	if !info.IsDir() {
		return info.Size(), nil
	}
	var size int64
	err := filepath.WalkDir(resolvedPath, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type().IsRegular() {
			itemInfo, err := entry.Info()
			if err != nil {
				return err
			}
			size += itemInfo.Size()
		}
		return nil
	})
	return size, err
}

func (s *Service) fileLock(resolvedPath string) *sync.Mutex {
	lock, _ := s.locks.LoadOrStore(resolvedPath, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

func (s *Service) resolve(relativePath string) (string, string, error) {
	normalized, err := NormalizePath(relativePath)
	if err != nil {
		return "", "", ErrInvalidPath
	}

	resolved := filepath.Join(s.root, filepath.FromSlash(normalized))
	relativeToRoot, err := filepath.Rel(s.root, resolved)
	if err != nil || relativeToRoot == ".." || strings.HasPrefix(relativeToRoot, ".."+string(filepath.Separator)) {
		return "", "", ErrInvalidPath
	}
	return resolved, normalized, nil
}

func NormalizePath(relativePath string) (string, error) {
	if relativePath == "" || strings.ContainsRune(relativePath, '\x00') || path.IsAbs(relativePath) {
		return "", ErrInvalidPath
	}
	normalized := path.Clean(strings.ReplaceAll(relativePath, "\\", "/"))
	if normalized == "." || normalized == ".." || strings.HasPrefix(normalized, "../") || IsInternal(normalized) {
		return "", ErrInvalidPath
	}
	return normalized, nil
}

// RemoveCreated removes only content whose hash still matches a just-created
// plan result. It exists for vault-plan rollback and never removes directories.
func (s *Service) RemoveCreated(relativePath, expectedHash string) error {
	s.tree.Lock()
	defer s.tree.Unlock()
	resolvedPath, _, err := s.resolve(relativePath)
	if err != nil {
		return err
	}
	if err := rejectSymlinks(s.root, resolvedPath); err != nil {
		return err
	}
	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return err
	}
	if expectedHash == "" || hash(content) != expectedHash {
		return ErrConflict
	}
	return os.Remove(resolvedPath)
}

func rejectSymlinks(root, target string) error {
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return ErrInvalidPath
	}
	current := root
	for _, component := range strings.Split(relative, string(filepath.Separator)) {
		if component == "." || component == "" {
			continue
		}
		current = filepath.Join(current, component)
		info, statErr := os.Lstat(current)
		if errors.Is(statErr, os.ErrNotExist) {
			return nil
		}
		if statErr != nil {
			return statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("%w: symlinks are not allowed", ErrInvalidPath)
		}
	}
	return nil
}

func IsInternal(relativePath string) bool {
	first, _, _ := strings.Cut(relativePath, "/")
	switch first {
	case ".flux", ".git", ".obsidian":
		return true
	default:
		return false
	}
}

// IsIgnored applies hidden application/cache exclusions at every directory depth.
// Visible dependency and build directories are deliberately traversed: Obsidian shows
// supported notes and attachments inside them while hiding unsupported code files.
func IsIgnored(relativePath string) bool {
	for _, component := range strings.Split(filepath.ToSlash(relativePath), "/") {
		switch component {
		case ".flux", ".git", ".obsidian", ".agents", ".cache", ".codex-plugins", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vite":
			return true
		}
	}
	return false
}

// IsSupportedVaultFile mirrors Obsidian's native vault formats. Source-code and
// arbitrary text files remain on disk but do not become notes in the explorer/index.
func IsSupportedVaultFile(relativePath string) bool {
	switch strings.ToLower(filepath.Ext(relativePath)) {
	case ".md", ".canvas", ".base",
		".bmp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif",
		".mp3", ".wav", ".m4a", ".3gp", ".flac", ".ogg", ".oga", ".opus",
		".mp4", ".webm", ".ogv", ".mov", ".mkv", ".pdf":
		return true
	default:
		return false
	}
}

func fileEntry(relativePath string, info os.FileInfo) domain.FileEntry {
	extension := strings.ToLower(filepath.Ext(relativePath))
	kind := domain.FileKindBinary
	if info.IsDir() {
		kind = domain.FileKindDirectory
	} else if extension == ".md" {
		kind = domain.FileKindMarkdown
	}
	return domain.FileEntry{
		Path:       relativePath,
		Name:       path.Base(relativePath),
		Kind:       kind,
		SizeBytes:  info.Size(),
		ModifiedAt: info.ModTime(),
	}
}

func writeAtomic(resolvedPath, content string, mode os.FileMode) (os.FileInfo, error) {
	temporary, err := os.CreateTemp(filepath.Dir(resolvedPath), ".flux-write-*")
	if err != nil {
		return nil, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return nil, err
	}
	if _, err := temporary.WriteString(content); err != nil {
		temporary.Close()
		return nil, err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return nil, err
	}
	if err := temporary.Close(); err != nil {
		return nil, err
	}
	if err := os.Rename(temporaryPath, resolvedPath); err != nil {
		return nil, err
	}
	return os.Stat(resolvedPath)
}

func applyEdits(content []byte, edits []domain.TextEdit) ([]byte, error) {
	if !utf8.Valid(content) || len(edits) == 0 {
		return nil, ErrInvalidEdit
	}
	var output bytes.Buffer
	cursor := 0
	for _, edit := range edits {
		if edit.StartByte < cursor || edit.EndByte < edit.StartByte || edit.EndByte > len(content) ||
			!utf8.ValidString(edit.Text) || !isRuneBoundary(content, edit.StartByte) || !isRuneBoundary(content, edit.EndByte) {
			return nil, ErrInvalidEdit
		}
		output.Write(content[cursor:edit.StartByte])
		output.WriteString(edit.Text)
		cursor = edit.EndByte
	}
	output.Write(content[cursor:])
	return output.Bytes(), nil
}

func isRuneBoundary(content []byte, offset int) bool {
	return offset == 0 || offset == len(content) || utf8.RuneStart(content[offset])
}

func hash(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}
