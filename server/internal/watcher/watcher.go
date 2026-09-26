//go:build !darwin

package watcher

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/symtab-pkm/server/internal/files"
	"github.com/fsnotify/fsnotify"
)

const debounce = 250 * time.Millisecond

type Watcher struct {
	inner    *fsnotify.Watcher
	root     string
	onChange func([]Event)
	done     chan struct{}
	close    sync.Once
	wait     sync.WaitGroup
}

// Start watches root immediately, then discovers nested directories without blocking vault open.
func Start(root string, onChange func([]Event)) (*Watcher, error) {
	inner, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := inner.Add(root); err != nil {
		_ = inner.Close()
		return nil, err
	}
	watcher := &Watcher{inner: inner, root: root, onChange: onChange, done: make(chan struct{})}
	watcher.wait.Add(2)
	go watcher.run()
	go func() {
		defer watcher.wait.Done()
		if err := watcher.addTree(root); err != nil {
			watcher.onChange([]Event{{Op: OpReconcile}})
		}
	}()
	return watcher, nil
}

func (w *Watcher) Close() error {
	w.close.Do(func() { close(w.done) })
	w.wait.Wait()
	return w.inner.Close()
}

func (w *Watcher) run() {
	defer w.wait.Done()
	pending := make(map[string]Op)
	var timer *time.Timer
	var timerChannel <-chan time.Time
	flush := func() {
		if len(pending) == 0 {
			return
		}
		events := make([]Event, 0, len(pending))
		for path, op := range pending {
			events = append(events, Event{Path: path, Op: op})
		}
		pending = make(map[string]Op)
		w.onChange(events)
	}
	for {
		select {
		case event, ok := <-w.inner.Events:
			if !ok {
				return
			}
			if w.ignored(event.Name) {
				continue
			}
			relative, err := filepath.Rel(w.root, event.Name)
			if err != nil {
				continue
			}
			relative = filepath.ToSlash(relative)
			if !files.IsSupportedVaultFile(relative) &&
				!event.Has(fsnotify.Remove) && !event.Has(fsnotify.Rename) {
				info, statErr := os.Stat(event.Name)
				if statErr != nil || !info.IsDir() {
					continue
				}
			}
			op := OpWrite
			if event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
				op = OpRemove
			} else if event.Has(fsnotify.Create) {
				op = OpCreate
				if info, statErr := os.Stat(event.Name); statErr == nil && info.IsDir() {
					_ = w.addTree(event.Name)
				}
			}
			pending[relative] = merge(pending[relative], op)
			if timer == nil {
				timer = time.NewTimer(debounce)
			} else {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(debounce)
			}
			timerChannel = timer.C
		case <-timerChannel:
			timerChannel = nil
			flush()
		case _, ok := <-w.inner.Errors:
			if !ok {
				return
			}
			flush()
			w.onChange([]Event{{Op: OpReconcile}})
		case <-w.done:
			if timer != nil {
				timer.Stop()
			}
			return
		}
	}
}

func (w *Watcher) addTree(root string) error {
	return filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if current != w.root && w.ignored(current) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() && current != w.root {
			select {
			case <-w.done:
				return filepath.SkipAll
			default:
			}
			if err := w.inner.Add(current); err != nil && !strings.Contains(err.Error(), "already exists") {
				return err
			}
		}
		return nil
	})
}

func (w *Watcher) ignored(current string) bool {
	relative, err := filepath.Rel(w.root, current)
	if err != nil || relative == ".." {
		return true
	}
	if relative == "." {
		return false
	}
	base := filepath.Base(relative)
	if strings.HasPrefix(base, ".symtab-write-") || strings.HasPrefix(base, ".symtab-rename-") ||
		strings.HasSuffix(base, ".swp") || strings.HasSuffix(base, "~") || base == ".DS_Store" {
		return true
	}
	return files.IsIgnored(filepath.ToSlash(relative))
}
