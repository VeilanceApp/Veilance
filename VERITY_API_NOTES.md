# Verity integration contract and backend follow-up

This build uses the supplied September 30 API reference:

- POST `/api/users/v1/register`: email_address, password; output access_token and refresh_token. Email verification on the website is required before account setup completion and Verity access.
- POST `/api/users/v1/login`: email_address, password; output access_token and refresh_token.
- POST `/api/users/v1/refresh`: refresh Bearer JWT; output ok/access_token.
- POST `/api/users/v1/whoami`: access Bearer JWT; user_id/email_address/plan/enabled_account/verified.
- POST `/api/users/v1/intel/policy/compare`: access Bearer JWT; telemetry_data (the same batch JSON used inside the telemetry upload gzip, containing the validated snapshot in observations), privacy_policy_url, current_url (the current tab URL). Returns uuid/status.
- POST `/api/users/v1/status`: Bearer JWT is supplied; body uuid. Pending states are polled sequentially. Completed output is cached immediately and not requested again.

No `/verity/chat` calls, chat sessions or model prompts are used. The API reference has no separate policy-discovery endpoint; the extension suggests public privacy links present on the visited page and allows editing them. The server is responsible for acquiring policy content.

## Backend security and compatibility requirements

1. The supplied `/status` route has no JWT/owner enforcement and is also publicly exposed. Require authentication and bind each comparison UUID to its submitting user before returning results. Checking a UUID alone is not authorization. The extension only polls its own jobs, but cannot secure a public server route.
2. Enforce account-enabled, verified-email and paid-plan checks server-side for both submission and status. Frontend/background checks are an additional layer, not a replacement.
3. Update the server telemetry threshold to 5 if it separately enforces the previous threshold of 25. Low-activity explicit comparisons must not be rejected solely for lacking upload-interest eligibility.
4. Keep policy acquisition restricted to public HTTP(S), enforce DNS/IP and redirect checks against private networks, and reject credentials/non-web ports server-side. Client URL validation does not prevent DNS rebinding or redirects.
5. The supplied status endpoint calls `queue.forget()` on completion. A lost response can therefore lose a result. Prefer per-user retained results and idempotent retrieval; client caching cannot solve a response lost before receipt.
6. The reference defines the job envelope but not the background task's final report schema. The UI supports text or structured summary/findings/results wrapped in output/report/analysis, with status/classification/verdict and explanatory/evidence fields. Unknown formats produce an explicit unsupported-report message rather than invented findings. Verify with one real staging job before release.

## Validation performed

October 5 revision: all 100 Node regression tests pass, along with JavaScript syntax checks and static UI element binding checks. Coverage includes early and concurrent refresh, persistent authentication, sign-out during refresh, history before capture, five-entry retention, account isolation, malformed-batch rejection before submission, one-shot result caching, upload-gzip/body equality, navigation and 15-second capture boundaries, and transient polling failures. A small DOM harness checks report warning scope and evidence rendering.

No installed-browser UI or live API tests were run for this revision. Previous browser-test descriptions in the supplied source are not verification of these changes. An installed-extension staging smoke test is still required before release.

Policy submissions now use buildTelemetryEnvelope, the same function used before gzip compression for uploads. telemetry_data contains schemaVersion, batchId, contributorId and observations. No model-specific field mapping is applied. The multipart upload fields (client_id, wallet_address, domain_name, ip_address) remain upload transport fields; the policy route receives current_url and privacy_policy_url beside telemetry_data. A regression test decompresses an actual upload and compares that JSON to the policy request body. The backend must consume this batch format; its worker implementation was not supplied.

## October 2 capture fix

Automatic capture waits at least 15 seconds after load completion. Verity reuses a validated snapshot for the current visit collected after that interval. If none exists (including when automatic capture is disabled), it uses the same capture function as telemetry uploads, allowing routine observations for explicit analysis without queueing a telemetry upload. The JSON batch under telemetry_data is not compressed or converted to a model-specific schema. The request includes the actual current tab URL; job grouping still uses its origin.

The background regression test exercises authentication, rejects a pre-interval comparison, captures telemetry after the interval, and verifies that the comparison sends the stored snapshot unchanged with the JWT and both URLs. Live API execution has not been verified; the supplied route delegates telemetry parsing to a background worker whose implementation is not attached.

## October 5 stability changes

Authentication is stored in extension-local storage restricted to trusted extension contexts, scoped by API origin. Refresh starts two minutes before JWT expiry, with a one-minute maintenance alarm and a request-time check. Concurrent requests share a refresh. Transient failures do not delete credentials. Server-revoked or expired refresh tokens still require signing in again.

Review history is stored separately by account and API origin. The five newest attempts include preparing, queued, processing, done and failed reviews. Capture and submission failures stay in history. The maintenance alarm polls queued jobs while the popup is closed; completed reports remain cached across browser restarts and sign-outs. A browser crash after the server accepts a POST but before returning its UUID cannot be safely retried without server-side idempotency. Likewise, the server's one-shot status retrieval cannot guarantee recovery of a lost response.

The production/development switch remains `VEILANCE_USE_PRODUCTION_API` in `config.js`. Set it to `false` to use `VEILANCE_DEVELOPMENT_API_ORIGIN`. Accounts and history are isolated between those environments.

### Installed-extension release check

1. Load the unpacked extension, then reload existing website tabs so the new content script is active.
2. Sign in, restart the browser, and verify the account remains available. Check a request near access-token expiry and a temporary offline period.
3. On a newly loaded public website, wait 15 seconds and submit the first analysis. Confirm the server receives the uncompressed batch under `telemetry_data`, plus both URL fields. Navigate during capture and confirm the old visit is rejected.
4. Confirm the review appears immediately, then close the popup. Reopen it after completion and open the saved report. Repeat until six attempts exist; only the newest five should remain.
5. Switch accounts and verify separate histories. Check the popup, full Verity page and Settings for readable content without raw report exports.
