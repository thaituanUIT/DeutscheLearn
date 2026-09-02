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

let stylesInjected = false;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  label,
}: SegmentedControlProps<T>): HTMLElement {
  injectSegmentedControlStyles();

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

function injectSegmentedControlStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.dataset.component = "SegmentedControl";
  style.textContent = `
.segmented-control {
  --count: 2;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(var(--count), 1fr);
  align-items: center;
  width: max-content;
  height: 44px;
  padding: 3px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.segmented-control[data-fill="true"] {
  width: 100%;
}

.segmented-control__item {
  all: unset;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  align-self: stretch;
  justify-self: stretch;
  height: 100%;
  border: 0;
  border-radius: 5px;
  background: var(--transparent);
  color: var(--text-muted);
  font: inherit;
  font-size: 15px;
  font-weight: 400;
  font-synthesis: none;
  line-height: 1;
  cursor: pointer;
}

.segmented-control__label {
  box-sizing: border-box;
  display: block;
  padding: 0 14px;
  text-align: center;
  white-space: nowrap;
}

.segmented-control__item:hover {
  background: var(--surface-raised);
  color: var(--text);
}

.segmented-control__item[aria-selected="true"] {
  background: var(--accent-subtle);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}

.segmented-control__item:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--focus-ring) 25%, var(--transparent));
  outline-offset: 2px;
}

.segmented-control[data-disabled="true"] {
  opacity: 0.52;
}

.segmented-control[data-disabled="true"] .segmented-control__item {
  cursor: not-allowed;
}

@media print {
  .segmented-control {
    display: none !important;
  }
}
`;
  document.head.append(style);
}
