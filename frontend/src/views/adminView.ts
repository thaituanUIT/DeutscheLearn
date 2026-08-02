import {
  createAdminReadingPassage,
  createAdminWord,
  deleteAdminReadingPassage,
  deleteAdminWord,
  getAdminReadingPassage,
  getAdminReadingPassages,
  getAdminWords,
  updateAdminReadingPassage,
  updateAdminWord,
} from "../api/client";
import type {
  AdminFocusEntry,
  AdminReadingPassage,
  AdminReadingQuestion,
  AdminReadingPassageSummary,
  AdminWord,
} from "../api/types";
import { button } from "../components/button";
import { clear, el } from "../utils/dom";

const ADMIN_TOKEN_KEY = "recognition_admin_token";
const LEVELS = ["A1", "A2", "B1", "B2"] as const;

type AdminLevel = (typeof LEVELS)[number];

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
  };

  const wrap = el("div", "admin-grid");
  const listPanel = el("div", "admin-list");
  const editor = el("div", "admin-editor");
  wrap.append(listPanel, editor);
  host.replaceChildren(wrap);

  const reload = async (): Promise<void> => {
    listPanel.replaceChildren(el("p", "prompt", "Loading words..."));
    try {
      state.words = await getAdminWords(token);
      renderWordList(listPanel, state, renderEditor);
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
  state: { words: AdminWord[]; selected: AdminWord; isNew: boolean },
  onSelect: () => void,
): void {
  const newButton = button("New word", "button primary");
  newButton.addEventListener("click", () => {
    state.selected = emptyWord();
    state.isNew = true;
    onSelect();
  });

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

  host.replaceChildren(el("h2", "focus-title", "Vocabulary"), newButton, list);
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
    wordField(focusEntries),
    actions,
    status,
  );
}

function renderReadingAdmin(host: HTMLElement, token: string): void {
  const state = {
    passages: [] as AdminReadingPassageSummary[],
    selected: emptyPassage(),
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
      state.passages = await getAdminReadingPassages(token);
      renderPassageList(listPanel, token, state, renderEditor);
    } catch (error) {
      listPanel.replaceChildren(adminError(error));
    }
  };

  const renderEditor = (): void => {
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
    passages: AdminReadingPassageSummary[];
    selected: AdminReadingPassage;
    isNew: boolean;
  },
  onSelect: () => void,
): void {
  const newButton = button("New passage", "button primary");
  newButton.addEventListener("click", () => {
    state.selected = emptyPassage();
    state.isNew = true;
    onSelect();
  });

  const list = el("div", "admin-items");
  for (const passage of state.passages) {
    const item = button("", "admin-item");
    item.append(
      el("strong", "", passage.title),
      el("span", "", `${passage.level} · ${passage.topic ?? "No topic"} · ${passage.question_count} questions`),
    );
    item.addEventListener("click", async () => {
      state.selected = await getAdminReadingPassage(token, passage.id);
      state.isNew = false;
      onSelect();
    });
    list.append(item);
  }

  host.replaceChildren(el("h2", "focus-title", "Reading"), newButton, list);
}

function renderPassageEditor(
  host: HTMLElement,
  token: string,
  state: { selected: AdminReadingPassage; isNew: boolean },
  onSaved: () => Promise<void>,
): void {
  const level = selectLevel(state.selected.level);
  const topic = input("Topic", state.selected.topic ?? "");
  const title = input("Title", state.selected.title);
  const order = input("Order", String(state.selected.order_index), "number");
  const passage = textarea("Passage text", state.selected.passage_text, 10);
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

  const save = button(state.isNew ? "Create passage" : "Save passage", "button primary");
  save.addEventListener("click", async () => {
    try {
      const payload: AdminReadingPassage = {
        id: state.selected.id,
        level: level.value as AdminLevel,
        topic: topic.value.trim() || null,
        title: title.value.trim(),
        passage_text: passage.value.trim(),
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
      state.selected = emptyPassage();
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
    wordField(level),
    wordField(topic),
    wordField(title),
    wordField(order),
    wordField(passage),
    questionSection(questions, addTemplate),
    actions,
    status,
  );
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

function emptyPassage(): AdminReadingPassage {
  return {
    level: "A1",
    topic: null,
    title: "",
    passage_text: "",
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

function wordField(control: HTMLElement): HTMLElement {
  const wrap = el("label", "admin-field");
  const label = control.getAttribute("placeholder") ?? "Level";
  wrap.append(el("span", "", label), control);
  return wrap;
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
