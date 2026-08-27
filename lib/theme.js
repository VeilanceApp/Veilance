const THEME_STORAGE_KEY = "veilanceUiTheme";
const THEME_PREFERENCES = new Set(["system", "light", "dark"]);

const colorSchemeQuery = typeof matchMedia === "function"
  ? matchMedia("(prefers-color-scheme: dark)")
  : null;

let currentPreference = "system";
let initialized = false;
let listenersInstalled = false;
const subscribers = new Set();

function normalizePreference(value) {
  return THEME_PREFERENCES.has(value) ? value : "system";
}

function resolvedTheme(preference = currentPreference) {
  if (preference === "light" || preference === "dark") return preference;
  return colorSchemeQuery?.matches ? "dark" : "light";
}

function themeState() {
  return {
    preference: currentPreference,
    resolved: resolvedTheme()
  };
}

function applyTheme() {
  const state = themeState();
  document.documentElement.dataset.theme = state.resolved;
  document.documentElement.dataset.themePreference = state.preference;
  document.documentElement.style.colorScheme = state.resolved;
  for (const subscriber of subscribers) subscriber(state);
  return state;
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;

  colorSchemeQuery?.addEventListener?.("change", () => {
    if (currentPreference === "system") applyTheme();
  });

  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes[THEME_STORAGE_KEY]) return;
    currentPreference = normalizePreference(changes[THEME_STORAGE_KEY].newValue);
    applyTheme();
  });
}

export async function initializeTheme() {
  if (initialized) return themeState();
  initialized = true;
  installListeners();

  try {
    const stored = await globalThis.chrome?.storage?.local?.get?.(THEME_STORAGE_KEY);
    currentPreference = normalizePreference(stored?.[THEME_STORAGE_KEY]);
  } catch {
    currentPreference = "system";
  }

  return applyTheme();
}

export async function setThemePreference(preference) {
  currentPreference = normalizePreference(preference);
  const state = applyTheme();
  await globalThis.chrome?.storage?.local?.set?.({ [THEME_STORAGE_KEY]: currentPreference });
  return state;
}

export function toggleResolvedTheme() {
  return setThemePreference(resolvedTheme() === "dark" ? "light" : "dark");
}

export function subscribeToTheme(subscriber) {
  subscribers.add(subscriber);
  subscriber(themeState());
  return () => subscribers.delete(subscriber);
}

export { THEME_STORAGE_KEY };
