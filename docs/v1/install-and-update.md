# Install and update Symtab

## Install on macOS

The current v1 release artifact is an Apple silicon DMG.

1. Download the `Symtab-<version>-arm64.dmg` file from the matching GitHub release.
2. Open the DMG.
3. Move Symtab to Applications.
4. Open Symtab from Applications.

Current builds are unsigned. macOS may prevent the first launch. If it does, review the warning and allow Symtab from **System Settings → Privacy & Security** only if you trust the downloaded release.

## Check for updates

Symtab checks for updates after onboarding. To check manually, choose **Symtab → Check for Updates…** or open Settings and run the update check.

When an update is available:

1. Start the download from the update notification or release-notes view.
2. Wait while Symtab downloads and verifies the DMG size and SHA-256 checksum supplied by GitHub.
3. Install the update when its status is **Ready**.

Symtab saves pending editor changes before opening the DMG and quitting. Complete the normal DMG installation to replace the previous app.

## Other platforms

The repository contains Windows and Linux packaging configuration, but the v1 release workflow publishes only the macOS DMG. Do not treat Windows or Linux packages as supported release artifacts until their workflows are enabled and tested.
