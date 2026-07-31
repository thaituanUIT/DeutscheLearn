import { el } from "../utils/dom";

export function scoreBadge(label: string, value: string | number): HTMLElement {
  const node = el("div", "score-badge");
  node.append(el("span", "score-label", label), el("strong", "", String(value)));
  return node;
}
