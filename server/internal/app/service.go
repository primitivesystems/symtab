package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/files"
	gitadapter "github.com/flux-pkm/server/internal/git"
	"github.com/flux-pkm/server/internal/vault"
)

var Version = "0.0.1"

var ErrInvalidVaultPlan = errors.New("invalid vault plan")

const (
	maxVaultPlanOperations = 100
	maxVaultPlanBytes      = 10 << 20
)

type Service struct {
	vaults *vault.Manager
}

func NewService(vaults *vault.Manager) *Service {
	return &Service{vaults: vaults}
}

func (s *Service) Status() domain.ServerStatus {
	status := domain.ServerStatus{
		Status:          "healthy",
		Version:         Version,
		VaultConfigured: s.vaults.Configured(),
	}
	if info := s.vaults.CurrentInfo(); info != nil {
		status.OpenVault = info
		if info.State == domain.VaultStateDegraded {
			status.Status = "degraded"
		}
	}
	return status
}

func (s *Service) AvailableVaults() ([]domain.VaultLocation, error) {
	return s.vaults.Available()
}

func (s *Service) OpenVault(path string) (domain.VaultInfo, error) {
	context, err := s.vaults.Open(path)
	if err != nil {
		return domain.VaultInfo{}, err
	}
	if err := context.Mutate(func() error { return recoverVaultPlans(context) }); err != nil {
		s.vaults.Degrade(context.VaultInfo().ID)
		return domain.VaultInfo{}, fmt.Errorf("recover interrupted vault plan: %w", err)
	}
	return context.VaultInfo(), nil
}

func (s *Service) VaultInfo(vaultID string) (domain.VaultInfo, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.VaultInfo{}, err
	}
	return context.VaultInfo(), nil
}

func (s *Service) CreateVault(path string) (domain.VaultInfo, error) {
	context, err := s.vaults.Create(path)
	if err != nil {
		return domain.VaultInfo{}, err
	}
	return context.VaultInfo(), nil
}

func (s *Service) ListFiles(vaultID string) ([]domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	return context.ListFiles()
}

func (s *Service) ListFileChildren(vaultID, parent, cursor string, limit int) ([]domain.FileEntry, string, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, "", err
	}
	if context.Index == nil {
		return nil, "", errors.New("vault index is unavailable")
	}
	return context.Index.ListChildren(parent, cursor, limit)
}

func (s *Service) Graph(vaultID string) (domain.VaultGraph, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.VaultGraph{}, err
	}
	if context.Index == nil {
		return domain.VaultGraph{Nodes: []domain.GraphNode{}, Edges: []domain.GraphEdge{}}, nil
	}
	return context.Index.Graph()
}

func (s *Service) Search(vaultID, query string, limit int) ([]domain.SearchResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	if context.Index == nil {
		return nil, errors.New("vault index is unavailable")
	}
	return context.Index.Search(query, limit)
}

func (s *Service) SearchPage(vaultID, query string, limit, offset int, caseSensitive bool) ([]domain.SearchResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	if context.Index == nil {
		return nil, errors.New("vault index is unavailable")
	}
	return context.Index.SearchPageCase(query, limit, offset, caseSensitive)
}

func (s *Service) DocumentReferences(vaultID, path string, includeUnlinked bool) (domain.DocumentReferences, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.DocumentReferences{}, err
	}
	if context.Index == nil {
		return domain.DocumentReferences{}, errors.New("vault index is unavailable")
	}
	return context.Index.References(path, includeUnlinked)
}

func (s *Service) VaultFacets(vaultID string) (domain.VaultFacets, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.VaultFacets{}, err
	}
	if context.Index == nil {
		return domain.VaultFacets{}, errors.New("vault index is unavailable")
	}
	return context.Index.Facets()
}

func (s *Service) FileMetadata(vaultID, path string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return context.Files.Metadata(path)
}

func (s *Service) VaultPath(vaultID string) (string, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return "", err
	}
	return context.RootPath(), nil
}

func (s *Service) GitStatus(ctx context.Context, vaultID string) (domain.GitStatus, error) {
	root, err := s.VaultPath(vaultID)
	if err != nil {
		return domain.GitStatus{}, err
	}
	return gitadapter.Status(ctx, root)
}

func (s *Service) EnableGit(ctx context.Context, vaultID string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Enable(ctx, vaultContext.RootPath()) })
}

func (s *Service) StageGit(ctx context.Context, vaultID string, paths []string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Stage(ctx, vaultContext.RootPath(), paths) })
}

func (s *Service) UnstageGit(ctx context.Context, vaultID string, paths []string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Unstage(ctx, vaultContext.RootPath(), paths) })
}

func (s *Service) CommitGit(ctx context.Context, vaultID, message string, paths []string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Commit(ctx, vaultContext.RootPath(), message, paths) })
}

func (s *Service) PullGit(ctx context.Context, vaultID string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Pull(ctx, vaultContext.RootPath()) })
}

func (s *Service) PushGit(ctx context.Context, vaultID string) error {
	return s.PushGitTo(ctx, vaultID, "")
}

func (s *Service) PushGitTo(ctx context.Context, vaultID, remote string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.PushTo(ctx, vaultContext.RootPath(), remote) })
}

func (s *Service) FetchGit(ctx context.Context, vaultID string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Fetch(ctx, vaultContext.RootPath()) })
}

func (s *Service) SetGitRemote(ctx context.Context, vaultID, name, url string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.SetRemote(ctx, vaultContext.RootPath(), name, url) })
}

func (s *Service) RemoveGitRemote(ctx context.Context, vaultID, name string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.RemoveRemote(ctx, vaultContext.RootPath(), name) })
}

func (s *Service) GitDiff(ctx context.Context, vaultID, path string, staged bool) (domain.GitDiff, error) {
	root, err := s.VaultPath(vaultID)
	if err != nil {
		return domain.GitDiff{}, err
	}
	return gitadapter.Diff(ctx, root, path, staged)
}

func (s *Service) DiscardGit(ctx context.Context, vaultID string, paths []string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Discard(ctx, vaultContext.RootPath(), paths) })
}

func (s *Service) GitBranches(ctx context.Context, vaultID string) ([]domain.GitBranch, error) {
	root, err := s.VaultPath(vaultID)
	if err != nil {
		return nil, err
	}
	return gitadapter.Branches(ctx, root)
}

func (s *Service) CheckoutGit(ctx context.Context, vaultID, branch string, create bool) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Checkout(ctx, vaultContext.RootPath(), branch, create) })
}

func (s *Service) GitHistory(ctx context.Context, vaultID string, limit int) ([]domain.GitCommit, error) {
	root, err := s.VaultPath(vaultID)
	if err != nil {
		return nil, err
	}
	return gitadapter.History(ctx, root, limit)
}

func (s *Service) ResolveGit(ctx context.Context, vaultID, path, strategy string) error {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return vaultContext.Mutate(func() error { return gitadapter.Resolve(ctx, vaultContext.RootPath(), path, strategy) })
}

func (s *Service) VaultConfig(vaultID string) (json.RawMessage, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(filepath.Join(context.RootPath(), ".flux", "config.json"))
	if errors.Is(err, os.ErrNotExist) {
		return json.RawMessage(`{}`), nil
	}
	if err != nil {
		return nil, err
	}
	if !json.Valid(content) {
		return nil, errors.New("invalid .flux/config.json")
	}
	return content, nil
}

func (s *Service) SaveVaultConfig(vaultID string, content json.RawMessage) error {
	var value map[string]any
	if len(content) > 64<<10 || json.Unmarshal(content, &value) != nil || value == nil {
		return errors.New("invalid vault config")
	}
	for _, key := range []string{"dailyFolder", "weeklyFolder", "inboxPath", "dailyTemplate", "weeklyTemplate"} {
		raw, exists := value[key]
		if !exists {
			continue
		}
		configPath, ok := raw.(string)
		required := key == "dailyFolder" || key == "weeklyFolder" || key == "inboxPath"
		if !ok || (required && configPath == "") ||
			(configPath != "" && (path.IsAbs(configPath) || path.Clean(configPath) == ".." ||
				len(path.Clean(configPath)) >= 3 && path.Clean(configPath)[:3] == "../")) {
			return fmt.Errorf("invalid %s", key)
		}
	}
	for _, key := range []string{"dailyFormat", "weeklyFormat"} {
		raw, exists := value[key]
		if !exists {
			continue
		}
		format, ok := raw.(string)
		if !ok || format == "" || strings.ContainsAny(format, `/\`) || strings.Contains(format, "..") {
			return fmt.Errorf("invalid %s", key)
		}
	}
	if raw, exists := value["timeZone"]; exists {
		timeZone, ok := raw.(string)
		if !ok {
			return errors.New("invalid timeZone")
		}
		if _, err := time.LoadLocation(timeZone); err != nil {
			return errors.New("invalid timeZone")
		}
	}
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return context.Mutate(func() error {
		directory := filepath.Join(context.RootPath(), ".flux")
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return err
		}
		temporary, err := os.CreateTemp(directory, ".config-*")
		if err != nil {
			return err
		}
		name := temporary.Name()
		defer os.Remove(name)
		if err := temporary.Chmod(0o600); err != nil {
			_ = temporary.Close()
			return err
		}
		if _, err := temporary.Write(content); err != nil {
			_ = temporary.Close()
			return err
		}
		if err := temporary.Sync(); err != nil {
			_ = temporary.Close()
			return err
		}
		if err := temporary.Close(); err != nil {
			return err
		}
		return os.Rename(name, filepath.Join(directory, "config.json"))
	})
}

func (s *Service) VaultRevision(vaultID string) (uint64, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return 0, err
	}
	return context.Revision.Load(), nil
}

func (s *Service) WaitVaultRevision(ctx context.Context, vaultID string, after uint64) (uint64, error) {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return 0, err
	}
	return vaultContext.WaitRevision(ctx, after), nil
}

func (s *Service) VaultChanges(vaultID string, after uint64) (domain.VaultChange, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.VaultChange{}, err
	}
	return context.ChangesSince(after), nil
}

func (s *Service) RebuildIndex(vaultID string) error {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return context.RebuildIndex()
}

func (s *Service) ReadFile(vaultID, path string) (domain.FileDocument, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileDocument{}, err
	}
	return context.Files.Read(path)
}

func (s *Service) ReadRawFile(vaultID, path string) ([]byte, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	return context.Files.ReadRaw(path)
}

func (s *Service) CreateDirectory(vaultID, path string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return mutate(context, func() (domain.FileEntry, error) {
		entry, err := context.Files.CreateDirectory(path)
		if err == nil {
			s.upsert(context, vaultID, entry)
		}
		return entry, err
	})
}

func (s *Service) CreateFile(vaultID, path, content string) (domain.FileDocument, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileDocument{}, err
	}
	return mutate(context, func() (domain.FileDocument, error) {
		document, entry, err := context.Files.Create(path, content)
		if err == nil {
			s.upsert(context, vaultID, entry)
		}
		return document, err
	})
}

func (s *Service) SaveFile(vaultID, path, content, expectedHash string) (domain.SaveResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.SaveResult{}, err
	}
	return mutate(context, func() (domain.SaveResult, error) {
		result, entry, err := context.Files.Save(path, content, expectedHash)
		if err != nil {
			return domain.SaveResult{}, err
		}
		s.upsert(context, vaultID, entry)
		return result, nil
	})
}

func (s *Service) ApplyVaultPlan(vaultID string, operations []domain.VaultPlanOperation) (domain.VaultPlanResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.VaultPlanResult{}, err
	}
	return mutate(context, func() (domain.VaultPlanResult, error) {
		if err := recoverVaultPlans(context); err != nil {
			s.vaults.Degrade(vaultID)
			return domain.VaultPlanResult{}, fmt.Errorf("recover interrupted vault plan: %w", err)
		}
		prepared, err := preflightVaultPlan(context, operations)
		if err != nil {
			return domain.VaultPlanResult{}, err
		}
		journal := newVaultPlanJournal(prepared)
		journalPath, err := writeJournal(context.RootPath(), journal)
		if err != nil {
			return domain.VaultPlanResult{}, fmt.Errorf("prepare vault plan recovery: %w", err)
		}
		applied := make([]appliedVaultPlanOperation, 0, len(prepared))
		results := make([]domain.SaveResult, 0, len(prepared))
		for _, operation := range prepared {
			var entry domain.FileEntry
			var result domain.SaveResult
			if operation.operation.Action == "create" {
				document, createdEntry, createErr := context.Files.Create(operation.path, operation.operation.Content)
				entry = createdEntry
				result = domain.SaveResult{Path: document.Path, ContentHash: document.ContentHash, ModifiedAt: document.ModifiedAt}
				err = createErr
			} else {
				result, entry, err = context.Files.Save(operation.path, operation.operation.Content, operation.operation.ExpectedHash)
			}
			if err != nil {
				if rollbackErr := rollbackJournal(context, journal); rollbackErr != nil {
					s.vaults.Degrade(vaultID)
					return domain.VaultPlanResult{}, fmt.Errorf("apply vault plan: %w; rollback failed: %v", err, rollbackErr)
				}
				_ = removeJournal(journalPath)
				return domain.VaultPlanResult{}, err
			}
			applied = append(applied, appliedVaultPlanOperation{entry: entry})
			results = append(results, result)
		}
		if err := commitJournal(journalPath, journal); err != nil {
			if rollbackErr := rollbackJournal(context, journal); rollbackErr != nil {
				s.vaults.Degrade(vaultID)
				return domain.VaultPlanResult{}, fmt.Errorf("commit vault plan: %w; rollback failed: %v", err, rollbackErr)
			}
			_ = removeJournal(journalPath)
			return domain.VaultPlanResult{}, fmt.Errorf("commit vault plan: %w", err)
		}
		if err := removeJournal(journalPath); err != nil {
			s.vaults.Degrade(vaultID)
			return domain.VaultPlanResult{}, fmt.Errorf("finish vault plan: %w", err)
		}
		for _, operation := range applied {
			s.upsert(context, vaultID, operation.entry)
		}
		return domain.VaultPlanResult{Files: results}, nil
	})
}

type preparedVaultPlanOperation struct {
	operation domain.VaultPlanOperation
	path      string
	original  *domain.FileDocument
}

type appliedVaultPlanOperation struct {
	entry domain.FileEntry
}

func preflightVaultPlan(context *vault.Context, operations []domain.VaultPlanOperation) ([]preparedVaultPlanOperation, error) {
	if len(operations) == 0 || len(operations) > maxVaultPlanOperations {
		return nil, fmt.Errorf("%w: operations must contain 1..%d items", ErrInvalidVaultPlan, maxVaultPlanOperations)
	}
	prepared := make([]preparedVaultPlanOperation, 0, len(operations))
	seen := make(map[string]bool, len(operations))
	totalBytes := 0
	for _, operation := range operations {
		totalBytes += len([]byte(operation.Content))
		if totalBytes > maxVaultPlanBytes {
			return nil, fmt.Errorf("%w: content exceeds 10 MiB", ErrInvalidVaultPlan)
		}
		normalized, err := files.NormalizePath(operation.Path)
		if err != nil {
			return nil, err
		}
		if seen[normalized] {
			return nil, fmt.Errorf("%w: duplicate path %q", ErrInvalidVaultPlan, normalized)
		}
		seen[normalized] = true
		item := preparedVaultPlanOperation{operation: operation, path: normalized}
		switch operation.Action {
		case "create":
			if operation.ExpectedHash != "" {
				return nil, fmt.Errorf("%w: create %q must not have expectedHash", ErrInvalidVaultPlan, normalized)
			}
			if _, err := context.Files.Metadata(normalized); err == nil {
				return nil, os.ErrExist
			} else if !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
			if parent := path.Dir(normalized); parent != "." {
				metadata, err := context.Files.Metadata(parent)
				if err != nil {
					return nil, err
				}
				if metadata.Kind != domain.FileKindDirectory {
					return nil, fmt.Errorf("%w: parent of %q is not a directory", ErrInvalidVaultPlan, normalized)
				}
			}
		case "update":
			if operation.ExpectedHash == "" {
				return nil, fmt.Errorf("%w: update %q requires expectedHash", ErrInvalidVaultPlan, normalized)
			}
			document, err := context.Files.Read(normalized)
			if err != nil {
				return nil, err
			}
			if document.ContentHash != operation.ExpectedHash {
				return nil, files.ErrConflict
			}
			item.original = &document
		default:
			return nil, fmt.Errorf("%w: action must be create or update", ErrInvalidVaultPlan)
		}
		prepared = append(prepared, item)
	}
	return prepared, nil
}

func (s *Service) PatchFile(vaultID, path, expectedHash string, edits []domain.TextEdit) (domain.SaveResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.SaveResult{}, err
	}
	return mutate(context, func() (domain.SaveResult, error) {
		result, entry, err := context.Files.Patch(path, expectedHash, edits)
		if err == nil {
			s.upsert(context, vaultID, entry)
		}
		return result, err
	})
}

func (s *Service) MoveFile(vaultID, sourcePath, destinationPath string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return mutate(context, func() (domain.FileEntry, error) {
		return s.moveFile(context, vaultID, sourcePath, destinationPath)
	})
}

// MoveFileExpected checks and moves under one vault mutation lock. This keeps
// external agents from moving content changed after they read it.
func (s *Service) MoveFileExpected(vaultID, sourcePath, destinationPath, expectedHash string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return mutate(context, func() (domain.FileEntry, error) {
		if err := expectHash(context, sourcePath, expectedHash); err != nil {
			return domain.FileEntry{}, err
		}
		return s.moveFile(context, vaultID, sourcePath, destinationPath)
	})
}

func (s *Service) DeleteFile(vaultID, path string) (domain.TrashEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.TrashEntry{}, err
	}
	return mutate(context, func() (domain.TrashEntry, error) {
		return s.deleteFile(context, path)
	})
}

// DeleteFileExpected checks and trashes under one vault mutation lock.
func (s *Service) DeleteFileExpected(vaultID, path, expectedHash string) (domain.TrashEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.TrashEntry{}, err
	}
	return mutate(context, func() (domain.TrashEntry, error) {
		if err := expectHash(context, path, expectedHash); err != nil {
			return domain.TrashEntry{}, err
		}
		return s.deleteFile(context, path)
	})
}

func (s *Service) RestoreFile(vaultID, trashID string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	return mutate(context, func() (domain.FileEntry, error) {
		entry, err := context.Files.Restore(trashID)
		if err == nil {
			s.upsert(context, vaultID, entry)
		}
		return entry, err
	})
}

func (s *Service) ListTrash(vaultID string) ([]domain.TrashEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	return context.Files.ListTrash()
}

func (s *Service) PermanentlyDelete(vaultID, trashID string) error {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return context.Mutate(func() error { return context.Files.PermanentlyDelete(trashID) })
}

func (s *Service) PurgeTrash(vaultID string, retentionDays int) (domain.PurgeResult, error) {
	if retentionDays != 7 && retentionDays != 30 && retentionDays != 90 {
		return domain.PurgeResult{}, files.ErrRetention
	}
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.PurgeResult{}, err
	}
	deleted, err := mutate(context, func() (int, error) {
		return context.Files.PurgeTrash(time.Duration(retentionDays)*24*time.Hour, time.Now().UTC())
	})
	return domain.PurgeResult{Deleted: deleted}, err
}

func (s *Service) moveFile(context *vault.Context, vaultID, sourcePath, destinationPath string) (domain.FileEntry, error) {
	var entry domain.FileEntry
	var err error
	info := context.VaultInfo()
	if context.Index != nil && info.State == domain.VaultStateActive {
		var entries []domain.FileEntry
		var linkSources []string
		entries, err = context.Index.ListFiles()
		if err == nil {
			linkSources, err = context.Index.LinkSourcePathsForMove(sourcePath)
		}
		if err == nil {
			entry, err = context.Files.MoveIndexed(sourcePath, destinationPath, entries, linkSources)
		}
	} else {
		entry, err = context.Files.Move(sourcePath, destinationPath)
	}
	if errors.Is(err, files.ErrLinkRewrite) {
		s.vaults.Degrade(vaultID)
		s.moveIndex(context, vaultID, sourcePath, entry)
		return entry, nil
	}
	if err == nil {
		s.moveIndex(context, vaultID, sourcePath, entry)
	}
	return entry, err
}

func (s *Service) deleteFile(context *vault.Context, path string) (domain.TrashEntry, error) {
	entry, err := context.Files.Delete(path)
	if err == nil {
		context.QueueDelete(path)
	}
	return entry, err
}

func expectHash(context *vault.Context, path, expectedHash string) error {
	if expectedHash == "" {
		return files.ErrConflict
	}
	document, err := context.Files.Read(path)
	if err != nil {
		return err
	}
	if document.ContentHash != expectedHash {
		return files.ErrConflict
	}
	return nil
}

func mutate[T any](context *vault.Context, operation func() (T, error)) (T, error) {
	var result T
	err := context.Mutate(func() error {
		var operationErr error
		result, operationErr = operation()
		return operationErr
	})
	return result, err
}

func (s *Service) upsert(context *vault.Context, vaultID string, entry domain.FileEntry) {
	if context.Index != nil {
		if context.Index.UpsertFile(entry) != nil {
			s.vaults.Degrade(vaultID)
			return
		}
		context.QueueIndex(entry.Path)
	}
}

func (s *Service) moveIndex(context *vault.Context, vaultID, sourcePath string, entry domain.FileEntry) {
	if context.Index != nil && context.Index.DeletePath(sourcePath) != nil {
		s.vaults.Degrade(vaultID)
		return
	}
	s.upsert(context, vaultID, entry)
}
