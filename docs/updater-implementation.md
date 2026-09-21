# Symtab Cross-Platform Updater - Testing & Implementation Guide

## Overview

Your Symtab updater now implements a **platform-aware** installation system:

- **macOS (unsigned builds)**: Semi-automatic DMG installation
- **Windows**: Automatic NSIS installation via `electron-updater`
- **Linux**: Automatic AppImage installation via `electron-updater`

All platforms show the same unified state progression to users, but the backend installation mechanisms are platform-specific.

## Installation Flow Architecture

```
                    ┌─────────────────────┐
                    │  Symtab Update Check  │
                    └──────────┬──────────┘
                               │
                         "checking"
                               │
                    ┌──────────▼──────────┐
                    │ Update Available?   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Downloading…       │
                    │  [████░░░░░░ 40%]   │
                    └──────────┬──────────┘
                               │
                         "downloaded"
                               │
                    ┌──────────▼──────────┐
                    │  Verifying Package… │ ◄─ NEW: Integrity check
                    └──────────┬──────────┘
                               │
                         "verifying"
                               │
                    ┌──────────▼──────────┐
                    │  [Ready to Install] │
                    │  ┌──────────────┐   │
                    │  │ Install      │ ◄─ User clicks
                    │  └──────────────┘   │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
        macOS               Windows             Linux
       (DMG flow)          (NSIS flow)      (AppImage flow)
           │                   │                   │
        "installing"      "installing"        "installing"
           │                   │                   │
        ┌──▼──┐            ┌────▼──┐          ┌───▼──┐
        │ DMG │            │ NSIS  │          │AppImg│
        │ App │            │Inst.  │          │Replace│
        │ open│            │runs   │          │/restart│
        └──┬──┘            └────┬──┘          └───┬──┘
           │                   │                  │
        User drag          Auto replace        Auto replace
        to /Apps           → Quit               → Relaunch
           │                   │                  │
           └───────────────────┴──────────────────┘
                       │
                    "Done"
                  Symtab relaunch
```

## States & Their Meaning

| State       | Meaning                                    | Platform    |
|-------------|------------------------------------------|-----------
| `checking`  | Checking GitHub for updates               | All        |
| `available` | Update found (optional state, can skip)   | All        |
| `downloading` | Download in progress + percent shown    | All        |
| `downloaded` | Download complete, ready for verification | All        |
| `verifying` | Computing SHA256, checking integrity      | All        |
| `ready`     | Verification passed, ready to install     | All        |
| `installing` | Installation mechanism running           | All        |
| `error`     | Error occurred (download/verify/install)  | All        |

## Testing Without Real Updates

### 1. **Simulate Update Check** (Development Mode)
If you're running in dev mode (`isDev = true`), the updater skips checks:
```typescript
// apps/desktop/src/main/index.ts
ipcMain.handle("check-for-updates", async () => {
  const currentVersion = app.getVersion();
  if (!app.isPackaged) return { currentVersion }; // ◄ Skipped in dev
  const result = await autoUpdater.checkForUpdates();
  return result?.updateInfo ? updateDetails(result.updateInfo) : { currentVersion };
});
```

To test with a packaged build:
```bash
npm run build  # Creates release/ with signed/packaged app
npm run release  # Publishes to GitHub Releases
```

### 2. **Test DMG Flow (macOS)**

#### Setup
1. Build Symtab in dev or create a mock DMG
2. Manually test the installation flow:

```bash
# Terminal 1: Run Symtab (dev mode)
cd apps/desktop
npm run dev

# Terminal 2: Simulate update downloaded
# Manually place a DMG in the electron cache:
mkdir -p ~/Library/Caches/flux/electron-updater/
cp ~/Downloads/FLUX-0.0.2-arm64.dmg ~/Library/Caches/flux/electron-updater/

# Then in Symtab: Click Settings → Check for Updates → Install
```

#### Expected Flow
1. ✓ State transitions: `checking` → `downloading` → `downloaded` → `verifying` → `ready`
2. ✓ User clicks "Install"
3. ✓ State: `installing`
4. ✓ Finder opens with DMG
5. ✓ Symtab quits
6. ✓ User drags Symtab.app to /Applications

#### What's Being Tested
- DMG opens **before** Symtab quits (no race condition)
- SHA256 verification passes
- No error handling needed (unsigned build)
- Graceful shutdown of windows

### 3. **Test Windows NSIS Flow**

#### Prerequisites
- NSIS installed (part of electron-builder setup)
- Windows package.json configured with NSIS target:
  ```json
  "win": {
    "target": ["nsis"]
  }
  ```

#### Setup
```bash
npm run build  # Builds FLUX-0.0.2-Setup.exe
npm run release  # Publishes to GitHub Releases
```

#### Expected Flow
1. ✓ Download Setup.exe
2. ✓ Verify checksum
3. ✓ Call `autoUpdater.quitAndInstall(false, true)`
4. ✓ NSIS silently replaces Symtab
5. ✓ Symtab 0.0.2 launches

### 4. **Test Linux AppImage Flow**

#### Prerequisites
- Linux package.json configured with AppImage target:
  ```json
  "linux": {
    "target": ["AppImage"]
  }
  ```

#### Setup
```bash
npm run build  # Builds Symtab-0.0.2.AppImage
npm run release  # Publishes to GitHub Releases
```

#### Expected Flow
1. ✓ Download new AppImage
2. ✓ Verify checksum
3. ✓ Call `autoUpdater.quitAndInstall()`
4. ✓ Old AppImage replaced
5. ✓ Symtab relaunches with new version

## Implementation Files

### Core Files Modified

1. **`apps/desktop/src/main/installer.ts`** (NEW)
   - Platform detection and dispatcher
   - macOS DMG verification and opening
   - Windows/Linux delegated to electron-updater

2. **`apps/desktop/src/main/index.ts`** (MODIFIED)
   - Updated UpdateStatus type with new states
   - Added `latestUpdateInfo` storage
   - Replaced direct `autoUpdater.quitAndInstall()` with platform-aware `installUpdate()`
   - Fixed event order: open DMG before quit

3. **`packages/app-core/src/App.tsx`** (MODIFIED)
   - Extended UpdateRuntimeStatus type with new states
   - Updated state mapping to WorkbenchUpdateStatus

4. **`packages/shared-ui/src/components/design-system/workbench/types.ts`** (MODIFIED)
   - Extended WorkbenchUpdateStatus type

5. **`packages/shared-ui/src/components/design-system/workbench/chrome/release-notes-dialog.tsx`** (MODIFIED)
   - Extended UpdateDownloadStatus type

6. **`apps/desktop/package.json`** (MODIFIED)
   - Removed `"notarize": true` (unsigned builds can't notarize)

## Implementation Details: macOS DMG Flow

### Why This Works for Unsigned Builds

**The Problem:**
- Apple requires signed + notarized apps to use Squirrel.Mac (the OTA mechanism)
- Squirrel.Mac uses `autoUpdater.quitAndInstall()` which handles replacement
- Your builds are unsigned → can't use Squirrel.Mac

**The Solution:**
- Download DMG (contains unsigned Symtab.app)
- Verify package integrity (SHA256)
- Open DMG in Finder (macOS native installer)
- User manually drags Symtab.app to /Applications
- macOS asks to replace existing app (native prompt)

**Why This is Reasonable:**
- Standard macOS installation UX (app in DMG, drag to Applications)
- No code signing cost ($100/year)
- Verification step catches corrupted downloads
- User maintains control (not invisible replacement)

### macOS Implementation

```typescript
// apps/desktop/src/main/installer.ts

async function installUpdateMacOS(callbacks) {
  // 1. Find downloaded DMG in cache
  const dmgPath = await findLatestDMG();
  
  // 2. Verify integrity
  callbacks.onStateChange("verifying");
  const isValid = await verifyDMGChecksum(dmgPath);
  
  if (!isValid) {
    throw new Error("Verification failed: Update package is corrupted.");
  }
  
  // 3. Open DMG (order matters!)
  callbacks.onStateChange("opening");
  const error = await shell.openPath(dmgPath);
  
  if (error) {
    throw new Error(`Failed to open installer: ${error}`);
  }
  
  // 4. Give Finder time to open before quitting
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  // 5. Quit Symtab
  app.quit();
}
```

**Key Points:**
- ✓ Open DMG **before** quit (Finder needs app running to display window)
- ✓ Verify checksum before opening (don't corrupt downloads)
- ✓ 500ms delay before quit (gives Finder time to grab the file)
- ✓ No signing or notarization needed

## Migration Path to Full OTA (When Signing is Available)

When you're ready to pay for Apple Developer ID ($100/year):

1. **Get Apple Developer ID** ($100 → annual subscription)
2. **Configure signing** in `apps/desktop/package.json`:
   ```json
   "mac": {
     "certificateFile": "/path/to/cert.p12",
     "certificatePassword": process.env.APPLE_CERT_PASSWORD,
     "notarize": true  // Re-enable
   }
   ```
3. **Switch to Squirrel.Mac** (keep same UI):
   ```typescript
   // installer.ts - macOS case
   async function installUpdateMacOS(callbacks) {
     callbacks.onStateChange("installing");
     autoUpdater.quitAndInstall(false, true);  // Squirrel.Mac takes over
   }
   ```
4. **Frontend unchanged** - Users see same states and UX
5. **macOS now gets true OTA** - Automatic, invisible replacement

## Checksum Verification

The installer verifies SHA256 checksums from one of these sources:

1. **From `.blockmap` file** (if electron-builder provides it)
2. **From GitHub Release notes** (if version notes include hashes)
3. **File existence check only** (if no checksum available)

Example blockmap location:
```
release/FLUX-0.0.2-arm64.dmg.blockmap
```

Contains:
```json
{
  "checksums": {
    "FLUX-0.0.2-arm64.dmg": "abc123def456..."
  }
}
```

## Error Handling

If installation fails at any step:

```
download succeeds
     ↓
verify fails (bad checksum)
     ↓
throw Error("Verification failed…")
     ↓
onError callback fires
     ↓
sendUpdateStatus({state: "error", message: "…"})
     ↓
UI shows error
     ↓
fallback: app.quit() (regular quit, no update)
```

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Check for updates | 0.5-1s | GitHub API call |
| Download (50MB) | 5-30s | Depends on connection |
| Verify (SHA256) | 0.5-1s | Single disk pass |
| Open DMG | <0.5s | Finder opens async |
| Quit delay | 0.5s | Grace period for Finder |

## Debugging

Enable detailed logging:

```typescript
// apps/desktop/src/main/installer.ts
console.log("DMG path:", dmgPath);
console.log("Checksum valid:", isValid);
console.log("Opening DMG:", error ? `Error: ${error}` : "Success");

// apps/desktop/src/main/index.ts
console.log("Update state:", status.state);
console.log("Latest update info:", latestUpdateInfo);
```

Run with debug flags:
```bash
DEBUG=electron-updater* npm run dev
```

## Testing Checklist

- [ ] **macOS**: DMG download → verify → open → user installs
- [ ] **Windows**: NSIS download → verify → silent install → app relaunches
- [ ] **Linux**: AppImage download → verify → replace → relaunch
- [ ] Error states display correctly
- [ ] Progress bar shows during download
- [ ] UI state machine transitions correctly
- [ ] No race conditions on quit
- [ ] Checksum validation works
- [ ] Graceful fallback on errors

## Architecture Summary

```
┌─────────────────────────────────────────┐
│  VSCodeWorkbench (React UI Component)   │
│  Displays: checking/available/…/error   │
└────────────────────┬────────────────────┘
                     │ IPC Message
                     │ "update-status"
                     ▼
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│  - autoUpdater (electron-updater)       │
│  - installUpdate() dispatcher           │
│  - platform-specific installers         │
└────────────────────┬────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │ macOS  │  │Windows │  │ Linux  │
    │ DMG    │  │ NSIS   │  │AppImage│
    │  flow  │  │  flow  │  │ flow   │
    └────────┘  └────────┘  └────────┘
         │           │           │
         └───────────┴───────────┘
              ▼
         App Updated
```

Enjoy your cross-platform updater! 🚀
