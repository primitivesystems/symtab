package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/symtab-pkm/server/internal/vault"
	"github.com/google/uuid"
)

const vaultPlanJournalVersion = 1

type vaultPlanJournal struct {
	Version    int                         `json:"version"`
	ID         string                      `json:"id"`
	Operations []vaultPlanJournalOperation `json:"operations"`
}

type vaultPlanJournalOperation struct {
	Action          string `json:"action"`
	Path            string `json:"path"`
	TargetHash      string `json:"targetHash"`
	OriginalContent string `json:"originalContent,omitempty"`
	OriginalHash    string `json:"originalHash,omitempty"`
}

func newVaultPlanJournal(prepared []preparedVaultPlanOperation) vaultPlanJournal {
	journal := vaultPlanJournal{
		Version: vaultPlanJournalVersion,
		ID:      uuid.Must(uuid.NewV7()).String(),
	}
	for _, item := range prepared {
		operation := vaultPlanJournalOperation{
			Action:     item.operation.Action,
			Path:       item.path,
			TargetHash: contentHash(item.operation.Content),
		}
		if item.original != nil {
			operation.OriginalContent = item.original.Content
			operation.OriginalHash = item.original.ContentHash
		}
		journal.Operations = append(journal.Operations, operation)
	}
	return journal
}

func recoverVaultPlans(context *vault.Context) error {
	directory := vaultPlanJournalDirectory(context.RootPath())
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		journalPath := filepath.Join(directory, entry.Name())
		data, err := os.ReadFile(journalPath)
		if err != nil {
			return err
		}
		var journal vaultPlanJournal
		if err := json.Unmarshal(data, &journal); err != nil || journal.Version != vaultPlanJournalVersion {
			return fmt.Errorf("invalid vault plan recovery journal %q", entry.Name())
		}
		marker, markerErr := os.ReadFile(journalPath + ".commit")
		if markerErr != nil && !errors.Is(markerErr, os.ErrNotExist) {
			return markerErr
		}
		if markerErr != nil || string(marker) != journal.ID {
			if err := rollbackJournal(context, journal); err != nil {
				return fmt.Errorf("recover vault plan %s: %w", journal.ID, err)
			}
		}
		if err := removeJournal(journalPath); err != nil {
			return err
		}
	}
	return nil
}

func writeJournal(root string, journal vaultPlanJournal) (string, error) {
	directory := vaultPlanJournalDirectory(root)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	target := filepath.Join(directory, journal.ID+".json")
	if err := writeJournalFile(target, journal); err != nil {
		return "", err
	}
	return target, nil
}

func writeJournalFile(target string, journal vaultPlanJournal) error {
	data, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	directory := filepath.Dir(target)
	temporary, err := os.CreateTemp(directory, ".plan-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func commitJournal(path string, journal vaultPlanJournal) error {
	marker := path + ".commit"
	file, err := os.OpenFile(marker, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.WriteString(journal.ID); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func rollbackJournal(context *vault.Context, journal vaultPlanJournal) error {
	var rollbackErr error
	for index := len(journal.Operations) - 1; index >= 0; index-- {
		operation := journal.Operations[index]
		current, err := context.Files.Read(operation.Path)
		if errors.Is(err, os.ErrNotExist) && operation.Action == "create" {
			continue
		}
		if err != nil {
			rollbackErr = errors.Join(rollbackErr, err)
			continue
		}
		switch {
		case current.ContentHash == operation.OriginalHash && operation.Action == "update":
			continue
		case current.ContentHash != operation.TargetHash:
			rollbackErr = errors.Join(rollbackErr, fmt.Errorf("%s changed after interrupted plan", operation.Path))
		case operation.Action == "create":
			rollbackErr = errors.Join(rollbackErr, context.Files.RemoveCreated(operation.Path, operation.TargetHash))
		case operation.Action == "update":
			_, _, err := context.Files.Save(operation.Path, operation.OriginalContent, operation.TargetHash)
			rollbackErr = errors.Join(rollbackErr, err)
		}
	}
	return rollbackErr
}

func removeJournal(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Remove(path + ".commit"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func vaultPlanJournalDirectory(root string) string {
	return filepath.Join(root, ".symtab", "recovery", "vault-plans")
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func contentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}
