import {
  focusCardsFromWords,
  focusLevelsFromWords,
  focusRevisionFromWords,
  focusTopicsFromWords,
  getFocusWordsCorpus,
  shuffle,
} from "../api/queryClient";
import type { FocusCard, FocusLevel, FocusRevisionQuestion, FocusTopic } from "../api/types";
import { button } from "../components/button";
import { getPlayer } from "../state/playerStore";
import { recordFocusReview } from "../state/progressStore";
import { el } from "../utils/dom";
import { formatCount } from "../utils/format";

type FocusViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
  onError: (message: string) => void;
};

type FocusRating = "again" | "hard" | "good" | "easy";

const FOCUS_RATINGS: ReadonlyArray<{
  rating: FocusRating;
  label: string;
  shortcut: string;
}> = [
  { rating: "again", label: "Again", shortcut: "1" },
  { rating: "hard", label: "Hard", shortcut: "2" },
  { rating: "good", label: "Good", shortcut: "3" },
  { rating: "easy", label: "Easy", shortcut: "4" },
];

const flashcardKeyHandlers = new WeakMap<HTMLElement, (event: KeyboardEvent) => void>();

export function focusView(options: FocusViewOptions): HTMLElement {
  const section = el("section", "panel focus-card");
  renderLevels(section, options);
  return section;
}

async function renderLevels(section: HTMLElement, options: FocusViewOptions): Promise<void> {
  leaveFlashcardScreen(section);
  options.onBackChange(options.onBack);
  section.replaceChildren(el("p", "prompt", "Loading focus levels..."));
  try {
    const levels = focusLevelsFromWords(await getFocusWordsCorpus());
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
  leaveFlashcardScreen(section);
  options.onBackChange(() => renderLevels(section, options));
  section.replaceChildren(el("p", "prompt", "Loading topics..."));
  try {
    const topics = focusTopicsFromWords(await getFocusWordsCorpus(), level);
    const intro = el("div");
    intro.append(
      el("div", "question-type", level),
      el("h2", "focus-title", "Choose a topic"),
    );

    const grid = el("div", "focus-grid topics-grid");
    for (const topic of topics) {
      grid.append(topicCard(topic, () => renderFlashcards(section, level, topic, options)));
    }

    section.replaceChildren(intro, grid);
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
  options.onBackChange(() => renderTopics(section, level, options));
  section.replaceChildren(el("p", "prompt", "Loading flashcards..."));
  try {
    const cards = shuffle(focusCardsFromWords(await getFocusWordsCorpus(), level, topic.topic));
    renderFlashcard(section, cards, 0, level, topic, options);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load flashcards");
  }
}

async function renderRevision(
  section: HTMLElement,
  level: FocusLevel["level"],
  topic: FocusTopic,
  options: FocusViewOptions,
): Promise<void> {
  leaveFlashcardScreen(section);
  options.onBackChange(() => renderFlashcards(section, level, topic, options));
  section.replaceChildren(el("p", "prompt", "Loading revision quiz..."));
  try {
    const words = await getFocusWordsCorpus();
    const questions = focusRevisionFromWords(focusCardsFromWords(words, level, topic.topic), words);
    renderRevisionQuestion(section, questions, 0, 0, () =>
      renderRevision(section, level, topic, options),
    );
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load revision quiz");
  }
}

function renderRevisionQuestion(
  section: HTMLElement,
  questions: FocusRevisionQuestion[],
  index: number,
  score: number,
  onRetry: () => void,
): void {
  section.replaceChildren();
  if (questions.length === 0) {
    section.append(el("p", "prompt", "No quiz words available for this topic yet."));
    return;
  }

  if (index >= questions.length) {
    const result = el("div", "result revision-result");
    result.append(
      el("div", "question-type", "Revision complete"),
      el("h2", "", `${score} / ${questions.length}`),
      el("p", "prompt", "Review this topic again whenever you want."),
    );
    const retry = button("Try again", "button primary");
    retry.addEventListener("click", onRetry);
    section.append(result, cardActions(retry));
    return;
  }

  const question = questions[index];
  const shownWord = question.article ? `${question.article} ${question.word}` : question.word;
  const content = el("div", "flashcard revision-card");
  content.append(
    el("div", "question-type", `${question.level} · ${question.topic_label}`),
    el("div", "flashcard-count", `${index + 1} / ${questions.length} · ${score} correct`),
    el("h2", "flashcard-word", shownWord),
    el("p", "prompt", "Choose the English meaning."),
  );

  const answers = el("div", "answers revision-answers");
  for (const choice of question.choices) {
    const option = button(choice, "answer-option");
    option.addEventListener("click", () => {
      const correct = choice === question.correct_answer;
      renderRevisionFeedback(
        section,
        questions,
        index,
        score + (correct ? 1 : 0),
        choice,
        onRetry,
      );
    });
    answers.append(option);
  }

  const skip = button("Skip", "flashcard-nav-control revision-skip");
  skip.addEventListener("click", () =>
    renderRevisionQuestion(section, questions, index + 1, score, onRetry),
  );
  const navigation = el("div", "revision-question-actions");
  navigation.append(skip);
  section.append(content, answers, navigation);
}

function renderRevisionFeedback(
  section: HTMLElement,
  questions: FocusRevisionQuestion[],
  index: number,
  score: number,
  selectedAnswer: string,
  onRetry: () => void,
): void {
  section.replaceChildren();
  const question = questions[index];
  const correct = selectedAnswer === question.correct_answer;
  const content = el("div", "flashcard revision-card");
  content.append(
    el("div", "question-type", correct ? "Correct" : "Review"),
    el("h2", "flashcard-word", question.word),
    el("p", "meaning-overview", question.correct_answer),
  );

  if (!correct) {
    content.append(el("p", "prompt", `You chose: ${selectedAnswer}`));
  }

  const next = button(
    index === questions.length - 1 ? "Finish" : "Next",
    "button primary revision-next",
  );
  next.addEventListener("click", () =>
    renderRevisionQuestion(section, questions, index + 1, score, onRetry),
  );
  section.append(content, cardActions(next));
}

function renderFlashcard(
  section: HTMLElement,
  cards: FocusCard[],
  index: number,
  level: FocusLevel["level"],
  topic: FocusTopic,
  options: FocusViewOptions,
  revealed = false,
): void {
  section.replaceChildren();
  section.classList.add("flashcard-screen");
  if (cards.length === 0) {
    clearFlashcardKeyboard(section);
    section.append(el("p", "prompt", "No cards available for this topic yet."));
    return;
  }

  const card = cards[index];
  const shownWord = card.article ? `${card.article} ${card.word}` : card.word;
  const content = el("div", "flashcard");
  const quiz = button("Quiz", "flashcard-quiz-link");
  quiz.addEventListener("click", () => renderRevision(section, level, topic, options));
  const deckHeader = el("div", "flashcard-deck-header");
  deckHeader.append(el("div", "question-type", `${card.level} · ${card.topic_label}`), quiz);

  const progressMeta = el("div", "flashcard-progress-meta");
  progressMeta.append(el("span", "flashcard-count", `${index + 1} / ${cards.length}`));
  const progress = el("div", "flashcard-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Deck progress");
  progress.setAttribute("aria-valuemin", "1");
  progress.setAttribute("aria-valuemax", String(cards.length));
  progress.setAttribute("aria-valuenow", String(index + 1));
  const progressFill = el("span", "flashcard-progress-fill");
  progressFill.style.width = `${((index + 1) / cards.length) * 100}%`;
  progress.append(progressFill);

  const wordGroup = el("div", "flashcard-word-group");
  wordGroup.append(
    el("h2", "flashcard-word", shownWord),
    el("p", "word-meta", card.part_of_speech),
  );
  if (revealed) wordGroup.append(el("p", "meaning-overview", card.meaning_overview));
  content.append(deckHeader, progressMeta, progress, wordGroup);

  const showPrevious = (): void => {
    if (index > 0) renderFlashcard(section, cards, index - 1, level, topic, options, true);
  };
  const showNext = (): void => {
    if (index < cards.length - 1) renderFlashcard(section, cards, index + 1, level, topic, options);
  };
  const revealCard = (): void => {
    if (!revealed) renderFlashcard(section, cards, index, level, topic, options, true);
  };
  const gradeCard = (rating: FocusRating): void => {
    const player = getPlayer();
    if (player) recordFocusReview(player.player_id, card, rating);
    if (index < cards.length - 1) renderFlashcard(section, cards, index + 1, level, topic, options);
  };

  const previous = button("Previous", "flashcard-nav-control flashcard-previous");
  previous.disabled = index === 0;
  previous.addEventListener("click", showPrevious);
  const next = button("Next", "flashcard-nav-control flashcard-next");
  next.disabled = index === cards.length - 1;
  next.addEventListener("click", showNext);

  const studyAction = revealed
    ? focusReviewActions(gradeCard)
    : revealAnswerAction(revealCard);
  section.append(content, studyAction, flashcardActions(previous, next));
  bindFlashcardKeyboard(section, {
    onReveal: revealed ? null : revealCard,
    onGrade: revealed ? gradeCard : null,
    onPrevious: index > 0 ? showPrevious : null,
  });
}

function focusReviewActions(onGrade: (rating: FocusRating) => void): HTMLElement {
  const wrap = el("div", "actions focus-review-actions");
  for (const { rating, label, shortcut } of FOCUS_RATINGS) {
    const control = button("", `button focus-grade focus-grade-${rating}`);
    control.setAttribute("aria-keyshortcuts", shortcut);
    control.append(el("span", "focus-grade-label", label), el("kbd", "focus-grade-shortcut", shortcut));
    control.addEventListener("click", () => onGrade(rating));
    wrap.append(control);
  }
  return wrap;
}

function revealAnswerAction(onReveal: () => void): HTMLElement {
  const wrap = el("div", "flashcard-reveal-row");
  const reveal = button("Show answer", "flashcard-reveal");
  reveal.setAttribute("aria-keyshortcuts", "Space");
  reveal.addEventListener("click", onReveal);
  wrap.append(reveal);
  return wrap;
}

function levelCard(level: FocusLevel, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option");
  const isEmpty = level.word_count === 0;
  card.disabled = isEmpty;
  card.setAttribute("aria-disabled", String(isEmpty));
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", level.level),
    el("span", "", formatCount(level.topic_count, "topic", { zeroLabel: "No" })),
    el("span", "", isEmpty ? "No material has been added yet." : formatCount(level.word_count, "word")),
  );
  return card;
}

function topicCard(topic: FocusTopic, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option topic-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", topic.label),
    el("span", "", formatCount(topic.word_count, "word", { zeroLabel: "No" })),
  );
  return card;
}

function cardActions(...nodes: HTMLElement[]): HTMLElement {
  const wrap = el("div", nodes.length === 1 ? "actions centered-actions" : "actions");
  wrap.append(...nodes);
  return wrap;
}

function flashcardActions(previous: HTMLElement, next: HTMLElement): HTMLElement {
  const wrap = el("div", "actions flashcard-actions");
  wrap.append(previous, next);
  return wrap;
}

function bindFlashcardKeyboard(
  section: HTMLElement,
  actions: {
    onReveal: (() => void) | null;
    onGrade: ((rating: FocusRating) => void) | null;
    onPrevious: (() => void) | null;
  },
): void {
  clearFlashcardKeyboard(section);
  const handler = (event: KeyboardEvent): void => {
    if (!section.isConnected) {
      clearFlashcardKeyboard(section);
      return;
    }
    if (isTypingTarget(event.target)) return;
    if ((event.code === "Space" || event.key === " ") && actions.onReveal) {
      event.preventDefault();
      actions.onReveal();
      return;
    }
    if (event.key === "ArrowLeft" && actions.onPrevious) {
      event.preventDefault();
      actions.onPrevious();
      return;
    }
    const rating = FOCUS_RATINGS.find(({ shortcut }) => shortcut === event.key)?.rating;
    if (rating && actions.onGrade) {
      event.preventDefault();
      actions.onGrade(rating);
    }
  };
  flashcardKeyHandlers.set(section, handler);
  window.addEventListener("keydown", handler);
}

function clearFlashcardKeyboard(section: HTMLElement): void {
  const handler = flashcardKeyHandlers.get(section);
  if (!handler) return;
  window.removeEventListener("keydown", handler);
  flashcardKeyHandlers.delete(section);
}

function leaveFlashcardScreen(section: HTMLElement): void {
  clearFlashcardKeyboard(section);
  section.classList.remove("flashcard-screen");
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName));
}
