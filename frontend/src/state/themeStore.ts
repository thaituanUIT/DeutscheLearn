export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const listeners = new Set<(preference: ThemePreference) => void>();
let mediaListenerRegistered = false;

type LegacyMediaQueryList = MediaQueryList & {
  addListener(listener: (event: MediaQueryListEvent) => void): void;
};

export function getThemePreference(): ThemePreference {
  const stored = readStoredThemePreference();
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    removeStoredThemePreference();
  } else {
    writeStoredThemePreference(preference);
  }
  applyThemePreference(preference);
  notifyThemePreference(preference);
}

export function subscribeThemePreference(listener: (preference: ThemePreference) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initializeThemeController(): void {
  applyThemePreference(getThemePreference());

  if (mediaListenerRegistered) return;
  const themeMedia = getThemeMedia();

  const handleSystemThemeChange = (): void => {
    const preference = getThemePreference();
    if (preference === "system") applyThemePreference(preference);
    notifyThemePreference(preference);
  };

  if (typeof themeMedia.addEventListener === "function") {
    themeMedia.addEventListener("change", handleSystemThemeChange);
  } else {
    (themeMedia as LegacyMediaQueryList).addListener(handleSystemThemeChange);
  }
  mediaListenerRegistered = true;
}

function applyThemePreference(preference: ThemePreference): void {
  const themeMedia = getThemeMedia();
  const dark = preference === "dark" || (preference === "system" && themeMedia.matches);
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = dark ? "dark" : "light";
  window.setTimeout(() => root.classList.remove("theme-switching"), 0);
}

function notifyThemePreference(preference: ThemePreference): void {
  for (const listener of listeners) listener(preference);
}

function getThemeMedia(): MediaQueryList {
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)");
  }

  return {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
}

function readStoredThemePreference(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredThemePreference(preference: Exclude<ThemePreference, "system">): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Browsers can block localStorage in private or embedded contexts.
  }
}

function removeStoredThemePreference(): void {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Browsers can block localStorage in private or embedded contexts.
  }
}
