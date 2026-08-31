import {
  submitStoryAnswer,
} from "../api/client";
import {
  getCachedStoryPassages,
  getStoryCorpus,
  storyGroupsFromCorpus,
  storyLevelsFromCorpus,
  storyPartsFromCorpus,
  storyPassageFromCorpus,
  storyPassageSummariesFromCorpus,
} from "../api/queryClient";
import type {
  GrammarPassageContext,
  GrammarWrongAnswerContext,
} from "../components/grammarWidget";
import { readingText } from "../components/readingText";
import type {
  StoryAnswer,
  StoryGroup,
  StoryLevel,
  StoryPart,
  StoryPassage,
  StoryPassageSummary,
} from "../api/types";
import { button } from "../components/button";
import { stimulusInstruction, stimulusRenderer, type StimulusViewModel } from "../stimuli/templates";
import { el } from "../utils/dom";
import { formatCount } from "../utils/format";

type StoryViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
  onError: (message: string) => void;
  onGrammarContextChange: (context: {
    passage?: GrammarPassageContext | null;
    wrongAnswer?: GrammarWrongAnswerContext | null;
  }) => void;
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
  options.onGrammarContextChange({ passage: null, wrongAnswer: null });
  options.onBackChange(options.onBack);
  section.replaceChildren(el("p", "prompt", "Loading story topics..."));
  try {
    const groups = storyGroupsFromCorpus(await getStoryCorpus());
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
  options.onGrammarContextChange({ passage: null, wrongAnswer: null });
  options.onBackChange(() => renderStoryGroups(section, options));
  section.replaceChildren(el("p", "prompt", "Loading story levels..."));
  try {
    const levels = storyLevelsFromCorpus(await getStoryCorpus(), group);
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
      grid.append(levelCard(level, onClick, { disabledWhenEmpty: group === "general", group }));
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
  options.onGrammarContextChange({ passage: null, wrongAnswer: null });
  options.onBackChange(() => renderStoryLevels(section, "goethe", options));
  section.replaceChildren(el("p", "prompt", "Loading Goethe parts..."));
  try {
    const parts = storyPartsFromCorpus(await getStoryCorpus(), level);
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
  options.onGrammarContextChange({ passage: null, wrongAnswer: null });
  options.onBackChange(() =>
    part ? renderStoryParts(section, level, options) : renderStoryLevels(section, group, options),
  );
  const intro = storyPassagesIntro(group, level, part);
  const hasPreviousList = section.querySelector(".topics-grid") !== null;
  if (!getCachedStoryPassages()) {
    if (hasPreviousList) {
      section.classList.add("story-list-updating");
    } else {
      section.replaceChildren(intro, passageSkeletonGrid());
    }
  }
  try {
    const passages = storyPassageSummariesFromCorpus(await getStoryCorpus(), group, level, part);
    section.classList.remove("story-list-updating");

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
    const passage = storyPassageFromCorpus(await getStoryCorpus(), passageId);
    if (!passage) throw new Error("Story passage not found");
    options.onGrammarContextChange({
      passage: { title: passage.title, text: passage.passage_text },
      wrongAnswer: null,
    });
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
  if (isReviewed) {
    options.onGrammarContextChange({ wrongAnswer: firstWrongAnswerContext(session) });
  } else {
    options.onGrammarContextChange({ wrongAnswer: null });
  }
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
    readingText(passage.passage_text),
  );
  return content;
}

function sourceChoiceContent(passage: StoryPassage): HTMLElement {
  const content = el("article", "story-passage goethe-exercise source-choice-exercise");
  const sources = passage.questions[0]?.answers
    .map((answer) => answer.ref_stimulus)
    .filter((source) => source !== null) ?? [];
  const instruction = stimulusInstruction(sources[0] ?? {
    render_kind: "ad_box",
    content: null,
  });
  content.append(
    el("div", "question-type", `${passage.level} · ${partLabel(passage.part ?? "teil_2")}`),
    el("h2", "story-title", passage.title),
    el("p", "goethe-task-prompt", instruction || passage.passage_text),
  );

  const grid = el("div", "source-card-grid");
  sources.forEach((source, index) => {
    const wrap = el("section", "source-card");
    wrap.append(
      el("span", "source-pill", String.fromCharCode(97 + index)),
      stimulusRenderer(source),
    );
    grid.append(wrap);
  });

  if (sources.length === 0) {
    grid.append(readingText(passage.passage_text));
  }
  content.append(grid);
  return content;
}

function noticeContent(passage: StoryPassage): HTMLElement {
  const content = el("article", "story-passage goethe-exercise notice-exercise");
  content.append(
    el("div", "question-type", `${passage.level} · ${partLabel(passage.part ?? "teil_3")}`),
    el("h2", "story-title", passage.title),
    stimulusRenderer(stimulusFromPassage(passage)),
  );
  return content;
}

function stimulusFromPassage(passage: StoryPassage): StimulusViewModel {
  return {
    title: passage.title,
    body: passage.passage_text,
    context_label: passage.context_label,
    render_kind: passage.render_kind,
    content: passage.content,
    image_url: passage.image_url,
    image_path: passage.image_path,
    transcript: passage.transcript,
  };
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

function firstWrongAnswerContext(session: StorySession): GrammarWrongAnswerContext | null {
  if (!session.results) return null;
  for (const question of session.passage.questions) {
    const result = session.results[question.id];
    if (!result || result.correct) continue;
    const selected = question.answers.find((answer) => answer.id === result.selected_answer_id);
    if (!selected) continue;
    return {
      question: question.prompt,
      learnerAnswer: selected.answer_text,
    };
  }
  return null;
}

function groupCard(group: StoryGroup, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option story-group-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", group.label),
    el("span", "", group.group === "general" ? "A1, A2, B1, B2 stories" : "Exam-style reading practice"),
    el("span", "", `${formatStoryItemCount(group.passage_count, group.group)} · ${formatCount(group.question_count, "question", { zeroLabel: "No" })}`),
  );
  return card;
}

function levelCard(
  level: StoryLevel,
  onClick: () => void,
  options: { disabledWhenEmpty: boolean; group: StoryGroup["group"] },
): HTMLButtonElement {
  const card = button("", "focus-option");
  card.disabled = options.disabledWhenEmpty && level.passage_count === 0;
  card.setAttribute("aria-disabled", String(card.disabled));
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", level.level),
    el("span", "", formatStoryItemCount(level.passage_count, options.group, { zeroLabel: "No" })),
    el("span", "", card.disabled ? "No material has been added yet." : formatCount(level.question_count, "question", { zeroLabel: "No" })),
  );
  return card;
}

function partCard(part: StoryPart, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option goethe-part-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", part.label),
    el("span", "", formatCount(part.passage_count, "Übung", { plural: "Übungen", zeroLabel: "No" })),
    el("span", "", formatCount(part.question_count, "question", { zeroLabel: "No" })),
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
    el("span", "", passage.question_count === 0 ? "No questions yet" : formatCount(passage.question_count, "question")),
  );
  return card;
}

function storyPassagesIntro(
  group: StoryGroup["group"],
  level: StoryLevel["level"],
  part: StoryPart["part"] | null,
): HTMLElement {
  const intro = el("div");
  intro.append(
    el("div", "question-type", part ? `${groupLabel(group)} · ${level} · ${partLabel(part)}` : level),
    el("h2", "focus-title", group === "goethe" ? "Choose an Übung" : "Choose a story"),
  );
  return intro;
}

function passageSkeletonGrid(): HTMLElement {
  const grid = el("div", "focus-grid topics-grid story-skeleton-grid");
  for (let index = 0; index < 4; index += 1) {
    const card = el("div", "focus-option topic-option story-option passage-card-skeleton");
    card.append(
      el("span", "skeleton-line skeleton-title"),
      el("span", "skeleton-line skeleton-meta"),
      el("span", "skeleton-line skeleton-meta short"),
    );
    grid.append(card);
  }
  return grid;
}

function groupLabel(group: StoryGroup["group"]): string {
  return group === "goethe" ? "Goethe-Institut" : "General";
}

function formatStoryItemCount(
  count: number,
  group: StoryGroup["group"],
  options: { zeroLabel?: string } = {},
): string {
  if (group === "goethe") return formatCount(count, "Übung", { plural: "Übungen", ...options });
  return formatCount(count, "story", options);
}

function partLabel(part: StoryPart["part"]): string {
  return part.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function topicLabel(topic: string): string {
  return topic
    .split("_")
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}
