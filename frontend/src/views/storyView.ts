import "../styles/views/story.css";
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
import { goethePartLabel, partLabel } from "../goethe/readingSpecs";
import { getPlayer } from "../state/playerStore";
import { addStoryMistakes, recordStoryComplete, loadStoryDraft, saveStoryDraft, isStoryCompleted } from "../state/progressStore";
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
  onChooseAnother: () => void;
  completionSaved?: boolean;
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
      el("h2", "focus-title", "Choose reading or exam practice"),
    );

    const grid = el("div", "focus-grid story-group-grid");
    for (const group of groups) {
      grid.append(groupCard(group, () => renderStoryLevels(section, group.group, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    renderRetryError(section, error instanceof Error ? error.message : "Could not load story topics", () =>
      renderStoryGroups(section, options),
    );
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
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load story levels",
      () => renderStoryLevels(section, group, options),
      groupLabel(group),
    );
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
      el("h2", "focus-title", "Choose a part"),
    );

    const grid = el("div", "focus-grid goethe-parts-grid");
    for (const part of parts) {
      grid.append(partCard(part, level, () => renderStoryPassages(section, "goethe", level, part.part, options)));
    }

    section.replaceChildren(intro, grid);
  } catch (error) {
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load Goethe parts",
      () => renderStoryParts(section, level, options),
      `Goethe-Institut · ${level}`,
    );
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
        el("p", "prompt", group === "goethe" ? "No exercises are available here yet." : "No stories are available here yet."),
      );
      return;
    }
    section.replaceChildren(intro, grid);
  } catch (error) {
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load stories",
      () => renderStoryPassages(section, group, level, part, options),
      part
        ? `${groupLabel(group)} · ${level} · ${learnerPartLabel(goethePartLabel(level, part))}`
        : `${groupLabel(group)} · ${level}`,
    );
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
    const player = getPlayer();
    const draft = player ? loadStoryDraft(player.player_id, passage) : null;
    options.onGrammarContextChange({
      passage: { title: passage.title, text: passage.passage_text },
      wrongAnswer: null,
    });
    renderStoryPractice(section, { passage, selections: draft?.selections ?? {}, results: null,
      onChooseAnother: () => renderStoryPassages(section, group, level, part, options),
    }, options);
  } catch (error) {
    renderRetryError(
      section,
      error instanceof Error ? error.message : "Could not load story",
      () => renderStoryReader(section, passageId, group, level, part, options),
      part
        ? `${groupLabel(group)} · ${level} · ${learnerPartLabel(goethePartLabel(level, part))}`
        : `${groupLabel(group)} · ${level}`,
    );
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
    el("h2", "focus-title", isReviewed ? `Results: ${score} / ${session.passage.questions.length} correct` : "Questions"),
    el(
      "p",
      "story-score",
      isReviewed
        ? `${score} / ${session.passage.questions.length} correct`
        : `${answeredCount} / ${session.passage.questions.length} answered`,
    ),
  );
  panel.append(summary);

  const status = summary.querySelector(".story-score")!;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const guidance = el("p", "story-score", "Answer every question, then submit to complete this reading.");
  summary.append(guidance);
  const storageNotice = el("p", "story-score", session.completionSaved === false
    ? "Answers submitted. Completion could not be saved on this device."
    : !isReviewed && answeredCount > 0 ? "Draft restored. Continue where you left off." : "");
  storageNotice.setAttribute("role", "status");
  let submitting = false;
  const inputs: HTMLInputElement[] = [];
  const questions = el("div", "story-question-list");
  const submit = button("Submit answers", "button primary");
  submit.disabled = answeredCount < session.passage.questions.length;
  for (const [index, question] of session.passage.questions.entries()) {
    const result = session.results?.[question.id];
    const block = el("fieldset", "story-question-block");
    const legend = el("legend", "story-question-title", `${index + 1}. ${question.prompt}`);
    legend.lang = "de";
    block.append(legend);
    const answers = el("div", "story-answer-list");
    for (const answer of question.answers) {
      const label = el("label", "answer-option story-answer-option");
      label.classList.toggle("selected-answer", answer.id === session.selections[question.id]);
      label.classList.toggle("correct-answer", !!result && answer.id === result.correct_answer_id);
      label.classList.toggle("wrong-answer", !!result && !result.correct && answer.id === result.selected_answer_id);
      const input = el("input");
      input.type = "radio";
      input.name = `story-${session.passage.id}-${question.id}`;
      input.value = answer.id;
      input.checked = answer.id === session.selections[question.id];
      input.disabled = isReviewed;
      inputs.push(input);
      const text = el("span", "", answer.answer_text);
      text.lang = "de";
      label.append(input, text);
      input.addEventListener("change", () => {
        if (submitting || isReviewed) return;
        session.selections[question.id] = answer.id;
        for (const choice of answers.querySelectorAll("label")) {
          choice.classList.toggle("selected-answer", choice.querySelector("input")!.checked);
        }
        const count = Object.keys(session.selections).length;
        status.textContent = `${count} / ${session.passage.questions.length} answered`;
        submit.disabled = count < session.passage.questions.length;
        const player = getPlayer();
        const saved = player && saveStoryDraft(player.player_id, session.passage, session.selections);
        storageNotice.textContent = saved ? "Draft saved on this device." : "Draft could not be saved. Keep this page open to retain your answers.";
      });
      answers.append(label);
    }
    block.append(answers);
    if (result) {
      const feedback = el("div", "story-feedback");
      feedback.append(el("strong", "", result.correct ? "Correct" : "Incorrect"));
      if (!result.correct) {
        const correct = el("p", "story-review-answer", `Correct answer: ${result.correct_answer_text}`);
        feedback.append(correct);
      }
      if (result.explanation) feedback.append(el("p", "story-explanation", result.explanation));
      block.append(feedback);
    }
    questions.append(block);
  }
  panel.append(questions);
  const controls = el("div", "story-question-controls");
  const inlineError = el("p", "error");
  inlineError.setAttribute("role", "alert");
  if (isReviewed) {
    guidance.textContent = "Reading completed. Review your answers or choose another reading.";
    const another = button("Choose another reading", "button primary");
    another.addEventListener("click", session.onChooseAnother);
    const retry = button("Try again", "button");
    retry.addEventListener("click", () => {
      renderStoryPractice(section, { ...session, selections: {}, results: null, completionSaved: undefined }, options);
    });
    controls.append(another, retry);
  } else {
    submit.addEventListener("click", async () => {
      if (submitting || submit.disabled) return;
      submitting = true;
      const submitted = { ...session.selections };
      inputs.forEach((input) => { input.disabled = true; });
      submit.disabled = true;
      submit.textContent = "Checking…";
      panel.setAttribute("aria-busy", "true");
      inlineError.textContent = "";
      try {
        const results = await Promise.all(session.passage.questions.map(async (item) => {
          const selected = submitted[item.id];
          const answer = await submitStoryAnswer(item.id, selected);
          return [item.id, { ...answer, selected_answer_id: selected }] as const;
        }));
        session.results = Object.fromEntries(results);
        const player = getPlayer();
        if (player) {
          session.completionSaved = recordStoryComplete(player.player_id, session.passage, submitted);
        }
        recordStoryMistakes(session);
        // The learner may have navigated away while the request was pending.
        if (!section.contains(panel)) return;
        renderStoryPractice(section, session, options);
      } catch {
        if (!section.contains(panel)) return;
        submitting = false;
        inputs.forEach((input) => { input.disabled = false; });
        submit.disabled = false;
        submit.textContent = "Submit answers";
        panel.removeAttribute("aria-busy");
        inlineError.textContent = "Could not check your answers. Your selections are retained; submit again to retry.";
      }
    });
    controls.append(submit);
  }
  summary.append(storageNotice);
  controls.append(inlineError);
  panel.append(controls);
  const existing = section.querySelector(".story-question-panel");
  if (existing) {
    existing.replaceWith(panel);
  } else {
    section.replaceChildren(storyPracticeLayout(session.passage, panel));
  }
  if (isReviewed) {
    const layout = panel.closest<HTMLElement>(".story-practice-layout")!;
    layout.dataset.readerView = "questions";
    layout.querySelectorAll(".story-mobile-switch button").forEach((control, index) => {
      control.setAttribute("aria-pressed", String(index === 1));
    });
    const heading = summary.querySelector("h2")!;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function recordStoryMistakes(session: StorySession): void {
  if (!session.results) return;
  const player = getPlayer();
  if (!player) return;
  const mistakes = session.passage.questions.flatMap((question) => {
    const result = session.results?.[question.id];
    if (!result || result.correct) return [];
    const selected = question.answers.find((answer) => answer.id === result.selected_answer_id);
    if (!selected) return [];
    return [{
      prompt: question.prompt,
      selected: selected.answer_text,
      correct: result.correct_answer_text,
    }];
  });
  addStoryMistakes(player.player_id, mistakes);
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
    el("div", "question-type", `${passage.level} · ${learnerPartLabel(partLabel(passage.part ?? "teil_2"))}`),
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
    el("div", "question-type", `${passage.level} · ${learnerPartLabel(partLabel(passage.part ?? "teil_3"))}`),
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
  const content = storyContent(passage);
  content.lang = "de";
  layout.dataset.readerView = "passage";
  const switcher = el("div", "story-mobile-switch");
  switcher.setAttribute("aria-label", "Reading view");
  const read = button("Read passage", "button compact-button");
  const answer = button("Questions", "button compact-button");
  read.setAttribute("aria-pressed", "true");
  answer.setAttribute("aria-pressed", "false");
  const choose = (view: string) => {
    layout.dataset.readerView = view;
    read.setAttribute("aria-pressed", String(view === "passage"));
    answer.setAttribute("aria-pressed", String(view === "questions"));
  };
  read.addEventListener("click", () => choose("passage"));
  answer.addEventListener("click", () => choose("questions"));
  switcher.append(read, answer);
  layout.append(switcher, content, questionPanel);
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
      correctAnswer: result.correct_answer_text,
      mode: "story",
    };
  }
  return null;
}

function groupCard(group: StoryGroup, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option story-group-option");
  card.addEventListener("click", onClick);
  card.append(
    storyChoiceTitle(group.label, group.group === "general" ? "A1, A2, B1, B2 stories" : "Exam-style reading practice"),
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

function partCard(part: StoryPart, level: StoryLevel["level"], onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option goethe-part-option");
  card.addEventListener("click", onClick);
  card.append(
    el("strong", "", learnerPartLabel(goethePartLabel(level, part.part))),
    el("span", "", formatCount(part.passage_count, "exercise", { plural: "exercises", zeroLabel: "No" })),
    el("span", "", formatCount(part.question_count, "question", { zeroLabel: "No" })),
  );
  return card;
}

function passageCard(passage: StoryPassageSummary, onClick: () => void): HTMLButtonElement {
  const card = button("", "focus-option topic-option story-option");

  card.addEventListener("click", onClick);
  card.append(
    storyChoiceTitle(passage.title, passage.topic ? topicLabel(passage.topic) : "General"),
    el("span", "", passage.question_count === 0 ? "No questions yet" : formatCount(passage.question_count, "question")),
  );
  const player = getPlayer();
  if (player) {
    const fullPassage = storyPassageFromCorpus(getCachedStoryPassages() ?? [], passage.id);
    if (fullPassage && loadStoryDraft(player.player_id, fullPassage)) card.append(el("span", "", "Continue draft"));
    else if (isStoryCompleted(player.player_id, passage.id)) card.append(el("span", "", "Completed"));
  }
  return card;
}

function storyChoiceTitle(title: string, description: string): HTMLElement {
  const content = el("span", "story-choice-title");
  content.append(el("strong", "", title), el("span", "", description));
  return content;
}

function storyPassagesIntro(
  group: StoryGroup["group"],
  level: StoryLevel["level"],
  part: StoryPart["part"] | null,
): HTMLElement {
  const intro = el("div");
  intro.append(
    el("div", "question-type", part ? `${groupLabel(group)} · ${level} · ${learnerPartLabel(goethePartLabel(level, part))}` : level),
    el("h2", "focus-title", group === "goethe" ? "Choose an exercise" : "Choose a story"),
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
  if (group === "goethe") return formatCount(count, "exercise", { plural: "exercises", ...options });
  return formatCount(count, "story", options);
}

function learnerPartLabel(label: string): string {
  return label.replace(/^Teil\b/, "Part");
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

function topicLabel(topic: string): string {
  return topic
    .split("_")
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}
