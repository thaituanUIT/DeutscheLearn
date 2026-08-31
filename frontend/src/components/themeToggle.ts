import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from "../state/themeStore";
import { el } from "../utils/dom";

const themeOptions: Array<{ preference: ThemePreference; label: string; ariaLabel: string }> = [
  { preference: "system", label: "Sys", ariaLabel: "Use system theme" },
  { preference: "light", label: "Light", ariaLabel: "Use light theme" },
  { preference: "dark", label: "Dark", ariaLabel: "Use dark theme" },
];

export function themeToggle(): HTMLElement {
  const group = el("div", "theme-toggle");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Theme");

  const buttons = new Map<ThemePreference, HTMLButtonElement>();
  for (const option of themeOptions) {
    const item = el("button", "theme-toggle__item", option.label);
    item.type = "button";
    item.setAttribute("role", "radio");
    item.setAttribute("aria-label", option.ariaLabel);
    item.addEventListener("click", () => setThemePreference(option.preference));
    buttons.set(option.preference, item);
    group.append(item);
  }

  const render = (preference: ThemePreference): void => {
    for (const [option, item] of buttons) {
      const checked = option === preference;
      item.setAttribute("aria-checked", String(checked));
      item.tabIndex = checked ? 0 : -1;
    }
  };

  render(getThemePreference());
  subscribeThemePreference(render);
  return group;
}
