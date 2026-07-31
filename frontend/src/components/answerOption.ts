export function answerOption(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "answer-option";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}
