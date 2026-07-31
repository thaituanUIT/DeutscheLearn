import { button } from "../components/button";
import { el } from "../utils/dom";
import type { QuizMode } from "./quizView";

export type HomeMode = QuizMode | "focus";

type HomeViewOptions = {
  onSelectMode: (mode: HomeMode) => void;
};

const modes: Array<{
  mode: HomeMode;
  title: string;
  meta: string;
  description: string;
  action: string;
}> = [
  {
    mode: "endless",
    title: "Endless",
    meta: "Best streak",
    description: "One miss ends the run. Build the longest correct streak and climb the board.",
    action: "Play endless",
  },
  {
    mode: "practice",
    title: "Practice",
    meta: "No pressure",
    description: "Keep answering, review the correct answer after each miss, and train at your pace.",
    action: "Start practice",
  },
  {
    mode: "timed",
    title: "Timed",
    meta: "60 seconds",
    description: "Race the clock and answer as many German word questions as possible.",
    action: "Start timed",
  },
  {
    mode: "focus",
    title: "Focus",
    meta: "Flashcards",
    description: "Pick a level and topic, then review Duden-backed vocabulary cards.",
    action: "Study words",
  },
];

export function homeView(options: HomeViewOptions): HTMLElement {
  const section = el("section", "home");
  const intro = el("div", "home-intro");
  intro.append(
    el("div", "question-type", "Choose mode"),
    el("h2", "", "What do you want to do?"),
    el("p", "prompt", "Pick a quiz mode or study by topic."),
  );

  const grid = el("div", "mode-grid");
  for (const item of modes) {
    const card = button("", "mode-card");
    card.setAttribute("aria-label", item.action);
    card.addEventListener("click", () => options.onSelectMode(item.mode));
    card.append(
      el("span", "mode-meta", item.meta),
      el("strong", "", item.title),
      el("span", "mode-description", item.description),
      el("span", "mode-action", item.action),
    );
    grid.append(card);
  }

  section.append(intro, grid);
  return section;
}
