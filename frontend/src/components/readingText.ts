import { el } from "../utils/dom";

export function readingText(text: string, className = "story-text"): HTMLElement {
  const wrap = el("div", className);
  for (const paragraph of readingParagraphs(text)) {
    wrap.append(el("p", "", paragraph));
  }
  return wrap;
}

function readingParagraphs(text: string): string[] {
  const blocks = text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks : [""];
}
