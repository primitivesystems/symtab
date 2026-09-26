//go:build darwin

package watcher

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework CoreServices -framework CoreFoundation
#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>
#include <stdint.h>
#include <stdlib.h>

extern void symtabFSEvent(uintptr_t handle, char *path, FSEventStreamEventFlags flags);

typedef struct {
    FSEventStreamRef stream;
    dispatch_queue_t queue;
} SymtabFSEvents;

static void symtabDrainQueue(void *unused) { (void)unused; }

static void symtabCallback(ConstFSEventStreamRef streamRef, void *clientCallBackInfo,
                         size_t count, void *eventPaths,
                         const FSEventStreamEventFlags flags[],
                         const FSEventStreamEventId ids[]) {
    char **paths = eventPaths;
    uintptr_t handle = (uintptr_t)clientCallBackInfo;
    for (size_t i = 0; i < count; i++) {
        symtabFSEvent(handle, paths[i], flags[i]);
    }
}

static SymtabFSEvents *symtabStartFSEvents(const char *path, uintptr_t handle) {
    CFStringRef pathString = CFStringCreateWithCString(NULL, path, kCFStringEncodingUTF8);
    if (pathString == NULL) return NULL;
    const void *values[] = { pathString };
    CFArrayRef paths = CFArrayCreate(NULL, values, 1, &kCFTypeArrayCallBacks);
    CFRelease(pathString);
    if (paths == NULL) return NULL;

    FSEventStreamContext context = {0, (void *)handle, NULL, NULL, NULL};
    FSEventStreamRef stream = FSEventStreamCreate(
        NULL, symtabCallback, &context, paths, kFSEventStreamEventIdSinceNow, 0.15,
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer |
        kFSEventStreamCreateFlagWatchRoot
    );
    CFRelease(paths);
    if (stream == NULL) return NULL;
    dispatch_queue_t queue = dispatch_queue_create("app.symtab.fsevents", DISPATCH_QUEUE_SERIAL);
    if (queue == NULL) {
        FSEventStreamInvalidate(stream);
        FSEventStreamRelease(stream);
        return NULL;
    }
    FSEventStreamSetDispatchQueue(stream, queue);
    if (!FSEventStreamStart(stream)) {
        FSEventStreamInvalidate(stream);
        FSEventStreamRelease(stream);
        dispatch_release(queue);
        return NULL;
    }
    SymtabFSEvents *watcher = calloc(1, sizeof(SymtabFSEvents));
    if (watcher == NULL) {
        FSEventStreamStop(stream);
        FSEventStreamInvalidate(stream);
        FSEventStreamRelease(stream);
        dispatch_release(queue);
        return NULL;
    }
    watcher->stream = stream;
    watcher->queue = queue;
    return watcher;
}

static void symtabStopFSEvents(SymtabFSEvents *watcher) {
    if (watcher == NULL) return;
    FSEventStreamStop(watcher->stream);
    FSEventStreamInvalidate(watcher->stream);
    // FSEvents dispatches asynchronously. Drain its private serial queue before
    // Go deletes the cgo handle referenced by callbacks already in flight.
    dispatch_sync_f(watcher->queue, NULL, symtabDrainQueue);
    FSEventStreamRelease(watcher->stream);
    dispatch_release(watcher->queue);
    free(watcher);
}
*/
import "C"

import (
	"errors"
	"os"
	"path/filepath"
	"runtime/cgo"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/symtab-pkm/server/internal/files"
)

const debounce = 250 * time.Millisecond

type nativeEvent struct {
	path  string
	flags C.FSEventStreamEventFlags
}

type Watcher struct {
	root     string
	onChange func([]Event)
	events   chan nativeEvent
	done     chan struct{}
	native   *C.SymtabFSEvents
	handle   cgo.Handle
	overflow atomic.Bool
	close    sync.Once
	wait     sync.WaitGroup
}

func Start(root string, onChange func([]Event)) (*Watcher, error) {
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	watcher := &Watcher{
		root: filepath.Clean(canonical), onChange: onChange,
		events: make(chan nativeEvent, 4096), done: make(chan struct{}),
	}
	watcher.handle = cgo.NewHandle(watcher)
	cPath := C.CString(watcher.root)
	watcher.native = C.symtabStartFSEvents(cPath, C.uintptr_t(watcher.handle))
	C.free(unsafe.Pointer(cPath))
	if watcher.native == nil {
		watcher.handle.Delete()
		return nil, errors.New("could not start macOS FSEvents watcher")
	}
	watcher.wait.Add(1)
	go watcher.run()
	return watcher, nil
}

func (w *Watcher) Close() error {
	w.close.Do(func() {
		close(w.done)
		C.symtabStopFSEvents(w.native)
		w.wait.Wait()
		w.handle.Delete()
	})
	return nil
}

func (w *Watcher) run() {
	defer w.wait.Done()
	pending := make(map[string]Op)
	var timer *time.Timer
	var timerChannel <-chan time.Time
	flush := func() {
		if w.overflow.Swap(false) {
			pending = map[string]Op{"": OpReconcile}
		}
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
		case event := <-w.events:
			relative, err := filepath.Rel(w.root, event.path)
			if err != nil || relative == "." || strings.HasPrefix(relative, "..") || w.ignored(relative) {
				continue
			}
			relative = filepath.ToSlash(relative)
			if event.flags&C.kFSEventStreamEventFlagItemIsFile != 0 &&
				!files.IsSupportedVaultFile(relative) {
				continue
			}
			op := OpWrite
			if event.flags&(C.kFSEventStreamEventFlagMustScanSubDirs|C.kFSEventStreamEventFlagUserDropped|C.kFSEventStreamEventFlagKernelDropped|C.kFSEventStreamEventFlagEventIdsWrapped|C.kFSEventStreamEventFlagRootChanged|C.kFSEventStreamEventFlagMount|C.kFSEventStreamEventFlagUnmount) != 0 {
				relative, op = "", OpReconcile
			} else if event.flags&C.kFSEventStreamEventFlagItemRenamed != 0 {
				if _, statErr := os.Lstat(event.path); statErr == nil {
					op = OpCreate
				} else {
					op = OpRemove
				}
			} else if event.flags&C.kFSEventStreamEventFlagItemRemoved != 0 {
				op = OpRemove
			} else if event.flags&C.kFSEventStreamEventFlagItemCreated != 0 {
				op = OpCreate
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
		case <-w.done:
			if timer != nil {
				timer.Stop()
			}
			return
		}
	}
}

func (w *Watcher) ignored(relative string) bool {
	base := filepath.Base(relative)
	if strings.HasPrefix(base, ".symtab-write-") || strings.HasPrefix(base, ".symtab-rename-") ||
		strings.HasSuffix(base, ".swp") || strings.HasSuffix(base, "~") || base == ".DS_Store" {
		return true
	}
	return files.IsIgnored(filepath.ToSlash(relative))
}

//export symtabFSEvent
func symtabFSEvent(handle C.uintptr_t, path *C.char, flags C.FSEventStreamEventFlags) {
	watcher := cgo.Handle(handle).Value().(*Watcher)
	event := nativeEvent{path: C.GoString(path), flags: flags}
	select {
	case watcher.events <- event:
	default:
		watcher.overflow.Store(true)
	}
}
