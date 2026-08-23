# Veilance Browser Extension v0.1.0

Veilance is a local-first browser privacy observability extension. It shows privacy-relevant behavior occurring in the current tab and prepares a sanitized telemetry payload for the user to review.

Telemetry uploading is intentionally disabled until the Veilance validation server is available. Once the submission system is live, validated telemetry may become eligible for VLNC rewards. Wallet linking and payouts remain separate from the telemetry collector.

## What this release detects

* First-party and third-party network request counts
* Third-party hosts and resource types
* Common analytics, advertising, attribution, and session-analysis infrastructure
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
* Selected top-level security headers

Veilance reports observed behavior, not intent. A finding does not automatically mean that a website is malicious.

## Install from GitHub

Veilance is currently installed as an unpacked Chromium extension. Chrome, Edge, Brave, and other Chromium-based browsers are supported.

### Option 1: Clone the repository

Make sure Git is installed, then run:

```bash
git clone https://github.com/VeilanceApp/Veilance.git
cd Veilance
```

Open your browser's extension management page:

* Chrome: `chrome://extensions`
* Edge: `edge://extensions`
* Brave: `brave://extensions`

Then:

1. Enable **Developer mode**.
2. Select **Load unpacked**.
3. Choose the cloned `Veilance` directory containing `manifest.json`.
4. Pin Veilance to the browser toolbar.
5. Reload any websites that were already open so Veilance can initialize at document start.
6. Open the Veilance toolbar icon to view the current tab's telemetry.

### Option 2: Download the repository as a ZIP

1. Open the [Veilance GitHub repository](https://github.com/VeilanceApp/Veilance).
2. Select **Code**.
3. Select **Download ZIP**.
4. Extract the downloaded archive.
5. Open your browser's extension management page.
6. Enable **Developer mode**.
7. Select **Load unpacked**.
8. Choose the extracted `Veilance-main` directory containing `manifest.json`.
9. Reload any websites that were already open.
10. Open the Veilance toolbar icon.

Do not select the ZIP file itself. Chromium requires the extracted directory containing `manifest.json`.

## Updating Veilance

When installed using Git, update the local repository with:

```bash
cd Veilance
git pull
```

After pulling an update:

1. Open your browser's extension management page.
2. Find Veilance.
3. Select the **Reload** button.
4. Reload any website tabs being tested.

When installed using Download ZIP, download the newest copy of the repository, extract it, replace the previous directory, and reload the extension from the browser's extension management page.

## Test locally

Clone or download the repository, then open a terminal inside the `Veilance` directory.

On Linux or macOS:

```bash
python3 -m http.server 8080
```

On Windows:

```powershell
py -m http.server 8080
```

Then open:

```text
http://localhost:8080/test-pages/privacy-demo.html
```

Use the test-page controls to trigger browser APIs, then open the Veilance popup to review the resulting observations.

The test page includes checks for:

* Canvas readback
* Offline audio processing
* Browser storage
* WebGL renderer access
* Third-party network requests
* Media-device enumeration
* Geolocation requests

## Upload telemetry

The **Upload telemetry** button is disabled by design.

The current configuration in `config.js` is:

```js
export const TELEMETRY_UPLOAD_ENABLED = false;
export const TELEMETRY_UPLOAD_ENDPOINT = "";
```

Do not enable telemetry uploading until the server described in `docs/SERVER_API.md` is running and capable of validating, deduplicating, and safely storing submissions.

The current popup allows users to preview or export exactly what a future telemetry submission would contain.

## Privacy boundary

Veilance does not include the following information in its telemetry payload:

* Page text or HTML
* Form values or keystrokes
* Cookie names or values
* Storage keys or values
* Clipboard contents
* Camera or microphone data
* Geolocation coordinates
* Passwords or authentication tokens
* Full URL paths
* Query strings
* URL fragments

See `docs/PRIVACY_MODEL.md` for the complete telemetry and data-handling model.

## Permissions

### `webRequest`

Used to observe request metadata and distinguish first-party activity from third-party activity. Veilance does not block, redirect, or modify network traffic.

### `storage`

Used to retain per-tab telemetry in browser session storage. This allows the Manifest V3 service worker to restart without immediately losing the current session's observations.

### HTTP and HTTPS access

Required to observe privacy-relevant browser APIs and request metadata on websites visited by the user.

## Development checks

Veilance v0.1.0 does not require any third-party packages.

Run the automated tests:

```bash
npm test
```

Run JavaScript syntax and manifest checks:

```bash
npm run check
```

## Known limitations

* This release supports Chromium Manifest V3 only.
* Only top-level frames are instrumented. Embedded-frame API calls are not yet included.
* Main-world wrappers can potentially be detected, bypassed, or modified by a hostile page.
* Browser caching may prevent some requests from appearing through `webRequest`.
* Third-party classification currently uses a compact suffix list rather than the complete Public Suffix List.
* The bundled service catalog is intentionally small and will require signed, reviewable updates.
* Detection is heuristic. Legitimate graphics, audio, communications, analytics, and application features may trigger findings.
* Telemetry uploading, wallet linking, server-side validation, and VLNC payouts are not active in this release.

## Repository

Source code, documentation, issues, and future releases are available through the official repository:

[github.com/VeilanceApp/Veilance](https://github.com/VeilanceApp/Veilance)
