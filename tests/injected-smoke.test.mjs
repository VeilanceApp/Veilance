import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

class TinyCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

class TinyEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }
}

class FakeDocument extends TinyEventTarget {
  get cookie() { return "secret-name=secret-value"; }
  set cookie(_value) {}
}

class FakeNavigator {
  get hardwareConcurrency() { return 16; }
  get deviceMemory() { return 8; }
  get languages() { return ["en-US"]; }
}

class FakeScreen {
  get width() { return 1920; }
  get colorDepth() { return 24; }
}

class FakeCanvasContext {
  measureText(value) { return { width: String(value).length }; }
}

test("main-world instrumentation records new indicator operations without values", async () => {
  const document = new FakeDocument();
  const pageEvents = new TinyEventTarget();
  const sandbox = {
    console,
    crypto: { randomUUID: () => "test-session" },
    URL,
    location: {
      href: "https://example.com/private?secret=yes",
      origin: "https://example.com"
    },
    CustomEvent: TinyCustomEvent,
    EventTarget: TinyEventTarget,
    Document: FakeDocument,
    document,
    Navigator: FakeNavigator,
    navigator: new FakeNavigator(),
    Screen: FakeScreen,
    screen: new FakeScreen(),
    CanvasRenderingContext2D: FakeCanvasContext,
    addEventListener: pageEvents.addEventListener.bind(pageEvents),
    window: null
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const source = await readFile(new URL("../injected.js", import.meta.url), "utf8");
  vm.runInContext(source, sandbox, { filename: "injected.js" });

  const events = [];
  document.addEventListener("__veilance_event_v1__", (event) => events.push(event.detail));
  document.dispatchEvent(new TinyCustomEvent("__veilance_control_v1__", {
    detail: {
      action: "configure",
      enabledIndicatorIds: [
        "navigator-characteristics",
        "screen-characteristics",
        "font-probing",
        "cookie-access"
      ]
    }
  }));
  document.dispatchEvent(new TinyCustomEvent("__veilance_control_v1__", {
    detail: { action: "drain" }
  }));

  void sandbox.navigator.hardwareConcurrency;
  void sandbox.screen.width;
  void sandbox.document.cookie;
  sandbox.document.cookie = "do-not-store=this-value";
  new sandbox.CanvasRenderingContext2D().measureText("do-not-store-this-text");

  assert.deepEqual(
    events.map((event) => event.indicatorId),
    [
      "navigator-characteristics",
      "screen-characteristics",
      "cookie-access",
      "cookie-access",
      "font-probing"
    ]
  );
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("secret-value"), false);
  assert.equal(serialized.includes("do-not-store"), false);
});
