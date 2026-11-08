import "../styles/views/admin.css";
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
  importAdminReading,
  importAdminWords,
  previewAdminReadingImport,
  previewAdminWordImport,
  updateAdminReadingPassage,
  updateAdminWord,
} from "../api/client";
import type {
  AdminFocusEntry,
  AdminImportResult,
  AdminReadingAdStimulus,
  AdminReadingPassage,
  AdminReadingQuestion,
  AdminWord,
  FocusTopicAlias,
} from "../api/types";
import { appHeader } from "../components/appHeader";
import { button } from "../components/button";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  GOETHE_PARTS,
  allowedGoetheParts,
  goethePartSpec,
  isTrueFalseShape,
  partLabel,
  resolveReadingShape,
  type GoetheLevel,
  type GoethePart,
  type GoethePartSpec,
  type ReadingShape,
} from "../goethe/readingSpecs";
import {
  createStimulusEditor,
  stimulusInstruction,
  stimulusOptionLabel,
  stimulusRenderer,
  type StimulusEditor,
  type StimulusViewModel,
} from "../stimuli/templates";
import { clear, el } from "../utils/dom";
import { formatCount } from "../utils/format";
import { renderDictationAdmin } from "./adminDictationView";
import wordsCsvTemplate from "../../../templates/admin-import/words.csv?raw";
import wordsJsonTemplate from "../../../templates/admin-import/words.json?raw";
import readingJsonTemplate from "../../../templates/admin-import/reading-passages.json?raw";
import { adminContentList } from "./adminContentList";
import {
  adminDialog, clearAdminDrafts, confirmAdminAction, editorChanged, editorIsBusy,
  editorSaved, leaveAllEditors, leaveEditor, protectAdminDrafts, readDraft,
  registerEditor, removeDraft, setEditorBusy, storeDraft, type DraftState,
} from "./adminSupport";

const ADMIN_TOKEN_KEY = "recognition_admin_token";
const LEVELS = ["A1", "A2", "B1", "B2"] as const;
const READING_GROUPS = ["general", "goethe"] as const;
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

type AdminLevel = GoetheLevel;
type AdminReadingGroup = (typeof READING_GROUPS)[number];
type AdminGoethePart = GoethePart;
type GermanArticle = (typeof GERMAN_ARTICLES)[number];
type AdminPartOfSpeech = (typeof PARTS_OF_SPEECH)[number];
type FieldValidationIssue = {
  field: string;
  message: string;
  control?: HTMLElement;
};
type ServerValidationIssue = {
  type?: string;
  loc?: Array<string | number>;
  msg?: string;
};
export function renderAdminApp(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token")?.trim();
  if (urlToken) {
    localStorage.setItem(ADMIN_TOKEN_KEY, urlToken);
    params.delete("token");
    window.history.replaceState({}, "", `/admin${params.size ? `?${params}` : ""}${location.hash}`);
  }

  const token = localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  clear(root);
  const shell = el("div", "shell admin-shell");
  shell.append(adminHeader(token), token ? adminWorkspace(token) : adminMissingToken());
  root.append(shell);
  protectAdminDrafts();
}

function adminHeader(token: string): HTMLElement {
  const actions = el("div", "admin-header-actions");
  if (token) {
    const clearToken = button("Sign out", "button");
    clearToken.addEventListener("click", async () => {
      if (!await leaveAllEditors()) return;
      clearAdminDrafts();
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      window.location.reload();
    });
    actions.append(clearToken);
  }
  const { header } = appHeader("Admin", actions);
  return header;
}

function adminMissingToken(): HTMLElement {
  const panel = el("section", "admin-access");
  const form = document.createElement("form");
  const token = input("Admin token", "", "password");
  token.autocomplete = "current-password";
  token.required = true;
  const submit = button("Open admin panel", "button primary");
  submit.type = "submit";
  form.append(wordField(token, undefined, true), submit);
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!token.value.trim()) return;
    localStorage.setItem(ADMIN_TOKEN_KEY, token.value.trim());
    window.location.reload();
  };
  panel.append(el("h2", "focus-title", "Admin access"), el("p", "prompt", "Enter the admin token provided by your administrator."), form);
  return panel;
}

function adminWorkspace(token: string): HTMLElement {
  const panel = el("section", "panel admin-panel");
  const host = el("div", "admin-host");
  type Section = "words" | "reading" | "dictation";
  const sections = new Map<Section, HTMLElement>();
  const initialized = new Set<Section>();
  const fromHash = (): Section => location.hash === "#reading" ? "reading" : location.hash === "#dictation" ? "dictation" : "words";
  let activeTab = fromHash();
  const show = (value: Section): void => {
    activeTab = value;
    let section = sections.get(value);
    if (!initialized.has(value)) {
      section = sections.get(value)!;
      initialized.add(value);
      if (value === "words") renderWordsAdmin(section, token);
      else if (value === "reading") renderReadingAdmin(section, token);
      else renderDictationAdmin(section, token);
    }
    sections.forEach((section, key) => { section.hidden = key !== value; });
    if (location.hash !== `#${value}`) location.hash = value;
  };

  const tabs = SegmentedControl({
    label: "Admin section",
    value: activeTab,
    fill: false,
    options: [
      { value: "words", label: "Vocabulary" },
      { value: "reading", label: "Reading" },
      { value: "dictation", label: "Dictation" },
    ],
    onChange: (value) => {
      show(value);
    },
  });
  tabs.classList.add("admin-section-tabs");
  for (const value of ["words", "reading", "dictation"] as const) {
    const section = el("div", "admin-section-host");
    section.id = `admin-section-${value}`;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", `admin-tab-${value}`);
    section.hidden = true;
    sections.set(value, section);
    host.append(section);
  }
  tabs.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((tab) => {
    tab.id = `admin-tab-${tab.dataset.value}`;
    tab.setAttribute("aria-controls", `admin-section-${tab.dataset.value}`);
  });
  window.addEventListener("hashchange", () => {
    const value = fromHash();
    if (value !== activeTab) { show(value); tabs.setValue(value); }
  });
  panel.append(tabs, host);
  show(activeTab);
  return panel;
}

type WordEditorState = DraftState<AdminWord>;

function renderWordsAdmin(host: HTMLElement, token: string): void {
  const state = readDraft<AdminWord>("words", { selected: emptyWord(), isNew: true });
  let words: AdminWord[] = [];
  const { wrap, listPanel, editor } = adminMasterDetailLayout();
  host.replaceChildren(wrap);
  const renderEditor = (): void => {
    renderWordEditor(editor, token, state, loadWords);
    list.updateSelection();
  };
  const list = adminContentList({
    title: "Words", noun: "word", topics: true,
    selectedId: () => state.isNew ? undefined : state.selected.word,
    errorMessage: adminErrorMessage,
    onNew: async () => {
      if (!await leaveEditor(editor)) return;
      state.selected = emptyWord(); state.draft = undefined; state.isNew = true; state.notice = undefined;
      renderEditor(); showAdminEditor(wrap);
    },
    onSelect: async (id) => {
      if (!await leaveEditor(editor)) return;
      state.selected = cloneWord(words.find((word) => word.word === id)!);
      state.draft = undefined; state.isNew = false; state.notice = undefined;
      renderEditor(); showAdminEditor(wrap);
    },
    onImport: async () => {
      if (!await leaveEditor(editor)) return;
      openAdminImportDialog({
        title: "Import words", accept: ".csv,.json,application/json,text/csv", kind: "words",
        parse: parseWordImportFile, preview: (items) => previewAdminWordImport(token, items),
        commit: (items) => importAdminWords(token, items), onImported: async () => {
          await loadWords();
          const updated = words.find((word) => word.word === state.selected.word);
          if (!state.isNew && updated) { state.selected = cloneWord(updated); renderEditor(); }
        },
      });
    },
    onRefresh: loadWords,
    bulk: [{ label: "Delete selected", run: async (ids) => {
      if (!await leaveEditor(editor)) return false;
      if (!await confirmAdminAction(`Delete ${ids.length} words?`, "These words and their practice-topic assignments will be removed. This cannot be undone.", "Delete words")) return false;
      await runContentBatch(ids, (id) => deleteAdminWord(token, id), loadWords, (successful) => {
        if (successful.includes(state.selected.word)) {
          state.selected = emptyWord(); state.draft = undefined; state.isNew = true; renderEditor();
        }
      });
    } }],
  });
  listPanel.replaceWith(list.node);
  async function loadWords(): Promise<void> {
    list.setStatus(true);
    try {
      words = await getAdminWords(token);
      list.setItems(words.map((word) => ({
        id: word.word, title: word.article ? `${word.article} ${word.word}` : word.word,
        meta: `${word.part_of_speech} · ${word.focus_entries.map((entry) => `${entry.level} ${entry.topic}`).join(", ") || "No practice topics"}`,
        level: word.focus_entries.map((entry) => entry.level), topic: word.focus_entries.map((entry) => entry.topic),
        searchText: word.meaning, assignments: word.focus_entries,
      })));
      list.setStatus(false);
    } catch (error) { list.setStatus(false, error); }
  }
  renderEditor();
  if (state.draft) showAdminEditor(wrap);
  void loadWords();
}

function renderWordEditor(host: HTMLElement, token: string, state: WordEditorState, onSaved: () => Promise<void>): void {
  const initial = state.draft ?? state.selected;
  const editorForm = adminEditorForm();
  const word = input("Word", initial.word);
  word.disabled = !state.isNew;
  const partOfSpeech = selectPartOfSpeech(initial.part_of_speech);
  const article = articleSegmentedControl(initial.article, partOfSpeech.value === "noun");
  const meaning = textarea("Meaning", initial.meaning, 5);
  const focusEntries = focusEntriesRepeater(initial.focus_entries);
  const status = editorStatus(state.notice ?? (state.draft ? "Recovered unsaved changes. Review and save when ready." : ""));
  const validation = createFormValidation(status);
  validation.register("word", word); validation.register("meaning", meaning); validation.register("part_of_speech", partOfSpeech);
  const value = (): AdminWord => ({
    word: word.value.trim(), article: partOfSpeech.value === "noun" ? article.value() : null,
    part_of_speech: partOfSpeech.value, meaning: meaning.value.trim(), focus_entries: focusEntries.value(),
  });
  const discard = (): void => { state.draft = undefined; state.notice = undefined; removeDraft("words"); };
  const saveWord = async (): Promise<boolean> => {
    if (editorIsBusy(host)) return false;
    validation.clear();
    const issues: FieldValidationIssue[] = [];
    if (!word.value.trim()) issues.push({ field: "word", message: "Enter the German word.", control: word });
    if (!meaning.value.trim()) issues.push({ field: "meaning", message: "Enter a meaning.", control: meaning });
    if (validation.show(issues)) return false;
    setEditorBusy(host, true);
    status.textContent = "Saving word…";
    let saved = false;
    try {
      state.selected = state.isNew ? await createAdminWord(token, value()) : await updateAdminWord(token, value());
      state.isNew = false; discard(); editorSaved(host);
      state.notice = `Saved ${state.selected.word}.`;
      await onSaved();
      saved = true;
    } catch (error) {
      if (!validation.show(fieldErrorsFromUnknown(error))) setErrorStatus(status, error);
    } finally { setEditorBusy(host, false); }
    if (saved) { renderWordEditor(host, token, state, onSaved); host.querySelector<HTMLButtonElement>("[data-save]")?.focus({ preventScroll: true }); }
    return saved;
  };
  partOfSpeech.addEventListener("change", () => article.setEnabled(partOfSpeech.value === "noun"));
  const save = button(state.isNew ? "Create word" : "Save word", "button primary");
  save.dataset.save = "true";
  save.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
  save.onclick = () => void saveWord();
  const cancel = button("Discard changes", "button");
  cancel.onclick = async () => {
    if (state.draft && !await confirmAdminAction("Discard changes?", "Your unsaved changes to this word will be removed.", "Discard changes")) return;
    discard(); editorSaved(host);
    if (state.isNew) state.selected = emptyWord();
    renderWordEditor(host, token, state, onSaved);
  };
  const metaGrid = el("div", "admin-vocab-meta-grid");
  metaGrid.append(wordField(word, undefined, true), wordField(article.node, "Article"), wordField(partOfSpeech, "Part of speech"));
  const formFields = el("div", "admin-form-fields");
  formFields.append(metaGrid, wordField(meaning, undefined, true), focusEntries.node);
  editorForm.append(formFields, editorActionBar(status, cancel, save));
  const header = el("div", "admin-editor-header");
  const heading = el("h2", "focus-title", state.isNew ? "New word" : state.selected.word);
  heading.tabIndex = -1;
  header.append(heading);
  if (!state.isNew) {
    const remove = button("Delete word", "admin-text-button danger-text-button");
    remove.onclick = async () => {
      if (editorIsBusy(host) || !await confirmAdminAction(`Delete ${state.selected.word}?`, "This word and its practice-topic assignments will be permanently removed.", "Delete word")) return;
      setEditorBusy(host, true);
      let deleted = false;
      try {
        await deleteAdminWord(token, state.selected.word);
        discard(); editorSaved(host); state.selected = emptyWord(); state.isNew = true;
        state.notice = "Word deleted."; await onSaved(); deleted = true;
      } catch (error) { setErrorStatus(status, error); }
      finally { setEditorBusy(host, false); }
      if (deleted) renderWordEditor(host, token, state, onSaved);
    };
    header.append(remove);
  }
  host.replaceChildren(header, editorForm);
  registerEditor(host, editorForm, {
    dirty: Boolean(state.draft), save: saveWord,
    discard: () => { discard(); renderWordEditor(host, token, state, onSaved); },
    capture: () => { state.draft = value(); storeDraft("words", state); },
    changed: () => setDirtyStatus(status),
  });
  editorForm.onkeydown = (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveWord(); }
  };
}

type ReadingEditorState = DraftState<AdminReadingPassage> & { activeGroup: AdminReadingGroup };

function renderReadingAdmin(host: HTMLElement, token: string): void {
  let rememberedGroup: AdminReadingGroup = "general";
  try { rememberedGroup = sessionStorage.getItem("admin-reading-group") === "goethe" ? "goethe" : "general"; } catch { /* Optional preference. */ }
  const state: ReadingEditorState = { ...readDraft<AdminReadingPassage>(`reading-${rememberedGroup}`, { selected: emptyPassage(rememberedGroup), isNew: true }), activeGroup: rememberedGroup };
  const { wrap, listPanel, editor } = adminMasterDetailLayout();
  host.replaceChildren(wrap);
  const renderEditor = (): void => {
    renderPassageEditor(editor, token, state, loadPassages);
    list.updateSelection();
  };
  const collection = SegmentedControl<AdminReadingGroup>({
    label: "Reading collection", value: state.activeGroup, fill: true,
    role: "radiogroup",
    options: [{ value: "general", label: "General" }, { value: "goethe", label: "Goethe" }],
    onChange: (group) => {
      void (async () => {
        if (!await leaveEditor(editor)) return;
        state.activeGroup = group;
        Object.assign(state, readDraft<AdminReadingPassage>(`reading-${group}`, { selected: emptyPassage(group), isNew: true, draft: undefined, notice: undefined }));
        try { sessionStorage.setItem("admin-reading-group", group); } catch { /* Optional preference. */ }
        collection.setValue(group); renderEditor(); await loadPassages();
      })();
      return false;
    },
  });
  collection.classList.add("admin-reading-tabs");
  const changePublication = async (ids: string[], publication: "draft" | "published"): Promise<void | boolean> => {
    if (!await leaveEditor(editor)) return false;
    if (!await confirmAdminAction(`${publication === "published" ? "Publish" : "Unpublish"} ${ids.length} passages?`, publication === "published" ? "These passages will appear in learner practice. Review their content before publishing." : "These passages will become drafts and disappear from learner practice.", publication === "published" ? "Publish passages" : "Move to drafts")) return false;
    await runContentBatch(ids, async (id) => {
      const passage = await getAdminReadingPassage(token, id);
      const updated = await updateAdminReadingPassage(token, { ...passage, status: publication });
      if (!state.isNew && state.selected.id === id) state.selected = updated;
    }, loadPassages, () => renderEditor());
  };
  const list = adminContentList({
    title: "Passages", noun: "passage", publication: true, collection,
    selectedId: () => state.isNew ? undefined : state.selected.id,
    errorMessage: adminErrorMessage,
    onNew: async () => {
      if (!await leaveEditor(editor)) return;
      state.selected = emptyPassage(state.activeGroup); state.draft = undefined; state.isNew = true; state.notice = undefined;
      renderEditor(); showAdminEditor(wrap);
    },
    onSelect: async (id) => {
      if (!await leaveEditor(editor)) return;
      const passage = await getAdminReadingPassage(token, id);
      state.selected = passage; state.draft = undefined; state.isNew = false; state.notice = undefined;
      renderEditor(); showAdminEditor(wrap);
    },
    onImport: async () => {
      if (!await leaveEditor(editor)) return;
      openAdminImportDialog({
        title: "Import passages", accept: ".json,application/json", kind: "reading",
        parse: parseJsonImportFile, preview: (items) => previewAdminReadingImport(token, items),
        commit: (items) => importAdminReading(token, items), onImported: async () => {
          await loadPassages();
          if (!state.isNew && state.selected.id) {
            try { state.selected = await getAdminReadingPassage(token, state.selected.id); }
            catch { state.notice = "Import complete. Reselect this passage to load its updated content."; }
            renderEditor();
          }
        },
      });
    },
    onRefresh: loadPassages,
    bulk: [
      { label: "Publish", run: (ids) => changePublication(ids, "published") },
      { label: "Move to drafts", run: (ids) => changePublication(ids, "draft") },
      { label: "Delete", run: async (ids) => {
        if (!await leaveEditor(editor)) return false;
        if (!await confirmAdminAction(`Delete ${ids.length} passages?`, "The passages and their questions will be permanently removed.", "Delete passages")) return false;
        await runContentBatch(ids, (id) => deleteAdminReadingPassage(token, id), loadPassages, (successful) => {
          if (state.selected.id && successful.includes(state.selected.id)) {
            state.selected = emptyPassage(state.activeGroup); state.draft = undefined; state.isNew = true; renderEditor();
          }
        });
      } },
    ],
  });
  listPanel.replaceWith(list.node);
  async function loadPassages(): Promise<void> {
    list.setStatus(true);
    try {
      const passages = await getAdminReadingPassages(token, { group: state.activeGroup });
      list.setItems(passages.map((passage) => ({
        id: passage.id, title: passage.title,
        meta: `${passage.level}${passage.part ? ` · ${partLabel(passage.part)}` : ""} · ${formatCount(passage.question_count, "question", { zeroLabel: "No" })} · ${passage.status === "published" ? "Published" : "Draft"}`,
        level: [passage.level], status: passage.status,
      })));
      list.setStatus(false);
    } catch (error) { list.setStatus(false, error); }
  }
  renderEditor();
  if (state.draft) showAdminEditor(wrap);
  void loadPassages();
}

async function runContentBatch(ids: string[], action: (id: string) => Promise<void>, refresh: () => Promise<void>, completed: (ids: string[]) => void): Promise<void> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try { await action(id); succeeded.push(id); } catch { failed.push(id); }
  }
  completed(succeeded);
  await refresh();
  if (failed.length) throw Object.assign(new Error(`${succeeded.length} completed; ${failed.length} could not be updated: ${failed.join(", ")}. The remaining items are still selected. Try again.`), { completedIds: succeeded });
}

function showAdminEditor(wrap: HTMLElement): void {
  wrap.dataset.view = "editor";
  wrap.querySelector<HTMLElement>(".admin-editor h2")?.focus({ preventScroll: true });
  if (matchMedia("(max-width: 820px)").matches) {
    window.scrollTo({ top: 0 });
  }
}

function renderPassageEditor(
  host: HTMLElement,
  token: string,
  state: ReadingEditorState,
  onSaved: () => Promise<void>,
): void {
  const initial = state.draft ?? state.selected;
  const level = selectLevel(initial.level);
  const part = selectGoethePart(initial.part ?? "teil_1");
  const topic = input("Topic", initial.topic ?? "");
  const contextLabel = input("Context label", initial.context_label ?? "");
  const title = input("Title", initial.title);
  const passage = textarea("Passage text", initial.passage_text, 10);
  const questions = el("div", "admin-question-list");
  const firstQuestion = initial.questions[0] ?? emptyQuestion(0);
  const sourceSituation = textarea("Situation", firstQuestion.prompt, 3);
  const sourceExplanation = textarea("Explanation after answer", firstQuestion.explanation ?? "", 3);
  const correctSource = selectSourceAnswer(firstQuestion);
  const noticeEditor = createStimulusEditor(
    {
      id: initial.id,
      title: initial.title,
      body: initial.passage_text,
      context_label: initial.context_label,
      render_kind: initial.render_kind,
      content: initial.content,
      image_url: initial.image_url,
      image_path: initial.image_path,
      transcript: initial.transcript,
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
      initial.ad_stimuli?.[index] ?? emptyAdStimulus(key, index),
      key,
      (stimulusId, file) => createStimulusImageUploadUrl(token, stimulusId, file),
    ),
  );
  const sourceChoicePanel = sourceChoiceSection(sourceSituation, sourceExplanation, correctSource, adControls);
  const preview = el("section", "admin-reading-preview");
  const formFields = el("div", "admin-form-fields");
  const shape = (): ReadingShape =>
    resolveReadingShape(state.activeGroup, level.value as AdminLevel, part.value as AdminGoethePart);
  const activeSpec = (): GoethePartSpec | null =>
    state.activeGroup === "goethe" ? goethePartSpec(level.value as AdminLevel, part.value as AdminGoethePart) : null;
  let questionControls = initial.questions.map((question) => questionBlockForShape(question, shape(), activeSpec()));
  if (questionControls.length === 0) {
    questionControls = [questionBlockForShape(emptyQuestion(0, activeSpec()?.defaultOptions), shape(), activeSpec())];
  }
  const addTemplate = button("+ Add question", "button primary");
  const renderQuestions = (): void => {
    questions.replaceChildren(
      ...questionControls.map((control, index) => {
        control.title.textContent = `Question ${index + 1}`;
        if (!control.node.dataset.initialized) {
          (control.node as HTMLDetailsElement).open = index === 0;
          control.node.dataset.initialized = "true";
        }
        control.remove.disabled = questionControls.length === 1;
        control.remove.onclick = () => {
          questionControls.splice(index, 1);
          renderQuestions();
          renderForm();
          editorChanged(editorForm);
        };
        return control.node;
      }),
      addTemplate,
    );
  };
  renderQuestions();
  const editorForm = adminEditorForm();
  const status = editorStatus(state.notice ?? (state.draft ? "Recovered unsaved changes. Review and save when ready." : ""));
  const metaGrid = el("div", "admin-reading-meta-grid");
  const formScroll = el("div", "form-scroll");
  const questionSectionNode = questionSection(questions);
  const validation = createFormValidation(status);
  validation.register("title", title);
  validation.register("passage_text", passage);
  validation.register("prompt", sourceSituation);

  const sourceQuestions = (): AdminReadingQuestion[] => {
    try {
      return collectSourceChoiceQuestion(sourceSituation, sourceExplanation, correctSource, adControls);
    } catch {
      return [
        {
          prompt: sourceSituation.value,
          explanation: sourceExplanation.value || null,
          order_index: 0,
          answers: sourceAnswerRows(correctSource, adControls),
        },
      ];
    }
  };

  const currentValue = (strict = false): AdminReadingPassage => {
    const activeShape = shape();
    const notice = noticeEditor.getValue();
    return {
      id: state.selected.id, group: state.activeGroup, level: level.value as AdminLevel,
      part: state.activeGroup === "goethe" ? part.value as AdminGoethePart : null,
      title: title.value.trim(),
      passage_text: activeShape === "goethe_source_choice" ? sourceChoiceInstruction(adControls)
        : activeShape === "goethe_true_false_notice" ? notice.body : passage.value.trim(),
      context_label: activeShape === "goethe_true_false_notice" ? contextLabel.value.trim() || null : null,
      image_url: initial.image_url,
      render_kind: activeShape === "goethe_true_false_notice" ? notice.render_kind : "text",
      content: activeShape === "goethe_true_false_notice" ? notice.content : null,
      image_path: activeShape === "goethe_true_false_notice" ? notice.image_path : null,
      transcript: activeShape === "goethe_true_false_notice" ? notice.transcript : null,
      topic: state.activeGroup === "general" ? topic.value.trim() || null : null,
      status: state.selected.status, order_index: state.selected.order_index,
      questions: activeShape === "goethe_source_choice"
        ? strict ? collectSourceChoiceQuestion(sourceSituation, sourceExplanation, correctSource, adControls) : sourceQuestions()
        : strict ? collectQuestionBlocks(questionControls) : collectQuestionBlocksSafely(questionControls),
      ad_stimuli: activeShape === "goethe_source_choice" ? strict ? collectAdStimuli(adControls) : collectAdStimuliSafely(adControls) : [],
    };
  };
  const renderPreviewState = (): void => renderReadingPreview(preview, currentValue());

  const renderForm = (): void => {
    syncGoethePartOptions(part, level.value as AdminLevel);
    const activeShape = shape();
    let questionShapeChanged = false;
    questionControls = questionControls.map((control, index) => {
      if (questionBlockMatchesShape(control, activeShape)) return control;
      questionShapeChanged = true;
      return questionBlockForShape(questionFromBlockSafely(control, index), activeShape, activeSpec(), true);
    });
    if (questionShapeChanged) renderQuestions();
    const metaFields = [wordField(level, "Level")];
    if (state.activeGroup === "goethe") {
      metaFields.push(wordField(part, "Goethe Teil"));
    } else {
      metaFields.push(wordField(topic));
    }
    metaGrid.replaceChildren(...metaFields);

    const stimulusFields: HTMLElement[] = [wordField(title, undefined, true)];
    if (activeShape === "goethe_source_choice") {
      stimulusFields.push(sourceChoicePanel);
    } else {
      const spec = activeSpec();
      if (spec) stimulusFields.push(el("p", "prompt admin-goethe-shape-note", spec.description));
      if (activeShape === "goethe_true_false_notice") {
        stimulusFields.push(wordField(contextLabel), noticeEditor.node);
      }
      stimulusFields.push(wordField(passage, undefined, true), questionSectionNode);
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
      syncGoethePartOptions(part, previousLevel as AdminLevel);
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
    control.editor.node.addEventListener("change", renderPreviewState);
    control.editor.node.addEventListener("change", () => updateCorrectSourceOptions(correctSource, adControls));
  }
  updateCorrectSourceOptions(correctSource, adControls);

  const draftKey = `reading-${state.activeGroup}`;
  const discard = (): void => { state.draft = undefined; state.notice = undefined; removeDraft(draftKey); };
  const savePassage = async (publication = state.selected.status): Promise<boolean> => {
    if (editorIsBusy(host)) return false;
    validation.clear();
    if (validation.show(validatePassageClientFields(shape(), title, passage, sourceSituation, adControls))) return false;
    let payload: AdminReadingPassage;
    try { payload = { ...currentValue(true), status: publication }; }
    catch (error) { setErrorStatus(status, error); return false; }
    if (publication !== state.selected.status && !await confirmAdminAction(
      publication === "published" ? "Publish this passage?" : "Move this passage to drafts?",
      publication === "published" ? "This passage and its questions will become available in learner practice." : "Learners will no longer see this passage in practice.",
      publication === "published" ? "Publish passage" : "Move to drafts",
    )) return false;
    setEditorBusy(host, true);
    status.textContent = publication === "published" ? "Saving published passage…" : "Saving draft…";
    let saved = false;
    try {
      state.selected = state.isNew ? await createAdminReadingPassage(token, payload) : await updateAdminReadingPassage(token, payload);
      state.isNew = false; discard(); editorSaved(host);
      state.notice = state.selected.status === "published" ? "Saved. This passage is available to learners." : "Draft saved. Learners cannot see this passage.";
      await onSaved(); saved = true;
    } catch (error) {
      if (!validation.show(fieldErrorsFromUnknown(error))) setErrorStatus(status, error);
    } finally { setEditorBusy(host, false); }
    if (saved) {
      renderPassageEditor(host, token, state, onSaved);
      host.querySelector<HTMLButtonElement>("[data-save]")?.focus({ preventScroll: true });
    }
    return saved;
  };
  editorForm.onkeydown = (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void savePassage(); }
  };
  const save = button(state.selected.status === "published" ? "Save changes" : "Save draft", "button primary");
  save.dataset.save = "true";
  save.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
  save.onclick = () => void savePassage();
  const publicationAction = button(state.selected.status === "published" ? "Move to drafts" : "Publish", "button");
  publicationAction.onclick = () => void savePassage(state.selected.status === "published" ? "draft" : "published");

  addTemplate.addEventListener("click", () => {
    questionControls.forEach((control) => { (control.node as HTMLDetailsElement).open = false; });
    questionControls.push(questionBlockForShape(emptyQuestion(questionControls.length, activeSpec()?.defaultOptions), shape(), activeSpec()));
    renderQuestions();
    (questionControls[questionControls.length - 1].node as HTMLDetailsElement).open = true;
    renderForm();
    editorChanged(editorForm);
  });

  const cancel = button("Discard changes", "button");
  cancel.onclick = async () => {
    if (state.draft && !await confirmAdminAction("Discard changes?", "Your unsaved changes to this passage will be removed.", "Discard changes")) return;
    discard(); editorSaved(host);
    if (state.isNew) state.selected = emptyPassage(state.activeGroup);
    renderPassageEditor(host, token, state, onSaved);
  };

  renderForm();

  const header = el("div", "admin-editor-header");
  const heading = el("h2", "focus-title", state.isNew ? "New passage" : state.selected.title);
  heading.tabIndex = -1;
  const publicationStatus = el("p", "prompt admin-publication-status", state.selected.status === "published"
    ? "Published · Saving updates learner content." : "Draft · Only admins can see this passage.");
  const titleGroup = el("div", "admin-editor-title");
  titleGroup.append(heading, publicationStatus);
  header.append(titleGroup);
  if (!state.isNew) {
    const remove = button("Delete passage", "admin-text-button danger-text-button");
    remove.onclick = async () => {
      if (editorIsBusy(host) || !state.selected.id || !await confirmAdminAction(`Delete ${state.selected.title}?`, "The passage and its questions will be permanently removed.", "Delete passage")) return;
      setEditorBusy(host, true);
      let deleted = false;
      try {
        await deleteAdminReadingPassage(token, state.selected.id);
        discard(); editorSaved(host); state.selected = emptyPassage(state.activeGroup); state.isNew = true;
        state.notice = "Passage deleted."; await onSaved(); deleted = true;
      } catch (error) { setErrorStatus(status, error); }
      finally { setEditorBusy(host, false); }
      if (deleted) renderPassageEditor(host, token, state, onSaved);
    };
    header.append(remove);
  }

  const actions = editorActionBar(status, cancel, save);
  actions.querySelector(".admin-action-buttons")?.prepend(publicationAction);
  formScroll.append(metaGrid, formFields);
  editorForm.append(formScroll, actions);

  const previewColumn = el("aside", "admin-preview-column");
  previewColumn.append(preview);
  const editorLayout = el("div", "admin-passage-editor");
  editorLayout.append(editorForm, previewColumn);
  const viewToggle = SegmentedControl({
    label: "Reading workspace", value: "editor", role: "radiogroup",
    options: [{ value: "editor", label: "Editor" }, { value: "preview", label: "Preview" }],
    onChange: (value) => { editorLayout.dataset.view = value; },
  });
  viewToggle.classList.add("admin-preview-toggle");
  editorLayout.dataset.view = "editor";
  host.replaceChildren(header, viewToggle, editorLayout);
  registerEditor(host, editorForm, {
    dirty: Boolean(state.draft), save: () => savePassage(),
    discard: () => { discard(); renderPassageEditor(host, token, state, onSaved); },
    capture: () => { state.draft = currentValue(); storeDraft(draftKey, state); },
    changed: () => { setDirtyStatus(status); renderPreviewState(); },
  });
}

type AdminImportDialogOptions = {
  title: string;
  accept: string;
  kind: "words" | "reading";
  parse: (file: File) => Promise<Record<string, unknown>[]>;
  preview: (items: Record<string, unknown>[]) => Promise<AdminImportResult>;
  commit: (items: Record<string, unknown>[]) => Promise<AdminImportResult>;
  onImported: () => void | Promise<void>;
};

function openAdminImportDialog(options: AdminImportDialogOptions): void {
  let parsedItems: Record<string, unknown>[] = [];
  let previewResult: AdminImportResult | null = null;
  let committing = false;
  let previewing = false;
  const { dialog, content, actions, close } = adminDialog(options.title,
    options.kind === "words" ? "Upload CSV or JSON. Existing words are updated by their German word; new words are created."
      : "Upload JSON with passages, questions, and answers. Existing IDs are updated. New passages default to drafts; explicit published status makes them visible to learners.");
  const templates = el("div", "admin-template-links");
  const urls: string[] = [];
  for (const [name, text, type] of options.kind === "words"
    ? [["words.csv", wordsCsvTemplate, "text/csv"], ["words.json", wordsJsonTemplate, "application/json"]]
    : [["reading-passages.json", readingJsonTemplate, "application/json"]]) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([text], { type }));
    urls.push(url); link.href = url; link.download = name; link.textContent = `Download ${name} template`;
    templates.append(link);
  }
  dialog.addEventListener("close", () => urls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
  dialog.addEventListener("cancel", (event) => { if (committing) event.preventDefault(); });
  const file = document.createElement("input");
  file.type = "file"; file.accept = options.accept; file.className = "admin-input";
  const status = editorStatus("Choose a file to validate and preview. No content changes until you import.");
  const resultHost = el("div", "admin-import-results");
  const cancel = button("Cancel", "button");
  const runImport = button("Import", "button primary");
  runImport.disabled = true;
  cancel.onclick = close;
  file.onchange = async () => {
    const selectedFile = file.files?.[0];
    parsedItems = []; previewResult = null; runImport.disabled = true; resultHost.replaceChildren();
    if (!selectedFile) return;
    previewing = true; file.disabled = true;
    try {
      status.textContent = "Validating file and checking existing content…";
      parsedItems = await options.parse(selectedFile);
      if (options.kind === "reading") parsedItems = parsedItems.map((item) => ({ ...item, status: item.status ?? "draft" }));
      previewResult = await options.preview(parsedItems);
      renderImportResult(resultHost, previewResult, true);
      runImport.disabled = previewResult.errors.length > 0 || previewResult.valid === 0;
      runImport.textContent = `Import ${previewResult.valid} ${previewResult.valid === 1 ? "item" : "items"}`;
      status.textContent = previewResult.errors.length ? "No changes made. Fix the listed rows and choose the file again." : "Preview ready. Check the changes before importing.";
    } catch (error) { status.textContent = adminErrorMessage(error); }
    finally { previewing = false; file.disabled = false; }
  };
  runImport.onclick = async () => {
    if (committing || previewing || !previewResult || previewResult.errors.length || !parsedItems.length) return;
    committing = true; runImport.disabled = true; file.disabled = true; cancel.disabled = true;
    dialog.setAttribute("aria-busy", "true");
    try {
      status.textContent = "Importing content. Keep this window open…";
      const result = await options.commit(parsedItems);
      renderImportResult(resultHost, result, false);
      if (result.errors.length) {
        status.textContent = "No content was imported. Fix the listed rows and choose the file again.";
        previewResult = null;
      } else {
        status.textContent = `Import complete. ${result.created} created, ${result.updated} updated.`;
        previewResult = null; runImport.hidden = true; cancel.textContent = "Close";
        await options.onImported();
      }
    } catch (error) { status.textContent = adminErrorMessage(error); runImport.disabled = false; }
    finally { committing = false; file.disabled = false; cancel.disabled = false; dialog.setAttribute("aria-busy", "false"); }
  };
  content.append(templates);
  if (options.kind === "words") content.append(el("p", "prompt", "Practice topics in CSV use LEVEL:topic_slug; for example A1:travel_transport;A2:city_places."));
  content.append(wordField(file, "File"), status, resultHost);
  actions.append(cancel, runImport);
  file.focus();
}

async function parseJsonImportFile(file: File): Promise<Record<string, unknown>[]> {
  let payload: unknown;
  try { payload = JSON.parse(await file.text()); }
  catch { throw new Error("This file is not valid JSON. Check quotes and commas, then choose the file again."); }
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : null;
  if (!items) throw new Error("JSON must be an array or an object with an items array.");
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Every imported item must be an object.");
    }
    return item as Record<string, unknown>;
  });
}

async function parseWordImportFile(file: File): Promise<Record<string, unknown>[]> {
  if (file.name.toLowerCase().endsWith(".json") || file.type.includes("json")) {
    return parseJsonImportFile(file);
  }
  return parseWordCsv(await file.text());
}

function parseWordCsv(text: string): Record<string, unknown>[] {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one word row.");
  const headers = rows[0].map((header) => header.trim());
  const required = ["word", "part_of_speech", "meaning"];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`CSV is missing: ${missing.join(", ")}.`);
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index]?.trim() ?? "";
    });
    return {
      word: record.word,
      article: record.article || null,
      part_of_speech: record.part_of_speech,
      meaning: record.meaning,
      focus_entries: parseFocusEntriesCell(record.focus_entries ?? ""),
    };
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function parseFocusEntriesCell(value: string): AdminFocusEntry[] {
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [level, topic] = entry.split(":");
      return {
        level: (level?.trim() || "A1") as AdminLevel,
        topic: topic?.trim() ?? "",
      };
    })
    .filter((entry) => entry.topic);
}

function renderImportResult(host: HTMLElement, result: AdminImportResult, preview = false): void {
  const summary = el("div", "admin-import-summary");
  summary.append(
    importMetric("Total", result.total),
    importMetric("Valid", result.valid),
    importMetric(preview ? "Will create" : "Created", result.created),
    importMetric(preview ? "Will update" : "Updated", result.updated),
    importMetric("Errors", result.errors.length),
  );
  const children: HTMLElement[] = [summary];
  if (result.errors.length) {
    const list = el("div", "admin-import-errors");
    for (const error of result.errors.slice(0, 20)) {
      list.append(el("p", "", `Row ${error.row} · ${error.field}: ${error.message}`));
    }
    if (result.errors.length > 20) {
      list.append(el("p", "", `${result.errors.length - 20} more errors.`));
    }
    children.push(list);
  }
  host.replaceChildren(...children);
}

function importMetric(label: string, value: number): HTMLElement {
  const node = el("div", "admin-import-metric");
  node.append(el("span", "", label), el("strong", "", String(value)));
  return node;
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
  const back = button("Back to results", "button admin-back-to-list");
  back.onclick = () => {
    wrap.dataset.view = "list";
    wrap.querySelector<HTMLInputElement>(".admin-list input[type=search]")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  };
  wrap.dataset.view = "list";
  wrap.append(back, listPanel, editor);
  return { wrap, listPanel, editor };
}

function editorActionBar(status: HTMLElement, cancel: HTMLButtonElement, save: HTMLButtonElement): HTMLElement {
  const actions = el("div", "admin-action-bar");
  const actionButtons = el("div", "admin-action-buttons");
  actionButtons.append(cancel, save);
  const feedback = el("div", "admin-save-feedback");
  feedback.append(status, el("span", "prompt admin-shortcut-hint", "Save: Ctrl / ⌘ + Enter"));
  actions.append(feedback, actionButtons);
  return actions;
}

type QuestionBlock = {
  node: HTMLElement;
  title: HTMLElement;
  prompt: HTMLTextAreaElement;
  explanation: HTMLTextAreaElement;
  remove: HTMLButtonElement;
  shape: ReadingShape;
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

function questionBlockForShape(
  question: AdminReadingQuestion,
  shape: ReadingShape,
  spec: GoethePartSpec | null = null,
  resetOptions = false,
): QuestionBlock {
  if (isTrueFalseShape(shape)) return trueFalseQuestionBlock(question, shape);
  const normalizedQuestion = resetOptions
    ? replaceQuestionOptions(question, spec?.defaultOptions)
    : normalizeQuestionOptions(question, spec?.defaultOptions);
  return standardQuestionBlock(normalizedQuestion, shape);
}

function questionBlockMatchesShape(block: QuestionBlock, shape: ReadingShape): boolean {
  return block.shape === shape;
}

function normalizeQuestionOptions(
  question: AdminReadingQuestion,
  defaultOptions: string[] | undefined,
): AdminReadingQuestion {
  if (!defaultOptions?.length) {
    return question;
  }
  const hasEnteredAnswers = question.answers.some((answer) => answer.answer_text.trim());
  const inheritedTrueFalse = answerSet(question) === "falsch|richtig";
  if (hasEnteredAnswers && !inheritedTrueFalse) return question;
  return replaceQuestionOptions(question, defaultOptions);
}

function replaceQuestionOptions(
  question: AdminReadingQuestion,
  defaultOptions: string[] | undefined,
): AdminReadingQuestion {
  if (!defaultOptions?.length) {
    return { ...question, answers: emptyQuestion(question.order_index).answers };
  }
  return {
    ...question,
    answers: defaultOptions.map((option, index) => ({
      answer_text: option,
      is_correct: index === 0,
      order_index: index,
    })),
  };
}

function answerSet(question: AdminReadingQuestion): string {
  return question.answers
    .map((answer) => answer.answer_text.trim().toLocaleLowerCase("de-DE"))
    .filter(Boolean)
    .sort()
    .join("|");
}

function trueFalseQuestionBlock(question: AdminReadingQuestion, shape: ReadingShape): QuestionBlock {
  let selected: TrueFalseAnswer = canonicalTrueFalseAnswer(question);
  const node = document.createElement("details");
  node.className = "admin-question-block";
  const title = el("h3", "admin-question-title", "Question");
  const prompt = textarea("Prompt", question.prompt, 3);
  const explanation = textarea("Explanation after answer", question.explanation ?? "", 3);
  const remove = button("Remove question", "admin-text-button danger-text-button");
  const header = questionBlockHeader(title, remove);
  const answer = SegmentedControl<TrueFalseAnswer>({
    label: "Correct answer",
    role: "radiogroup",
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
  return { node, title, prompt, explanation, remove, shape, mode: "true_false", trueFalseAnswer: () => selected };
}

function standardQuestionBlock(question: AdminReadingQuestion, shape: ReadingShape): QuestionBlock {
  const sortedAnswers = question.answers.length > 0
    ? [...question.answers].sort((first, second) => first.order_index - second.order_index)
    : emptyQuestion(question.order_index).answers;

  const node = document.createElement("details");
  node.className = "admin-question-block";
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
      const labelAnswer = (): void => option.radio.setAttribute("aria-label", `Correct answer: option ${index + 1}${option.text.value.trim() ? `, ${option.text.value.trim()}` : ""}`);
      labelAnswer();
      option.text.oninput = labelAnswer;
      option.text.setAttribute("aria-label", `Answer option ${index + 1}`);
      option.remove.setAttribute("aria-label", `Remove option ${index + 1}`);
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
      editorChanged(node);
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
    optionEditors[optionEditors.length - 1].text.focus();
    editorChanged(node);
  });

  node.append(
    header,
    wordField(prompt),
    wordField(optionsWrap, "Options"),
    el("p", "prompt", "Select the radio beside the answer learners should choose."),
    addOptionButton,
    wordField(explanation),
  );
  return {
    node,
    title,
    prompt,
    explanation,
    remove,
    shape,
    mode: "standard",
    options: optionEditors,
    addOption: addOptionButton,
  };
}

function questionBlockHeader(title: HTMLElement, remove: HTMLButtonElement): HTMLElement {
  const header = el("summary", "admin-question-block-header");
  header.append(title, remove);
  remove.addEventListener("click", (event) => event.preventDefault());
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
  text.id = `admin-answer-${++adminControlId}`;
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
    wordField(situation, undefined, true),
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
    option.textContent = advertOptionLabel(ad, index);
  }
}

function advertOptionLabel(ad: AdStimulusBlock | undefined, index: number): string {
  const key = ad?.key ?? (index === 0 ? "a" : "b");
  if (!ad) return `${key})`;
  const label = sourceOptionText(ad, index);
  return label === `${key})` ? label : `${key}) — ${truncateAdvertName(label)}`;
}

function sourceOptionText(ad: AdStimulusBlock, index: number): string {
  const key = ad.key ?? (index === 0 ? "a" : "b");
  const value = ad.editor.getValue();
  return stimulusOptionLabel({ render_kind: value.render_kind, content: value.content }, key);
}

function sourceChoiceInstruction(ads: AdStimulusBlock[]): string {
  const value = ads[0]?.editor.getValue();
  if (!value) return "Wo finden Sie Informationen?";
  return stimulusInstruction({ render_kind: value.render_kind, content: value.content })
    || "Wo finden Sie Informationen?";
}

function truncateAdvertName(name: string): string {
  const limit = 40;
  return name.length > limit ? `${name.slice(0, limit - 1)}…` : name;
}

function questionSection(questions: HTMLElement): HTMLElement {
  const wrap = el("section", "admin-question-section");
  const header = el("div", "admin-question-header");
  header.append(el("h3", "admin-section-title", "Questions"));
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
  return blocks.map(questionFromBlockSafely);
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
  ads: AdStimulusBlock[],
): AdminReadingQuestion[] {
  const prompt = situation.value.trim();
  if (!prompt) {
    throw new Error("Teil 2 needs a situation.");
  }
  return [
    {
      prompt,
      explanation: explanation.value.trim() || null,
      order_index: 0,
      answers: sourceAnswerRows(correct, ads),
    },
  ];
}

function sourceAnswerRows(correct: HTMLSelectElement, ads: AdStimulusBlock[]): AdminReadingQuestion["answers"] {
  const correctIndex = Number(correct.value);
  return ads.map((ad, index) => ({
    answer_text: sourceOptionText(ad, index),
    is_correct: correctIndex === index,
    order_index: index,
  }));
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
  const isSourceChoice = resolveReadingShape(passage.group, passage.level, passage.part ?? "teil_1") === "goethe_source_choice";
  const label = el("h3", "admin-preview-label", "Preview");
  const frame = el("div", "admin-preview-frame");
  const text = el("div", "admin-preview-text");
  if (!isSourceChoice && hasStimulusContent(stimulusFromPassage(passage))) {
    text.append(stimulusRenderer(stimulusFromPassage(passage)));
  }

  const body = el("div", "admin-preview-body");
  const meaningfulQuestions = passage.questions.filter(hasQuestionContent);
  if (isSourceChoice && hasSourceChoicePreviewContent(passage, meaningfulQuestions)) {
    const exercise = el("article", "story-passage goethe-exercise source-choice-exercise admin-source-preview");
    exercise.append(
      el("div", "question-type", `${passage.level} · ${partLabel(passage.part ?? "teil_2")}`),
      el("h2", "story-title", passage.title),
      el("p", "goethe-task-prompt", passage.passage_text),
    );
    const adGrid = el("div", "source-card-grid");
    for (const ad of passage.ad_stimuli.filter((ad) => hasStimulusContent(stimulusFromAd(ad)))) {
      const card = el("section", "source-card");
      card.append(el("span", "source-pill", ad.key), stimulusRenderer(stimulusFromAd(ad)));
      adGrid.append(card);
    }
    if (adGrid.childElementCount) exercise.append(adGrid);
    body.append(exercise);
  }
  for (const [index, question] of meaningfulQuestions.entries()) {
    const item = el("div", "story-question-block admin-preview-question");
    item.append(
      el("div", "question-type", `Question ${index + 1}`),
      el("h3", "story-question-title", question.prompt),
    );
    const answers = el("div", "story-answer-list");
    for (const answer of question.answers.filter((answer) => answer.answer_text.trim())) {
      const option = button(answer.answer_text, "answer-option");
      option.type = "button";
      answers.append(option);
    }
    if (answers.childElementCount) item.append(answers);
    body.append(item);
  }
  if (!text.childElementCount && !body.childElementCount) {
    frame.append(el("p", "admin-preview-empty", "Preview appears here as the passage is written."));
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
    status: "draft",
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
    render_kind: "website_box",
    content: {
      url: "",
      lines: ["", ""],
    },
    image_path: null,
    transcript: null,
    context_label: null,
    order_index: orderIndex,
  };
}

function emptyQuestion(orderIndex: number, options = ["", "", "", ""]): AdminReadingPassage["questions"][number] {
  return {
    prompt: "",
    explanation: null,
    order_index: orderIndex,
    answers: options.map((answerText, index) => ({
      answer_text: answerText,
      is_correct: index === 0,
      order_index: index,
    })),
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
  const node = SegmentedControl<GermanArticle>({
    label: "Article",
    role: "radiogroup",
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
    node.setValue(selected ?? "der");
    node.dataset.disabled = nextEnabled ? "false" : "true";
    for (const segment of Array.from(node.querySelectorAll<HTMLButtonElement>(".segmented-control__item"))) {
      segment.disabled = !nextEnabled;
      const isSelected = nextEnabled && segment.dataset.value === selected;
      segment.setAttribute("aria-checked", String(isSelected));
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
      editorChanged(wrap);
    });
    rows.push(row);
    renderRows();
  };

  const add = button("Add practice topic", "button compact-button");
  add.addEventListener("click", () => {
    addRow();
    rows[rows.length - 1].topic.focus();
    editorChanged(wrap);
  });

  for (const entry of entries.length ? entries : [{ level: "A1", topic: "" } as AdminFocusEntry]) {
    addRow(entry);
  }

  setTopicOptions(topics, entries.map((entry) => ({ topic: entry.topic, label: entry.topic })));
  void getFocusTopicAliases()
    .then((aliases) => setTopicOptions(topics, aliases))
    .catch(() => undefined);

  const header = el("div", "admin-field-header");
  header.append(el("h3", "admin-section-title", "Practice topics"));
  wrap.append(header, el("p", "prompt", "Choose where this word appears in level-based practice. For example: A1 · travel_transport. Start typing to find a topic."), list, add, topics);
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
  level.ariaLabel = "Practice level";
  const topic = input("Topic", entry.topic);
  topic.setAttribute("list", datalistId);
  topic.placeholder = "Topic";
  const remove = button("×", "admin-icon-button danger-icon-button");
  remove.type = "button";
  remove.ariaLabel = "Remove practice topic";
  remove.title = "Remove practice topic";
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

function syncGoethePartOptions(select: HTMLSelectElement, level: AdminLevel): void {
  const allowedParts = allowedGoetheParts(level);
  const selected = allowedParts.includes(select.value as AdminGoethePart)
    ? (select.value as AdminGoethePart)
    : allowedParts[0];
  select.replaceChildren(
    ...allowedParts.map((part) => {
      const option = document.createElement("option");
      option.value = part;
      option.textContent = goethePartSpec(level, part)?.label ?? partLabel(part);
      option.selected = part === selected;
      return option;
    }),
  );
  select.value = selected;
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

function hasStimulusContent(stimulus: StimulusViewModel): boolean {
  return Boolean(
    stimulus.title.trim()
      || stimulus.body.trim()
      || stimulus.context_label?.trim()
      || stimulus.image_url?.trim()
      || stimulus.image_path?.trim()
      || stimulus.transcript?.trim()
      || Object.values(stimulus.content ?? {}).some((value) => hasRenderableValue(value)),
  );
}

function hasRenderableValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasRenderableValue);
  if (value && typeof value === "object") return Object.values(value).some(hasRenderableValue);
  return value !== null && value !== undefined;
}

function hasQuestionContent(question: AdminReadingQuestion): boolean {
  return Boolean(
    question.prompt.trim()
      || question.explanation?.trim()
      || question.answers.some((answer) => answer.answer_text.trim()),
  );
}

function hasSourceChoicePreviewContent(
  passage: AdminReadingPassage,
  meaningfulQuestions: AdminReadingQuestion[],
): boolean {
  return Boolean(
    passage.title.trim()
      || passage.passage_text.trim()
      || meaningfulQuestions.length
      || passage.ad_stimuli.some((ad) => hasStimulusContent(stimulusFromAd(ad))),
  );
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

function wordField(control: HTMLElement, fallbackLabel?: string, required = false): HTMLElement {
  const labelable = control.matches("input, select, textarea");
  const wrap = el(labelable ? "label" : "div", "admin-field");
  const label = fallbackLabel ?? control.dataset.label ?? "Level";
  wrap.dataset.field = label;
  if (control.dataset.fieldKey) wrap.dataset.fieldKey = control.dataset.fieldKey;
  if (required) control.setAttribute("aria-required", "true");
  const labelNode = fieldLabel(label, required);
  if (!labelable) {
    labelNode.id = `admin-field-label-${++adminControlId}`;
    control.setAttribute("aria-labelledby", labelNode.id);
    if (!control.hasAttribute("role")) control.setAttribute("role", "group");
  }
  wrap.append(labelNode, control);
  return wrap;
}

function fieldLabel(label: string, required: boolean): HTMLElement {
  const node = el("span", "", label);
  if (required) {
    node.append(el("span", "required-marker", "*"), el("span", "sr-only", " required"));
  }
  return node;
}

function adminError(error: unknown): HTMLElement {
  const node = el("div", "error", adminErrorMessage(error));
  node.setAttribute("role", "alert");
  return node;
}

function adminErrorMessage(error: unknown): string {
  return error instanceof Error ? humanErrorMessage(error) : "The request could not be completed. Try again.";
}

function editorStatus(message = ""): HTMLElement {
  const node = el("p", "prompt admin-dirty-state", message);
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("aria-atomic", "true");
  return node;
}

function setDirtyStatus(status: HTMLElement): void {
  clearStatusAction(status);
  status.dataset.state = "dirty";
  status.textContent = "Unsaved changes";
}

function setErrorStatus(status: HTMLElement, error: unknown): void {
  clearStatusAction(status);
  delete status.dataset.state;
  status.replaceChildren(adminError(error));
}

function clearStatusAction(status: HTMLElement): void {
  status.onclick = null;
  status.onkeydown = null;
  status.setAttribute("role", "status");
  status.tabIndex = -1;
}

function createFormValidation(status: HTMLElement): {
  register: (field: string, control: HTMLElement) => void;
  clear: () => void;
  show: (issues: FieldValidationIssue[]) => boolean;
} {
  const fields = new Map<string, HTMLElement[]>();
  const touchedControls = new Set<HTMLElement>();

  const register = (field: string, control: HTMLElement): void => {
    const controls = fields.get(field) ?? [];
    controls.push(control);
    fields.set(field, controls);
  };

  const clear = (): void => {
    for (const control of touchedControls) clearFieldError(control);
    touchedControls.clear();
    if (status.dataset.state === "validation") {
      delete status.dataset.state;
      status.textContent = "";
      clearStatusAction(status);
    }
  };

  const show = (issues: FieldValidationIssue[]): boolean => {
    clear();
    const actionableIssues = issues
      .map((issue) => ({ ...issue, control: issue.control ?? fields.get(issue.field)?.[0] }))
      .filter((issue): issue is FieldValidationIssue & { control: HTMLElement } => Boolean(issue.control));
    if (!actionableIssues.length) return false;

    for (const issue of actionableIssues) {
      showFieldError(issue.control, issue.message);
      touchedControls.add(issue.control);
    }
    const first = actionableIssues[0].control;
    setValidationStatus(status, actionableIssues.length, () => focusInvalidControl(first));
    focusInvalidControl(first);
    return true;
  };

  return { register, clear, show };
}

function validatePassageClientFields(
  shape: ReadingShape,
  title: HTMLInputElement,
  passage: HTMLTextAreaElement,
  sourceSituation: HTMLTextAreaElement,
  ads: AdStimulusBlock[],
): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];
  if (!title.value.trim()) issues.push({ field: "title", message: "Enter a title.", control: title });
  if (shape === "goethe_source_choice") {
    if (!sourceSituation.value.trim()) {
      issues.push({ field: "prompt", message: "Enter the situation.", control: sourceSituation });
    }
    issues.push(...validateSourceStimuli(ads));
  } else if (shape !== "goethe_true_false_notice" && !passage.value.trim()) {
    issues.push({ field: "passage_text", message: "Enter the passage text.", control: passage });
  }
  return issues;
}

function validateSourceStimuli(ads: AdStimulusBlock[]): FieldValidationIssue[] {
  return ads.flatMap((ad) => {
    const value = ad.editor.getValue();
    if (value.render_kind === "website_box" && !stringFromContent(value.content, "url")) {
      return [{
        field: "url",
        message: `Enter the URL for ${ad.key}).`,
        control: firstStimulusField(ad, "url"),
      }];
    }
    if (value.render_kind === "ad_box") {
      const lines = Array.isArray(value.content?.lines) ? value.content.lines : [];
      if (!lines.some((line) => typeof line === "string" && line.trim())) {
        return [{
          field: "lines",
          message: `Enter the advert details for ${ad.key}).`,
          control: firstStimulusField(ad, "lines"),
        }];
      }
    }
    return [];
  });
}

function firstStimulusField(ad: AdStimulusBlock, key: string): HTMLElement | undefined {
  return ad.editor.node.querySelector<HTMLElement>(`[data-field-key="${key}"]`) ?? undefined;
}

function stringFromContent(content: Record<string, unknown> | null, key: string): string {
  const value = content?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function fieldErrorsFromUnknown(error: unknown): FieldValidationIssue[] {
  const payload = parseErrorPayload(error);
  const detail = payload && typeof payload === "object" && "detail" in payload
    ? (payload as { detail?: unknown }).detail
    : undefined;
  if (!Array.isArray(detail)) return [];
  return detail.map((issue) => validationIssueToFieldError(issue)).filter(Boolean) as FieldValidationIssue[];
}

function validationIssueToFieldError(issue: unknown): FieldValidationIssue | null {
  if (!issue || typeof issue !== "object") return null;
  const validationIssue = issue as ServerValidationIssue;
  const field = lastLocationPart(validationIssue.loc);
  if (typeof field !== "string") return null;
  return {
    field,
    message: validationInstruction(validationIssue),
  };
}

function validationInstruction(issue: ServerValidationIssue): string {
  const field = lastLocationPart(issue.loc);
  if (field === "title") return "Enter a title.";
  if (field === "passage_text") return "Enter the passage text.";
  if (field === "prompt") return "Enter the question prompt.";
  if (field === "url") return "Enter a URL.";
  if (issue.type === "missing" || issue.type === "string_too_short") return `Enter ${readableFieldName(field)}.`;
  if (issue.type === "list_too_short") return `Add more ${readableFieldName(field)}.`;
  if (issue.type === "list_too_long") return `Remove extra ${readableFieldName(field)}.`;
  return "Check this field.";
}

function parseErrorPayload(error: unknown): unknown {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message.trim().startsWith("{") && !message.trim().startsWith("[")) return null;
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

function humanErrorMessage(error: Error): string {
  const payload = parseErrorPayload(error);
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((issue) => {
      if (!issue || typeof issue !== "object") return "Check the supplied content.";
      const item = issue as ServerValidationIssue;
      return `${readableFieldName(lastLocationPart(item.loc))}: ${item.msg ?? validationInstruction(item)}`;
    }).join(" ");
  }
  if (/fetch|network/i.test(error.message)) return "Could not reach the server. Check your connection and try again. Your edits are still here.";
  return error.message || "The request could not be completed. Try again.";
}

function readableFieldName(field: string): string {
  return field.replace(/_/g, " ") || "this field";
}

function lastLocationPart(loc: Array<string | number> | undefined): string {
  const part = loc && loc.length ? loc[loc.length - 1] : "";
  return typeof part === "string" ? part : "";
}

function showFieldError(control: HTMLElement, message: string): void {
  const field = control.closest<HTMLElement>(".admin-field");
  if (!field) return;
  field.classList.add("has-field-error");
  control.classList.add("field-error");
  control.setAttribute("aria-invalid", "true");
  const error = field.querySelector<HTMLElement>(".admin-field-error") ?? el("p", "admin-field-error");
  error.textContent = message;
  error.id ||= `admin-field-error-${++adminControlId}`;
  control.setAttribute("aria-describedby", error.id);
  field.append(error);
}

function clearFieldError(control: HTMLElement): void {
  const field = control.closest<HTMLElement>(".admin-field");
  field?.classList.remove("has-field-error");
  field?.querySelector(".admin-field-error")?.remove();
  control.classList.remove("field-error");
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
}

function focusInvalidControl(control: HTMLElement): void {
  const details = control.closest<HTMLDetailsElement>("details");
  if (details) details.open = true;
  control.scrollIntoView({ block: "center" });
  control.focus({ preventScroll: true });
}

function setValidationStatus(status: HTMLElement, count: number, onClick: () => void): void {
  status.dataset.state = "validation";
  status.textContent = `${count} ${count === 1 ? "field needs" : "fields need"} attention`;
  status.onclick = onClick;
  status.setAttribute("role", "button");
  status.tabIndex = 0;
  status.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  };
}
