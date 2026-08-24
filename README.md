# Veilance Browser Extension v0.6.0

Veilance is a local-first browser privacy observability extension. It shows what
a website requests from browser APIs and which network hosts it contacts while
the page is open. Observations describe behavior, not intent: a finding does not
automatically mean a website is malicious.

This release adds explicit local telemetry snapshots. A user can capture the
current public website from the popup once its observed behavior reaches the
20/100 interest threshold, then review the resulting evidence and inert
redacted HTML in Settings, download it, or delete it. Snapshot uploads have a
complete queue and API path but remain disabled by the build gate. Payouts also
remain disabled.

## What changed in v0.6.0

* User-triggered snapshots combine host-level network observations, tracker
  matches, browser API names/actions and counts, page/security counts, and an
  inert structural HTML representation
* A deterministic 0–100 interest score prevents routine activity from being
  snapshotted: high findings add 40 points, medium findings add 20, low findings
  add 5, and repeated allowed API activity can add 5–10 points
* HTML redaction removes all page text, form values, URL paths and searches,
  event handlers, arbitrary attributes, inline script source, comments, styles,
  private network origins, and other value-bearing content
* External resource URLs are reduced to public origins and stored only in
  non-executable `data-veilance-*` attributes
* Inline scripts contribute only coarse capability hints such as Canvas,
  WebGL, WebGPU, audio, font, navigator, advertising, or anti-blocking behavior
* DOM ids, classes, and attribute names contribute only coarse advertising,
  consent, tracking, or anti-blocking marker counts; their original values are
  never retained
* The final background validator rejects a snapshot if it contains raw text,
  executable URL attributes, URL paths/searches, private hosts, or forbidden
  identity/value fields
* Remote signal reduction uses an explicit built-in indicator/API/action
  allowlist, so a page cannot place arbitrary strings in uploadable signal
  fields by dispatching a lookalike event
* The SQLite snapshot vault is separate from visit history and retains the 20
  newest snapshots
* Settings is divided into Tracker database, Detection, Snapshots, Wallet, and
  Local data tabs; the snapshot tab provides review, redacted-HTML
  inspection, downloads, deletion, queue status, retry errors, and clear-all controls
* System, light, and dark appearance preferences are shared by the popup and
  Settings and saved in extension-local storage
* Future uploads use a random 256-bit contributor id that is never the Solana
  wallet address; precise local capture time and upload state are excluded from
  the transmitted payload
* Uploads require both the compile-time build gate and separate user consent,
  plus an explicit queue action for each snapshot or group of snapshots
* Queued snapshots batch after a randomized 5–15 minute delay and retry with
  jittered 1 minute, 5 minute, 15 minute, 1 hour, and 4 hour backoff
* Upload batches are capped at 20 observations and approximately 2 MiB before
  gzip compression
* Incognito, localhost, private IP, `.local`, `.internal`, `.lan`, and other
  browser-local targets cannot produce uploadable snapshots

## v0.5.0 tracker database updates

* The current `veilance-json-trackers/*` database snapshot is bundled and
  enabled on first install
* Automatic data-only updates come from
  `VeilanceApp/Veilance-Tracker-DB` every eight hours (three checks per day while
  the browser is available)
* Separate Settings controls disable tracker matching or automatic updates;
  manual update checks remain available
* Settings retains the latest 50 update results with timestamps, revisions,
  change counts, validation skips, warnings, and errors
* Updates are downloaded as a gzip-compressed TAR archive, bounded by size,
  restricted to JSON inside `veilance-json-trackers`, and validated before the
  active database is replaced
* Managed tracker IDs are derived from repository paths, so records owned by the
  same organization remain distinct
* Host-indexed evaluation avoids scanning the entire tracker database on every
  network request

## v0.4.2 canvas compatibility fix

* Veilance observes access to canvas readback methods, then returns the original
  browser method before the website invokes it, keeping Veilance off the native
  diagnostic call stack
* `getImageData()`, `toDataURL()`, and `toBlob()` activity remains observable
* Veilance does not force `willReadFrequently`, change Pixlr's canvas backend,
  or hide the diagnostic from the website's own developer console

## v0.4.1 WebGPU compatibility fix

* Windows WebGPU adapter requests no longer forward the `powerPreference` hint
  that Chromium currently ignores and warns about
* All other current and future adapter options pass through unchanged
* WebGPU adapter requests are still recorded as privacy-relevant activity

## v0.4.0 Veilance JSON tracker support

* Veilance JSON tracker objects with `name`, `category`, `website_url`,
  `organization`, `domains`, and `filters`
* Host-anchored filter parsing for patterns such as `||tracker.example^$3p`
* First-/third-party, common resource-type, and `domain=` filter constraints
* Visible warnings for unsupported path, cosmetic, regular-expression,
  redirect, and exception filters
* `trackers` and `rules` JSON array wrappers in addition to `indicators`
* A copyable Veilance JSON template and import-ready Platform161 example

## v0.3.0 indicator expansion

* New cookie and Storage Access API observation
* New browser, platform, CPU, memory, language, plugin, and client-hint signals
* New screen, time zone, locale, font, CSS media-query, performance, WebGPU,
  network-information, and media-capability signals
* New connected-device, sensor, credential, file-system, speech, and advertising
  privacy API signals
* New combined findings for broad fingerprint profiles and sensitive local API
  use
* Built-in source ids are visible next to indicator names in Settings
* Three-step custom-rule guidance, copyable templates, and a downloadable
  starter pack in Settings
* Importable starter examples under `indicator-examples/`

## Existing local-first capabilities

* One stable visit session per top-level navigation
* Redirects update the same visit instead of resetting its data
* Start, page-load-complete, update, and end timestamps
* SQLite-backed history for the latest 20 visits
* Full history detail for requests, hosts, API signals, page counts, findings,
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

The Overview tab shows the active website, current status, request and signal
counts, findings, and the live snapshot interest score. Open **Technical
details** to see the full local record while the visit is active.

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
to 100. **Save snapshot** becomes available at 20/100. Visits below that
threshold are treated as routine and cannot be snapshotted. The capture is
intentional and one-time; ordinary browsing does not retain page HTML. Open
**Settings → Snapshots** to:

* Review the raw telemetry fields and the redacted HTML as inert text
* Inspect third-party resource origins, inline-script capability hints, and
  advertising, consent, tracking, or anti-blocking structural markers
* Download the complete local record as JSON or the redacted HTML as `.txt`
* Delete one snapshot or clear the vault without clearing visit history
* If a future build enables uploads, opt in and explicitly queue selected local
  snapshots

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

* Wallet material never leaves the browser through Veilance.
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
interest-qualified, user-triggered snapshots, their local queue state, and the
redacted payload.
Derived summary columns keep both lists inexpensive while the complete local
records remain available for review.

No remote executable code is loaded. The bundled SQLite runtime is version
3.53.0 from the official `sqlite/sqlite-wasm` project.

## Snapshot upload gate and API contract

Uploading is off by default:

```javascript
export const TELEMETRY_UPLOAD_ENABLED = false;
export const TELEMETRY_UPLOAD_ENDPOINT = "https://api.veilance.com/v1/telemetry/snapshots";
```

After the HTTPS endpoint exists, set `TELEMETRY_UPLOAD_ENABLED` to `true` and
package a new build. The user must then enable **Allow pseudonymous snapshot
uploads** in Settings and explicitly queue interest-qualified local snapshots.
Unscored legacy records and visits below 20/100 cannot be queued. Enabling the
build gate alone never uploads existing or future snapshots.

The extension posts gzip-compressed JSON when the runtime supports
`CompressionStream`:

```json
{
  "schemaVersion": "veilance.telemetry-snapshot-batch.v1",
  "batchId": "random-uuid",
  "contributorId": "random-256-bit-id-unrelated-to-the-wallet",
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
        "score": 40,
        "level": "high",
        "minimumScore": 20,
        "eligible": true,
        "reasons": [{ "id": "geolocation", "severity": "high", "points": 40 }]
      },
      "redactedDocument": {}
    }
  ]
}
```

The API should deduplicate rewards and storage by each observation's `eventId`.
Only the payload under `observations` is transmitted. Local `snapshotId`, exact
capture time, queue state, retry errors, and wallet data stay in SQLite or
extension-local settings.

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

A user-triggered telemetry snapshot additionally retains a redacted HTML
structure. It contains standard tag names, fixed redaction placeholders,
allowlisted non-value attributes, public resource origins in inert
`data-veilance-*` attributes, and coarse evidence counters. It never contains
page text, inline script source, arbitrary id/class values, live `src`/`href`
attributes, form values or field attributes, cookie/storage contents, URL
paths/searches, or private host origins.

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
log, local snapshot consent, the pseudonymous random contributor id, the shared
appearance preference, and local wallet material.

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
visits. Browser-internal and other extension pages remain outside the
observation boundary.

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
* Telemetry snapshot uploads and wallet payouts are disabled by build flags

## Third-party runtime

SQLite WebAssembly notices and provenance are documented in
`vendor/sqlite/README.md`. Veilance's own source remains under the repository
license in `LICENSE`.
