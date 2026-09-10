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
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  label,
}: SegmentedControlProps<T>): HTMLElement {
  let activeValue = value;
  const wrap = document.createElement("div");
  wrap.className = "segmented-control";
  wrap.dataset.fill = fill ? "true" : "false";
  wrap.setAttribute("role", "tablist");
  if (label) wrap.setAttribute("aria-label", label);
  wrap.style.setProperty("--count", String(options.length));

  const renderState = (): void => {
    for (const segment of Array.from(wrap.querySelectorAll<HTMLButtonElement>(".segmented-control__item"))) {
      const isSelected = segment.dataset.value === activeValue;
      segment.setAttribute("aria-selected", isSelected ? "true" : "false");
      segment.tabIndex = isSelected ? 0 : -1;
    }
  };

  for (const option of options) {
    const segment = button("", "segmented-control__item");
    segment.type = "button";
    segment.dataset.value = option.value;
    segment.title = option.title ?? option.label;
    segment.setAttribute("role", "tab");
    segment.append(labelSpan(option.label));
    segment.addEventListener("click", () => {
      if (activeValue === option.value) return;
      if (onChange(option.value) === false) return;
      activeValue = option.value;
      renderState();
    });
    segment.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const currentIndex = options.findIndex((item) => item.value === activeValue);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = options[(currentIndex + offset + options.length) % options.length];
      if (onChange(next.value) === false) return;
      activeValue = next.value;
      renderState();
      const nextButton = wrap.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
      nextButton?.focus();
    });
    wrap.append(segment);
  }

  renderState();
  return wrap;
}

function labelSpan(label: string): HTMLElement {
  const node = document.createElement("span");
  node.className = "segmented-control__label";
  node.textContent = label;
  return node;
}
