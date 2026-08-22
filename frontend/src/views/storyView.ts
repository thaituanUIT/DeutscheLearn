import {
  getStoryGroups,
  getStoryLevels,
  getStoryParts,
  getStoryPassage,
  getStoryPassages,
  submitStoryAnswer,
} from "../api/client";
import type {
  StoryAnswer,
  StoryGroup,
  StoryLevel,
  StoryPart,
  StoryPassage,
  StoryPassageSummary,
} from "../api/types";
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
  renderStoryGroups(section, options);
  return section;
}

async function renderStoryGroups(section: HTMLElement, options: StoryViewOptions): Promise<void> {
  section.className = "panel story-card";
  options.onBackChange(options.onBack);
  section.replaceChildren(el("p", "prompt", "Loading story topics..."));
  try {
    const groups = await getStoryGroups();
    const intro = el("div");
    intro.append(
      el("div", "question-type", "Story mode"),
      el("h2", "focus-title", "Choose a reading topic"),
    );

    const grid = el("div", "focus-grid story-group-grid");
    for (const group of groups) {
      grid.append(groupCard(group, () => renderStoryLevels(section, group.group, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load story topics");
  }
}

async function renderStoryLevels(
  section: HTMLElement,
  group: StoryGroup["group"],
  options: StoryViewOptions,
): Promise<void> {
  section.className = "panel story-card";
  options.onBackChange(() => renderStoryGroups(section, options));
  section.replaceChildren(el("p", "prompt", "Loading story levels..."));
  try {
    const levels = await getStoryLevels(group);
    const intro = el("div");
    intro.append(
      el("div", "question-type", groupLabel(group)),
      el("h2", "focus-title", "Choose a reading level"),
    );

    const grid = el("div", "focus-grid");
    for (const level of levels) {
      const onClick =
        group === "goethe"
          ? () => renderStoryParts(section, level.level, options)
          : () => renderStoryPassages(section, group, level.level, null, options);
      grid.append(levelCard(level, onClick, { disabledWhenEmpty: group === "general", itemLabel: itemLabel(group) }));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load story levels");
  }
}

async function renderStoryParts(
  section: HTMLElement,
  level: StoryLevel["level"],
  options: StoryViewOptions,
): Promise<void> {
  section.className = "panel story-card";
  options.onBackChange(() => renderStoryLevels(section, "goethe", options));
  section.replaceChildren(el("p", "prompt", "Loading Goethe parts..."));
  try {
    const parts = await getStoryParts(level);
    const intro = el("div");
    intro.append(
      el("div", "question-type", `Goethe-Institut · ${level}`),
      el("h2", "focus-title", "Choose a Teil"),
    );

    const grid = el("div", "focus-grid goethe-parts-grid");
    for (const part of parts) {
      grid.append(partCard(part, () => renderStoryPassages(section, "goethe", level, part.part, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not load Goethe parts");
  }
}

async function renderStoryPassages(
  section: HTMLElement,
  group: StoryGroup["group"],
  level: StoryLevel["level"],
  part: StoryPart["part"] | null,
  options: StoryViewOptions,
): Promise<void> {
  section.className = "panel story-card";
  options.onBackChange(() =>
    part ? renderStoryParts(section, level, options) : renderStoryLevels(section, group, options),
  );
  section.replaceChildren(el("p", "prompt", "Loading stories..."));
  try {
    const passages = await getStoryPassages(level, group, part ?? undefined);
    const intro = el("div");
    intro.append(
      el("div", "question-type", part ? `${groupLabel(group)} · ${level} · ${partLabel(part)}` : level),
      el("h2", "focus-title", group === "goethe" ? "Choose an Übung" : "Choose a story"),
    );

    const grid = el("div", "focus-grid topics-grid");
    for (const passage of passages) {
      grid.append(
        passageCard(passage, () => renderStoryReader(section, passage.id, group, level, part, options)),
      );
    }

    if (passages.length === 0) {
      section.replaceChildren(
        intro,
        el("p", "prompt", group === "goethe" ? "No Übungen are available here yet." : "No stories are available here yet."),
      );
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
  group: StoryGroup["group"],
  level: StoryLevel["level"],
  part: StoryPart["part"] | null,
  options: StoryViewOptions,
): Promise<void> {
  section.className = "panel story-card story-reader-card";
  options.onBackChange(() => renderStoryPassages(section, group, level, part, options));
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
  section.classList.toggle("goethe-reader-card", session.passage.group === "goethe");
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
  if (passage.group === "goethe" && passage.exercise_type === "source_choice") {
    return sourceChoiceContent(passage);
  }
  if (passage.group === "goethe" && passage.exercise_type === "true_false_notice") {
    return noticeContent(passage);
  }

  const content = el("article", "story-passage");
  content.append(
    el("div", "question-type", passage.topic ? `${passage.level} · ${topicLabel(passage.topic)}` : passage.level),
    el("h2", "story-title", passage.title),
    el("p", "story-text", passage.passage_text),
  );
  return content;
}

function sourceChoiceContent(passage: StoryPassage): HTMLElement {
  const content = el("article", "story-passage goethe-exercise source-choice-exercise");
  const data = asRecord(passage.content);
  const prompt = stringValue(data.prompt) || passage.passage_text;
  const sources = arrayValue(data.sources).map(asRecord).filter(Boolean);
  content.append(
    el("div", "question-type", `${passage.level} · ${partLabel(passage.part ?? "teil_2")}`),
    el("h2", "story-title", passage.title),
    el("p", "goethe-task-prompt", prompt),
  );

  const grid = el("div", "source-card-grid");
  sources.forEach((source, index) => {
    const card = el("section", "source-card");
    const header = el("div", "source-card-header");
    header.append(
      el("span", "source-pill", stringValue(source.id) || String.fromCharCode(97 + index)),
      el("strong", "", stringValue(source.title) || `Option ${index + 1}`),
    );
    const details = arrayValue(source.details)
      .map((item) => stringValue(item))
      .filter(Boolean);
    card.append(
      header,
      el("p", "source-subtitle", stringValue(source.subtitle)),
      detailList(details),
    );
    grid.append(card);
  });

  if (sources.length === 0) {
    grid.append(el("p", "story-text", passage.passage_text));
  }
  content.append(grid);
  return content;
}

function noticeContent(passage: StoryPassage): HTMLElement {
  const content = el("article", "story-passage goethe-exercise notice-exercise");
  const data = asRecord(passage.content);
  const notice = asRecord(data.notice);
  const tone = stringValue(notice.tone) || "info";
  const card = el("section", `notice-card notice-${tone}`);
  card.append(
    el("div", "notice-bar", stringValue(notice.label) || "Hinweis"),
    el("h3", "", stringValue(notice.headline) || passage.title),
    el("p", "", stringValue(notice.body) || passage.passage_text),
  );
  content.append(
    el("div", "question-type", `${passage.level} · ${partLabel(passage.part ?? "teil_3")}`),
    el("h2", "story-title", passage.title),
    card,
  );
  return content;
}

function detailList(items: string[]): HTMLElement {
  const list = el("ul", "source-detail-list");
  for (const item of items) {
    list.append(el("li", "", item));
  }
  return list;
}

function storyPracticeLayout(passage: StoryPassage, questionPanel: HTMLElement): HTMLElement {
  const layout = el(
    "div",
    passage.group === "goethe"
      ? "story-practice-layout goethe-practice-layout"
      : "story-practice-layout",
  );
  layout.append(storyContent(passage), questionPanel);
  return layout;
}

function groupCard(group: StoryGroup, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option story-group-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", group.label),
    el("span", "", group.group === "general" ? "A1, A2, B1, B2 stories" : "Exam-style reading practice"),
    el("span", "", `${group.passage_count} ${itemLabel(group.group)} · ${group.question_count} questions`),
  );
  return card;
}

function levelCard(
  level: StoryLevel,
  onClick: () => void,
  options: { disabledWhenEmpty: boolean; itemLabel: string },
): HTMLButtonElement {
  const card = button("", "focus-option");
  card.disabled = options.disabledWhenEmpty && level.passage_count === 0;
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", level.level),
    el("span", "", `${level.passage_count} ${options.itemLabel}`),
    el("span", "", `${level.question_count} questions`),
  );
  return card;
}

function partCard(part: StoryPart, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option goethe-part-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", part.label),
    el("span", "", `${part.passage_count} Übungen`),
    el("span", "", `${part.question_count} questions`),
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

function groupLabel(group: StoryGroup["group"]): string {
  return group === "goethe" ? "Goethe-Institut" : "General";
}

function itemLabel(group: StoryGroup["group"]): string {
  return group === "goethe" ? "Übungen" : "stories";
}

function partLabel(part: StoryPart["part"]): string {
  return part.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function topicLabel(topic: string): string {
  return topic
    .split("_")
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}
