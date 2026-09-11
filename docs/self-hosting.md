# Flux on a VM: single-owner deployment

This deployment is **one trusted owner per instance**, not a multi-tenant service.
The owner account unlocks the whole instance; no shared-user roles are implemented.
The Go API is authenticated but should stay behind the HTTPS proxy. Hosted AI execution remains disabled; do not set
`FLUX_DESKTOP_TOKEN` to bypass that restriction.

## First deployment

Use a maintained Linux VM, Docker Engine with Compose, and a dedicated hostname.
Run these from the repository root:

```sh
cp .env.selfhost .env
chmod 600 .env
openssl rand -hex 32
```

Put the random output in `FLUX_SETUP_KEY` in `.env`. Keep it private: it authorizes
creation of the first owner. An empty database refuses startup without it.
After starting the stack, open the site, enter the setup key, and choose a username
and a password of at least 15 characters. The account is stored in the app-data
volume. Once setup completes, remove `FLUX_SETUP_KEY` from `.env` and recreate the
server container. It is no longer needed and cannot replace an existing owner.

The old Nginx Basic-auth prompt is removed. Any old `secrets/flux.htpasswd` file is
no longer used. Existing vaults are preserved and protected by the owner account.

Set `PUBLIC_URL=https://flux.example.com` in `.env` (exact origin, no trailing slash).
For local-only testing, retain `http://localhost:3000`.

```sh
docker compose -f docker-compose.selfhost.yml config --quiet
docker compose -f docker-compose.selfhost.yml up -d --build
docker compose -f docker-compose.selfhost.yml exec flux-web nginx -t
docker compose -f docker-compose.selfhost.yml ps
sh scripts/check-selfhost.sh
```

Missing first-owner setup configuration prevents startup. The web port binds only to `127.0.0.1`;
the API has no host port. Put an HTTPS reverse proxy on the VM in front of port
3000. For example, a host-installed Caddy configuration:

```caddyfile
flux.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Point DNS at the VM, permit HTTPS and the ports required by your certificate
issuer, restrict SSH, and leave 3000/8080 closed externally. Do not send login
credentials or API tokens over remote plaintext HTTP. Do not mount the Docker socket, host
home directory, or provider credentials into Flux.

Verify the HTTPS URL with `sh scripts/check-selfhost.sh https://flux.example.com`.
Sign in through the login page. Settings → Account provides sign out, password
changes, session revocation, and named API tokens. Copy a new token when displayed;
it cannot be retrieved later. Use it in scripts without putting it in shell history:

```sh
curl --fail -H "Authorization: Bearer $FLUX_API_TOKEN" https://flux.example.com/api/v1/status
```

In the browser, create a test vault, create/edit/rename a note, wait for indexing,
check search/backlinks, move the note to Trash and restore it, then restart the
containers and verify persistence. Test authenticated streaming before enabling
any hosted agent feature. Go protects every data route, including event streams.
Cookie-authenticated writes require the exact configured Origin; native Bearer
requests need no Origin header. CORS is not authentication.

## Authentication contract

Sessions use Secure, HttpOnly, SameSite=Strict cookies over HTTPS (loopback HTTP
uses an HttpOnly cookie without Secure). They expire after 30 minutes idle or
7 days absolute. Password changes revoke all sessions and API tokens. Passwords
use salted Argon2id; opaque random session/API credentials are stored as SHA-256
hashes. No credentials are stored in browser localStorage.
Open event streams recheck credentials every 15 seconds. The browser checks session
status every 60 seconds and on focus; passive checks do not extend the idle timeout.

API tokens expire after 90 days. They have full owner access to the data API but
cannot manage sessions/passwords or create further tokens. Revoke them in Account.

Under `/api/v1/auth`: `GET /status`, `POST /setup`, `POST /login`, `POST /logout`,
`GET /credentials`, `POST /tokens` (`name`), `DELETE /credentials/:id`, and
`POST /password` (`currentPassword`, `newPassword`). Setup/login accept `username`
and `password`; setup also requires `setupKey`. Setup and account mutations
require the configured Origin header. Account-management endpoints require a
browser session. Login/setup/password checks share 10 attempts/minute per process;
monitor abuse at your reverse proxy too.

## Backups and upgrades

Back up **both** named volumes: `flux-selfhost_flux-vaults` and
`flux-selfhost_flux-appdata`. The latter holds app state and SQLite databases.
Do not copy live SQLite files independently from their WAL files.

1. Stop the stack without deleting volumes:
   `docker compose -f docker-compose.selfhost.yml stop`.
2. Take a VM/disk snapshot containing both Docker volumes, or archive both stopped
   volumes with your backup tool. Encrypt backups and keep an off-VM copy.
3. Start the same stack with `docker compose -f docker-compose.selfhost.yml start`.
4. Restore into an isolated VM and verify notes, settings, and app startup.

Never use `docker compose down -v` unless you intend to erase your data.
Before upgrading, record the Git revision and take a tested backup. Check out the
intended release, rebuild, and repeat the smoke checks. Roll back code **and** the
matching backup if a storage migration prevents downgrade. Existing volumes
created with incorrect ownership require an administrator to repair ownership;
new volumes inherit the image's non-root ownership.

## Remaining release gates

### Verified locally (2026-09-07)

Follow-up verification: 79 frontend/lifecycle tests, all 11 workspace typechecks,
the Go suite, scoped auth/reading-view lint, and web/unsigned macOS ARM64 builds pass.
An isolated browser check covered login, Account settings, revocation while Settings
was open, and reauthentication restoring that view. The copied preview also logged
an unresolved 404 during workspace loading; this check does not certify every UI path.

`bun test scripts/server-lifecycle.test.ts` builds and starts the real production
server with temporary storage. It checks fresh vault creation, note/settings
persistence after a graceful restart, foreign-origin write rejection, and restore
from a cold copy of both storage directories. It never accesses your app data.
This is not a power-loss/crash-consistency test or a Docker-volume restore test.

The full Go test suite and web production build pass. Go 1.26.6 and compatible
module updates cleared the scanner's reachable findings. `govulncheck` still
reports 18 advisories in required modules outside the detected call paths;
zero reachable findings is not a security certification.

DOMPurify and Mermaid were updated and their reported advisories cleared.
PDF.js was updated to version 6.2.108. Dependency resolutions were added for
browserslist, postcss, qs, nanoid, js-yaml, tar, undici, brace-expansion,
fast-uri, and ip-address. `bun audit` now flags 5 transitive packages from
MCP SDK and electron-builder: `@hono/node-server`, `@xmldom/xmldom`,
`app-builder-lib`, `builder-util-runtime`, and `hono`. These are all
transitive dependencies; their reachability has not been established. Do not treat
transitive status as proof that an advisory is harmless.

Frontend bundling was improved with dynamic imports for katex, mermaid, dompurify,
and ReadingView component. Manual chunk splitting was added to both web and desktop
vite configs. PWA cache size limit was increased to 5MB. Chunk size warning limit
was increased to 1000KB. Both web and desktop builds now complete successfully.

The `Self-hosted release checks` GitHub workflow builds the Linux containers and
checks anonymous denial and authenticated API access. It has been added but has
not yet run. No code was pushed and no deployment was started by this check.

- Run the actual Linux container build and smoke checks; Docker was unavailable
  on the development machine for this hardening pass.
- Verify fresh setup, restart, backup restore, large-vault indexing, and concurrent
  edits through the production web app.
- Collaboration/roles are intentionally excluded. Hosted agent execution remains
  disabled. Password recovery without the current password is not implemented;
  retain a tested app-data backup. Do not expose a reset endpoint or delete the
  owner table as a workaround.
- Review dependency vulnerabilities, image versions, resource limits, logging,
  monitoring, and load behavior before public rollout.

References: [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[Docker port exposure](https://docs.docker.com/engine/network/port-publishing/).
