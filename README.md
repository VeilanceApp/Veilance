# Veilance Browser Extension v0.2.0

Veilance is a local-first browser privacy observability extension. It shows what
a website requests from browser APIs and which network hosts it contacts while
the page is open. Observations describe behavior, not intent: a finding does not
automatically mean a website is malicious.

This release adds complete visit history, user-controlled indicators, folder
imports, and a locally generated Solana wallet. Telemetry uploads and payouts
remain disabled.

## What changed in v0.2.0

* One stable visit session per top-level navigation
* Redirects update the same visit instead of resetting its data
* Start, page-load-complete, update, and end timestamps
* SQLite-backed history for the latest 20 visits
* Full history detail for requests, hosts, API signals, page counts, findings,
  and response security headers
* Live and History tabs in the popup
* A dedicated Settings page
* Individual enable/disable controls for every built-in indicator
* Declarative custom indicator rules loaded from a user-selected folder
* A locally generated Ed25519 Solana wallet and explicit private-key export
* Telemetry JSON export removed
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

### Live

The Live tab shows the active website, current status, request and signal
counts, findings, and the generated wallet address. Open **Complete visit
details** to see the full local record while the visit is active.

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

## Indicator settings

Open the popup and select **Settings**. Each built-in indicator can be enabled
or disabled separately. A change affects new observations immediately; it does
not rewrite existing history.

Veilance observes enabled signals. It does not block, spoof, or modify browser
fingerprints or website behavior.

## Load indicators from a folder

Select **Choose indicator folder** in Settings, then choose a directory that
contains JSON files. The browser grants one-time read access to the selected
files. Veilance does not retain a directory handle and does not scan folders in
the background.

Imported indicators are data-only rules. They cannot contain or execute
JavaScript. A file may contain one object, an array, or an object with an
`indicators` array.

Signal example:

```json
{
  "id": "repeated-canvas-readback",
  "name": "Repeated canvas readback",
  "category": "Fingerprinting",
  "description": "Canvas data was read at least three times.",
  "severity": "medium",
  "match": {
    "api": "Canvas",
    "action": "readback",
    "minCount": 3
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

See `indicator-examples/` for files that can be imported directly.

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
* Payouts are not active in v0.2.0.

## SQLite history storage

Veilance uses the official SQLite WebAssembly runtime bundled under
`vendor/sqlite/`. Visit data is inserted and queried through SQLite. The SQLite
database bytes are serialized into extension-local storage so Manifest V3
service-worker restarts do not lose history.

The `visits` table stores one row per visit and prunes itself to the most recent
20 rows. Derived summary columns make the History list inexpensive while the
complete sanitized state remains available for the detail view.

No remote executable code is loaded. The bundled SQLite runtime is version
3.53.0 from the official `sqlite/sqlite-wasm` project.

## Privacy boundary

Veilance does not retain:

* Full URL paths, query strings, or fragments
* Page text or HTML
* Form values or keystrokes
* Cookie names or values
* Storage keys or values
* Clipboard contents
* Camera or microphone data
* Geolocation coordinates
* Passwords, authentication tokens, or authorization headers

History retains the safe origin/hostname, aggregate counts, approved signal
metadata, and timing needed to explain what happened during the visit.

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
custom indicator definitions, and local wallet material.

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
* Telemetry uploads and wallet payouts are disabled

## Third-party runtime

SQLite WebAssembly notices and provenance are documented in
`vendor/sqlite/README.md`. Veilance's own source remains under the repository
license in `LICENSE`.
