## 0.6.14

- Added a new **Protections** settings tab.
- Added **Fingerprint Protection (Beta)**, disabled by default. The first protection randomizes Canvas 2D readback and canvas exports to reduce stable canvas fingerprinting across navigations.
- Added a disabled **Tracker Protection** control as a preview of a future blocking feature.
- Added the generated contributor UUID to Settings with a direct link to `https://veilance.org/leaderboard?uuid=<UUID>`.
- Fingerprint protection is dynamically registered in the page MAIN world at `document_start` when enabled and unregistered when disabled.

## What changed in v0.6.13

* Queued, uploading, and failed snapshots are protected from local retention
  pruning so pending telemetry is not lost when more than 20 snapshots exist
* Queue pressure triggers an immediate consented upload attempt, while failed
  records remain stored for their next retry
* Enabling automatic snapshot capture now requires acknowledging that complex
  pages or several tabs loading together may experience additional latency
* The popup disables manual snapshot capture while automatic capture is on and
  explains how to restore the manual control

## What changed in v0.6.11

* Every live Overview counter now shows a clear **Typical** or **High** volume
  label
* Numeric cutoff lines are kept out of the popup so the colored **Typical** and
  **High** states remain the focus
* Activity cards now focus on concise colored **Typical** and **High** states
* Sensitive status text identifies the primary behavior and links directly to
  the finding details
* Finding totals are explicitly labeled, and important reference text has
  stronger contrast and larger type
* The snapshot interest score is now a full-width meter with a clear ready
  state instead of a cramped severity-tinted box
* The Overview notes that counts accumulate during longer visits

## What changed in v0.6.10

* One `VEILANCE_USE_PRODUCTION_API` constant now switches both telemetry
  requests from the development API to `https://api.veilance.org`
* Immediately before each upload operation, Veilance asks that same API for the
  connection address it observes and sends the validated IPv4 or IPv6 literal
  as `ip_address`
* IP resolution fails closed: a failed or malformed lookup leaves snapshots
  queued for retry instead of sending `127.0.0.1`, an empty value, or a guessed
  address
* Veilance does not use WebRTC/STUN or a third-party IP lookup service

## What changed in v0.6.9

* Automatic local snapshot capture is available as a separate Settings opt-in
  and remains off by default
* When enabled, Veilance saves one snapshot per public-site visit as soon as
  the existing interest score reaches 25/100
* Capture retries transient content-script failures up to three times and does
  not run in Incognito or on private, local, internal, or unsupported pages
* Automatic capture never grants upload consent; automatic uploading remains a
  separate control

## What changed in v0.6.8

* Unsupported browser-internal, extension, local-file, and non-web pages now
  receive a dedicated friendly popup instead of an empty monitoring dashboard
* The page clearly confirms that nothing was collected and provides quick
  actions to check again or open Settings

## What changed in v0.6.7

* `domain_name` now contains the complete normalized website hostname,
  including subdomains, with no scheme, port, path, query, or fragment
* Upload batches are separated by exact hostname so the request field always
  describes every snapshot in its gzip payload

## What changed in v0.6.6

* **Upload now** queues every eligible local, failed, or privacy-delayed
  snapshot and immediately starts the multipart request
* Users can opt into automatic uploads; existing eligible snapshots and future
  snapshots are queued without requiring a separate Queue button
* Automatic uploads retain the randomized 5–15 minute privacy delay, while
  **Upload now** explicitly bypasses it
* The stable pseudonymous identifier is available as the multipart `client_id`
  field and remains inside the compressed envelope as `contributorId`
* Each request also includes the generated public Solana address as
  `wallet_address` and the registrable website domain as `domain_name`; the
  private wallet key is never uploaded
* Upload batches are separated by registrable domain, so `domain_name` never
  represents a mixture of unrelated sites

## What changed in v0.6.5

* Telemetry uploads use multipart fields: `client_id` and `ip_address` are text
  fields, while `telemetry` is a raw gzip file with MIME type
  `application/gzip`
* The browser creates the multipart boundary automatically; gzip data is never
  converted to Base64 or placed in JSON
* Uploading targets the configured development endpoint and remains gated by
  separate user consent
* A snapshot is marked uploaded only when the API returns HTTP success and
  `output.ok` is exactly `true`; JSON error reports remain queued for retry

## What changed in v0.6.0

* User-triggered snapshots combine host-level network observations, tracker
  matches, browser API names/actions and counts, page/security counts, and an
  inert structural HTML representation
* A deterministic 0–100 interest score prevents routine activity from being
  snapshotted: high findings add 25 points, medium findings add 10, low findings
  add 2, and repeated allowed API activity can add 5–10 points
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
* A random 256-bit telemetry client id is created on first startup and retained
  in extension-local storage independently of upload consent. It is never the
  Solana wallet address and precise local capture time and upload state are
  excluded from the transmitted payload
* The client id survives browser restarts and extension updates. Veilance
  rotates it when the detected browser family, operating system, or CPU
  architecture changes; routine browser version updates do not rotate it
* Uploads require both the compile-time build gate and separate user consent;
  users can upload immediately, queue for later, or enable automatic queueing
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
