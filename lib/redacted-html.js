(() => {
  "use strict";

  const FORMAT = "veilance.redacted-html.v1";
  const MAX_HTML_CHARS = 384 * 1024;
  const MAX_NODES = 12000;
  const MAX_DEPTH = 64;
  const MAX_RESOURCE_HOSTS = 160;
  const MAX_SCRIPT_SOURCE_CHARS = 1024 * 1024;

  const STANDARD_TAGS = new Set([
    "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
    "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption",
    "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del", "details",
    "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption",
    "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
    "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd",
    "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter",
    "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p", "picture",
    "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "search",
    "section", "select", "slot", "small", "source", "span", "strong", "style", "sub",
    "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th",
    "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
    "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
    "defs", "symbol", "use", "math"
  ]);

  const VOID_TAGS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "source", "track", "wbr"
  ]);

  const FORM_CONTROL_TAGS = new Set(["input", "textarea", "select", "option", "button", "output"]);
  const OPAQUE_TAGS = new Set(["script", "style", "template", "noscript", "title"]);
  const URL_ATTRIBUTE_BY_TAG = Object.freeze({
    script: "src",
    iframe: "src",
    img: "src",
    source: "src",
    track: "src",
    audio: "src",
    video: "src",
    embed: "src",
    object: "data",
    link: "href",
    form: "action"
  });

  const MARKER_PATTERNS = Object.freeze({
    advertising: /(?:^|[-_\s])(?:ad|ads|advert|advertising|sponsor|sponsored|promoted|prebid|adsbygoogle|adslot|adunit|gpt)(?:$|[-_\s])/i,
    consent: /(?:^|[-_\s])(?:consent|cookie|privacy|cmp|gdpr|ccpa|onetrust)(?:$|[-_\s])/i,
    antiBlocking: /(?:ad[-_\s]?block|anti[-_\s]?ad[-_\s]?block|blocker[-_\s]?detect|fuckadblock|ad[-_\s]?bait)/i,
    tracking: /(?:^|[-_\s])(?:analytics|telemetry|tracker|tracking|pixel|tagmanager|tag[-_\s]?manager)(?:$|[-_\s])/i
  });

  const SCRIPT_HINT_PATTERNS = Object.freeze({
    canvas: /\b(?:toDataURL|getImageData|toBlob)\b/,
    webgl: /\b(?:WEBGL_debug_renderer_info|readPixels|getParameter)\b/,
    webgpu: /\b(?:navigator\.gpu|requestAdapter|requestDevice)\b/,
    audio: /\b(?:OfflineAudioContext|createOscillator|createAnalyser|getChannelData)\b/,
    fonts: /\b(?:document\.fonts|measureText|FontFaceSet)\b/,
    navigator: /\b(?:hardwareConcurrency|deviceMemory|userAgentData|navigator\.plugins|navigator\.languages)\b/,
    screen: /\b(?:screen\.(?:width|height|colorDepth|pixelDepth)|devicePixelRatio)\b/,
    webrtc: /\b(?:RTCPeerConnection|createOffer|getStats)\b/,
    advertising: /\b(?:googletag|prebid|pbjs|adsbygoogle|amazon-adsystem|doubleclick)\b/i,
    antiBlocking: /(?:ad[-_\s]?block|anti[-_\s]?ad[-_\s]?block|fuckadblock|blockAdBlock)/i
  });

  const SAFE_TYPES = new Set([
    "module", "text/javascript", "application/javascript", "application/ld+json", "application/veilance-redacted",
    "text/css", "image", "audio", "video", "font", "document", "fetch", "worker",
    "text", "search", "email", "url", "tel", "password", "number", "checkbox",
    "radio", "file", "hidden", "submit", "reset", "button", "date", "time",
    "datetime-local", "month", "week", "color", "range"
  ]);
  const SAFE_REL = new Set([
    "stylesheet", "preload", "modulepreload", "prefetch", "dns-prefetch", "preconnect",
    "icon", "manifest", "alternate", "canonical", "noopener", "noreferrer"
  ]);
  const SAFE_CROSSORIGIN = new Set(["anonymous", "use-credentials"]);
  const SAFE_LOADING = new Set(["lazy", "eager"]);
  const SAFE_METHOD = new Set(["get", "post", "dialog"]);
  const SAFE_REFERRER_POLICY = new Set([
    "no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin",
    "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url"
  ]);
  const SAFE_SANDBOX = new Set([
    "allow-downloads", "allow-forms", "allow-modals", "allow-orientation-lock",
    "allow-pointer-lock", "allow-popups", "allow-popups-to-escape-sandbox",
    "allow-presentation", "allow-same-origin", "allow-scripts", "allow-storage-access-by-user-activation",
    "allow-top-navigation", "allow-top-navigation-by-user-activation"
  ]);

  function normalizeHostname(value) {
    return String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/^\.+|\.+$/g, "");
  }

  function isPrivateHostname(value) {
    const host = normalizeHostname(value);
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home")) return true;

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((part) => part < 0 || part > 255)) return true;
      const [a, b] = octets;
      return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || a >= 224;
    }

    if (host.includes(":")) {
      const mapped = host.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
      if (mapped) return isPrivateHostname(mapped[1]);
      return host === "::1" || host === "::" || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);
    }
    return !host.includes(".");
  }

  function registrableDomain(value) {
    const host = normalizeHostname(value);
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return host;
    const multipart = new Set([
      "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au",
      "co.nz", "com.br", "com.mx", "co.jp", "co.kr", "co.in", "com.sg",
      "com.tr", "com.cn", "com.tw", "com.hk", "co.za"
    ]);
    const suffix = labels.slice(-2).join(".");
    return multipart.has(suffix) ? labels.slice(-3).join(".") : suffix;
  }

  function safeTagName(value) {
    const tag = String(value || "").toLowerCase();
    return STANDARD_TAGS.has(tag) ? tag : "custom-element";
  }

  function escapeAttribute(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function attributeValue(element, name) {
    try {
      const value = element?.getAttribute?.(name);
      if (value !== null && value !== undefined) return String(value);
    } catch {
      // Fall through to the NamedNodeMap-compatible path.
    }
    for (const attribute of Array.from(element?.attributes || [])) {
      if (String(attribute?.name || "").toLowerCase() === name) return String(attribute?.value || "");
    }
    return "";
  }

  function hasAttribute(element, name) {
    try {
      if (typeof element?.hasAttribute === "function") return element.hasAttribute(name);
    } catch {
      // Fall through to the NamedNodeMap-compatible path.
    }
    return Array.from(element?.attributes || []).some(
      (attribute) => String(attribute?.name || "").toLowerCase() === name
    );
  }

  function addCounter(target, key, amount = 1) {
    target[key] = Math.max(0, Number(target[key]) || 0) + amount;
  }

  function scriptHints(source) {
    const text = String(source || "").slice(0, MAX_SCRIPT_SOURCE_CHARS);
    return Object.entries(SCRIPT_HINT_PATTERNS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name);
  }

  function sizeBucket(value) {
    const length = Math.max(0, Number(value) || 0);
    if (!length) return "0";
    if (length <= 1024) return "1kb";
    if (length <= 4096) return "4kb";
    if (length <= 16384) return "16kb";
    if (length <= 65536) return "64kb";
    if (length <= 262144) return "256kb";
    return "256kb+";
  }

  function captureRedactedDocument(documentValue, locationValue = globalThis.location) {
    const pageUrl = new URL(String(locationValue?.href || ""));
    const pageHostname = normalizeHostname(pageUrl.hostname);
    if (!documentValue?.documentElement || (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:")) {
      throw new Error("A top-level HTTP(S) document is required");
    }

    const parts = ["<!doctype html>\n"];
    let chars = parts[0].length;
    let nodesVisited = 0;
    let truncated = false;
    const redaction = {
      textNodesRedacted: 0,
      attributesRemoved: 0,
      urlsReduced: 0,
      privateUrlsRemoved: 0,
      inlineScriptsRedacted: 0,
      styleBlocksRedacted: 0,
      formControlsRedacted: 0,
      commentsRemoved: 0,
      opaqueNodesRedacted: 0,
      nodesOmitted: 0
    };
    const domMarkers = { advertising: 0, consent: 0, antiBlocking: 0, tracking: 0 };
    const inlineScriptHints = {};
    const resourceHosts = new Map();

    function append(value) {
      if (truncated) return false;
      const text = String(value || "");
      if (chars + text.length > MAX_HTML_CHARS) {
        parts.push("\n<!-- veilance: snapshot truncated -->");
        chars += 43;
        truncated = true;
        return false;
      }
      parts.push(text);
      chars += text.length;
      return true;
    }

    function recordMarkers(element, outputAttributes) {
      const names = Array.from(element?.attributes || []).map((attribute) => String(attribute?.name || ""));
      const source = [attributeValue(element, "id"), attributeValue(element, "class"), ...names].join(" ").slice(0, 4096);
      const matches = [];
      for (const [name, pattern] of Object.entries(MARKER_PATTERNS)) {
        if (!pattern.test(source)) continue;
        addCounter(domMarkers, name);
        matches.push(name);
      }
      if (matches.length) outputAttributes.push(["data-veilance-markers", matches.join(",")]);
    }

    function recordResource(element, tag, attribute, outputAttributes) {
      const raw = attributeValue(element, attribute);
      if (!raw) return;
      let parsed;
      try {
        parsed = new URL(raw, pageUrl.href);
      } catch {
        redaction.attributesRemoved += 1;
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        outputAttributes.push([`data-veilance-${attribute}`, "non-network-redacted"]);
        redaction.urlsReduced += 1;
        return;
      }
      const host = normalizeHostname(parsed.hostname);
      if (isPrivateHostname(host)) {
        outputAttributes.push([`data-veilance-${attribute}`, "private-origin-redacted"]);
        redaction.privateUrlsRemoved += 1;
        return;
      }
      const origin = `${parsed.protocol}//${parsed.host}`;
      outputAttributes.push([`data-veilance-${attribute}-origin`, origin]);
      redaction.urlsReduced += 1;
      if (!resourceHosts.has(host) && resourceHosts.size >= MAX_RESOURCE_HOSTS) return;
      const entry = resourceHosts.get(host) || {
        host,
        thirdParty: registrableDomain(host) !== registrableDomain(pageHostname),
        count: 0,
        tags: {}
      };
      entry.count += 1;
      entry.tags[tag] = (entry.tags[tag] || 0) + 1;
      resourceHosts.set(host, entry);
    }

    function safeAttributes(element, tag) {
      const output = [];
      recordMarkers(element, output);
      const urlAttribute = URL_ATTRIBUTE_BY_TAG[tag];
      if (urlAttribute) recordResource(element, tag, urlAttribute, output);
      if (tag === "video" && hasAttribute(element, "poster")) recordResource(element, tag, "poster", output);

      const type = attributeValue(element, "type").toLowerCase();
      if (tag === "script") output.push(["type", "application/veilance-redacted"]);
      else if (type && SAFE_TYPES.has(type)) output.push(["type", type]);
      const rel = attributeValue(element, "rel").toLowerCase().split(/\s+/).filter((value) => SAFE_REL.has(value));
      if (rel.length) output.push(["rel", [...new Set(rel)].join(" ")]);
      const crossorigin = attributeValue(element, "crossorigin").toLowerCase();
      if (SAFE_CROSSORIGIN.has(crossorigin)) output.push(["crossorigin", crossorigin]);
      const loading = attributeValue(element, "loading").toLowerCase();
      if (SAFE_LOADING.has(loading)) output.push(["loading", loading]);
      const method = attributeValue(element, "method").toLowerCase();
      if (tag === "form" && SAFE_METHOD.has(method)) output.push(["method", method]);
      const referrerPolicy = attributeValue(element, "referrerpolicy").toLowerCase();
      if (SAFE_REFERRER_POLICY.has(referrerPolicy)) output.push(["referrerpolicy", referrerPolicy]);
      const sandbox = attributeValue(element, "sandbox").toLowerCase().split(/\s+/).filter((value) => SAFE_SANDBOX.has(value));
      if (tag === "iframe" && sandbox.length) output.push(["sandbox", [...new Set(sandbox)].join(" ")]);
      for (const name of ["width", "height"]) {
        const value = attributeValue(element, name);
        if (/^\d{1,6}$/.test(value)) output.push([name, String(Math.min(100000, Number(value)))]);
      }
      if (tag === "script") {
        for (const name of ["async", "defer", "nomodule"]) {
          if (hasAttribute(element, name)) output.push([name, null]);
        }
      }
      if (tag === "input") output.push(["data-veilance-control", `input:${SAFE_TYPES.has(type) ? type : "other"}`]);
      else if (FORM_CONTROL_TAGS.has(tag)) output.push(["data-veilance-control", tag]);

      const retainedNames = new Set(output.map(([name]) => name));
      redaction.attributesRemoved += Array.from(element?.attributes || []).filter((attribute) => {
        const name = String(attribute?.name || "").toLowerCase();
        if (name === urlAttribute || (tag === "video" && name === "poster")) return false;
        if (["type", "rel", "crossorigin", "loading", "method", "referrerpolicy", "sandbox", "width", "height", "async", "defer", "nomodule"].includes(name)) {
          return !retainedNames.has(name);
        }
        return true;
      }).length;
      return output;
    }

    function serializeNode(node, depth) {
      if (truncated) return;
      if (nodesVisited >= MAX_NODES || depth > MAX_DEPTH) {
        redaction.nodesOmitted += 1;
        append("[REDACTED OPAQUE CONTENT]");
        truncated = true;
        return;
      }
      nodesVisited += 1;
      const nodeType = Number(node?.nodeType);
      if (nodeType === 3) {
        if (String(node?.nodeValue || "").trim()) {
          redaction.textNodesRedacted += 1;
          append("[REDACTED TEXT]");
        }
        return;
      }
      if (nodeType === 8) {
        redaction.commentsRemoved += 1;
        return;
      }
      if (nodeType !== 1) return;

      const tag = safeTagName(node.tagName || node.nodeName);
      const attributes = safeAttributes(node, tag);
      if (tag === "script" && !attributeValue(node, "src")) {
        const source = String(node?.textContent || "").slice(0, MAX_SCRIPT_SOURCE_CHARS);
        const hints = scriptHints(source);
        attributes.push(["data-veilance-inline", "redacted"]);
        attributes.push(["data-veilance-size-bucket", sizeBucket(source.length)]);
        if (hints.length) attributes.push(["data-veilance-api-hints", hints.join(",")]);
        for (const hint of hints) addCounter(inlineScriptHints, hint);
        redaction.inlineScriptsRedacted += 1;
      }
      const serializedAttributes = attributes.map(([name, value]) =>
        value === null ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`
      ).join("");
      if (!append(`<${tag}${serializedAttributes}>`)) return;
      if (VOID_TAGS.has(tag)) {
        if (FORM_CONTROL_TAGS.has(tag)) redaction.formControlsRedacted += 1;
        return;
      }

      if (tag === "script") {
        if (!attributeValue(node, "src")) append("[REDACTED INLINE SCRIPT]");
      } else if (tag === "style") {
        redaction.styleBlocksRedacted += 1;
        append("[REDACTED STYLE]");
      } else if (FORM_CONTROL_TAGS.has(tag)) {
        redaction.formControlsRedacted += 1;
        append("[REDACTED FORM CONTROL]");
      } else if (OPAQUE_TAGS.has(tag)) {
        redaction.opaqueNodesRedacted += 1;
        append("[REDACTED OPAQUE CONTENT]");
      } else {
        for (const child of Array.from(node?.childNodes || [])) {
          serializeNode(child, depth + 1);
          if (truncated) break;
        }
      }
      append(`</${tag}>`);
    }

    serializeNode(documentValue.documentElement, 0);
    const html = parts.join("");
    return {
      format: FORMAT,
      hostname: pageHostname,
      https: pageUrl.protocol === "https:",
      html,
      truncated,
      originalElementCount: Math.max(0, Number(documentValue.getElementsByTagName?.("*")?.length) || 0),
      serializedChars: html.length,
      redaction,
      resourceHosts: [...resourceHosts.values()]
        .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)),
      inlineScriptHints,
      domMarkers
    };
  }

  globalThis.VeilanceRedactedHtml = Object.freeze({
    FORMAT,
    captureRedactedDocument
  });
})();
