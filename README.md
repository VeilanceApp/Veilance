# Veilance Browser Extension v0.6.11

Veilance is a local-first browser privacy observability extension. It shows what
a website requests from browser APIs and which network hosts it contacts while
the page is open. Observations describe behavior, not intent: a finding does not
automatically mean a website is malicious.

Veilance supports explicit local telemetry snapshots. A user can capture the
current public website from the popup or separately opt into automatic local
capture once observed behavior reaches the 25/100 interest threshold. The
resulting evidence and inert redacted HTML can be reviewed, downloaded, or
deleted in Settings. Snapshot uploads require their own explicit consent and
can run immediately, through the privacy-delayed queue, or automatically. They
send raw gzip files through the configured multipart API. Payouts remain
disabled.

## Existing local-first capabilities

* One stable visit session per top-level navigation
* Redirects update the same visit instead of resetting its data
* Start, page-load-complete, update, and end timestamps
* SQLite-backed history for the latest 20 visits
* Full history detail for requests, hosts, browser API calls, page counts, findings,
  and response security headers
* Overview and History tabs in the popup
* A tabbed Settings page
* Individual enable/disable controls for every built-in indicator
* A bundled, automatically updated tracker database enabled by default
* Declarative custom indicator rules loaded from a user-selected folder
* A locally generated Ed25519 Solana wallet and explicit private-key export
* Automatic visit-payload export removed; explicit local snapshot downloads use
  the stricter snapshot safety policy
* Payout controls shown as disabled until payout infrastructure is ready

## What Veilance detects

* First-party and third-party network request counts
* Contacted hosts and resource types
* Common analytics, advertising, attribution, and session-analysis services
* Canvas pixel readback and export
* WebGL renderer queries and pixel readback
* Offline AudioContext rendering and audio-buffer access
* WebRTC connection and statistics activity
* Browser storage writes and container counts
* Permission queries
* Media-device enumeration
* Camera and microphone requests
* Geolocation requests
* Clipboard API access
* Notification permission requests
* Battery status access
* Beacon transmissions
* Script-visible cookie reads and writes
* Storage Access and Cookie Store operations
* Browser, platform, CPU, memory, touch, language, plugin, and client hints
* Screen geometry, color depth, orientation, and device-pixel ratio reads
* Locale and time-zone resolution
* Font availability checks and canvas text measurement
* JavaScript CSS media and preference queries
* Performance entry inspection and observation
* WebGPU adapter, device, format, and adapter-information requests
* Network Information API characteristic reads
* Media capability and protected-media checks
* Bluetooth, USB, HID, serial, MIDI, and gamepad access
* Motion, orientation, and Generic Sensor activity
* Credential Management and WebAuthn capability checks
* Local file-system picker and handle operations
* Speech voice enumeration and speech-recognition starts
* Topics, Protected Audience, and Shared Storage API use
* Script and iframe counts
* Accessible-cookie counts
* LocalStorage, SessionStorage, IndexedDB, and CacheStorage counts
* Selected top-level response security headers

## Install as an unpacked extension

Veilance supports Chromium Manifest V3 browsers such as Chrome, Edge, and
Brave.

1. Extract the release ZIP.
2. Open the browser's extension page:
   * Chrome: `chrome://extensions`
   * Edge: `edge://extensions`
   * Brave: `brave://extensions`
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted `Veilance-main` directory containing `manifest.json`.
6. Pin Veilance to the toolbar.
7. Reload any sites that were already open so document-start indicators can
   initialize.

Do not select the ZIP itself. Chromium needs the extracted directory.

## Use the popup

### Overview

The Overview tab shows the active website, current status, request and browser
API call counts, findings, and the live snapshot interest score. Each activity
counter is labeled **Typical** or **High**. Counts accumulate throughout a
visit, and high volume alone does not mean harmful behavior. Select a finding
status to jump directly to its explanation, or open **Technical details** to
see the full local record.

The compact **Wallet & payouts** button opens the dedicated Settings
tab containing the Solana address, backup controls, and payout status.

Use the appearance button in the popup to switch directly between light and
dark mode. Settings also provides **System**, **Light**, and **Dark** options.

### History

The History tab shows the latest 20 visits. Select a visit to review:

* Observation start, page-load completion, end, and duration
* First-party and third-party request totals
* Every retained host and resource-type count
* Known service matches
* Every enabled browser API signal, its count, and first/last observation time
* Page structure and storage counts
* Top-level response status and selected security-header presence
* All built-in and imported findings

“Complete” refers to Veilance's complete observation record for the visit. It
does not include page content, form values, exact URLs, or other excluded
sensitive data.

### Save a telemetry snapshot

While viewing a public HTTP(S) website, Veilance scores observed actions from 0
to 100. **Save snapshot** becomes available at 25/100. Visits below that
threshold are treated as routine and cannot be snapshotted. The capture is
manual unless **Save eligible snapshots automatically** is enabled in Settings.
Automatic capture remains off by default and saves at most one local snapshot
per eligible visit. Open **Settings → Snapshots** to:

* Review the raw telemetry fields and the redacted HTML as inert text
* Inspect third-party resource origins, inline-script capability hints, and
  advertising, consent, tracking, or anti-blocking structural markers
* Download the complete local record as JSON or the redacted HTML as `.txt`
* Delete one snapshot or clear the vault without clearing visit history
* Opt into automatic local capture independently of any upload permission
* Opt into uploads, then upload immediately, queue selected snapshots for later,
  or enable automatic upload for future eligible snapshots

The snapshot provides evidence for an analyst or backend classifier. It does
not label a site as malicious and does not upload the locally generated
`findings` or severity interpretations.

## Indicator settings

Open the popup and select **Settings**. Each built-in indicator can be enabled
or disabled separately. A change affects new observations immediately; it does
not rewrite existing history.

Veilance observes enabled signals. It does not block, spoof, or modify browser
fingerprints or website behavior.

## Tracker database updates

Settings shows the managed tracker database separately from user-imported
custom rules. **Enable tracker matching** controls matching without deleting the
local database. **Automatic updates** controls the eight-hour alarm. **Check
now** always remains available for a manual refresh.

Each successful update is validated completely before it replaces the last
known-good database. A failed download or invalid archive leaves the active
tracker set unchanged and adds the error to the visible update log. Tracker
updates are declarative JSON and cannot execute code.

## Load indicators from a folder

Select **Choose folder** in Settings, then choose a directory that
contains JSON files. The browser grants one-time read access to the selected
files. Veilance does not retain a directory handle and does not scan folders in
the background.

Imported indicators are data-only rules. They cannot contain or execute
JavaScript. A file may contain one object, an array, or an object with an
`indicators`, `trackers`, or `rules` array.

For the easiest start:

1. Select **Download starter file** in Settings.
2. Put the downloaded JSON file in its own folder.
3. Edit the examples or add another `.json` file.
4. Select **Choose folder** and choose that folder.

Use `indicatorId` to match every retained event from a built-in source. Source
ids are shown next to each event-based indicator in Settings. Keep that built-in
indicator enabled. For a narrower rule, use the exact case-sensitive `api` and
`action` strings shown in a visit's **Technical details**.

Signal example:

```json
{
  "id": "repeated-font-probing",
  "name": "Repeated font probing",
  "category": "Fingerprinting",
  "description": "Font-related signals appeared at least ten times.",
  "severity": "medium",
  "match": {
    "indicatorId": "font-probing",
    "minCount": 10
  }
}
```

Combined example:

```json
{
  "id": "broad-fingerprint-profile",
  "name": "Broad fingerprint profile",
  "description": "Navigator, screen, and font signals appeared together.",
  "severity": "medium",
  "match": {
    "mode": "all",
    "signals": [
      { "indicatorId": "navigator-characteristics" },
      { "indicatorId": "screen-characteristics" },
      { "indicatorId": "font-probing" }
    ]
  }
}
```

Host example:

```json
{
  "id": "example-host",
  "name": "Example host contacted",
  "description": "A matching host was contacted.",
  "severity": "low",
  "match": {
    "hosts": ["metrics.example"]
  }
}
```

Veilance JSON tracker example:

```json
{
  "format": "veilance-json",
  "name": "Platform161",
  "category": "advertising",
  "website_url": "https://platform161.com/",
  "organization": "platform161",
  "domains": [
    "creative-serving.com",
    "p161.net"
  ],
  "filters": [
    "||ads.creative-serving.com^$3p",
    "||p161.net^$3p"
  ]
}
```

Veilance JSON supports host-anchored rules, first-/third-party options, common
resource types, and `domain=` page constraints. Veilance warns and skips filters
that require URL paths, cosmetic matching, regular expressions, redirects, or
exception semantics because history intentionally retains host-level request
data rather than full URLs. Keep the built-in `network-requests` indicator
enabled while using tracker rules.

`mode` may be `any` or `all`. A signal matcher may contain `indicatorId`,
`kind`, `api`, `action`, and `minCount`. Host rules use `hosts` or
`hostSuffix`. See `indicator-examples/` for import-ready rules and the complete
authoring guide.

## Solana wallet

On first startup, Veilance asks the browser's Web Crypto implementation to
generate an Ed25519 keypair. The Solana address and 64-byte secret key are
derived locally. The private key is returned to a page only after the user
explicitly confirms an export in Settings.

Export options include:

* Copying the standard Base58 private key
* Downloading the standard 64-byte Solana keypair array

Important security boundary:

* The generated public address is sent as `wallet_address` only after telemetry
  upload consent is enabled.
* The 64-byte secret key and its Base58 private-key form never leave the browser
  through Veilance telemetry.
* The keypair is stored in `chrome.storage.local` for the extension profile.
* It is not encrypted with a separate user passphrase in this release.
* A person or process with access to the browser profile or extension storage
  may be able to recover it.
* Removing extension data or losing the browser profile can remove the only
  local copy. Back up the key before funding the wallet.
* Payouts are not active in v0.6.0.

## SQLite history storage

Veilance uses the official SQLite WebAssembly runtime bundled under
`vendor/sqlite/`. Visit data is inserted and queried through SQLite. The SQLite
database bytes are serialized into extension-local storage so Manifest V3
service-worker restarts do not lose history.

The `visits` table stores one row per visit and prunes itself to the most recent
20 rows. The separate `telemetry_snapshots` table stores no more than 20
interest-qualified manual or automatic snapshots, their local queue state, and
the redacted payload.
Derived summary columns keep both lists inexpensive while the complete local
records remain available for review.

No remote executable code is loaded. The bundled SQLite runtime is version
3.53.0 from the official `sqlite/sqlite-wasm` project.

## Snapshot upload API contract

This build uses one constant for its complete Veilance API origin:

```javascript
export const VEILANCE_USE_PRODUCTION_API = false;
export const VEILANCE_DEVELOPMENT_API_ORIGIN = "http://10.0.10.211:5132";
export const VEILANCE_PRODUCTION_API_ORIGIN = "https://api.veilance.org";
export const VEILANCE_API_ORIGIN = VEILANCE_USE_PRODUCTION_API
  ? VEILANCE_PRODUCTION_API_ORIGIN
  : VEILANCE_DEVELOPMENT_API_ORIGIN;

export const TELEMETRY_UPLOAD_ENABLED = true;
export const TELEMETRY_UPLOAD_ENDPOINT = `${VEILANCE_API_ORIGIN}/api/v1/telemetry/upload`;
export const TELEMETRY_IP_ADDRESS_ENDPOINT = `${VEILANCE_API_ORIGIN}/api/v1/telemetry/ip`;
export const TELEMETRY_UPLOAD_ALLOW_INSECURE_HTTP = !VEILANCE_USE_PRODUCTION_API;
```

Set `VEILANCE_USE_PRODUCTION_API` to `true` for a production build. Both the IP
lookup and upload then use `https://api.veilance.org`, and insecure HTTP is
disabled automatically. The HTTP exception exists only for the private
development endpoint. The user must still enable **Allow pseudonymous snapshot
uploads** in Settings. They can then upload immediately, queue with a randomized
privacy delay, or opt into automatic queueing. Unscored legacy records and
visits below 25/100 cannot be queued. Enabling the build gate alone never uploads
existing or future snapshots.

Immediately before an upload operation, the extension sends a credential-free
`GET /api/v1/telemetry/ip` request to the selected API origin. The expected
response uses the same report envelope as the upload API:

```json
{
  "error": {},
  "metadata": { "request_id": "req-example" },
  "output": { "ip_address": "203.0.113.42" }
}
```

The extension accepts a valid IPv4 or IPv6 literal and uses it for every domain
batch in that upload operation. It does not persist the address. A non-2xx
response, invalid JSON, or malformed address fails the upload safely and leaves
the snapshots eligible for the normal retry schedule.

The request is equivalent to:

```bash
curl -X POST \
  -F 'client_id=stable-random-256-bit-client-id' \
  -F 'wallet_address=generated-public-solana-address' \
  -F 'domain_name=collector.shop.example.co.uk' \
  -F 'ip_address=203.0.113.42' \
  -F 'telemetry=@telemetry.bin;type=application/gzip' \
  http://10.0.10.211:5132/api/v1/telemetry/upload
```

The API needs a small first-party lookup route. In the Flask blueprint shown by
the upload API, its direct form is:

```python
@veilance_v1.route("/telemetry/ip", methods=["GET"])
def telemetry_ip():
    return settings.build_json_report({"ip_address": request.remote_addr})
```

If production is behind a reverse proxy, configure Flask/Werkzeug to trust the
exact known proxy hop count so `request.remote_addr` represents the originating
client. Do not accept an arbitrary internet-supplied `X-Forwarded-For` value.
The upload service should also use its own connection-derived address as the
authoritative stored IP. The multipart `ip_address` field is useful for
association and diagnostics, but like every client-supplied field it can be
spoofed and must not be used for authentication or abuse controls.

`domain_name` is the complete normalized hostname, including subdomains. For a
page at `https://collector.shop.example.co.uk/private?q=secret`, the field is
`collector.shop.example.co.uk`; the scheme, port, path, query, and fragment are
not included. Batches are separated by that hostname. The `telemetry` file
contains raw gzip bytes. After decompression, its JSON is:

```json
{
  "schemaVersion": "veilance.telemetry-snapshot-batch.v1",
  "batchId": "random-uuid",
  "contributorId": "stable-random-256-bit-client-id",
  "observations": [
    {
      "schemaVersion": "veilance.telemetry-snapshot.v2",
      "eventId": "idempotent-event-id",
      "site": { "hostname": "example.com", "https": true },
      "observation": { "durationSeconds": 42, "totalRequests": 137 },
      "thirdPartyHosts": [],
      "trackers": [],
      "signals": [],
      "page": {},
      "security": {},
      "interest": {
        "score": 25,
        "level": "interesting",
        "minimumScore": 25,
        "eligible": true,
        "reasons": [{ "id": "geolocation", "severity": "high", "points": 25 }]
      },
      "redactedDocument": {}
    }
  ]
}
```

The API can use `domain_name` for basic hostname-level deduplication and should
use each observation's `eventId` for exact idempotency. Local `snapshotId`, exact
capture time, queue state, retry errors, and private wallet material stay in
SQLite or extension-local settings. The public wallet address is transmitted in
the multipart request only.

### Pseudonymous telemetry client identity

Veilance creates the telemetry client id during background initialization, even
when snapshot uploading is disabled. The id is 32 bytes from the browser's
cryptographically secure random generator and is stored in
`chrome.storage.local`, so the same browser profile keeps the same id across
restarts and extension upgrades.

The extension also stores a SHA-256 hash of a coarse local environment record:
browser family, operating system, CPU architecture, and Native Client
architecture. The raw environment fields and their hash are never added to an
upload. If the hash changes, Veilance replaces the old id with a new unrelated
random id. Browser version numbers, hardware serial numbers, fonts, screen
properties, and other fingerprinting inputs are deliberately excluded. A new
browser profile or reinstall creates a new id because extension-local storage
does not carry over. Existing `veilanceTelemetryContributorIdV1` values are
migrated without changing the user's current pseudonymous identity.

## Privacy boundary

Routine visit history does not retain:

* Full URL paths, query strings, or fragments
* Page text or HTML
* Form values or keystrokes
* Cookie names or values
* Storage keys or values
* Clipboard contents
* Camera or microphone data
* Geolocation coordinates
* Browser, hardware, screen, network, locale, time-zone, or font values read by
  instrumented fingerprint indicators
* Peripheral names, ids, or sensor readings
* Credential, passkey, challenge, or authenticator response data
* Local file names or contents
* Speech audio, recognized text, or installed voice details
* Advertising topics, auction configuration, or Shared Storage keys and values
* Passwords, authentication tokens, or authorization headers

History retains the safe origin/hostname, aggregate counts, approved signal
metadata, and timing needed to explain what happened during the visit.

A telemetry snapshot additionally retains a redacted HTML
structure. It contains standard tag names, fixed redaction placeholders,
allowlisted non-value attributes, public resource origins in inert
`data-veilance-*` attributes, and coarse evidence counters. It never contains
page text, inline script source, arbitrary id/class values, live `src`/`href`
attributes, form values or field attributes, cookie/storage contents, URL
paths/searches, or private host origins.

The server-observed IP lookup occurs only when an opted-in upload actually
starts. The returned address is placed in that multipart request and is not
written into visit history, snapshot payloads, or extension storage.

## Permissions

### `webRequest`

Observes request metadata and response-header names. Veilance does not block,
redirect, or modify traffic.

### `webNavigation`

Creates one visit lifecycle per top-level navigation and records when the page
commits and completes loading. This prevents redirects and subrequests from
resetting the visit.

### `storage`

Keeps active visit state, indicator settings, the serialized SQLite database,
custom indicator definitions, managed tracker definitions, the tracker update
log, the automatic-capture preference, local snapshot upload consent, the
automatic-upload preference, the stable pseudonymous telemetry client identity,
the shared appearance preference, and local wallet material.

### `unlimitedStorage`

Allows the full managed tracker database and future database growth to remain in
extension-local storage without displacing visit history or user rules.

### `alarms`

Schedules tracker database checks every eight hours. In an upload-enabled build,
it also wakes privacy-delayed queued snapshot batches and retries. If the
browser is closed or the extension service worker is asleep, Chromium delivers
the missed alarm when the extension next wakes.

### HTTP and HTTPS host access

Required to observe browser API use and request metadata on sites the user
visits, and to call the selected first-party Veilance telemetry API.
Browser-internal and other extension pages remain outside the observation
boundary.

## Test locally

From the extension directory:

```bash
npm test
npm run check
```

To rebuild the bundled tracker snapshot from a sibling checkout of
`Veilance-Tracker-DB`:

```bash
npm run build:trackers
```

To exercise browser APIs manually:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/test-pages/privacy-demo.html`, trigger the test
controls, and inspect the Live and History tabs.

## Known limitations

* Chromium Manifest V3 only
* Top-level frames only; embedded-frame API calls are not instrumented
* Main-world wrappers can be detected, bypassed, or changed by a hostile page
* Browser caching may prevent some requests from appearing through
  `webRequest`
* Third-party classification uses a compact suffix list rather than the full
  Public Suffix List
* Detection is heuristic; legitimate application behavior can trigger findings
* Custom rules evaluate retained signals and hosts, so their required built-in
  data source must remain enabled
* Telemetry snapshot uploads remain gated by explicit consent; wallet payouts
  are disabled by the build flag

## Third-party runtime

SQLite WebAssembly notices and provenance are documented in
`vendor/sqlite/README.md`. Veilance's own source remains under the repository
license in `LICENSE`.
