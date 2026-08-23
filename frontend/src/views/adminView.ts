import {
  createAdminReadingPassage,
  createAdminWord,
  createStimulusImageUploadUrl,
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
import {
  createStimulusEditor,
  stimulusRenderer,
  type StimulusEditor,
  type StimulusViewModel,
} from "../stimuli/templates";
import { clear, el } from "../utils/dom";

const ADMIN_TOKEN_KEY = "recognition_admin_token";
const LEVELS = ["A1", "A2", "B1", "B2"] as const;
const READING_GROUPS = ["general", "goethe"] as const;
const GOETHE_PARTS = ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"] as const;
const GERMAN_ARTICLES = ["der", "die", "das"] as const;
const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "conjunction",
  "pronoun",
  "phrase",
] as const;
let questionBlockId = 0;
let adminControlId = 0;

type AdminLevel = (typeof LEVELS)[number];
type AdminReadingGroup = (typeof READING_GROUPS)[number];
type AdminGoethePart = (typeof GOETHE_PARTS)[number];
type GermanArticle = (typeof GERMAN_ARTICLES)[number];
type AdminPartOfSpeech = (typeof PARTS_OF_SPEECH)[number];
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

  const { wrap, listPanel, editor } = adminMasterDetailLayout();
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
  newButton.textContent = "+ New";
  newButton.ariaLabel = "New word";
  newButton.title = "New word";
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
    const focusCount = `${word.focus_entries.length} ${pluralize("focus entry", word.focus_entries.length)}`;
    item.append(
      el("strong", "", word.article ? `${word.article} ${word.word}` : word.word),
      el("span", "", `${word.part_of_speech} · ${focusCount}`),
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
  header.append(el("h2", "focus-title", "Words"), newButton);
  host.replaceChildren(header, controls, list);
}

function renderWordEditor(
  host: HTMLElement,
  token: string,
  state: { selected: AdminWord; isNew: boolean },
  onSaved: () => Promise<void>,
): void {
  const editorForm = adminEditorForm();
  const word = input("Word", state.selected.word);
  word.disabled = !state.isNew;
  const partOfSpeech = selectPartOfSpeech(state.selected.part_of_speech);
  const article = articleSegmentedControl(state.selected.article, partOfSpeech.value === "noun");
  const meaning = textarea("Meaning", state.selected.meaning, 5);
  const focusEntries = focusEntriesRepeater(state.selected.focus_entries);
  const status = el("p", "prompt admin-dirty-state");

  const syncArticleState = (): void => {
    article.setEnabled(partOfSpeech.value === "noun");
  };

  const saveWord = async (): Promise<void> => {
    try {
      const payload = {
        word: word.value.trim(),
        article: partOfSpeech.value === "noun" ? article.value() : null,
        part_of_speech: partOfSpeech.value.trim(),
        meaning: meaning.value.trim(),
        focus_entries: focusEntries.value(),
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
  };

  editorForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void saveWord();
  });
  editorForm.addEventListener("input", () => {
    status.textContent = "Unsaved changes";
  });
  editorForm.addEventListener("change", () => {
    status.textContent = "Unsaved changes";
  });
  partOfSpeech.addEventListener("change", syncArticleState);

  const save = button(state.isNew ? "Create word" : "Save word", "button primary");
  save.addEventListener("click", () => {
    void saveWord();
  });

  const cancel = button("Cancel", "button");
  cancel.addEventListener("click", () => {
    state.selected = state.isNew ? emptyWord() : state.selected;
    renderWordEditor(host, token, state, onSaved);
  });

  const metaGrid = el("div", "admin-vocab-meta-grid");
  metaGrid.append(wordField(word), wordField(article.node, "Article"), wordField(partOfSpeech, "Part of speech"));
  const formFields = el("div", "admin-form-fields");
  formFields.append(metaGrid, wordField(meaning), focusEntries.node);

  const actions = editorActionBar(status, cancel, save);
  editorForm.append(formFields, actions);

  const header = el("div", "admin-editor-header");
  header.append(el("h2", "focus-title", state.isNew ? "New word" : state.selected.word));
  if (!state.isNew) {
    const remove = button("Delete", "admin-text-button danger-text-button");
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
    header.append(remove);
  }
  host.replaceChildren(header, editorForm);
}

function renderReadingAdmin(host: HTMLElement, token: string): void {
  const state = {
    activeGroup: "general" as AdminReadingGroup,
    passages: [] as AdminReadingPassageSummary[],
    selected: emptyPassage("general"),
    isNew: true,
    search: "",
  };

  const { wrap, listPanel, editor } = adminMasterDetailLayout();
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
    search: string;
  },
  onSelect: () => void,
): void {
  const newButton = button("New passage", "button primary");
  newButton.textContent = "+ New";
  newButton.ariaLabel = "New passage";
  newButton.title = "New passage";
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
  const search = input("Search passages", state.search);
  search.autocomplete = "off";
  search.addEventListener("input", () => {
    state.search = search.value;
    renderPassageList(host, token, state, onSelect);
  });
  const clearSearch = button("Clear", "button compact-button");
  clearSearch.disabled = !state.search.trim();
  clearSearch.addEventListener("click", () => {
    state.search = "";
    renderPassageList(host, token, state, onSelect);
  });
  const controls = el("div", "admin-list-controls");
  controls.append(search, clearSearch);

  const list = el("div", "admin-items");
  const filteredPassages = state.passages.filter((passage) => matchesPassageSearch(passage, state.search));
  for (const passage of filteredPassages) {
    const item = button("", "admin-item");
    const questionCount = `${passage.question_count} ${pluralize("question", passage.question_count)}`;
    item.append(
      adminItemTitle(passage.title, passage.status),
      el(
        "span",
        "",
        `${readingGroupLabel(passage.group)} · ${passage.level}${
          passage.part ? ` · ${partLabel(passage.part)}` : ""
        } · ${questionCount}`,
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
  header.append(el("h2", "focus-title", "Passages"), newButton);
  host.replaceChildren(header, tabs, controls, list);
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
  const title = input("Title", state.selected.title);
  const passage = textarea("Passage text", state.selected.passage_text, 10);
  const questions = el("div", "admin-question-list");
  const firstQuestion = state.selected.questions[0] ?? emptyQuestion(0);
  const sourceSituation = textarea("Situation", firstQuestion.prompt, 3);
  const sourceExplanation = textarea("Explanation after answer", firstQuestion.explanation ?? "", 3);
  const correctSource = selectSourceAnswer(firstQuestion);
  const noticeEditor = createStimulusEditor(
    {
      id: state.selected.id,
      title: state.selected.title,
      body: state.selected.passage_text,
      context_label: state.selected.context_label,
      render_kind: state.selected.render_kind,
      content: state.selected.content,
      image_url: state.selected.image_url,
      image_path: state.selected.image_path,
      transcript: state.selected.transcript,
    },
    "teil_3",
    () => {
      const value = noticeEditor.getValue();
      title.value = value.title;
      passage.value = value.body;
      renderPreviewState();
    },
    (stimulusId, file) => createStimulusImageUploadUrl(token, stimulusId, file),
  );
  const adControls = (["a", "b"] as const).map((key, index) =>
    adStimulusBlock(
      state.selected.ad_stimuli?.[index] ?? emptyAdStimulus(key, index),
      key,
      (stimulusId, file) => createStimulusImageUploadUrl(token, stimulusId, file),
    ),
  );
  const sourceChoicePanel = sourceChoiceSection(sourceSituation, sourceExplanation, correctSource, adControls);
  const preview = el("section", "admin-reading-preview");
  const formFields = el("div", "admin-form-fields");
  const shape = (): ReadingShape =>
    resolveReadingShape(state.activeGroup, level.value as AdminLevel, part.value as AdminGoethePart);
  let questionControls = state.selected.questions.map((question) => questionBlockForShape(question, shape()));
  if (questionControls.length === 0) {
    questionControls = [questionBlockForShape(emptyQuestion(0), shape())];
  }
  const renderQuestions = (): void => {
    questions.replaceChildren(
      ...questionControls.map((control, index) => {
        control.title.textContent = `Question ${index + 1}`;
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
  const editorForm = adminEditorForm();
  const status = el("p", "prompt admin-dirty-state");
  const metaGrid = el("div", "admin-reading-meta-grid");
  const resolvedType = el("span", "admin-resolved-type");
  const questionSectionNode = questionSection(questions, button("+ Add question", "button primary"));

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

  const renderPreviewState = (): void => {
    const activeShape = shape();
    renderReadingPreview(preview, {
      group: state.activeGroup,
      level: level.value as AdminLevel,
      part: state.activeGroup === "goethe" ? (part.value as AdminGoethePart) : null,
      title: title.value,
      passage_text: activeShape === "goethe_source_choice" ? "" : passage.value,
      context_label: activeShape === "goethe_true_false_notice" ? contextLabel.value || null : null,
      image_url: state.selected.image_url,
      render_kind: activeShape === "goethe_true_false_notice" ? noticeEditor.getValue().render_kind : "text",
      content: activeShape === "goethe_true_false_notice" ? noticeEditor.getValue().content : null,
      image_path: activeShape === "goethe_true_false_notice" ? noticeEditor.getValue().image_path : null,
      transcript: activeShape === "goethe_true_false_notice" ? noticeEditor.getValue().transcript : null,
      topic: state.activeGroup === "general" ? topic.value || null : null,
      status: state.selected.status,
      order_index: state.selected.order_index,
      questions: activeShape === "goethe_source_choice" ? sourceQuestions() : collectQuestionBlocksSafely(questionControls),
      ad_stimuli: activeShape === "goethe_source_choice" ? collectAdStimuliSafely(adControls) : [],
    });
  };

  const renderForm = (): void => {
    syncGoethePartOptions(part, level.value as AdminLevel);
    const activeShape = shape();
    let questionShapeChanged = false;
    questionControls = questionControls.map((control, index) => {
      if (questionBlockMatchesShape(control, activeShape)) return control;
      questionShapeChanged = true;
      return questionBlockForShape(questionFromBlockSafely(control, index), activeShape);
    });
    if (questionShapeChanged) renderQuestions();
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
        stimulusFields.push(wordField(contextLabel), noticeEditor.node);
      }
      stimulusFields.push(wordField(passage), questionSectionNode);
    }

    renderPreviewState();
    formFields.replaceChildren(...stimulusFields);
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
  for (const control of [title, passage, topic, contextLabel, sourceSituation, sourceExplanation]) {
    control.addEventListener("input", renderPreviewState);
  }
  correctSource.addEventListener("change", renderPreviewState);
  for (const control of adControls) {
    control.editor.node.addEventListener("input", renderPreviewState);
    control.editor.node.addEventListener("input", () => updateCorrectSourceOptions(correctSource, adControls));
  }
  updateCorrectSourceOptions(correctSource, adControls);

  const markDirty = (): void => {
    status.textContent = "Unsaved changes";
  };

  const savePassage = async (): Promise<void> => {
    try {
      const activeShape = shape();
      const noticeValue = noticeEditor.getValue();
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
            : activeShape === "goethe_true_false_notice"
              ? noticeValue.body
              : passage.value.trim(),
        image_url: state.selected.image_url,
        render_kind: activeShape === "goethe_true_false_notice" ? noticeValue.render_kind : "text",
        content: activeShape === "goethe_true_false_notice" ? noticeValue.content : null,
        image_path: activeShape === "goethe_true_false_notice" ? noticeValue.image_path : null,
        transcript: activeShape === "goethe_true_false_notice" ? noticeValue.transcript : null,
        context_label: activeShape === "goethe_true_false_notice" ? contextLabel.value.trim() || null : null,
        order_index: state.selected.order_index,
        status: state.selected.status,
        ad_stimuli: activeShape === "goethe_source_choice" ? collectAdStimuli(adControls) : [],
        questions: activeShape === "goethe_source_choice"
          ? collectSourceChoiceQuestion(sourceSituation, sourceExplanation, correctSource)
          : collectQuestionBlocks(questionControls),
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
  };

  editorForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void savePassage();
  });
  editorForm.addEventListener("input", markDirty);
  editorForm.addEventListener("change", markDirty);

  const save = button(state.isNew ? "Create passage" : "Save passage", "button primary");
  save.addEventListener("click", () => {
    void savePassage();
  });

  const addTemplate = button("+ Add question", "button");
  addTemplate.className = "button primary";
  addTemplate.addEventListener("click", () => {
    questionControls.push(questionBlockForShape(emptyQuestion(questionControls.length), shape()));
    renderQuestions();
    renderForm();
  });
  questionSectionNode.querySelector(".admin-question-header")?.replaceChildren(
    el("h3", "admin-section-title", "Questions"),
    addTemplate,
  );

  const cancel = button("Cancel", "button");
  cancel.addEventListener("click", () => {
    state.selected = state.isNew ? emptyPassage(state.activeGroup) : state.selected;
    renderPassageEditor(host, token, state, onSaved);
  });

  renderForm();

  const header = el("div", "admin-editor-header");
  header.append(el("h2", "focus-title", state.isNew ? "New passage" : state.selected.title));
  if (!state.isNew) {
    const remove = button("Delete", "admin-text-button danger-text-button");
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
    header.append(remove);
  }

  const actions = editorActionBar(status, cancel, save);
  editorForm.append(metaGrid, formFields, actions);

  const previewColumn = el("aside", "admin-preview-column");
  previewColumn.append(preview);
  const editorLayout = el("div", "admin-passage-editor");
  editorLayout.append(editorForm, previewColumn);
  host.replaceChildren(header, editorLayout);
}

function adminEditorForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "admin-editor-form";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  return form;
}

function adminMasterDetailLayout(): { wrap: HTMLElement; listPanel: HTMLElement; editor: HTMLElement } {
  const wrap = el("div", "admin-grid");
  const listPanel = el("div", "admin-list");
  const editor = el("div", "admin-editor");
  wrap.append(listPanel, editor);
  return { wrap, listPanel, editor };
}

function editorActionBar(status: HTMLElement, cancel: HTMLButtonElement, save: HTMLButtonElement): HTMLElement {
  const actions = el("div", "admin-action-bar");
  const actionButtons = el("div", "admin-action-buttons");
  actionButtons.append(cancel, save);
  actions.append(status, actionButtons);
  return actions;
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
  explanation: HTMLTextAreaElement;
  remove: HTMLButtonElement;
  mode: "true_false" | "standard";
  trueFalseAnswer?: () => TrueFalseAnswer;
  options?: OptionEditor[];
  addOption?: HTMLButtonElement;
};

type TrueFalseAnswer = "Richtig" | "Falsch";

type OptionEditor = {
  row: HTMLElement;
  radio: HTMLInputElement;
  text: HTMLTextAreaElement;
  remove: HTMLButtonElement;
};

type AdStimulusBlock = {
  node: HTMLElement;
  key: "a" | "b";
  id?: string;
  editor: StimulusEditor;
  orderIndex: number;
};

function questionBlock(question: AdminReadingQuestion): QuestionBlock {
  return standardQuestionBlock(question);
}

function questionBlockForShape(question: AdminReadingQuestion, shape: ReadingShape): QuestionBlock {
  return isTrueFalseShape(shape) ? trueFalseQuestionBlock(question) : standardQuestionBlock(question);
}

function questionBlockMatchesShape(block: QuestionBlock, shape: ReadingShape): boolean {
  return isTrueFalseShape(shape) ? block.mode === "true_false" : block.mode === "standard";
}

function isTrueFalseShape(shape: ReadingShape): boolean {
  return shape === "goethe_true_false_text" || shape === "goethe_true_false_notice";
}

function trueFalseQuestionBlock(question: AdminReadingQuestion): QuestionBlock {
  let selected: TrueFalseAnswer = canonicalTrueFalseAnswer(question);
  const node = el("div", "admin-question-block");
  const title = el("h3", "admin-question-title", "Question");
  const prompt = textarea("Prompt", question.prompt, 3);
  const explanation = textarea("Explanation after answer", question.explanation ?? "", 3);
  const remove = button("Remove question", "admin-text-button danger-text-button");
  const header = questionBlockHeader(title, remove);
  const answer = segmentedControl<TrueFalseAnswer>({
    label: "Correct answer",
    value: selected,
    options: [
      { value: "Richtig", label: "Richtig" },
      { value: "Falsch", label: "Falsch" },
    ],
    onChange: (value) => {
      selected = value;
    },
  });

  node.append(header, wordField(prompt), wordField(answer, "Correct answer"), wordField(explanation));
  return { node, title, prompt, explanation, remove, mode: "true_false", trueFalseAnswer: () => selected };
}

function standardQuestionBlock(question: AdminReadingQuestion): QuestionBlock {
  const sortedAnswers = question.answers.length > 0
    ? [...question.answers].sort((first, second) => first.order_index - second.order_index)
    : emptyQuestion(question.order_index).answers;

  const node = el("div", "admin-question-block");
  const title = el("h3", "admin-question-title", "Question");
  const prompt = textarea("Prompt", question.prompt, 3);
  const explanation = textarea("Explanation after answer", question.explanation ?? "", 3);
  const remove = button("Remove question", "admin-text-button danger-text-button");
  const header = questionBlockHeader(title, remove);
  const optionsWrap = el("div", "admin-options-editor");
  const optionEditors: OptionEditor[] = [];
  const radioName = `question-${++questionBlockId}-correct`;

  const renderOptions = (): void => {
    optionsWrap.replaceChildren(...optionEditors.map((option, index) => {
      option.radio.value = String(index);
      option.remove.disabled = optionEditors.length <= 2;
      return option.row;
    }));
  };
  const addOption = (answerText = "", isCorrect = false): void => {
    const option = optionEditor(radioName, answerText, isCorrect);
    option.remove.addEventListener("click", () => {
      const index = optionEditors.indexOf(option);
      if (index === -1 || optionEditors.length <= 2) return;
      const wasCorrect = option.radio.checked;
      optionEditors.splice(index, 1);
      if (wasCorrect) optionEditors[0].radio.checked = true;
      renderOptions();
    });
    optionEditors.push(option);
    renderOptions();
  };

  for (const answer of sortedAnswers) {
    addOption(answer.answer_text, answer.is_correct);
  }
  if (!optionEditors.some((option) => option.radio.checked)) {
    optionEditors[0]?.radio.click();
  }

  const addOptionButton = button("+ Add option", "button compact-button");
  addOptionButton.addEventListener("click", () => {
    addOption();
  });

  node.append(
    header,
    wordField(prompt),
    wordField(optionsWrap, "Options"),
    addOptionButton,
    wordField(explanation),
  );
  return {
    node,
    title,
    prompt,
    explanation,
    remove,
    mode: "standard",
    options: optionEditors,
    addOption: addOptionButton,
  };
}

function questionBlockHeader(title: HTMLElement, remove: HTMLButtonElement): HTMLElement {
  const header = el("div", "admin-question-block-header");
  header.append(title, remove);
  return header;
}

function optionEditor(radioName: string, answerText: string, isCorrect: boolean): OptionEditor {
  const row = el("div", "admin-option-row");
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = radioName;
  radio.checked = isCorrect;
  radio.ariaLabel = "Correct answer";
  const text = textarea("Answer option", answerText, 2);
  const remove = button("×", "admin-icon-button danger-icon-button");
  remove.ariaLabel = "Remove option";
  remove.title = "Remove option";
  row.append(radio, text, remove);
  return { row, radio, text, remove };
}

function canonicalTrueFalseAnswer(question: AdminReadingQuestion): TrueFalseAnswer {
  const correct = question.answers.find((answer) => answer.is_correct)?.answer_text.trim().toLocaleLowerCase("de-DE");
  return correct === "falsch" || correct === "false" ? "Falsch" : "Richtig";
}

function adStimulusBlock(
  ad: AdminReadingAdStimulus,
  key: "a" | "b",
  uploadHandler: Parameters<typeof createStimulusEditor>[3],
): AdStimulusBlock {
  const node = el("div", "admin-ad-block");
  const editor = createStimulusEditor(
    {
      id: ad.id,
      title: ad.title,
      body: ad.body,
      context_label: ad.context_label,
      render_kind: ad.render_kind,
      content: ad.content,
      image_url: null,
      image_path: ad.image_path,
      transcript: ad.transcript,
    },
    "teil_2",
    () => undefined,
    uploadHandler,
  );
  const header = el("h3", "admin-question-title admin-ad-title");
  header.append(el("span", "admin-ad-chip", key), document.createTextNode(" Advert"));
  node.append(header, editor.node);
  return {
    node,
    key,
    id: ad.id,
    editor,
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

function updateCorrectSourceOptions(select: HTMLSelectElement, ads: AdStimulusBlock[]): void {
  for (const [index, option] of Array.from(select.options).entries()) {
    const ad = ads[index];
    option.textContent = ad?.editor.getValue().title.trim() || `${ad?.key ?? index + 1})`;
  }
}

function questionSection(questions: HTMLElement, addButton: HTMLButtonElement): HTMLElement {
  const wrap = el("section", "admin-question-section");
  const header = el("div", "admin-question-header");
  header.append(el("h3", "admin-section-title", "Questions"), addButton);
  wrap.append(header, questions);
  return wrap;
}

function collectQuestionBlocks(blocks: QuestionBlock[]): AdminReadingQuestion[] {
  return blocks
    .map((block, index) => {
      if (!block.prompt.value.trim()) {
        throw new Error(`Question ${index + 1} needs a prompt.`);
      }
      if (block.mode === "true_false") {
        const correct = block.trueFalseAnswer?.() ?? "Richtig";
        return {
          prompt: block.prompt.value.trim(),
          explanation: block.explanation.value.trim() || null,
          order_index: index,
          answers: trueFalseAnswers(correct),
        };
      }

      const options = block.options ?? [];
      const answers = options.map((option, answerIndex) => ({
        answer_text: option.text.value.trim(),
        is_correct: option.radio.checked,
        order_index: answerIndex,
      }));
      if (answers.some((answer) => !answer.answer_text)) {
        throw new Error(`Question ${index + 1} needs text for every option.`);
      }
      if (answers.length < 2) {
        throw new Error(`Question ${index + 1} needs at least two options.`);
      }
      if (answers.filter((answer) => answer.is_correct).length !== 1) {
        throw new Error(`Question ${index + 1} needs one correct option.`);
      }
      return {
        prompt: block.prompt.value.trim(),
        explanation: block.explanation.value.trim() || null,
        order_index: index,
        answers,
      };
    });
}

function collectQuestionBlocksSafely(blocks: QuestionBlock[]): AdminReadingQuestion[] {
  try {
    return collectQuestionBlocks(blocks);
  } catch {
    return [];
  }
}

function questionFromBlockSafely(block: QuestionBlock, index: number): AdminReadingQuestion {
  try {
    return collectQuestionBlocks([block])[0];
  } catch {
    return {
      prompt: block.prompt.value,
      explanation: block.explanation.value || null,
      order_index: index,
      answers: block.mode === "true_false"
        ? trueFalseAnswers(block.trueFalseAnswer?.() ?? "Richtig")
        : (block.options ?? []).map((option, answerIndex) => ({
          answer_text: option.text.value,
          is_correct: option.radio.checked,
          order_index: answerIndex,
        })),
    };
  }
}

function trueFalseAnswers(correct: TrueFalseAnswer): AdminReadingQuestion["answers"] {
  return [
    { answer_text: "Richtig", is_correct: correct === "Richtig", order_index: 0 },
    { answer_text: "Falsch", is_correct: correct === "Falsch", order_index: 1 },
  ];
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
    const value = block.editor.getValue();
    const title = value.title.trim();
    const body = value.body.trim();
    if (!title || !body) {
      throw new Error(`Advert ${block.key}) needs content.`);
    }
    if (value.render_kind === "image" && !value.transcript) {
      throw new Error(`Advert ${block.key}) needs a transcript for the image.`);
    }
    return {
      id: block.id,
      key: block.key,
      title,
      body,
      render_kind: value.render_kind,
      content: value.content,
      image_path: value.image_path,
      transcript: value.transcript,
      context_label: null,
      order_index: index,
    };
  });
}

function collectAdStimuliSafely(blocks: AdStimulusBlock[]): AdminReadingAdStimulus[] {
  return blocks.map((block, index) => {
    const value = block.editor.getValue();
    return {
      id: block.id,
      key: block.key,
      title: value.title.trim(),
      body: value.body.trim(),
      render_kind: value.render_kind,
      content: value.content,
      image_path: value.image_path,
      transcript: value.transcript,
      context_label: null,
      order_index: index,
    };
  });
}

function renderReadingPreview(host: HTMLElement, passage: AdminReadingPassage): void {
  const isSourceChoice = passage.group === "goethe" && passage.part === "teil_2";
  const label = el("h3", "admin-preview-label", "Preview");
  const frame = el("div", "admin-preview-frame");
  const text = el("div", "admin-preview-text");
  if (!isSourceChoice) {
    text.append(stimulusRenderer(stimulusFromPassage(passage)));
  }

  const body = el("div", "admin-preview-body");
  if (isSourceChoice) {
    const adGrid = el("div", "admin-preview-ad-grid");
    for (const ad of passage.ad_stimuli) {
      const card = el("article", "admin-preview-ad");
      card.append(el("strong", "", `${ad.key})`), stimulusRenderer(stimulusFromAd(ad)));
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
  if (!text.childElementCount && !body.childElementCount) {
    frame.append(el("p", "admin-preview-empty", "Preview content appears here."));
  } else {
    frame.append(text, body);
  }
  host.replaceChildren(label, frame);
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
    id: crypto.randomUUID(),
    group,
    level: "A1",
    part: group === "goethe" ? "teil_1" : null,
    topic: null,
    title: "",
    passage_text: "",
    image_url: null,
    render_kind: "text",
    content: null,
    image_path: null,
    transcript: null,
    context_label: null,
    status: "published",
    order_index: 0,
    ad_stimuli: [],
    questions: [emptyQuestion(0)],
  };
}

function emptyAdStimulus(key: "a" | "b", orderIndex: number): AdminReadingAdStimulus {
  return {
    id: crypto.randomUUID(),
    key,
    title: "",
    body: "",
    render_kind: "ad_box",
    content: {
      business_name: "",
      tagline: "",
      lines: ["", ""],
      hours: "",
      address: "",
      phone: "",
      price: "",
    },
    image_path: null,
    transcript: null,
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

function input(label: string, value: string, type = "text", placeholder = ""): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  node.dataset.label = label;
  node.ariaLabel = label;
  node.placeholder = placeholder;
  node.value = value;
  node.className = "admin-input";
  return node;
}

function textarea(label: string, value: string, rows: number, placeholder = ""): HTMLTextAreaElement {
  const node = document.createElement("textarea");
  node.dataset.label = label;
  node.ariaLabel = label;
  node.placeholder = placeholder;
  node.value = value;
  node.rows = rows;
  node.className = "admin-input admin-textarea";
  node.addEventListener("input", () => growTextarea(node));
  window.requestAnimationFrame(() => growTextarea(node));
  return node;
}

function growTextarea(node: HTMLTextAreaElement): void {
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

function selectLevel(value: AdminLevel): HTMLSelectElement {
  const node = document.createElement("select");
  node.dataset.label = "Level";
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
  node.dataset.label = "Goethe Teil";
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

function selectPartOfSpeech(value: string): HTMLSelectElement {
  const node = document.createElement("select");
  node.dataset.label = "Part of speech";
  node.className = "admin-input";
  const selectedValue = PARTS_OF_SPEECH.includes(value as AdminPartOfSpeech)
    ? value
    : "noun";
  for (const part of PARTS_OF_SPEECH) {
    const option = document.createElement("option");
    option.value = part;
    option.textContent = part;
    option.selected = part === selectedValue;
    node.append(option);
  }
  return node;
}

function articleSegmentedControl(
  value: string | null,
  enabled: boolean,
): { node: HTMLElement; value: () => GermanArticle | null; setEnabled: (nextEnabled: boolean) => void } {
  let selected = GERMAN_ARTICLES.includes(value as GermanArticle) ? (value as GermanArticle) : null;
  const node = segmentedControl<GermanArticle>({
    label: "Article",
    value: selected ?? "der",
    options: GERMAN_ARTICLES.map((article) => ({ value: article, label: article })),
    onChange: (next) => {
      selected = next;
    },
  });
  node.classList.add("article-segmented-control");

  const setEnabled = (nextEnabled: boolean): void => {
    if (nextEnabled && selected === null) selected = "der";
    if (!nextEnabled) selected = null;
    node.dataset.disabled = nextEnabled ? "false" : "true";
    for (const segment of Array.from(node.querySelectorAll<HTMLButtonElement>(".segmented-control__item"))) {
      segment.disabled = !nextEnabled;
      const isSelected = nextEnabled && segment.dataset.value === selected;
      segment.setAttribute("aria-selected", isSelected ? "true" : "false");
      segment.tabIndex = nextEnabled && isSelected ? 0 : -1;
    }
  };

  setEnabled(enabled);
  return {
    node,
    value: () => selected,
    setEnabled,
  };
}

type FocusEntriesRepeater = {
  node: HTMLElement;
  value: () => AdminFocusEntry[];
};

type FocusEntryRow = {
  node: HTMLElement;
  level: HTMLSelectElement;
  topic: HTMLInputElement;
  remove: HTMLButtonElement;
};

function focusEntriesRepeater(entries: AdminFocusEntry[]): FocusEntriesRepeater {
  const wrap = el("section", "admin-focus-repeater");
  const list = el("div", "admin-focus-repeater-list");
  const datalistId = `focus-topics-${++adminControlId}`;
  const topics = document.createElement("datalist");
  topics.id = datalistId;
  const rows: FocusEntryRow[] = [];

  const renderRows = (): void => {
    list.replaceChildren(...rows.map((row) => row.node));
    for (const row of rows) {
      row.remove.disabled = rows.length <= 1;
    }
  };

  const addRow = (entry: AdminFocusEntry = { level: "A1", topic: "" }): void => {
    const row = focusEntryRow(entry, datalistId);
    row.remove.addEventListener("click", () => {
      const index = rows.indexOf(row);
      if (index === -1 || rows.length <= 1) return;
      rows.splice(index, 1);
      renderRows();
    });
    rows.push(row);
    renderRows();
  };

  const add = button("+ Add focus entry", "button compact-button");
  add.addEventListener("click", () => {
    addRow();
  });

  for (const entry of entries.length ? entries : [{ level: "A1", topic: "" } as AdminFocusEntry]) {
    addRow(entry);
  }

  setTopicOptions(topics, entries.map((entry) => ({ topic: entry.topic, label: entry.topic })));
  void getFocusTopicAliases()
    .then((aliases) => setTopicOptions(topics, aliases))
    .catch(() => undefined);

  const header = el("div", "admin-field-header");
  header.append(el("span", "", "Focus entries"));
  wrap.append(header, list, add, topics);
  return {
    node: wrap,
    value: () =>
      rows
        .map((row) => ({
          level: row.level.value as AdminLevel,
          topic: row.topic.value.trim(),
        }))
        .filter((entry) => entry.topic),
  };
}

function focusEntryRow(entry: AdminFocusEntry, datalistId: string): FocusEntryRow {
  const node = el("div", "admin-focus-row");
  const level = selectLevel(entry.level as AdminLevel);
  level.ariaLabel = "Focus level";
  const topic = input("Topic", entry.topic);
  topic.setAttribute("list", datalistId);
  topic.placeholder = "Topic";
  const remove = button("×", "admin-icon-button danger-icon-button");
  remove.type = "button";
  remove.ariaLabel = "Remove focus entry";
  remove.title = "Remove focus entry";
  node.append(wordField(level, "Level"), wordField(topic, "Topic"), remove);
  return { node, level, topic, remove };
}

function setTopicOptions(datalist: HTMLDataListElement, aliases: FocusTopicAlias[]): void {
  const seen = new Set<string>();
  datalist.replaceChildren(
    ...aliases
      .filter((alias) => {
        const key = alias.topic.trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((alias) => {
        const option = document.createElement("option");
        option.value = alias.topic;
        option.label = alias.label;
        return option;
      }),
  );
}

function readingGroupLabel(group: AdminReadingGroup): string {
  return group === "goethe" ? "Goethe" : "General";
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

function adminItemTitle(title: string, status: "draft" | "published"): HTMLElement {
  const wrap = el("strong", "admin-item-title");
  wrap.append(document.createTextNode(title));
  if (status === "draft") wrap.append(el("span", "draft-badge", "Draft"));
  return wrap;
}

function hasAdvertDraft(adControls: AdStimulusBlock[]): boolean {
  return adControls.some((ad) => {
    const value = ad.editor.getValue();
    return value.title.trim() || value.body.trim();
  });
}

function stimulusFromPassage(passage: AdminReadingPassage): StimulusViewModel {
  return {
    id: passage.id,
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

function stimulusFromAd(ad: AdminReadingAdStimulus): StimulusViewModel {
  return {
    id: ad.id,
    title: ad.title,
    body: ad.body,
    context_label: ad.context_label,
    render_kind: ad.render_kind,
    content: ad.content,
    image_url: null,
    image_path: ad.image_path,
    transcript: ad.transcript,
  };
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
  const label = fallbackLabel ?? control.dataset.label ?? "Level";
  wrap.dataset.field = label;
  wrap.append(el("span", "", label), control);
  return wrap;
}

function matchesPassageSearch(passage: AdminReadingPassageSummary, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const haystack = [
    passage.title,
    passage.group,
    readingGroupLabel(passage.group),
    passage.level,
    passage.part ? partLabel(passage.part) : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function adminError(error: unknown): HTMLElement {
  return el("div", "error", error instanceof Error ? error.message : "Admin request failed");
}
