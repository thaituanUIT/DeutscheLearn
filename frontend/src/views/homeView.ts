import { el } from "../utils/dom";
import type { QuizMode } from "./quizView";

export type HomeMode = QuizMode | "focus" | "story";

export type HomeModeMetric = {
  label: string;
  value: string;
};

type HomeViewOptions = {
  onSelectMode: (mode: HomeMode) => void;
  metrics: Record<HomeMode, HomeModeMetric>;
};

const modes: Array<{
  mode: HomeMode;
  title: string;
  description: string;
  action: string;
}> = [
  {
    mode: "endless",
    title: "Endless",
    description: "One miss ends the run.",
    action: "Play endless",
  },
  {
    mode: "practice",
    title: "Practice",
    description: "Review the correct answer after each miss.",
    action: "Start practice",
  },
  {
    mode: "timed",
    title: "Timed",
    description: "Answer as many as possible in 60 seconds.",
    action: "Start timed",
  },
  {
    mode: "focus",
    title: "Focus",
    description: "Flashcards by level and topic.",
    action: "Study words",
  },
  {
    mode: "story",
    title: "Story",
    description: "Short passages with comprehension questions.",
    action: "Read stories",
  },
];

export function homeView(options: HomeViewOptions): HTMLElement {
  const section = el("section", "home");
  const intro = el("div", "home-intro");

  const grid = el("div", "mode-grid");
  for (const [index, item] of modes.entries()) {
    const card = document.createElement("a");
    card.className = `mode-card mode-card-${item.mode}`;
    card.href = `#${item.mode}`;
    card.setAttribute("aria-label", item.action);
    card.addEventListener("click", (event) => {
      event.preventDefault();
      options.onSelectMode(item.mode);
    });

    const numeral = el("span", "mode-numeral", String(index + 1).padStart(2, "0"));
    const content = el("span", "mode-content");
    content.append(el("strong", "", item.title), el("span", "mode-description", item.description));

    const metric = options.metrics[item.mode];
    const stat = el("span", "mode-stat");
    stat.append(
      el("span", "mode-stat-label", metric.label),
      el("span", metric.value === "—" ? "mode-stat-value mode-stat-empty" : "mode-stat-value", metric.value),
    );

    card.append(numeral, content, stat, el("span", "mode-arrow", "→"));
    grid.append(card);
  }

  section.append(intro, grid);
  return section;
}
