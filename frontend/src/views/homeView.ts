import "../styles/views/home.css";
import { el } from "../utils/dom";
import type { Mistake } from "../state/progressStore";
import type { QuizMode } from "./quizView";

export type HomeMode = QuizMode | "focus" | "scramble" | "story" | "dictation";

export type HomeModeMetric = {
  label: string;
  value: string;
};

type HomeViewOptions = {
  onSelectMode: (mode: HomeMode) => void;
  metrics: Record<HomeMode, HomeModeMetric>;
  mistakes: Mistake[];
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
    mode: "scramble",
    title: "Scramble",
    description: "Rebuild German words from shuffled letters.",
    action: "Play scramble",
  },
  {
    mode: "story",
    title: "Story",
    description: "Short passages with comprehension questions.",
    action: "Read stories",
  },
  {
    mode: "dictation",
    title: "Hörtippen",
    description: "German video dictation, one line at a time.",
    action: "Start listening",
  },
];

const modeGroups: Array<{ id: "quiz" | "skills"; title: string; modes: HomeMode[] }> = [
  { id: "quiz", title: "Quiz practice", modes: ["practice", "endless", "timed"] },
  { id: "skills", title: "Study and listening", modes: ["focus", "scramble", "story", "dictation"] },
];

export function homeView(options: HomeViewOptions): HTMLElement {
  const section = el("section", "home");
  const intro = el("div", "home-intro");
  intro.append(el("h2", "home-heading", "Choose a way to practice"));

  const grid = el("div", "mode-grid");
  for (const group of modeGroups) {
    const groupNode = el("section", `mode-group mode-group-${group.id}`);
    groupNode.setAttribute("aria-labelledby", `mode-group-${group.id}-title`);
    const groupTitle = el("h3", "mode-group-title", group.title);
    groupTitle.id = `mode-group-${group.id}-title`;
    groupNode.append(groupTitle);
    for (const mode of group.modes) {
      const item = modes.find((candidate) => candidate.mode === mode);
      if (!item) continue;
      const card = document.createElement("a");
      card.className = `mode-card mode-card-${item.mode}`;
      card.href = `#${item.mode}`;
      card.setAttribute("aria-label", `${item.title}: ${item.action}`);
      card.addEventListener("click", (event) => {
        event.preventDefault();
        options.onSelectMode(item.mode);
      });

      const content = el("span", "mode-content");
      content.append(el("strong", "", item.title), el("span", "mode-description", item.description));

      const metric = options.metrics[item.mode];
      const stat = el("span", "mode-stat");
      stat.append(
        el("span", "mode-stat-label", metric.label),
        el("span", metric.value === "—" ? "mode-stat-value mode-stat-empty" : "mode-stat-value", metric.value),
      );

      const arrow = el("span", "mode-arrow", "");
      arrow.setAttribute("aria-hidden", "true");
      card.append(content, stat, arrow);
      groupNode.append(card);
    }
    grid.append(groupNode);
  }

  section.append(intro, grid);
  if (options.mistakes.length > 0) {
    section.append(mistakeTray(options.mistakes));
  }
  return section;
}

function mistakeTray(mistakes: Mistake[]): HTMLElement {
  const tray = el("section", "mistake-tray");
  const list = el("div", "mistake-list");
  for (const mistake of mistakes.slice(0, 3)) {
    const item = el("div", "mistake-item");
    const modeLabels = { practice: "Practice", endless: "Endless", timed: "Timed", focus: "Flashcards", story: "Reading" };
    const word = el("strong", "", mistake.word ?? mistake.prompt);
    word.lang = "de";
    item.append(
      el("span", "mistake-mode", modeLabels[mistake.mode]),
      word,
      el("span", "mistake-answer", `You chose ${mistake.selected} · Correct: ${mistake.correct}`),
    );
    list.append(item);
  }
  tray.append(el("h3", "mode-group-title", "Review recent mistakes"), list);
  return tray;
}
