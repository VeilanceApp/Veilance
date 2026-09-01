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

test("canvas readback observation leaves Veilance off the native call stack", async () => {
  class DiagnosticCanvasContext {
    getImageData() {
      this.nativeCallStack = new Error("browser diagnostic").stack;
      return { data: new Uint8ClampedArray(4) };
    }
  }

  const originalGetImageData = DiagnosticCanvasContext.prototype.getImageData;
  const document = new FakeDocument();
  const pageEvents = new TinyEventTarget();
  const sandbox = {
    console,
    crypto: { randomUUID: () => "canvas-session" },
    URL,
    Uint8ClampedArray,
    location: {
      href: "https://example.com/editor/",
      origin: "https://example.com"
    },
    CustomEvent: TinyCustomEvent,
    EventTarget: TinyEventTarget,
    Document: FakeDocument,
    document,
    Navigator: FakeNavigator,
    navigator: new FakeNavigator(),
    CanvasRenderingContext2D: DiagnosticCanvasContext,
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
    detail: { action: "configure", enabledIndicatorIds: ["canvas"] }
  }));

  const context = new sandbox.CanvasRenderingContext2D();
  const pixels = context.getImageData(0, 0, 1, 1);

  assert.equal(pixels.data.length, 4);
  assert.doesNotMatch(
    context.nativeCallStack,
    /injected\.js|veilanceWrappedMethod|veilanceObservedMethodGetter/
  );
  assert.deepEqual(
    events.map((event) => [event.indicatorId, event.action]),
    [["canvas", "readback"]]
  );

  assert.equal(context.getImageData, originalGetImageData);
  assert.equal(events.length, 2);

  const replacement = () => "replacement";
  context.getImageData = replacement;
  assert.equal(context.getImageData(), "replacement");
  assert.equal(events.length, 2);
});

test("Windows WebGPU calls omit only Chromium's ignored power preference", async () => {
  class WindowsNavigator {
    get platform() { return "Win32"; }
  }

  class FakeGPU {
    requestAdapter(options) {
      this.receivedOptions = options;
      return Promise.resolve(null);
    }
  }

  const document = new FakeDocument();
  const pageEvents = new TinyEventTarget();
  const sandbox = {
    console,
    crypto: { randomUUID: () => "windows-webgpu-session" },
    URL,
    location: {
      href: "https://example.com/",
      origin: "https://example.com"
    },
    CustomEvent: TinyCustomEvent,
    EventTarget: TinyEventTarget,
    Document: FakeDocument,
    document,
    Navigator: WindowsNavigator,
    navigator: new WindowsNavigator(),
    GPU: FakeGPU,
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
    detail: { action: "configure", enabledIndicatorIds: ["webgpu"] }
  }));

  const requestedOptions = Object.freeze({
    powerPreference: "high-performance",
    forceFallbackAdapter: true,
    featureLevel: "core",
    futureOption: "preserved"
  });
  const gpu = new sandbox.GPU();
  await gpu.requestAdapter(requestedOptions);

  assert.equal(gpu.receivedOptions.powerPreference, undefined);
  assert.equal(gpu.receivedOptions.forceFallbackAdapter, true);
  assert.equal(gpu.receivedOptions.featureLevel, "core");
  assert.equal(gpu.receivedOptions.futureOption, "preserved");
  assert.equal(requestedOptions.powerPreference, "high-performance");
  assert.deepEqual(
    events.map((event) => [event.indicatorId, event.action]),
    [["webgpu", "request-adapter"]]
  );
});

test("non-Windows WebGPU calls preserve the power preference", async () => {
  class LinuxNavigator {
    get platform() { return "Linux x86_64"; }
  }

  class FakeGPU {
    requestAdapter(options) {
      this.receivedOptions = options;
      return Promise.resolve(null);
    }
  }

  const document = new FakeDocument();
  const pageEvents = new TinyEventTarget();
  const sandbox = {
    console,
    crypto: { randomUUID: () => "linux-webgpu-session" },
    URL,
    location: {
      href: "https://example.com/",
      origin: "https://example.com"
    },
    CustomEvent: TinyCustomEvent,
    EventTarget: TinyEventTarget,
    Document: FakeDocument,
    document,
    Navigator: LinuxNavigator,
    navigator: new LinuxNavigator(),
    GPU: FakeGPU,
    addEventListener: pageEvents.addEventListener.bind(pageEvents),
    window: null
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const source = await readFile(new URL("../injected.js", import.meta.url), "utf8");
  vm.runInContext(source, sandbox, { filename: "injected.js" });

  const requestedOptions = { powerPreference: "low-power" };
  const gpu = new sandbox.GPU();
  await gpu.requestAdapter(requestedOptions);

  assert.equal(gpu.receivedOptions, requestedOptions);
  assert.equal(gpu.receivedOptions.powerPreference, "low-power");
});

test("downloaded Shield rules drive packaged Canvas, WebGL, audio, Navigator, and Screen protections", async () => {
  class ShieldNavigator {
    get hardwareConcurrency() { return 16; }
    get deviceMemory() { return 8; }
    get maxTouchPoints() { return 10; }
    get platform() { return "Linux x86_64"; }
  }

  class ShieldScreen {
    get width() { return 1920; }
    get height() { return 1080; }
    get colorDepth() { return 30; }
  }

  class ShieldImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
      this.colorSpace = "srgb";
    }
  }

  class ShieldCanvasContext {
    getImageData() {
      return new ShieldImageData(new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]), 2, 1);
    }

    measureText() {
      return {
        width: 42.5,
        actualBoundingBoxLeft: 1,
        actualBoundingBoxRight: 41.5,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2
      };
    }
  }

  class ShieldWebGl {
    getParameter(parameter) {
      if (parameter === 37445) return "Original GPU Vendor";
      if (parameter === 37446) return "Original GPU Renderer";
      if (parameter === 3379) return 16384;
      return null;
    }

    readPixels(_x, _y, _width, _height, _format, _type, destination) {
      destination.fill(128);
    }
  }

  class ShieldAudioBuffer {
    getChannelData() {
      return new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    }

    copyFromChannel(destination) {
      destination.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    }
  }

  class ShieldAnalyserNode {
    getFloatFrequencyData(destination) { destination.fill(-42.5); }
    getFloatTimeDomainData(destination) { destination.fill(0.25); }
    getByteFrequencyData(destination) { destination.fill(128); }
    getByteTimeDomainData(destination) { destination.fill(128); }
  }

  const document = new FakeDocument();
  const pageEvents = new TinyEventTarget();
  const sandbox = {
    console,
    crypto: { randomUUID: () => "shield-session" },
    URL,
    Uint8Array,
    Uint8ClampedArray,
    Float32Array,
    ImageData: ShieldImageData,
    location: { href: "https://example.com/", origin: "https://example.com" },
    CustomEvent: TinyCustomEvent,
    EventTarget: TinyEventTarget,
    Document: FakeDocument,
    document,
    Navigator: ShieldNavigator,
    navigator: new ShieldNavigator(),
    Screen: ShieldScreen,
    screen: new ShieldScreen(),
    CanvasRenderingContext2D: ShieldCanvasContext,
    WebGLRenderingContext: ShieldWebGl,
    AudioBuffer: ShieldAudioBuffer,
    AnalyserNode: ShieldAnalyserNode,
    addEventListener: pageEvents.addEventListener.bind(pageEvents),
    window: null
  };
  sandbox.window = sandbox;
  sandbox[Symbol.for("veilance.fingerprint-protection-enabled.v1")] = true;
  vm.createContext(sandbox);

  const [source, shieldBundleText] = await Promise.all([
    readFile(new URL("../injected.js", import.meta.url), "utf8"),
    readFile(new URL("../data/veilance-shields.json", import.meta.url), "utf8")
  ]);
  vm.runInContext(source, sandbox, { filename: "injected.js" });
  const shieldRules = JSON.parse(shieldBundleText).records;
  const protectedEvents = [];
  document.addEventListener("__veilance_protection_event_v1__", (event) => protectedEvents.push(event.detail));
  document.dispatchEvent(new TinyCustomEvent("__veilance_control_v1__", {
    detail: {
      action: "configure",
      enabledIndicatorIds: ["canvas", "font-probing", "webgl", "audio", "navigator-characteristics", "screen-characteristics"],
      shieldRules
    }
  }));

  assert.equal(sandbox.navigator.hardwareConcurrency, 8);
  assert.equal(sandbox.navigator.deviceMemory, 4);
  assert.equal(sandbox.navigator.maxTouchPoints, 5);
  assert.equal(sandbox.screen.width, 1900);
  assert.equal(sandbox.screen.height, 1100);
  assert.equal(sandbox.screen.colorDepth, 24);

  const gl = new sandbox.WebGLRenderingContext();
  assert.equal(gl.getParameter(37445), "Google Inc. (Google)");
  assert.match(gl.getParameter(37446), /SwiftShader/);
  assert.equal(gl.getParameter(3379), 4096);
  const pixels = new Uint8Array(16);
  gl.readPixels(0, 0, 2, 2, 0, 0, pixels);
  assert.ok([...pixels].some((value) => value !== 128));

  const audio = new sandbox.AudioBuffer();
  const baselineSamples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  const protectedSamples = audio.getChannelData(0);
  assert.ok([...protectedSamples].some((value, index) => value !== baselineSamples[index]));
  const copiedSamples = new Float32Array(8);
  audio.copyFromChannel(copiedSamples, 0);
  assert.ok([...copiedSamples].some((value, index) => value !== baselineSamples[index]));

  const analyser = new sandbox.AnalyserNode();
  const floatFrequency = new Float32Array(16);
  analyser.getFloatFrequencyData(floatFrequency);
  assert.ok([...floatFrequency].some((value) => value !== -42.5));
  const floatWaveform = new Float32Array(16);
  analyser.getFloatTimeDomainData(floatWaveform);
  assert.ok([...floatWaveform].some((value) => value !== 0.25));
  const byteFrequency = new Uint8Array(16);
  analyser.getByteFrequencyData(byteFrequency);
  assert.ok([...byteFrequency].some((value) => value !== 128));
  const byteWaveform = new Uint8Array(16);
  analyser.getByteTimeDomainData(byteWaveform);
  assert.ok([...byteWaveform].some((value) => value !== 128));

  const canvasContext = new sandbox.CanvasRenderingContext2D();
  const canvasPixels = canvasContext.getImageData(0, 0, 2, 1);
  assert.ok([...canvasPixels.data].some((value, index) => index % 4 !== 3 && value !== 128));
  const textMetrics = canvasContext.measureText("fingerprint");
  assert.notEqual(textMetrics.width, 42.5);
  assert.ok(protectedEvents.length >= 16);
  assert.ok(protectedEvents.every((event) => event.ruleId && event.technique && event.explanation));
  assert.ok(protectedEvents.every((event) => event.returnedValue));
  const textureCap = protectedEvents.find((event) => event.ruleId === "webgl-max-texture-size");
  assert.equal(textureCap.returnedValue.value, 4096);
  const audioPreview = protectedEvents.find((event) => event.ruleId === "audio-analyser-float-frequency");
  assert.equal(audioPreview.returnedValue.type, "Float32Array");
  assert.equal(audioPreview.returnedValue.length, 16);
  assert.equal(audioPreview.returnedValue.sample.length, 16);
});
