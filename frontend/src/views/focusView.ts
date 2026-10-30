import "../styles/views/focus.css";
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
import { recordFocusReview, type FocusReviewUndo } from "../state/progressStore";
import { el } from "../utils/dom";
import { formatCount } from "../utils/format";

type FocusViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
};

type FocusRating = "again" | "hard" | "good" | "easy";
type FocusRatingReceipt = {
  cardIndex: number;
  rating: FocusRating;
  undo: FocusReviewUndo;
};

const FOCUS_RATINGS: ReadonlyArray<{
  rating: FocusRating;
  label: string;
  dueLabel: string;
  shortcut: string;
}> = [
  { rating: "again", label: "Again", dueLabel: "Due today", shortcut: "1" },
  { rating: "hard", label: "Hard", dueLabel: "Due in 1 day", shortcut: "2" },
  { rating: "good", label: "Good", dueLabel: "Due in 3 days", shortcut: "3" },
  { rating: "easy", label: "Easy", dueLabel: "Due in 7 days", shortcut: "4" },
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
    renderRetryError(section, error instanceof Error ? error.message : "Could not load focus levels", () =>
      renderLevels(section, options),
    );
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
    grid.tabIndex = 0;
    grid.setAttribute("role", "region");
    grid.setAttribute("aria-label", "Vocabulary topics");
    for (const topic of topics) {
      grid.append(topicCard(topic, () => renderFlashcards(section, level, topic, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load focus topics",
      () => renderTopics(section, level, options),
      level,
    );
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
    renderFlashcard(section, cards, 0, level, topic, options, new Set());
  } catch (error) {
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load flashcards",
      () => renderFlashcards(section, level, topic, options),
      `${level} · ${topic.label}`,
    );
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
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load revision quiz",
      () => renderRevision(section, level, topic, options),
      `${level} · ${topic.label}`,
    );
  }
}

function renderRevisionQuestion(
  section: HTMLElement,
  questions: FocusRevisionQuestion[],
  index: number,
  score: number,
  onRetry: () => void,
): void {
  clearFlashcardKeyboard(section);
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

  const showAnswer = (): void =>
    renderRevisionFeedback(section, questions, index, score, null, onRetry);
  const reveal = revealAnswerButton(showAnswer);
  const skip = button("Skip", "flashcard-nav-control revision-skip");
  skip.addEventListener("click", () =>
    renderRevisionQuestion(section, questions, index + 1, score, onRetry),
  );
  const navigation = el("div", "revision-question-actions");
  navigation.append(reveal, skip);
  section.append(content, answers, navigation);
  bindFlashcardKeyboard(section, {
    onReveal: showAnswer,
    onGrade: null,
    onPrevious: null,
  });
}

function renderRevisionFeedback(
  section: HTMLElement,
  questions: FocusRevisionQuestion[],
  index: number,
  score: number,
  selectedAnswer: string | null,
  onRetry: () => void,
): void {
  clearFlashcardKeyboard(section);
  section.replaceChildren();
  const question = questions[index];
  const correct = selectedAnswer !== null && selectedAnswer === question.correct_answer;
  const content = el("div", "flashcard revision-card");
  content.append(
    el("div", "question-type", selectedAnswer === null ? "Answer" : correct ? "Correct" : "Review"),
    el("h2", "flashcard-word", question.word),
    el("p", "meaning-overview", question.correct_answer),
  );

  if (selectedAnswer !== null && !correct) {
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
  revealedCards: Set<number>,
  previousRating?: FocusRatingReceipt,
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
  const isRevealed = revealedCards.has(index);
  const content = el("div", "flashcard");
  const quiz = button("5-question quiz", "flashcard-quiz-link");
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
  const focusPoint = isRevealed
    ? el("h2", "flashcard-word", shownWord)
    : el("h2", "focus-recall-meaning", card.meaning_overview);
  focusPoint.tabIndex = -1;
  if (isRevealed) {
    wordGroup.append(focusPoint, el("p", "word-meta", card.part_of_speech), el("p", "meaning-overview", card.meaning_overview));
  } else {
    wordGroup.append(
      el("p", "focus-recall-instruction", "Recall the German word and article."),
      focusPoint,
      el("p", "word-meta", card.part_of_speech),
    );
  }
  content.append(deckHeader, progressMeta, progress, wordGroup);

  const showPrevious = (): void => {
    if (index > 0) renderFlashcard(section, cards, index - 1, level, topic, options, revealedCards, previousRating);
  };
  const showNext = (): void => {
    if (index < cards.length - 1) renderFlashcard(section, cards, index + 1, level, topic, options, revealedCards, previousRating);
  };
  const gradeCard = (rating: FocusRating): void => {
    if (!isRevealed) return;
    const player = getPlayer();
    const undo = player ? recordFocusReview(player.player_id, card, rating) : null;
    const receipt = undo ? { cardIndex: index, rating, undo } : undefined;
    if (index < cards.length - 1) {
      renderFlashcard(section, cards, index + 1, level, topic, options, revealedCards, receipt);
    } else {
      renderDeckComplete(
        section,
        cards.length,
        level,
        topic,
        options,
        receipt,
        () => renderFlashcard(section, cards, index, level, topic, options, revealedCards),
      );
    }
  };

  const previous = button("Previous", "flashcard-nav-control flashcard-previous");
  previous.disabled = index === 0;
  previous.addEventListener("click", showPrevious);
  const next = button("Next", "flashcard-nav-control flashcard-next");
  next.disabled = index === cards.length - 1;
  next.addEventListener("click", showNext);

  if (previousRating) {
    section.append(focusReviewUndoNotice(previousRating, () => {
      renderFlashcard(section, cards, previousRating.cardIndex, level, topic, options, revealedCards);
    }));
  }
  section.append(content);
  if (isRevealed) {
    section.append(
      el("p", "focus-review-guidance", "Choose how well you recalled the word to set when it returns."),
      focusReviewActions(gradeCard),
    );
  } else {
    const reveal = button("Reveal word and article", "button primary focus-reveal");
    reveal.setAttribute("aria-keyshortcuts", "Space");
    reveal.addEventListener("click", () => {
      revealedCards.add(index);
      renderFlashcard(section, cards, index, level, topic, options, revealedCards, previousRating);
    });
    section.append(reveal);
  }
  section.append(flashcardActions(previous, next));
  focusPoint.focus({ preventScroll: true });
  bindFlashcardKeyboard(section, {
    onReveal: isRevealed ? null : () => {
      revealedCards.add(index);
      renderFlashcard(section, cards, index, level, topic, options, revealedCards, previousRating);
    },
    onGrade: isRevealed ? gradeCard : null,
    onPrevious: index > 0 ? showPrevious : null,
  });
}

function renderDeckComplete(
  section: HTMLElement,
  cardCount: number,
  level: FocusLevel["level"],
  topic: FocusTopic,
  options: FocusViewOptions,
  lastRating?: FocusRatingReceipt,
  onUndoLastRating?: () => void,
): void {
  clearFlashcardKeyboard(section);
  const result = el("div", "result focus-deck-complete");
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  result.setAttribute("aria-atomic", "true");
  result.append(
    el("div", "question-type", `${level} · ${topic.label}`),
    el("h2", "focus-title", "Deck complete"),
    el("p", "prompt", `You reviewed all ${cardCount} cards in this deck.`),
  );
  const actions = el("div", "actions focus-deck-complete-actions");
  if (lastRating && onUndoLastRating) actions.append(focusReviewUndoNotice(lastRating, onUndoLastRating));
  const review = button("Review this deck again", "button primary");
  review.addEventListener("click", () => void renderFlashcards(section, level, topic, options));
  const chooseTopic = button("Choose another topic", "button");
  chooseTopic.addEventListener("click", () => void renderTopics(section, level, options));
  actions.append(review, chooseTopic);
  section.replaceChildren(result, actions);
}

function renderRetryError(
  section: HTMLElement,
  message: string,
  retryAction: () => void,
  contextLabel?: string,
): void {
  const error = el("p", "error", message);
  error.setAttribute("role", "alert");
  const retry = button("Try again", "button compact-button");
  retry.addEventListener("click", retryAction);
  const state = el("div", "load-error");
  if (contextLabel) state.append(el("div", "question-type", contextLabel));
  state.append(error, retry);
  section.replaceChildren(state);
}

function focusReviewActions(onGrade: (rating: FocusRating) => void): HTMLElement {
  const wrap = el("div", "actions focus-review-actions");
  for (const { rating, label, dueLabel, shortcut } of FOCUS_RATINGS) {
    const control = button("", `button focus-grade focus-grade-${rating}`);
    control.setAttribute("aria-keyshortcuts", shortcut);
    control.append(
      el("span", "focus-grade-label", label),
      el("span", "focus-grade-interval", dueLabel),
      el("kbd", "focus-grade-shortcut", shortcut),
    );
    control.addEventListener("click", () => onGrade(rating));
    wrap.append(control);
  }
  return wrap;
}

function focusReviewUndoNotice(
  receipt: FocusRatingReceipt,
  onUndo: () => void,
): HTMLElement {
  const notice = el("div", "focus-review-undo");
  const rating = FOCUS_RATINGS.find((item) => item.rating === receipt.rating);
  const message = el(
    "p",
    "focus-review-undo-message",
    `Rated ${rating?.label ?? "card"} · ${rating?.dueLabel.toLowerCase() ?? "schedule updated"}.`,
  );
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");
  const undo = button("Undo rating", "button focus-undo");
  undo.addEventListener("click", () => {
    if (!receipt.undo()) {
      message.textContent = "This rating is no longer available to undo.";
      undo.disabled = true;
      return;
    }
    onUndo();
  });
  notice.append(message, undo);
  return notice;
}

function revealAnswerButton(onReveal: () => void): HTMLButtonElement {
  const reveal = button("Show answer", "flashcard-reveal");
  reveal.setAttribute("aria-keyshortcuts", "Space");
  reveal.addEventListener("click", onReveal);
  return reveal;
}

function levelCard(level: FocusLevel, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option");
  const isEmpty = level.word_count === 0;
  card.disabled = isEmpty;
  card.setAttribute("aria-disabled", String(isEmpty));
  card.addEventListener("click", onClick);
  const metrics = el("span", "focus-option-metrics");
  metrics.append(
    focusOptionMetric("Topics", formatCount(level.topic_count, "topic", { zeroLabel: "No" })),
    focusOptionMetric("Words", isEmpty ? "No material available" : formatCount(level.word_count, "word")),
  );
  card.append(el("strong", "", level.level), metrics);
  return card;
}

function topicCard(topic: FocusTopic, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option topic-option");
  card.addEventListener("click", onClick);
  const metrics = el("span", "focus-option-metrics");
  metrics.append(focusOptionMetric("Words", formatCount(topic.word_count, "word", { zeroLabel: "No" })));
  card.append(el("strong", "", topic.label), metrics);
  return card;
}

function focusOptionMetric(label: string, value: string): HTMLElement {
  const metric = el("span", "focus-option-metric");
  metric.append(el("span", "focus-option-metric-label", label), el("span", "focus-option-metric-value", value));
  return metric;
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
