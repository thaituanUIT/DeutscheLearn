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
const EXERCISE_TYPES = ["", "source_choice", "true_false_notice"] as const;

type AdminLevel = (typeof LEVELS)[number];
type AdminReadingGroup = (typeof READING_GROUPS)[number];
type AdminGoethePart = (typeof GOETHE_PARTS)[number];

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
  const tabs = el("div", "admin-tabs");
  const host = el("div", "admin-host");
  const wordsTab = button("Vocabulary", "button primary");
  const readingTab = button("Reading", "button");

  const showWords = (): void => {
    wordsTab.className = "button primary";
    readingTab.className = "button";
    renderWordsAdmin(host, token);
  };
  const showReading = (): void => {
    readingTab.className = "button primary";
    wordsTab.className = "button";
    renderReadingAdmin(host, token);
  };

  wordsTab.addEventListener("click", showWords);
  readingTab.addEventListener("click", showReading);
  tabs.append(wordsTab, readingTab);
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
  header.append(el("h2", "focus-title", "Reading"), newButton);
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
  const exerciseType = selectExerciseType(state.selected.exercise_type ?? "");
  const topic = input("Topic", state.selected.topic ?? "");
  const title = input("Title", state.selected.title);
  const order = input("Order", String(state.selected.order_index), "number");
  const passage = textarea("Passage text", state.selected.passage_text, 10);
  const contentJson = textarea("Structured content JSON", state.selected.content_json ?? "", 8);
  contentJson.spellcheck = false;
  const questions = el("div", "admin-question-list");
  const questionControls = state.selected.questions.map((question) => questionBlock(question));
  const renderQuestions = (): void => {
    questions.replaceChildren(
      ...questionControls.map((control, index) => {
        control.title.textContent = `Question ${index + 1}`;
        control.prompt.placeholder = `Question ${index + 1}: main text`;
        control.remove.disabled = questionControls.length === 1;
        control.remove.onclick = () => {
          questionControls.splice(index, 1);
          renderQuestions();
        };
        return control.node;
      }),
    );
  };
  renderQuestions();
  const status = el("p", "prompt");
  const metaGrid = el("div", "admin-reading-meta-grid");
  const partField = wordField(part);
  const exerciseTypeField = wordField(exerciseType);
  const contentJsonField = wordField(contentJson);
  const isGoethe = state.activeGroup === "goethe";
  toggleField(partField, isGoethe);
  toggleField(exerciseTypeField, isGoethe);
  toggleField(contentJsonField, isGoethe);

  metaGrid.append(
    wordField(level),
    partField,
    exerciseTypeField,
    wordField(topic),
    wordField(order),
  );

  const save = button(state.isNew ? "Create passage" : "Save passage", "button primary");
  save.addEventListener("click", async () => {
    try {
      const payload: AdminReadingPassage = {
        id: state.selected.id,
        group: state.activeGroup,
        level: level.value as AdminLevel,
        part: isGoethe ? (part.value as AdminGoethePart) : null,
        exercise_type: exerciseType.value.trim() || null,
        topic: topic.value.trim() || null,
        title: title.value.trim(),
        passage_text: passage.value.trim(),
        content_json: contentJson.value.trim() || null,
        order_index: Number(order.value) || 0,
        questions: collectQuestions(questionControls),
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
  addTemplate.addEventListener("click", () => {
    questionControls.push(questionBlock(emptyQuestion(questionControls.length)));
    renderQuestions();
  });

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

  const actions = el("div", "actions");
  actions.append(save, remove);
  host.replaceChildren(
    el("h2", "focus-title", state.isNew ? "New passage" : state.selected.title),
    metaGrid,
    wordField(title),
    readingTextGrid(wordField(passage), contentJsonField),
    questionSection(questions, addTemplate),
    actions,
    status,
  );
}

function readingGroupTabs(
  activeGroup: AdminReadingGroup,
  onSelect: (group: AdminReadingGroup) => void,
): HTMLElement {
  const tabs = el("div", "admin-reading-tabs");
  for (const group of READING_GROUPS) {
    const tab = button(readingGroupLabel(group), group === activeGroup ? "button primary" : "button");
    tab.addEventListener("click", () => {
      if (group !== activeGroup) onSelect(group);
    });
    tabs.append(tab);
  }
  return tabs;
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

function questionSection(questions: HTMLElement, addButton: HTMLButtonElement): HTMLElement {
  const wrap = el("section", "admin-question-section");
  const header = el("div", "admin-question-header");
  header.append(el("h3", "admin-section-title", "Questions"), addButton);
  wrap.append(header, questions);
  return wrap;
}

function readingTextGrid(passageField: HTMLElement, contentField: HTMLElement): HTMLElement {
  const wrap = el("div", "admin-reading-text-grid");
  wrap.append(passageField, contentField);
  return wrap;
}

function toggleField(field: HTMLElement, visible: boolean): void {
  field.hidden = !visible;
  field.classList.toggle("is-hidden", !visible);
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
    exercise_type: null,
    topic: null,
    title: "",
    passage_text: "",
    content_json: null,
    order_index: 0,
    questions: [emptyQuestion(0)],
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

function selectExerciseType(value: string): HTMLSelectElement {
  const node = document.createElement("select");
  node.setAttribute("placeholder", "Exercise type");
  node.className = "admin-input";
  for (const type of EXERCISE_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type ? exerciseTypeLabel(type) : "Standard questions";
    option.selected = type === value;
    node.append(option);
  }
  return node;
}

function readingGroupLabel(group: AdminReadingGroup): string {
  return group === "goethe" ? "Goethe-Institut" : "General";
}

function partLabel(part: AdminGoethePart): string {
  return part.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function exerciseTypeLabel(type: string): string {
  if (type === "source_choice") return "Source choice";
  if (type === "true_false_notice") return "Notice true/false";
  return type;
}

function wordField(control: HTMLElement): HTMLElement {
  const wrap = el("label", "admin-field");
  const label = control.getAttribute("placeholder") ?? "Level";
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
