import { button } from "./button";

type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => boolean | void;
  fill?: boolean;
  label?: string;
  role?: "tablist" | "radiogroup";
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  label,
  role = "tablist",
}: SegmentedControlProps<T>): HTMLElement & { setValue: (value: T) => void } {
  let activeValue = value;
  const wrap = document.createElement("div");
  wrap.className = "segmented-control";
  wrap.dataset.fill = fill ? "true" : "false";
  wrap.setAttribute("role", role);
  if (label) wrap.setAttribute("aria-label", label);
  wrap.style.setProperty("--count", String(options.length));

  const renderState = (): void => {
    for (const segment of Array.from(wrap.querySelectorAll<HTMLButtonElement>(".segmented-control__item"))) {
      const isSelected = segment.dataset.value === activeValue;
      segment.setAttribute(role === "radiogroup" ? "aria-checked" : "aria-selected", String(isSelected));
      segment.tabIndex = isSelected ? 0 : -1;
    }
  };

  for (const option of options) {
    const segment = button("", "segmented-control__item");
    segment.type = "button";
    segment.dataset.value = option.value;
    segment.title = option.title ?? option.label;
    segment.setAttribute("role", role === "radiogroup" ? "radio" : "tab");
    segment.append(labelSpan(option.label));
    segment.addEventListener("click", () => {
      if (activeValue === option.value) return;
      if (onChange(option.value) === false) return;
      activeValue = option.value;
      renderState();
      wrap.dispatchEvent(new Event("change", { bubbles: true }));
    });
    segment.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = options.findIndex((item) => item.value === activeValue);
      const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (currentIndex + offset + options.length) % options.length;
      const next = options[index];
      if (onChange(next.value) === false) return;
      activeValue = next.value;
      renderState();
      wrap.dispatchEvent(new Event("change", { bubbles: true }));
      const nextButton = wrap.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
      nextButton?.focus();
    });
    wrap.append(segment);
  }

  renderState();
  return Object.assign(wrap, { setValue: (next: T): void => { activeValue = next; renderState(); } });
}

function labelSpan(label: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "segmented-control__label";
  node.textContent = label;
  return node;
}
