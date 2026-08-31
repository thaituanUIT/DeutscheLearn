import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from "../state/themeStore";
import { el } from "../utils/dom";

const themeOptions: Array<{ preference: ThemePreference; label: string }> = [
  { preference: "system", label: "System" },
  { preference: "light", label: "Light" },
  { preference: "dark", label: "Dark" },
];

export function themeToggle(): HTMLElement {
  const wrap = el("div", "theme-menu");
  const trigger = el("button", "theme-menu__trigger");
  const menu = el("div", "theme-menu__list");
  const items = new Map<ThemePreference, HTMLButtonElement>();

  trigger.type = "button";
  trigger.setAttribute("aria-label", "Theme");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  menu.setAttribute("role", "menu");
  menu.hidden = true;

  for (const option of themeOptions) {
    const item = el("button", "theme-menu__item");
    const check = el("span", "theme-menu__check", "✓");
    const label = el("span", "", option.label);

    item.type = "button";
    item.setAttribute("role", "menuitemradio");
    item.dataset.preference = option.preference;
    item.append(check, label);
    item.addEventListener("click", () => {
      setThemePreference(option.preference);
      closeMenu({ restoreFocus: true });
    });
    items.set(option.preference, item);
    menu.append(item);
  }

  const render = (preference: ThemePreference): void => {
    trigger.replaceChildren(themeIcon(isDarkThemeActive() ? "dark" : "light"));

    for (const [option, item] of items) {
      const checked = option === preference;
      item.setAttribute("aria-checked", String(checked));
      item.tabIndex = checked ? 0 : -1;
    }
  };

  const openMenu = (): void => {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
  };

  const closeMenu = ({ restoreFocus }: { restoreFocus: boolean }): void => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    if (restoreFocus) trigger.focus();
  };

  const focusSelectedItem = (): void => {
    const selected = items.get(getThemePreference());
    selected?.focus();
  };

  const toggleMenu = (): void => {
    if (menu.hidden) {
      openMenu();
      focusSelectedItem();
    } else {
      closeMenu({ restoreFocus: false });
    }
  };

  const moveFocus = (direction: 1 | -1): void => {
    const itemList = Array.from(items.values());
    const currentIndex = itemList.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + itemList.length) % itemList.length;
    itemList[nextIndex]?.focus();
  };

  function closeOnOutsidePointerDown(event: PointerEvent): void {
    if (!wrap.contains(event.target as Node)) closeMenu({ restoreFocus: false });
  }

  trigger.addEventListener("click", toggleMenu);
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      focusSelectedItem();
    }
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      Array.from(items.values())[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const itemList = Array.from(items.values());
      itemList[itemList.length - 1]?.focus();
    }
  });

  render(getThemePreference());
  subscribeThemePreference(render);
  wrap.append(trigger, menu);
  return wrap;
}

function isDarkThemeActive(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function themeIcon(theme: "light" | "dark"): SVGSVGElement {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "18");
  icon.setAttribute("height", "18");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");

  if (theme === "light") {
    appendSvg(icon, "circle", { cx: "12", cy: "12", r: "4" });
    appendSvg(icon, "path", { d: "M12 2v2" });
    appendSvg(icon, "path", { d: "M12 20v2" });
    appendSvg(icon, "path", { d: "m4.93 4.93 1.41 1.41" });
    appendSvg(icon, "path", { d: "m17.66 17.66 1.41 1.41" });
    appendSvg(icon, "path", { d: "M2 12h2" });
    appendSvg(icon, "path", { d: "M20 12h2" });
    appendSvg(icon, "path", { d: "m6.34 17.66-1.41 1.41" });
    appendSvg(icon, "path", { d: "m19.07 4.93-1.41 1.41" });
  } else {
    appendSvg(icon, "path", { d: "M20.99 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.78 9.79Z" });
  }

  return icon;
}

function appendSvg<K extends keyof SVGElementTagNameMap>(
  parent: SVGSVGElement,
  tag: K,
  attributes: Record<string, string>,
): void {
  const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) child.setAttribute(name, value);
  parent.append(child);
}
