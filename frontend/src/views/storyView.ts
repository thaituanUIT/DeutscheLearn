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
  selections: Record<string, string>;
  results: Record<string, StoryQuestionResult> | null;
};

type StoryQuestionResult = StoryAnswer & {
  selected_answer_id: string;
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
    renderStoryPractice(section, { passage, selections: {}, results: null }, options);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load story");
  }
}

function renderStoryPractice(
  section: HTMLElement,
  session: StorySession,
  options: StoryViewOptions,
): void {
  if (session.passage.questions.length === 0) {
    const empty = el("div", "story-question-panel");
    empty.append(
      el("div", "question-type", "Reading"),
      el("h2", "focus-title", "No questions yet"),
      el("p", "prompt", "This passage is available to read, but it does not have questions yet."),
    );
    section.replaceChildren(storyPracticeLayout(session.passage, empty));
    return;
  }

  const isReviewed = session.results !== null;
  const answeredCount = Object.keys(session.selections).length;
  const score = session.results
    ? Object.values(session.results).filter((result) => result.correct).length
    : 0;

  const panel = el("div", "story-question-panel");
  const summary = el("div", "story-question-summary");
  summary.append(
    el("h2", "focus-title", "Questions"),
    el(
      "p",
      "story-score",
      isReviewed
        ? `${score} / ${session.passage.questions.length} correct`
        : `${answeredCount} / ${session.passage.questions.length} answered`,
    ),
  );
  panel.append(summary);

  const questions = el("div", "story-question-list");
  for (const [index, question] of session.passage.questions.entries()) {
    const selectedAnswerId = session.selections[question.id];
    const result = session.results?.[question.id];
    const block = el("div", "story-question-block");
    block.append(
      el("div", "question-type", `Question ${index + 1}`),
      el("h3", "story-question-title", question.prompt),
    );

    const answers = el("div", "story-answer-list");
    for (const answer of question.answers) {
      const classes = ["answer-option"];
      if (answer.id === selectedAnswerId) classes.push("selected-answer");
      if (result && answer.id === result.correct_answer_id) classes.push("correct-answer");
      if (result && answer.id === result.selected_answer_id && !result.correct) classes.push("wrong-answer");
      const option = button(answer.answer_text, classes.join(" "));
      option.disabled = isReviewed;
      option.addEventListener("click", () => {
        session.selections[question.id] = answer.id;
        renderStoryPractice(section, session, options);
      });
      answers.append(option);
    }
    block.append(answers);

    if (result) {
      const feedback = el("div", "story-feedback");
      feedback.append(
        el("div", "question-type", result.correct ? "Correct" : "Review"),
        el("p", "story-review-answer", result.correct_answer_text),
      );
      block.append(feedback);
      if (result.explanation) {
        block.append(el("p", "story-explanation", result.explanation));
      }
    }
    questions.append(block);
  }
  panel.append(questions);

  const controls = el("div", "story-question-controls");
  if (isReviewed) {
    const retry = button("Try again", "button primary");
    retry.addEventListener("click", () =>
      renderStoryPractice(section, { passage: session.passage, selections: {}, results: null }, options),
    );
    controls.append(retry);
  } else {
    const submit = button("Submit answers", "button primary");
    submit.disabled = answeredCount < session.passage.questions.length;
    submit.addEventListener("click", async () => {
      submit.disabled = true;
      submit.textContent = "Checking...";
      try {
        const results = await Promise.all(
          session.passage.questions.map(async (item) => {
            const selected = session.selections[item.id];
            const answer = await submitStoryAnswer(item.id, selected);
            return [item.id, { ...answer, selected_answer_id: selected }] as const;
          }),
        );
        session.results = Object.fromEntries(results);
        renderStoryPractice(section, session, options);
      } catch (error) {
        submit.disabled = false;
        submit.textContent = "Submit answers";
        options.onError(error instanceof Error ? error.message : "Could not submit answers");
      }
    });
    controls.append(submit);
  }
  panel.append(controls);
  section.replaceChildren(storyPracticeLayout(session.passage, panel));
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

function storyPracticeLayout(passage: StoryPassage, questionPanel: HTMLElement): HTMLElement {
  const layout = el("div", "story-practice-layout");
  layout.append(storyContent(passage), questionPanel);
  return layout;
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

function topicLabel(topic: string): string {
  return topic
    .split("_")
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}
