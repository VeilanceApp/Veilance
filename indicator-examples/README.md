# Indicator folder examples

Open Veilance **Settings**, select **Choose indicator folder**, and choose this
directory to load the example JSON rules.

Indicator files are declarative. They can match already-observed API signals or
network host suffixes, but they cannot execute JavaScript or modify websites.

Supported top-level forms:

* One indicator object
* An array of indicator objects
* An object containing an `indicators` array

Signal fields are `indicatorId`, `kind`, `api`, `action`, and `minCount`. Host
rules use `hosts` or the shorthand `hostSuffix`. `mode` may be `any` or `all`.

## Make your own in five minutes

1. Create an empty folder such as `my-veilance-indicators`.
2. Copy `useful-starter-rules.json` into it, or select **Download starter
   rules** in Veilance Settings.
3. Give every rule a unique `id`, plain-language `name`, and `description`.
4. Match a broad event source with `indicatorId`, an exact `api` and `action`
   from a visit's **Complete visit details**, or a host with `hosts`.
5. Choose the folder in Settings. Fix any validation message shown there.

Veilance automatically prefixes imported ids with `custom.`. Keep the built-in
source enabled or there will be no retained events for a custom signal rule to
match.

## Veilance tracker JSON

Veilance accepts its own tracker definitions as JSON, with domains and filters
stored in arrays:

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

The `format` field is recommended but optional when `domains` or `filters` is
present. `organization` becomes the default id, so the example is stored as
`custom.platform161`. See `veilance-platform161.json` for an import-ready copy.
Keep the built-in `network-requests` indicator enabled while using tracker
rules.

Supported filter behavior:

* Host anchors such as `||tracker.example^`
* Third-party options: `$3p`, `$third-party`
* First-party options: `$1p`, `$first-party`, `$~3p`, `$~third-party`
* Common resource types such as `script`, `image`, `stylesheet`, `font`,
  `media`, `xmlhttprequest`, `ping`, and `websocket`, including negated types
* Page-host constraints using `domain=allowed.example|~blocked.example`

Veilance skips unsupported path-specific, cosmetic, regular-expression,
redirect, and exception filters with a visible import warning. This is
intentional: visit history retains hostnames and aggregate resource types, not
URL paths, queries, or response bodies.

## Useful source ids

These built-in event sources may be used as `indicatorId` values:

* Fingerprinting: `canvas`, `webgl`, `audio`,
  `navigator-characteristics`, `screen-characteristics`, `locale-timezone`,
  `font-probing`, `css-media-queries`, `performance-timing`, `webgpu`,
  `network-information`, and `media-capabilities`
* Storage: `browser-storage` and `cookie-access`
* Sensitive APIs: `media-devices`, `geolocation`, `clipboard`,
  `permission-queries`, `connected-devices`, `device-sensors`,
  `credential-management`, `file-system-access`, `speech`, `notifications`,
  and `battery`
* Network and browser behavior: `webrtc`, `beacon`, `spa-navigation`, and
  `privacy-sandbox`

`network-requests`, `known-trackers`, `security-headers`, and `page-structure`
are built-in settings rather than signal ids. Use a `hosts` rule for network
destinations and inspect the built-in history fields for headers and structure.

## Rule patterns

Match any use of one source:

```json
{
  "match": { "indicatorId": "file-system-access" }
}
```

Match a threshold:

```json
{
  "match": { "indicatorId": "font-probing", "minCount": 10 }
}
```

Require several sources in one visit:

```json
{
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

Match a service and its subdomains:

```json
{
  "match": { "hosts": ["metrics.example"] }
}
```
