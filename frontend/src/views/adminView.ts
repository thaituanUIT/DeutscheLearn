import {
  createAdminReadingPassage,
  createAdminWord,
  deleteAdminReadingPassage,
  deleteAdminWord,
  getAdminReadingPassage,
  getAdminReadingPassages,
  getAdminWords,
  getFocusTopicAliases,
  updateAdminReadingPassage,
  updateAdminWord,
} from "../api/client";
import type {
  AdminFocusEntry,
  AdminReadingAdStimulus,
  AdminReadingPassage,
  AdminReadingQuestion,
  AdminReadingPassageSummary,
  AdminWord,
  FocusTopicAlias,
} from "../api/types";
import { button } from "../components/button";
import { clear, el } from "../utils/dom";

const ADMIN_TOKEN_KEY = "recognition_admin_token";
const LEVELS = ["A1", "A2", "B1", "B2"] as const;
const READING_GROUPS = ["general", "goethe"] as const;
const GOETHE_PARTS = ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"] as const;

type AdminLevel = (typeof LEVELS)[number];
type AdminReadingGroup = (typeof READING_GROUPS)[number];
type AdminGoethePart = (typeof GOETHE_PARTS)[number];
type ReadingShape =
  | "general_free_form"
  | "goethe_true_false_text"
  | "goethe_source_choice"
  | "goethe_true_false_notice"
  | "goethe_standard";

const READING_SHAPE_TABLE: Record<AdminReadingGroup, Partial<Record<AdminLevel, Partial<Record<AdminGoethePart, ReadingShape>>>>> = {
  general: {},
  goethe: {
    A1: {
      teil_1: "goethe_true_false_text",
      teil_2: "goethe_source_choice",
      teil_3: "goethe_true_false_notice",
    },
    A2: {
      teil_1: "goethe_true_false_text",
      teil_2: "goethe_source_choice",
      teil_3: "goethe_true_false_notice",
    },
    B1: { teil_1: "goethe_standard" },
    B2: { teil_1: "goethe_standard" },
  },
};

export function renderAdminApp(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token")?.trim();
  if (urlToken) {
    localStorage.setItem(ADMIN_TOKEN_KEY, urlToken);
    window.history.replaceState({}, "", "/admin");
  }

  const token = localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  clear(root);
  const shell = el("div", "shell admin-shell");
  shell.append(adminHeader(token), token ? adminWorkspace(token) : adminMissingToken());
  root.append(shell);
}

function adminHeader(token: string): HTMLElement {
  const header = el("header", "topbar");
  header.append(el("h1", "brand", "Admin"));
  if (token) {
    const clearToken = button("Clear token", "button");
    clearToken.addEventListener("click", () => {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      window.location.reload();
    });
    header.append(clearToken);
  }
  return header;
}

function adminMissingToken(): HTMLElement {
  const panel = el("section", "panel admin-panel");
  panel.append(
    el("h2", "focus-title", "Admin token required"),
    el("p", "prompt", "Open this page with /admin?token=your-secret-token."),
  );
  return panel;
}

function adminWorkspace(token: string): HTMLElement {
  const panel = el("section", "panel admin-panel");
  const host = el("div", "admin-host");
  let activeTab: "words" | "reading" = "words";

  const showWords = (): void => {
    activeTab = "words";
    renderWordsAdmin(host, token);
  };
  const showReading = (): void => {
    activeTab = "reading";
    renderReadingAdmin(host, token);
  };

  const tabs = segmentedControl({
    label: "Admin section",
    value: activeTab,
    options: [
      { value: "words", label: "Vocabulary" },
      { value: "reading", label: "Reading" },
    ],
    onChange: (value) => {
      if (value === "words") showWords();
      else showReading();
    },
  });
  panel.append(tabs, host);
  showWords();
  return panel;
}

function renderWordsAdmin(host: HTMLElement, token: string): void {
  const state = {
    words: [] as AdminWord[],
    selected: emptyWord(),
    isNew: true,
    search: "",
  };

  const wrap = el("div", "admin-grid");
  const listPanel = el("div", "admin-list");
  const editor = el("div", "admin-editor");
  wrap.append(listPanel, editor);
  host.replaceChildren(wrap);

  const reload = async (): Promise<void> => {
    listPanel.replaceChildren(el("p", "prompt", "Loading words..."));
    try {
      state.words = await getAdminWords(token, { search: state.search.trim() });
      renderWordList(listPanel, state, renderEditor, reload);
    } catch (error) {
      listPanel.replaceChildren(adminError(error));
    }
  };

  const renderEditor = (): void => {
    renderWordEditor(editor, token, state, async () => {
      await reload();
      renderEditor();
    });
  };

  renderEditor();
  void reload();
}

function renderWordList(
  host: HTMLElement,
  state: { words: AdminWord[]; selected: AdminWord; isNew: boolean; search: string },
  onSelect: () => void,
  onSearch: () => Promise<void>,
): void {
  let searchTimer: number | undefined;
  const newButton = button("New word", "button primary");
  newButton.addEventListener("click", () => {
    state.selected = emptyWord();
    state.isNew = true;
    onSelect();
  });

  const search = input("Search words", state.search);
  search.autocomplete = "off";
  search.addEventListener("input", () => {
    state.search = search.value;
    if (searchTimer !== undefined) {
      window.clearTimeout(searchTimer);
    }
    searchTimer = window.setTimeout(() => {
      void onSearch();
    }, 250);
  });

  const clearSearch = button("Clear", "button compact-button");
  clearSearch.disabled = !state.search.trim();
  clearSearch.addEventListener("click", () => {
    state.search = "";
    void onSearch();
  });

  const controls = el("div", "admin-list-controls");
  controls.append(search, clearSearch);

  const list = el("div", "admin-items");
  for (const word of state.words) {
    const item = button("", "admin-item");
    item.append(
      el("strong", "", word.article ? `${word.article} ${word.word}` : word.word),
      el("span", "", `${word.part_of_speech} · ${word.focus_entries.length} focus entries`),
    );
    item.addEventListener("click", () => {
      state.selected = cloneWord(word);
      state.isNew = false;
      onSelect();
    });
    list.append(item);
  }

  if (state.words.length === 0) {
    list.append(el("p", "prompt", state.search.trim() ? "No matching words." : "No words yet."));
  }

  const header = el("div", "admin-list-header");
  header.append(el("h2", "focus-title", "Vocabulary"), newButton);
  host.replaceChildren(header, controls, list);
}

function renderWordEditor(
  host: HTMLElement,
  token: string,
  state: { selected: AdminWord; isNew: boolean },
  onSaved: () => Promise<void>,
): void {
  const word = input("Word", state.selected.word);
  word.disabled = !state.isNew;
  const article = input("Article", state.selected.article ?? "");
  const partOfSpeech = input("Part of speech", state.selected.part_of_speech);
  const meaning = textarea("Meaning", state.selected.meaning, 5);
  const focusEntries = textarea(
    "Focus entries, one per line: LEVEL,topic",
    formatFocusEntries(state.selected.focus_entries),
    6,
  );
  const status = el("p", "prompt");

  const save = button(state.isNew ? "Create word" : "Save word", "button primary");
  save.addEventListener("click", async () => {
    try {
      const payload = {
        word: word.value.trim(),
        article: article.value.trim() || null,
        part_of_speech: partOfSpeech.value.trim(),
        meaning: meaning.value.trim(),
        focus_entries: parseFocusEntries(focusEntries.value),
      };
      state.selected = state.isNew
        ? await createAdminWord(token, payload)
        : await updateAdminWord(token, payload);
      state.isNew = false;
      status.textContent = "Saved.";
      await onSaved();
    } catch (error) {
      status.replaceChildren(adminError(error));
    }
  });

  const remove = button("Delete", "button danger-button");
  remove.disabled = state.isNew;
  remove.addEventListener("click", async () => {
    if (!window.confirm(`Delete ${state.selected.word}?`)) return;
    try {
      await deleteAdminWord(token, state.selected.word);
      state.selected = emptyWord();
      state.isNew = true;
      await onSaved();
    } catch (error) {
      status.replaceChildren(adminError(error));
    }
  });

  const actions = el("div", "actions");
  actions.append(save, remove);
  host.replaceChildren(
    el("h2", "focus-title", state.isNew ? "New word" : state.selected.word),
    wordField(word),
    wordField(article),
    wordField(partOfSpeech),
    wordField(meaning),
    focusEntriesField(focusEntries),
    actions,
    status,
  );
}

function renderReadingAdmin(host: HTMLElement, token: string): void {
  const state = {
    activeGroup: "general" as AdminReadingGroup,
    passages: [] as AdminReadingPassageSummary[],
    selected: emptyPassage("general"),
    isNew: true,
  };

  const wrap = el("div", "admin-grid");
  const listPanel = el("div", "admin-list");
  const editor = el("div", "admin-editor");
  wrap.append(listPanel, editor);
  host.replaceChildren(wrap);

  const reload = async (): Promise<void> => {
    listPanel.replaceChildren(el("p", "prompt", "Loading passages..."));
    try {
      state.passages = await getAdminReadingPassages(token, { group: state.activeGroup });
      renderPassageList(listPanel, token, state, renderEditor);
    } catch (error) {
      listPanel.replaceChildren(adminError(error));
    }
  };

  const renderEditor = (): void => {
    state.selected.group = state.activeGroup;
    renderPassageEditor(editor, token, state, async () => {
      await reload();
      renderEditor();
    });
  };

  renderEditor();
  void reload();
}

function renderPassageList(
  host: HTMLElement,
  token: string,
  state: {
    activeGroup: AdminReadingGroup;
    passages: AdminReadingPassageSummary[];
    selected: AdminReadingPassage;
    isNew: boolean;
  },
  onSelect: () => void,
): void {
  const newButton = button("New passage", "button primary");
  newButton.addEventListener("click", () => {
    state.selected = emptyPassage(state.activeGroup);
    state.isNew = true;
    onSelect();
  });
  const tabs = readingGroupTabs(state.activeGroup, (group) => {
    if (!confirmDiscardingShapeData(state.selected, state.activeGroup, group)) return false;
    state.activeGroup = group;
    state.selected = emptyPassage(group);
    state.isNew = true;
    onSelect();
    void getAdminReadingPassages(token, { group })
      .then((passages) => {
        state.passages = passages;
        renderPassageList(host, token, state, onSelect);
      })
      .catch((error) => {
        host.replaceChildren(adminError(error));
      });
    return true;
  });

  const list = el("div", "admin-items");
  for (const passage of state.passages) {
    const item = button("", "admin-item");
    item.append(
      el("strong", "", passage.title),
      el(
        "span",
        "",
        `${readingGroupLabel(passage.group)} · ${passage.level}${
          passage.part ? ` · ${partLabel(passage.part)}` : ""
        } · ${passage.question_count} questions`,
      ),
    );
    item.addEventListener("click", async () => {
      state.selected = await getAdminReadingPassage(token, passage.id);
      state.isNew = false;
      onSelect();
    });
    list.append(item);
  }

  const header = el("div", "admin-list-header");
  header.append(
    el("h2", "focus-title", `${state.passages.length} ${pluralize("passage", state.passages.length)} · ${readingGroupLabel(state.activeGroup)}`),
    newButton,
  );
  host.replaceChildren(header, tabs, list);
}

function renderPassageEditor(
  host: HTMLElement,
  token: string,
  state: { activeGroup: AdminReadingGroup; selected: AdminReadingPassage; isNew: boolean },
  onSaved: () => Promise<void>,
): void {
  const level = selectLevel(state.selected.level);
  const part = selectGoethePart(state.selected.part ?? "teil_1");
  const topic = input("Topic", state.selected.topic ?? "");
  const contextLabel = input("Context label", state.selected.context_label ?? "");
  const imageUrl = input("Image URL", state.selected.image_url ?? "");
  const title = input("Title", state.selected.title);
  const passage = textarea("Passage text", state.selected.passage_text, 10);
  const questions = el("div", "admin-question-list");
  const questionControls = state.selected.questions.map((question) => questionBlock(question));
  const firstQuestion = state.selected.questions[0] ?? emptyQuestion(0);
  const sourceSituation = textarea("Situation", firstQuestion.prompt, 3);
  const sourceExplanation = textarea("Explanation after answer", firstQuestion.explanation ?? "", 3);
  const correctSource = selectSourceAnswer(firstQuestion);
  const adControls = (["a", "b"] as const).map((key, index) =>
    adStimulusBlock(state.selected.ad_stimuli?.[index] ?? emptyAdStimulus(key, index), key),
  );
  const sourceChoicePanel = sourceChoiceSection(sourceSituation, sourceExplanation, correctSource, adControls);
  const preview = el("section", "admin-reading-preview");
  const formFields = el("div", "admin-form-fields");
  const renderQuestions = (): void => {
    questions.replaceChildren(
      ...questionControls.map((control, index) => {
        control.title.textContent = `Question ${index + 1}`;
        control.prompt.placeholder = `Question ${index + 1}: main text`;
        control.remove.disabled = questionControls.length === 1;
        control.remove.onclick = () => {
          questionControls.splice(index, 1);
          renderQuestions();
          renderForm();
        };
        return control.node;
      }),
    );
  };
  renderQuestions();
  const status = el("p", "prompt");
  const metaGrid = el("div", "admin-reading-meta-grid");
  const resolvedType = el("span", "admin-resolved-type");
  const questionSectionNode = questionSection(questions, button("+ Add question", "button primary"));
  const shape = (): ReadingShape =>
    resolveReadingShape(state.activeGroup, level.value as AdminLevel, part.value as AdminGoethePart);

  const renderForm = (): void => {
    syncGoethePartOptions(part, level.value as AdminLevel);
    const activeShape = shape();
    resolvedType.textContent = `Type: ${resolvedExerciseLabel(activeShape)}`;
    const metaFields = [wordField(level, "Level")];
    if (state.activeGroup === "goethe") {
      metaFields.push(wordField(part, "Goethe Teil"), resolvedType);
    } else {
      metaFields.push(wordField(topic));
    }
    metaGrid.replaceChildren(...metaFields);

    const stimulusFields: HTMLElement[] = [wordField(title)];
    if (activeShape === "goethe_source_choice") {
      stimulusFields.push(sourceChoicePanel);
    } else {
      if (activeShape === "goethe_true_false_notice") {
        stimulusFields.push(wordField(contextLabel), wordField(imageUrl));
      }
      stimulusFields.push(wordField(passage), questionSectionNode);
    }

    const sourceQuestions = (): AdminReadingQuestion[] => {
      try {
        return collectSourceChoiceQuestion(sourceSituation, sourceExplanation, correctSource);
      } catch {
        return [
          {
            prompt: sourceSituation.value,
            explanation: sourceExplanation.value || null,
            order_index: 0,
            answers: [
              { answer_text: "a)", is_correct: correctSource.value === "0", order_index: 0 },
              { answer_text: "b)", is_correct: correctSource.value === "1", order_index: 1 },
            ],
          },
        ];
      }
    };
    renderReadingPreview(preview, {
      group: state.activeGroup,
      level: level.value as AdminLevel,
      part: state.activeGroup === "goethe" ? (part.value as AdminGoethePart) : null,
      title: title.value,
      passage_text: activeShape === "goethe_source_choice" ? "" : passage.value,
      context_label: activeShape === "goethe_true_false_notice" ? contextLabel.value || null : null,
      image_url: activeShape === "goethe_true_false_notice" ? imageUrl.value || null : null,
      topic: state.activeGroup === "general" ? topic.value || null : null,
      order_index: state.selected.order_index,
      questions: activeShape === "goethe_source_choice" ? sourceQuestions() : collectQuestionsSafely(questionControls),
      ad_stimuli: activeShape === "goethe_source_choice" ? collectAdStimuliSafely(adControls) : [],
    });
    formFields.replaceChildren(...stimulusFields, preview);
  };
  let previousShape = shape();
  let previousLevel = level.value;
  let previousPart = part.value;
  level.addEventListener("change", () => {
    syncGoethePartOptions(part, level.value as AdminLevel);
    const nextShape = shape();
    if (!confirmShapeSwitch(previousShape, nextShape, adControls)) {
      level.value = previousLevel;
      part.value = previousPart;
      return;
    }
    previousShape = nextShape;
    previousLevel = level.value;
    previousPart = part.value;
    renderForm();
  });
  part.addEventListener("change", () => {
    const nextShape = shape();
    if (!confirmShapeSwitch(previousShape, nextShape, adControls)) {
      part.value = previousPart;
      return;
    }
    previousShape = nextShape;
    previousPart = part.value;
    renderForm();
  });
  for (const control of [title, passage, topic, contextLabel, imageUrl, sourceSituation, sourceExplanation]) {
    control.addEventListener("input", renderForm);
  }
  correctSource.addEventListener("change", renderForm);
  for (const control of adControls) {
    control.title.addEventListener("input", renderForm);
    control.body.addEventListener("input", renderForm);
  }

  const save = button(state.isNew ? "Create passage" : "Save passage", "button primary");
  save.addEventListener("click", async () => {
    try {
      const activeShape = shape();
      const payload: AdminReadingPassage = {
        id: state.selected.id,
        group: state.activeGroup,
        level: level.value as AdminLevel,
        part: state.activeGroup === "goethe" ? (part.value as AdminGoethePart) : null,
        topic: state.activeGroup === "general" ? topic.value.trim() || null : null,
        title: title.value.trim(),
        passage_text:
          activeShape === "goethe_source_choice"
            ? "Lesen Sie die Situation und die zwei Anzeigen."
            : passage.value.trim(),
        image_url: activeShape === "goethe_true_false_notice" ? imageUrl.value.trim() || null : null,
        context_label: activeShape === "goethe_true_false_notice" ? contextLabel.value.trim() || null : null,
        order_index: state.selected.order_index,
        ad_stimuli: activeShape === "goethe_source_choice" ? collectAdStimuli(adControls) : [],
        questions: activeShape === "goethe_source_choice"
          ? collectSourceChoiceQuestion(sourceSituation, sourceExplanation, correctSource)
          : collectQuestions(questionControls),
      };
      state.selected = state.isNew
        ? await createAdminReadingPassage(token, payload)
        : await updateAdminReadingPassage(token, payload);
      state.isNew = false;
      status.textContent = "Saved.";
      await onSaved();
    } catch (error) {
      status.replaceChildren(adminError(error));
    }
  });

  const addTemplate = button("+ Add question", "button");
  addTemplate.className = "button primary";
  addTemplate.addEventListener("click", () => {
    questionControls.push(questionBlock(emptyQuestion(questionControls.length)));
    renderQuestions();
    renderForm();
  });
  questionSectionNode.querySelector(".admin-question-header")?.replaceChildren(
    el("h3", "admin-section-title", "Questions"),
    addTemplate,
  );

  const remove = button("Delete", "button danger-button");
  remove.disabled = state.isNew;
  remove.addEventListener("click", async () => {
    if (!state.selected.id || !window.confirm(`Delete ${state.selected.title}?`)) return;
    try {
      await deleteAdminReadingPassage(token, state.selected.id);
      state.selected = emptyPassage(state.activeGroup);
      state.isNew = true;
      await onSaved();
    } catch (error) {
      status.replaceChildren(adminError(error));
    }
  });

  renderForm();

  const actions = el("div", "actions");
  actions.append(save, remove);
  host.replaceChildren(
    el("h2", "focus-title", state.isNew ? "New passage" : state.selected.title),
    metaGrid,
    formFields,
    actions,
    status,
  );
}

function readingGroupTabs(
  activeGroup: AdminReadingGroup,
  onSelect: (group: AdminReadingGroup) => boolean,
): HTMLElement {
  return segmentedControl({
    label: "Reading collection",
    value: activeGroup,
    options: [
      { value: "general", label: "General" },
      { value: "goethe", label: "Goethe", title: "Goethe-Institut" },
    ],
    onChange: onSelect,
  });
}

type QuestionBlock = {
  node: HTMLElement;
  title: HTMLElement;
  prompt: HTMLTextAreaElement;
  explanation: HTMLInputElement;
  correct: HTMLInputElement;
  incorrect: HTMLTextAreaElement;
  remove: HTMLButtonElement;
};

type AdStimulusBlock = {
  node: HTMLElement;
  key: "a" | "b";
  id?: string;
  title: HTMLInputElement;
  body: HTMLTextAreaElement;
  orderIndex: number;
};

function questionBlock(question: AdminReadingQuestion): QuestionBlock {
  const correctAnswer = question.answers.find((answer) => answer.is_correct);
  const incorrectAnswers = question.answers
    .filter((answer) => !answer.is_correct)
    .sort((first, second) => first.order_index - second.order_index)
    .map((answer) => answer.answer_text)
    .join("\n");

  const node = el("div", "admin-question-block");
  const title = el("h3", "admin-question-title", "Question");
  const prompt = textarea("Main text", question.prompt, 3);
  const correct = input("Correct answer", correctAnswer?.answer_text ?? "");
  const incorrect = textarea("Incorrect answers, one per line", incorrectAnswers, 4);
  const explanation = input("Explanation after answer", question.explanation ?? "");
  const remove = button("Remove question", "button danger-button");

  node.append(
    title,
    wordField(prompt),
    wordField(correct),
    wordField(incorrect),
    wordField(explanation),
    remove,
  );
  return { node, title, prompt, explanation, correct, incorrect, remove };
}

function adStimulusBlock(ad: AdminReadingAdStimulus, key: "a" | "b"): AdStimulusBlock {
  const node = el("div", "admin-ad-block");
  const title = input(`${key}) Advert title`, ad.title);
  const body = textarea(`${key}) Advert text`, ad.body, 5);
  node.append(
    el("h3", "admin-question-title", `${key}) Advert`),
    wordField(title),
    wordField(body),
  );
  return {
    node,
    key,
    id: ad.id,
    title,
    body,
    orderIndex: ad.order_index,
  };
}

function sourceChoiceSection(
  situation: HTMLTextAreaElement,
  explanation: HTMLTextAreaElement,
  correct: HTMLSelectElement,
  ads: AdStimulusBlock[],
): HTMLElement {
  const wrap = el("section", "admin-source-choice-section");
  const adGrid = el("div", "admin-ad-grid");
  adGrid.append(...ads.map((ad) => ad.node));
  wrap.append(
    el("h3", "admin-section-title", "Teil 2 source choice"),
    wordField(situation),
    adGrid,
    wordField(correct, "Correct advert"),
    wordField(explanation),
  );
  return wrap;
}

function selectSourceAnswer(question: AdminReadingQuestion): HTMLSelectElement {
  const node = document.createElement("select");
  node.className = "admin-input";
  const correct = question.answers.find((answer) => answer.is_correct)?.order_index ?? 0;
  for (const [index, label] of ["a", "b"].entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${label})`;
    option.selected = index === correct;
    node.append(option);
  }
  return node;
}

function questionSection(questions: HTMLElement, addButton: HTMLButtonElement): HTMLElement {
  const wrap = el("section", "admin-question-section");
  const header = el("div", "admin-question-header");
  header.append(el("h3", "admin-section-title", "Questions"), addButton);
  wrap.append(header, questions);
  return wrap;
}

function collectQuestions(blocks: QuestionBlock[]): AdminReadingQuestion[] {
  return blocks
    .map((block, index) => {
      const correct = block.correct.value.trim();
      const incorrect = block.incorrect.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!block.prompt.value.trim()) {
        throw new Error(`Question ${index + 1} needs main text.`);
      }
      if (!correct) {
        throw new Error(`Question ${index + 1} needs a correct answer.`);
      }
      if (incorrect.length === 0) {
        throw new Error(`Question ${index + 1} needs at least one incorrect answer.`);
      }
      return {
        prompt: block.prompt.value.trim(),
        explanation: block.explanation.value.trim() || null,
        order_index: index,
        answers: [
          { answer_text: correct, is_correct: true, order_index: 0 },
          ...incorrect.map((answer, answerIndex) => ({
            answer_text: answer,
            is_correct: false,
            order_index: answerIndex + 1,
          })),
        ],
      };
    });
}

function collectQuestionsSafely(blocks: QuestionBlock[]): AdminReadingQuestion[] {
  try {
    return collectQuestions(blocks);
  } catch {
    return [];
  }
}

function collectSourceChoiceQuestion(
  situation: HTMLTextAreaElement,
  explanation: HTMLTextAreaElement,
  correct: HTMLSelectElement,
): AdminReadingQuestion[] {
  const prompt = situation.value.trim();
  if (!prompt) {
    throw new Error("Teil 2 needs a situation.");
  }
  const correctIndex = Number(correct.value);
  return [
    {
      prompt,
      explanation: explanation.value.trim() || null,
      order_index: 0,
      answers: [
        { answer_text: "a)", is_correct: correctIndex === 0, order_index: 0 },
        { answer_text: "b)", is_correct: correctIndex === 1, order_index: 1 },
      ],
    },
  ];
}

function collectAdStimuli(blocks: AdStimulusBlock[]): AdminReadingAdStimulus[] {
  return blocks.map((block, index) => {
    const title = block.title.value.trim();
    const body = block.body.value.trim();
    if (!title || !body) {
      throw new Error(`Advert ${block.key}) needs a title and text.`);
    }
    return {
      id: block.id,
      key: block.key,
      title,
      body,
      context_label: null,
      order_index: index,
    };
  });
}

function collectAdStimuliSafely(blocks: AdStimulusBlock[]): AdminReadingAdStimulus[] {
  return blocks.map((block, index) => ({
    id: block.id,
    key: block.key,
    title: block.title.value.trim(),
    body: block.body.value.trim(),
    context_label: null,
    order_index: index,
  }));
}

function renderReadingPreview(host: HTMLElement, passage: AdminReadingPassage): void {
  const isSourceChoice = passage.group === "goethe" && passage.part === "teil_2";
  const isNotice = passage.group === "goethe" && passage.part === "teil_3";
  const title = el("h3", "admin-section-title", "Preview");
  const text = el("div", "admin-preview-text");
  text.append(el("strong", "", passage.title || "Untitled passage"));
  if (passage.context_label) text.append(el("span", "", passage.context_label));
  if (isNotice && passage.image_url) {
    const image = document.createElement("img");
    image.src = passage.image_url;
    image.alt = passage.title || "Notice image";
    text.append(image);
  }
  if (!isSourceChoice) {
    text.append(el("p", "", passage.passage_text || "Reading text appears here."));
  }

  const body = el("div", "admin-preview-body");
  if (isSourceChoice) {
    const adGrid = el("div", "admin-preview-ad-grid");
    for (const ad of passage.ad_stimuli) {
      const card = el("article", "admin-preview-ad");
      card.append(el("strong", "", `${ad.key}) ${ad.title}`), el("p", "", ad.body));
      adGrid.append(card);
    }
    body.append(adGrid);
  }
  for (const question of passage.questions) {
    const item = el("div", "admin-preview-question");
    item.append(el("p", "", question.prompt || "Question prompt appears here."));
    const answers = el("div", "admin-preview-options");
    for (const answer of question.answers) {
      answers.append(el("span", "", answer.answer_text || "Option"));
    }
    item.append(answers);
    body.append(item);
  }
  host.replaceChildren(title, text, body);
}

function emptyWord(): AdminWord {
  return {
    word: "",
    article: null,
    part_of_speech: "noun",
    meaning: "",
    focus_entries: [],
  };
}

function cloneWord(word: AdminWord): AdminWord {
  return {
    ...word,
    focus_entries: word.focus_entries.map((entry) => ({ ...entry })),
  };
}

function emptyPassage(group: AdminReadingGroup): AdminReadingPassage {
  return {
    group,
    level: "A1",
    part: group === "goethe" ? "teil_1" : null,
    topic: null,
    title: "",
    passage_text: "",
    image_url: null,
    context_label: null,
    order_index: 0,
    ad_stimuli: [],
    questions: [emptyQuestion(0)],
  };
}

function emptyAdStimulus(key: "a" | "b", orderIndex: number): AdminReadingAdStimulus {
  return {
    key,
    title: "",
    body: "",
    context_label: null,
    order_index: orderIndex,
  };
}

function emptyQuestion(orderIndex: number): AdminReadingPassage["questions"][number] {
  return {
    prompt: "",
    explanation: null,
    order_index: orderIndex,
    answers: [
      { answer_text: "", is_correct: true, order_index: 0 },
      { answer_text: "", is_correct: false, order_index: 1 },
      { answer_text: "", is_correct: false, order_index: 2 },
      { answer_text: "", is_correct: false, order_index: 3 },
    ],
  };
}

function input(label: string, value: string, type = "text"): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  node.placeholder = label;
  node.value = value;
  node.className = "admin-input";
  return node;
}

function textarea(label: string, value: string, rows: number): HTMLTextAreaElement {
  const node = document.createElement("textarea");
  node.placeholder = label;
  node.value = value;
  node.rows = rows;
  node.className = "admin-input admin-textarea";
  return node;
}

function selectLevel(value: AdminLevel): HTMLSelectElement {
  const node = document.createElement("select");
  node.setAttribute("placeholder", "Level");
  node.className = "admin-input";
  for (const level of LEVELS) {
    const option = document.createElement("option");
    option.value = level;
    option.textContent = level;
    option.selected = level === value;
    node.append(option);
  }
  return node;
}

function selectGoethePart(value: AdminGoethePart): HTMLSelectElement {
  const node = document.createElement("select");
  node.setAttribute("placeholder", "Goethe Teil");
  node.className = "admin-input";
  for (const part of GOETHE_PARTS) {
    const option = document.createElement("option");
    option.value = part;
    option.textContent = partLabel(part);
    option.selected = part === value;
    node.append(option);
  }
  return node;
}

function readingGroupLabel(group: AdminReadingGroup): string {
  return group === "goethe" ? "Goethe-Institut" : "General";
}

function resolveReadingShape(
  collection: AdminReadingGroup,
  level: AdminLevel,
  teil: AdminGoethePart | null,
): ReadingShape {
  if (collection === "general") return "general_free_form";
  return READING_SHAPE_TABLE.goethe[level]?.[teil ?? "teil_1"] ?? "goethe_standard";
}

function allowedGoetheParts(level: AdminLevel): AdminGoethePart[] {
  return Object.keys(READING_SHAPE_TABLE.goethe[level] ?? { teil_1: "goethe_standard" }) as AdminGoethePart[];
}

function syncGoethePartOptions(select: HTMLSelectElement, level: AdminLevel): void {
  const allowedParts = allowedGoetheParts(level);
  const selected = allowedParts.includes(select.value as AdminGoethePart)
    ? (select.value as AdminGoethePart)
    : allowedParts[0];
  select.replaceChildren(
    ...allowedParts.map((part) => {
      const option = document.createElement("option");
      option.value = part;
      option.textContent = partLabel(part);
      option.selected = part === selected;
      return option;
    }),
  );
  select.value = selected;
}

function segmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => boolean | void;
}): HTMLElement {
  let activeValue = value;
  const wrap = el("div", "segmented-control");
  wrap.setAttribute("role", "tablist");
  wrap.setAttribute("aria-label", label);
  wrap.style.setProperty("--segment-count", String(options.length));

  const renderState = (): void => {
    for (const segment of Array.from(wrap.querySelectorAll<HTMLButtonElement>(".segmented-control__item"))) {
      const isSelected = segment.dataset.value === activeValue;
      segment.setAttribute("aria-selected", isSelected ? "true" : "false");
      segment.tabIndex = isSelected ? 0 : -1;
    }
  };

  for (const option of options) {
    const segment = button(option.label, "segmented-control__item");
    segment.type = "button";
    segment.dataset.value = option.value;
    segment.title = option.title ?? option.label;
    segment.setAttribute("role", "tab");
    segment.addEventListener("click", () => {
      if (activeValue === option.value) return;
      if (onChange(option.value) === false) return;
      activeValue = option.value;
      renderState();
    });
    segment.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const currentIndex = options.findIndex((item) => item.value === activeValue);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = options[(currentIndex + offset + options.length) % options.length];
      if (onChange(next.value) === false) return;
      activeValue = next.value;
      renderState();
      const nextButton = wrap.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
      nextButton?.focus();
    });
    wrap.append(segment);
  }
  renderState();
  return wrap;
}

function partLabel(part: AdminGoethePart): string {
  return part.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolvedExerciseLabel(shape: ReadingShape): string {
  if (shape === "general_free_form") return "Free-form practice";
  if (shape === "goethe_true_false_text") return "Personal text - true/false";
  if (shape === "goethe_source_choice") return "Two adverts - choose one";
  if (shape === "goethe_true_false_notice") return "Sign or notice - true/false";
  return "Standard questions";
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

function hasAdvertDraft(adControls: AdStimulusBlock[]): boolean {
  return adControls.some((ad) => ad.title.value.trim() || ad.body.value.trim());
}

function confirmShapeSwitch(
  previousShape: ReadingShape,
  nextShape: ReadingShape,
  adControls: AdStimulusBlock[],
): boolean {
  if (previousShape !== "goethe_source_choice" || nextShape === "goethe_source_choice" || !hasAdvertDraft(adControls)) {
    return true;
  }
  return window.confirm("The two adverts you entered will not be saved for this reading type.");
}

function confirmDiscardingShapeData(
  selected: AdminReadingPassage,
  currentGroup: AdminReadingGroup,
  nextGroup: AdminReadingGroup,
): boolean {
  if (currentGroup === nextGroup || selected.ad_stimuli.length === 0) return true;
  return window.confirm("The two adverts you entered will not be saved in General.");
}

function wordField(control: HTMLElement, fallbackLabel?: string): HTMLElement {
  const wrap = el("label", "admin-field");
  const label = fallbackLabel ?? control.getAttribute("placeholder") ?? "Level";
  wrap.append(el("span", "", label), control);
  return wrap;
}

function focusEntriesField(control: HTMLTextAreaElement): HTMLElement {
  const wrap = el("label", "admin-field");
  const header = el("span", "admin-field-header");
  const topics = button("Topics", "button compact-button");
  topics.type = "button";
  topics.addEventListener("click", async (event) => {
    event.preventDefault();
    const modal = topicAliasModal();
    document.body.append(modal.overlay);
    try {
      modal.render(await getFocusTopicAliases());
    } catch (error) {
      modal.body.replaceChildren(adminError(error));
    }
  });
  header.append(el("span", "", control.getAttribute("placeholder") ?? "Focus entries"), topics);
  wrap.append(header, control);
  return wrap;
}

function topicAliasModal(): {
  overlay: HTMLElement;
  body: HTMLElement;
  render: (topics: FocusTopicAlias[]) => void;
} {
  const overlay = el("div", "modal-overlay");
  const dialog = el("section", "modal-dialog topic-modal");
  const body = el("div", "topic-alias-list");
  body.append(el("p", "prompt", "Loading topics..."));
  const close = button("Close", "button");
  close.type = "button";
  const dismiss = (): void => overlay.remove();
  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismiss();
  });

  const render = (topics: FocusTopicAlias[]): void => {
    body.replaceChildren(
      ...topics.map((topic) => {
        const row = el("div", "topic-alias-row");
        row.append(el("strong", "", topic.label), el("code", "", topic.topic));
        return row;
      }),
    );
  };

  const header = el("div", "modal-header");
  header.append(el("h3", "admin-section-title", "Current topics"), close);
  dialog.append(header, body);
  overlay.append(dialog);
  return { overlay, body, render };
}

function parseFocusEntries(value: string): AdminFocusEntry[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [level, topic] = line.split(",").map((piece) => piece.trim());
      return { level: level as AdminLevel, topic };
    });
}

function formatFocusEntries(entries: AdminFocusEntry[]): string {
  return entries.map((entry) => `${entry.level},${entry.topic}`).join("\n");
}

function adminError(error: unknown): HTMLElement {
  return el("div", "error", error instanceof Error ? error.message : "Admin request failed");
}
