import { getFocusCards, getFocusLevels, getFocusTopics } from "../api/client";
import type { FocusCard, FocusLevel, FocusTopic } from "../api/types";
import { button } from "../components/button";
import { el } from "../utils/dom";

type FocusViewOptions = {
  onBack: () => void;
  onError: (message: string) => void;
};

export function focusView(options: FocusViewOptions): HTMLElement {
  const section = el("section", "panel focus-card");
  renderLevels(section, options);
  return section;
}

async function renderLevels(section: HTMLElement, options: FocusViewOptions): Promise<void> {
  section.replaceChildren(el("p", "prompt", "Loading focus levels..."));
  try {
    const levels = await getFocusLevels();
    const intro = el("div");
    intro.append(
      el("div", "question-type", "Focus mode"),
      el("h2", "focus-title", "Choose a level"),
    );

    const grid = el("div", "focus-grid");
    for (const level of levels) {
      grid.append(levelCard(level, () => renderTopics(section, level.level, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load focus levels");
  }
}

async function renderTopics(
  section: HTMLElement,
  level: FocusLevel["level"],
  options: FocusViewOptions,
): Promise<void> {
  section.replaceChildren(el("p", "prompt", "Loading topics..."));
  try {
    const topics = await getFocusTopics(level);
    const intro = el("div");
    intro.append(
      el("div", "question-type", level),
      el("h2", "focus-title", "Choose a topic"),
    );

    const grid = el("div", "focus-grid topics-grid");
    for (const topic of topics) {
      grid.append(topicCard(topic, () => renderFlashcards(section, level, topic, options)));
    }

    const back = button("Back", "button");
    back.addEventListener("click", () => renderLevels(section, options));
    section.replaceChildren(intro, grid, actions(back));
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load focus topics");
  }
}

async function renderFlashcards(
  section: HTMLElement,
  level: FocusLevel["level"],
  topic: FocusTopic,
  options: FocusViewOptions,
): Promise<void> {
  section.replaceChildren(el("p", "prompt", "Loading flashcards..."));
  try {
    const cards = await getFocusCards(level, topic.topic);
    renderFlashcard(section, cards, 0, () => renderTopics(section, level, options));
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load flashcards");
  }
}

function renderFlashcard(
  section: HTMLElement,
  cards: FocusCard[],
  index: number,
  onBack: () => void,
): void {
  section.replaceChildren();
  if (cards.length === 0) {
    const back = button("Back", "button");
    back.addEventListener("click", onBack);
    section.append(el("p", "prompt", "No cards available for this topic yet."), actions(back));
    return;
  }

  const card = cards[index];
  const shownWord = card.article ? `${card.article} ${card.word}` : card.word;
  const content = el("div", "flashcard");
  content.append(
    el("div", "question-type", `${card.level} · ${card.topic_label}`),
    el("div", "flashcard-count", `${index + 1} / ${cards.length}`),
    el("h2", "flashcard-word", shownWord),
    el("p", "word-meta", card.part_of_speech),
    el("p", "meaning-overview", card.meaning_overview),
  );

  const back = button("Back", "button");
  back.addEventListener("click", onBack);
  const previous = button("Previous", "button");
  previous.disabled = index === 0;
  previous.addEventListener("click", () => renderFlashcard(section, cards, index - 1, onBack));
  const next = button("Next", "button primary");
  next.disabled = index === cards.length - 1;
  next.addEventListener("click", () => renderFlashcard(section, cards, index + 1, onBack));

  section.append(content, actions(back, previous, next));
}

function levelCard(level: FocusLevel, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", level.level),
    el("span", "", `${level.topic_count} topics`),
    el("span", "", `${level.word_count} words`),
  );
  return card;
}

function topicCard(topic: FocusTopic, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option topic-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", topic.label),
    el("span", "", `${topic.word_count} words`),
  );
  return card;
}

function actions(...nodes: HTMLElement[]): HTMLElement {
  const wrap = el("div", "actions");
  wrap.append(...nodes);
  return wrap;
}
