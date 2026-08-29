(() => {
  "use strict";
  const ENABLED_FLAG = Symbol.for("veilance.fingerprint-protection-enabled.v1");
  try {
    Object.defineProperty(window, ENABLED_FLAG, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
  } catch {
    // Best effort. The main Veilance instrumentation treats a missing flag as off.
  }
})();
