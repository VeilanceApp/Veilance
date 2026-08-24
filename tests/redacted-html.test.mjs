import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { isRedactedHtmlSafe } from "../lib/core.js";

function element(tagName, attributes = {}, children = [], textContent = "") {
  const attributeList = Object.entries(attributes).map(([name, value]) => ({ name, value: String(value) }));
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    attributes: attributeList,
    childNodes: children,
    textContent,
    getAttribute(name) {
      return attributeList.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.value ?? null;
    },
    hasAttribute(name) {
      return attributeList.some((attribute) => attribute.name.toLowerCase() === name.toLowerCase());
    }
  };
}

function text(value) {
  return { nodeType: 3, nodeValue: value };
}

function comment(value) {
  return { nodeType: 8, nodeValue: value };
}

test("redacted HTML retains structural evidence without page text, values, script source, or URL paths", async () => {
  const sandbox = { URL };
  vm.createContext(sandbox);
  const source = await readFile(new URL("../lib/redacted-html.js", import.meta.url), "utf8");
  vm.runInContext(source, sandbox, { filename: "redacted-html.js" });

  const secret = "NEVER_INCLUDE_THIS_SECRET";
  const root = element("html", { lang: "en-US", "data-user": secret }, [
    element("head", {}, [
      element("title", {}, [text(`Account for ${secret}`)]),
      element("script", { nonce: secret }, [], `const token = "${secret}"; canvas.toDataURL(); navigator.hardwareConcurrency;`),
      element("script", { src: `https://tracker.example/private/pixel.js?user=${secret}`, integrity: secret })
    ]),
    element("body", { id: `adblock-detector-${secret}`, class: "advertising consent-modal" }, [
      element("h1", {}, [text(`Welcome ${secret}`)]),
      element("form", { action: `https://accounts.example/private?token=${secret}` }, [
        element("input", { type: "password", value: secret, name: "password", autocomplete: "current-password" }),
        element("textarea", {}, [text(secret)])
      ]),
      element("img", { src: `https://pixel.example/collect?id=${secret}`, width: "1", height: "1", alt: secret }),
      element("style", {}, [], `.user-${secret} { background: url(https://secret.example/${secret}); }`),
      comment(secret)
    ])
  ]);
  const documentValue = {
    documentElement: root,
    getElementsByTagName: () => ({ length: 13 })
  };

  const captured = sandbox.VeilanceRedactedHtml.captureRedactedDocument(documentValue, {
    href: `https://shop.example/private/account?session=${secret}`
  });
  const serialized = JSON.stringify(captured);

  assert.equal(captured.format, "veilance.redacted-html.v1");
  assert.equal(isRedactedHtmlSafe(captured.html), true);
  assert.equal(captured.hostname, "shop.example");
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("/private"), false);
  assert.equal(serialized.includes("?user="), false);
  assert.equal(serialized.includes(' value="'), false);
  assert.equal(serialized.includes(" nonce="), false);
  assert.equal(serialized.includes(" integrity="), false);
  assert.match(captured.html, /\[REDACTED TEXT\]/);
  assert.match(captured.html, /\[REDACTED INLINE SCRIPT\]/);
  assert.match(captured.html, /data-veilance-api-hints="canvas,navigator"/);
  assert.match(captured.html, /data-veilance-src-origin="https:\/\/tracker\.example"/);
  assert.match(captured.html, /data-veilance-src-origin="https:\/\/pixel\.example"/);
  assert.ok(captured.domMarkers.advertising >= 1);
  assert.ok(captured.domMarkers.antiBlocking >= 1);
  assert.ok(captured.inlineScriptHints.canvas >= 1);
  assert.ok(captured.inlineScriptHints.navigator >= 1);
  assert.ok(captured.redaction.formControlsRedacted >= 1);
});

test("redacted HTML removes private resource origins from public-page snapshots", async () => {
  const sandbox = { URL };
  vm.createContext(sandbox);
  const source = await readFile(new URL("../lib/redacted-html.js", import.meta.url), "utf8");
  vm.runInContext(source, sandbox, { filename: "redacted-html.js" });
  const root = element("html", {}, [
    element("body", {}, [
      element("img", { src: "http://192.168.1.50/private-camera" }),
      element("script", { src: "http://router.local/admin.js" })
    ])
  ]);
  const captured = sandbox.VeilanceRedactedHtml.captureRedactedDocument({
    documentElement: root,
    getElementsByTagName: () => ({ length: 4 })
  }, { href: "https://public.example/" });

  assert.equal(JSON.stringify(captured).includes("192.168.1.50"), false);
  assert.equal(JSON.stringify(captured).includes("router.local"), false);
  assert.equal(captured.redaction.privateUrlsRemoved, 2);
});
