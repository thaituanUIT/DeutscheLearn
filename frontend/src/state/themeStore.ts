export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(preference: ThemePreference) => void>();

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
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
  themeMedia.addEventListener("change", () => {
    const preference = getThemePreference();
    if (preference === "system") applyThemePreference(preference);
    notifyThemePreference(preference);
  });
}

function applyThemePreference(preference: ThemePreference): void {
  const dark = preference === "dark" || (preference === "system" && themeMedia.matches);
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = dark ? "dark" : "light";
  window.setTimeout(() => root.classList.remove("theme-switching"), 0);
}

function notifyThemePreference(preference: ThemePreference): void {
  for (const listener of listeners) listener(preference);
}
