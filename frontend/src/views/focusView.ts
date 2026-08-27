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
import { el } from "../utils/dom";

type FocusViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
  onError: (message: string) => void;
};

export function focusView(options: FocusViewOptions): HTMLElement {
  const section = el("section", "panel focus-card");
  renderLevels(section, options);
  return section;
}

async function renderLevels(section: HTMLElement, options: FocusViewOptions): Promise<void> {
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

  section.append(content, answers);
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
): void {
  section.replaceChildren();
  if (cards.length === 0) {
    section.append(el("p", "prompt", "No cards available for this topic yet."));
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

  const previous = button("Previous", "button flashcard-previous");
  previous.disabled = index === 0;
  previous.addEventListener("click", () => renderFlashcard(section, cards, index - 1, level, topic, options));
  const quiz = button("Quiz", "button");
  quiz.addEventListener("click", () => renderRevision(section, level, topic, options));
  const next = button("Next", "button primary flashcard-next");
  next.disabled = index === cards.length - 1;
  next.addEventListener("click", () => renderFlashcard(section, cards, index + 1, level, topic, options));

  section.append(content, flashcardActions(previous, next, quiz));
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

function cardActions(...nodes: HTMLElement[]): HTMLElement {
  const wrap = el("div", nodes.length === 1 ? "actions centered-actions" : "actions");
  wrap.append(...nodes);
  return wrap;
}

function flashcardActions(previous: HTMLElement, next: HTMLElement, quiz: HTMLElement): HTMLElement {
  const wrap = el("div", "actions flashcard-actions");
  wrap.append(previous, next, quiz);
  return wrap;
}
