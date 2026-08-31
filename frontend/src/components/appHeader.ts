import { el } from "../utils/dom";
import { themeToggle } from "./themeToggle";

export function appHeader(title: string, endContent: HTMLElement): {
  header: HTMLElement;
  headerStart: HTMLElement;
  headerEnd: HTMLElement;
} {
  const header = el("header", "topbar");
  const headerStart = el("div", "header-start");
  const headerEnd = el("div", "header-end");

  headerStart.append(el("h1", "brand", title));
  headerEnd.append(themeToggle(), endContent);
  header.append(headerStart, headerEnd);
  return { header, headerStart, headerEnd };
}
