import { getStoryLevels, getStoryPassage, getStoryPassages, submitStoryAnswer } from "../api/client";
import type { StoryAnswer, StoryLevel, StoryPassage, StoryPassageSummary } from "../api/types";
import { button } from "../components/button";
import { el } from "../utils/dom";

type StoryViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
  onError: (message: string) => void;
};

type StorySession = {
  passage: StoryPassage;
  index: number;
  score: number;
};

export function storyView(options: StoryViewOptions): HTMLElement {
  const section = el("section", "panel story-card");
  renderStoryLevels(section, options);
  return section;
}

async function renderStoryLevels(section: HTMLElement, options: StoryViewOptions): Promise<void> {
  options.onBackChange(options.onBack);
  section.replaceChildren(el("p", "prompt", "Loading story levels..."));
  try {
    const levels = await getStoryLevels();
    const intro = el("div");
    intro.append(
      el("div", "question-type", "Story mode"),
      el("h2", "focus-title", "Choose a reading level"),
    );

    const grid = el("div", "focus-grid");
    for (const level of levels) {
      grid.append(levelCard(level, () => renderStoryPassages(section, level.level, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load story levels");
  }
}

async function renderStoryPassages(
  section: HTMLElement,
  level: StoryLevel["level"],
  options: StoryViewOptions,
): Promise<void> {
  options.onBackChange(() => renderStoryLevels(section, options));
  section.replaceChildren(el("p", "prompt", "Loading stories..."));
  try {
    const passages = await getStoryPassages(level);
    const intro = el("div");
    intro.append(
      el("div", "question-type", level),
      el("h2", "focus-title", "Choose a story"),
    );

    const grid = el("div", "focus-grid topics-grid");
    for (const passage of passages) {
      grid.append(passageCard(passage, () => renderStoryReader(section, passage.id, level, options)));
    }

    if (passages.length === 0) {
      section.replaceChildren(el("p", "prompt", "No stories are available for this level yet."));
      return;
    }
    section.replaceChildren(intro, grid);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load stories");
  }
}

async function renderStoryReader(
  section: HTMLElement,
  passageId: string,
  level: StoryLevel["level"],
  options: StoryViewOptions,
): Promise<void> {
  options.onBackChange(() => renderStoryPassages(section, level, options));
  section.replaceChildren(el("p", "prompt", "Loading story..."));
  try {
    const passage = await getStoryPassage(passageId);
    renderReader(section, passage, () => renderStoryQuestion(section, { passage, index: 0, score: 0 }, options));
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load story");
  }
}

function renderReader(section: HTMLElement, passage: StoryPassage, onStart: () => void): void {
  const content = storyContent(passage);
  const start = button(passage.questions.length ? "Start questions" : "No questions yet", "button primary");
  start.disabled = passage.questions.length === 0;
  start.addEventListener("click", onStart);
  section.replaceChildren(content, centeredActions(start));
}

function renderStoryQuestion(
  section: HTMLElement,
  session: StorySession,
  options: StoryViewOptions,
): void {
  const question = session.passage.questions[session.index];
  if (!question) {
    renderStoryResult(section, session, options);
    return;
  }

  const content = el("div", "story-question");
  content.append(
    el("div", "question-type", `${session.passage.level} · ${session.index + 1} / ${session.passage.questions.length}`),
    el("h2", "focus-title", question.prompt),
    el("p", "story-score", `${session.score} correct`),
  );

  const answers = el("div", "answers revision-answers");
  for (const answer of question.answers) {
    const option = button(answer.answer_text, "answer-option");
    option.addEventListener("click", async () => {
      setAnswersDisabled(answers, true);
      try {
        const result = await submitStoryAnswer(question.id, answer.id);
        renderStoryFeedback(section, session, result, options);
      } catch (error) {
        setAnswersDisabled(answers, false);
        options.onError(error instanceof Error ? error.message : "Could not submit answer");
      }
    });
    answers.append(option);
  }

  section.replaceChildren(storyContent(session.passage), content, answers);
}

function renderStoryFeedback(
  section: HTMLElement,
  session: StorySession,
  result: StoryAnswer,
  options: StoryViewOptions,
): void {
  const nextSession = {
    ...session,
    index: session.index + 1,
    score: session.score + (result.correct ? 1 : 0),
  };
  const content = el("div", "story-question");
  content.append(
    el("div", "question-type", result.correct ? "Correct" : "Review"),
    el("h2", "focus-title", result.correct ? "Nice reading" : "Correct answer"),
    el("p", "meaning-overview", result.correct_answer_text),
  );
  if (!result.correct) {
    content.append(el("p", "prompt", "Check the passage again before moving on."));
  }
  if (result.explanation) {
    content.append(el("p", "story-explanation", result.explanation));
  }

  const next = button(nextSession.index >= session.passage.questions.length ? "Finish" : "Next", "button primary");
  next.addEventListener("click", () => renderStoryQuestion(section, nextSession, options));
  section.replaceChildren(storyContent(session.passage), content, centeredActions(next));
}

function renderStoryResult(
  section: HTMLElement,
  session: StorySession,
  options: StoryViewOptions,
): void {
  const result = el("div", "result revision-result");
  result.append(
    el("div", "question-type", "Story complete"),
    el("h2", "", `${session.score} / ${session.passage.questions.length}`),
    el("p", "prompt", session.passage.title),
  );
  const reread = button("Read again", "button primary");
  reread.addEventListener("click", () =>
    renderReader(section, session.passage, () =>
      renderStoryQuestion(section, { passage: session.passage, index: 0, score: 0 }, options),
    ),
  );
  section.replaceChildren(result, centeredActions(reread));
}

function storyContent(passage: StoryPassage): HTMLElement {
  const content = el("article", "story-passage");
  content.append(
    el("div", "question-type", passage.topic ? `${passage.level} · ${topicLabel(passage.topic)}` : passage.level),
    el("h2", "story-title", passage.title),
    el("p", "story-text", passage.passage_text),
  );
  return content;
}

function levelCard(level: StoryLevel, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option");
  card.disabled = level.passage_count === 0;
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", level.level),
    el("span", "", `${level.passage_count} stories`),
    el("span", "", `${level.question_count} questions`),
  );
  return card;
}

function passageCard(passage: StoryPassageSummary, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option topic-option story-option");
  card.disabled = passage.question_count === 0;
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", passage.title),
    el("span", "", passage.topic ? topicLabel(passage.topic) : "General"),
    el("span", "", `${passage.question_count} questions`),
  );
  return card;
}

function centeredActions(...nodes: HTMLElement[]): HTMLElement {
  const wrap = el("div", "actions centered-actions");
  wrap.append(...nodes);
  return wrap;
}

function setAnswersDisabled(host: HTMLElement, disabled: boolean): void {
  for (const option of host.querySelectorAll<HTMLButtonElement>(".answer-option")) {
    option.disabled = disabled;
  }
}

function topicLabel(topic: string): string {
  return topic
    .split("_")
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}
