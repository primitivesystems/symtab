# Desktop release process

GitHub Actions builds and attaches the macOS DMG when a GitHub release is published from a correctly named release branch.

## Required names

For version `1.2.3`:

- branch: `release/<name>-1.2.3` or `release/<name>-v1.2.3`;
- desktop package version in `apps/desktop/package.json`: `1.2.3`;
- Git tag: `v1.2.3`;
- GitHub release target: the release branch.

All three versions must match. The workflow rejects a release with mismatched names.

## Publish

1. Merge the approved product branch into a new `release/<name>-<version>` branch.
2. Update `apps/desktop/package.json` to that semantic version and commit it.
3. Push the release branch.
4. Create tag `v<version>` at the intended release commit and push it.
5. Create a GitHub release for that tag, set its target to the release branch, add release notes, and publish it.

Publishing triggers `.github/workflows/release-desktop.yml`. The job checks out the tag, verifies the branch/tag/package versions, installs locked dependencies, builds the bundled Go service and unsigned DMG, then uploads the DMG to the GitHub release.

## Verify

Before announcing the release:

1. Confirm the workflow succeeded.
2. Confirm the release contains `Symtab-<version>-arm64.dmg`.
3. Download the DMG from GitHub and confirm it opens.
4. Install and launch Symtab on Apple silicon.
5. Open a test vault and verify create, edit, archive, Trash restore, journal, graph, and update-check flows.

The current workflow does not sign or notarize the app and does not publish Windows or Linux artifacts. Add those only after their credentials and installation flows are tested.
