import { askGrammar } from "../api/client";
import type { GrammarCitation, GrammarAskResponse, Player } from "../api/types";
import { button } from "./button";
import { clear, el } from "../utils/dom";

type WidgetStatus = "closed" | "open" | "sending" | "waking" | "answered" | "no-match" | "error";

type ChatMessage =
  | { role: "learner"; text: string }
  | {
      role: "assistant";
      status: "answered";
      text: string;
      citations: GrammarCitation[];
      truncated: boolean;
    }
  | {
      role: "assistant";
      status: "no_match";
      text: string;
    }
  | { role: "assistant"; status: "error"; text: string; canRetry: boolean };

export type GrammarPassageContext = {
  title: string;
  text: string;
};

export type GrammarWrongAnswerContext = {
  question: string;
  learnerAnswer: string;
};

type GrammarWidgetContext = {
  route: string;
  passage: GrammarPassageContext | null;
  wrongAnswer: GrammarWrongAnswerContext | null;
};

export type GrammarWidgetHandle = {
  updateContext: (context: Partial<GrammarWidgetContext>) => void;
};

const MAX_MESSAGES = 20;
const MAX_QUESTION_LENGTH = 1200;
const DEFAULT_CONTEXT: GrammarWidgetContext = {
  route: "home",
  passage: null,
  wrongAnswer: null,
};

const SUGGESTIONS = [
  {
    label: { en: "Akkusativ articles", vi: "Mạo từ Akkusativ" },
    question: {
      en: "When does der become den in Akkusativ?",
      vi: "Khi nào der đổi thành den trong Akkusativ?",
    },
  },
  {
    label: { en: "Verb position", vi: "Vị trí Verb" },
    question: {
      en: "Why is the verb second in Heute lerne ich Deutsch?",
      vi: "Tại sao Verb đứng thứ hai trong Heute lerne ich Deutsch?",
    },
  },
] as const;

export function mountGrammarWidget(root: HTMLElement, player: Player): GrammarWidgetHandle {
  let context = { ...DEFAULT_CONTEXT };
  let status: WidgetStatus = "closed";
  let messages = loadMessages(player.player_id);
  let inFlight = false;
  let lastQuestion = "";
  let loadingTimer: number | undefined;
  let timeoutTimer: number | undefined;

  const storageKey = `grammar_widget_${player.player_id}`;
  const host = el("div", "grammar-widget");
  const launcher = button("?", "grammar-launcher");
  launcher.setAttribute("aria-label", "Open grammar assistant");
  launcher.title = "Open grammar assistant";

  const panel = el("section", "grammar-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", "Grammar assistant");

  const header = el("div", "grammar-panel-header");
  const title = el("div", "grammar-panel-title");
  const close = button("×", "grammar-close");
  close.setAttribute("aria-label", "Close grammar assistant");
  title.append(el("strong", "", "Grammar assistant"));
  header.append(title, close);

  const list = el("div", "grammar-message-list");
  const composer = el("div", "grammar-composer");
  const inputWrap = el("div", "grammar-input-wrap");
  const textarea = document.createElement("textarea");
  textarea.className = "grammar-input";
  textarea.placeholder = "Ask a grammar question";
  textarea.rows = 1;
  textarea.maxLength = MAX_QUESTION_LENGTH;
  const counter = el("span", "grammar-counter");
  const send = button("↑", "grammar-send");
  send.setAttribute("aria-label", "Send");
  send.title = "Send";
  inputWrap.append(textarea, counter, send);
  composer.append(inputWrap);
  panel.append(header, list, composer);
  host.append(launcher, panel);
  root.append(host);

  const setOpen = (open: boolean): void => {
    status = open ? "open" : "closed";
    host.dataset.state = status;
    persistState();
    if (open) {
      renderMessages();
      window.setTimeout(() => textarea.focus(), 0);
    } else {
      launcher.focus();
    }
  };

  const sendQuestion = async (): Promise<void> => {
    const question = textarea.value.trim();
    if (!question || inFlight) return;
    lastQuestion = question;
    textarea.value = "";
    updateComposer();
    const learnerMessage: ChatMessage = { role: "learner", text: question };
    messages = [...messages, learnerMessage].slice(-MAX_MESSAGES);
    status = "sending";
    inFlight = true;
    host.dataset.state = status;
    renderMessages();
    startLoadingTimers();
    try {
      const response = await askGrammar({
        question,
        learner_id: player.player_id,
      });
      clearLoadingTimers();
      const assistantMessage = messageFromResponse(response);
      messages = [...messages, assistantMessage].slice(-MAX_MESSAGES);
      status = statusFromAssistantMessage(assistantMessage);
    } catch (error) {
      clearLoadingTimers();
      const errorMessage: ChatMessage = {
        role: "assistant",
        status: "error",
        text: mapGrammarError(error),
        canRetry: true,
      };
      messages = [
        ...messages,
        errorMessage,
      ].slice(-MAX_MESSAGES);
      status = "error";
    } finally {
      inFlight = false;
      host.dataset.state = status;
      persistState();
      renderMessages();
      updateComposer();
    }
  };

  const renderMessages = (): void => {
    clear(list);
    host.dataset.hasMessages = messages.length > 0 || inFlight ? "true" : "false";
    if (messages.length === 0) {
      renderEmptyState(list, context, (question, source) => {
        console.info("grammar_suggestion_tapped", source);
        textarea.value = question;
        updateComposer();
        textarea.focus();
      });
    }
    for (const message of messages) {
      list.append(renderMessage(message, () => retryLastQuestion()));
    }
    if (inFlight) list.append(renderLoading());
    list.scrollTop = list.scrollHeight;
  };

  const retryLastQuestion = (): void => {
    if (!lastQuestion) return;
    textarea.value = lastQuestion;
    updateComposer();
    void sendQuestion();
  };

  const updateComposer = (): void => {
    const length = textarea.value.length;
    send.disabled = inFlight || textarea.value.trim().length === 0;
    counter.textContent = length > 950 ? `${length}/${MAX_QUESTION_LENGTH}` : "";
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  };

  const startLoadingTimers = (): void => {
    clearLoadingTimers();
    loadingTimer = window.setTimeout(() => {
      status = "waking";
      host.dataset.state = status;
      renderMessages();
    }, 10000);
    timeoutTimer = window.setTimeout(() => {
      if (!inFlight) return;
      const timeoutMessage: ChatMessage = {
        role: "assistant",
        status: "error",
        text: "The server is taking too long to wake up.",
        canRetry: true,
      };
      messages = [
        ...messages,
        timeoutMessage,
      ].slice(-MAX_MESSAGES);
      inFlight = false;
      status = "error";
      host.dataset.state = status;
      renderMessages();
      updateComposer();
    }, 60000);
  };

  const clearLoadingTimers = (): void => {
    if (loadingTimer !== undefined) window.clearTimeout(loadingTimer);
    if (timeoutTimer !== undefined) window.clearTimeout(timeoutTimer);
    loadingTimer = undefined;
    timeoutTimer = undefined;
  };

  const persistState = (): void => {
    localStorage.setItem(storageKey, JSON.stringify({ open: status !== "closed", messages }));
  };

  const applyKeyboardOffset = (): void => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    host.style.setProperty("--grammar-keyboard-offset", `${offset}px`);
  };

  launcher.addEventListener("click", () => setOpen(status === "closed"));
  close.addEventListener("click", () => setOpen(false));
  send.addEventListener("click", () => void sendQuestion());
  textarea.addEventListener("input", updateComposer);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && status !== "closed") setOpen(false);
  });
  window.visualViewport?.addEventListener("resize", applyKeyboardOffset);
  window.visualViewport?.addEventListener("scroll", applyKeyboardOffset);

  host.dataset.state = readInitialOpen(player.player_id) ? "open" : "closed";
  status = host.dataset.state as WidgetStatus;
  updateComposer();
  renderMessages();
  applyKeyboardOffset();

  return {
    updateContext(next) {
      context = { ...context, ...next };
      renderMessages();
    },
  };
}

function renderEmptyState(
  host: HTMLElement,
  context: GrammarWidgetContext,
  onPick: (question: string, source: string) => void,
): void {
  const language = interfaceLanguage();
  const wrap = el("div", "grammar-empty");
  wrap.append(el("p", "", language === "vi" ? "Hỏi về ngữ pháp tiếng Đức." : "Ask about German grammar."));
  const chips = el("div", "grammar-suggestion-list");
  if (context.passage) {
    const passage = context.passage;
    const chip = button(language === "vi" ? "Hỏi về đoạn đọc này" : "Ask about this passage", "grammar-chip");
    chip.addEventListener("click", () => onPick(passageQuestion(passage, language), "passage_context"));
    chips.append(chip);
  }
  if (context.wrongAnswer) {
    const wrongAnswer = context.wrongAnswer;
    const chip = button(
      language === "vi" ? "Vì sao câu trả lời của tôi sai?" : "Why was my answer wrong?",
      "grammar-chip",
    );
    chip.addEventListener("click", () => onPick(wrongAnswerQuestion(wrongAnswer, language), "wrong_answer_context"));
    chips.append(chip);
  }
  for (const suggestion of SUGGESTIONS) {
    const chip = button(suggestion.label[language], "grammar-chip");
    chip.addEventListener("click", () => onPick(suggestion.question[language], suggestion.label.en));
    chips.append(chip);
  }
  wrap.append(chips);
  host.append(wrap);
}

function renderMessage(message: ChatMessage, onRetry: () => void): HTMLElement {
  const bubble = el("article", `grammar-message grammar-message-${message.role}`);
  if (message.role === "learner") {
    bubble.textContent = message.text;
    return bubble;
  }
  if (message.status === "answered") {
    bubble.append(
      message.truncated ? renderPlainTruncated(message.text, onRetry) : renderMarkdown(message.text),
      renderCitations(message.citations),
    );
    return bubble;
  }
  if (message.status === "no_match") {
    bubble.classList.add("grammar-no-match");
    bubble.append(el("p", "", message.text));
    return bubble;
  }
  bubble.classList.add("grammar-error-message");
  bubble.append(el("p", "", message.text));
  if (message.canRetry) {
    const retry = button("Retry", "grammar-chip");
    retry.addEventListener("click", onRetry);
    bubble.append(retry);
  }
  return bubble;
}

function renderPlainTruncated(text: string, onContinue: () => void): HTMLElement {
  const wrap = el("div", "grammar-markdown");
  const p = el("p");
  p.textContent = text;
  const note = el("p", "grammar-truncated-note", "The answer was shortened. Ask me to continue if you want the rest.");
  const continueButton = button("Continue", "grammar-chip");
  continueButton.addEventListener("click", onContinue);
  wrap.append(p, note, continueButton);
  return wrap;
}

function renderMarkdown(markdown: string): HTMLElement {
  const wrap = el("div", "grammar-markdown");
  const lines = markdown.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      const [table, nextIndex] = renderTable(lines, index);
      wrap.append(table);
      index = nextIndex;
      continue;
    }
    if (isListItem(line)) {
      const [list, nextIndex] = renderList(lines, index);
      wrap.append(list);
      index = nextIndex;
      continue;
    }
    if (line.startsWith("#") || line.startsWith(">") || imageOrLinkOnly(line)) {
      index += 1;
      continue;
    }
    const paragraphLines = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || isTableStart(lines, index) || isListItem(current) || current.startsWith("#") || current.startsWith(">")) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    const p = el("p");
    p.append(renderInline(paragraphLines.join(" ")));
    wrap.append(p);
  }
  return wrap;
}

function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  text = text.replace(/!\[[^\]]*]\([^)]*\)/g, "").replace(/\[([^\]]+)]\([^)]*\)/g, "$1");
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end === -1) break;
      const code = document.createElement("code");
      code.textContent = text.slice(index + 1, end);
      fragment.append(code);
      index = end + 1;
      continue;
    }
    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end === -1) break;
      const strong = document.createElement("strong");
      strong.append(renderInline(text.slice(index + 2, end)));
      fragment.append(strong);
      index = end + 2;
      continue;
    }
    if (text[index] === "*") {
      const end = findClosingEmphasis(text, index + 1);
      if (end === -1) break;
      const em = document.createElement("em");
      em.append(renderInline(text.slice(index + 1, end)));
      fragment.append(em);
      index = end + 1;
      continue;
    }
    const next = nextMarkdownTokenIndex(text, index + 1);
    fragment.append(document.createTextNode(text.slice(index, next)));
    index = next;
  }
  if (index < text.length) {
    fragment.append(document.createTextNode(text.slice(index)));
  }
  return fragment;
}

function nextMarkdownTokenIndex(text: string, startIndex: number): number {
  const candidates = [
    text.indexOf("`", startIndex),
    text.indexOf("*", startIndex),
  ].filter((index) => index !== -1);
  return candidates.length ? Math.min(...candidates) : text.length;
}

function findClosingEmphasis(text: string, startIndex: number): number {
  let index = startIndex;
  while (index < text.length) {
    const found = text.indexOf("*", index);
    if (found === -1) return -1;
    if (!text.startsWith("**", found)) {
      return found;
    } else {
      index = found + 2;
    }
  }
  return -1;
}

function renderList(lines: string[], startIndex: number): [HTMLElement, number] {
  const ordered = /^\d+\.\s+/.test(lines[startIndex].trim());
  const list = document.createElement(ordered ? "ol" : "ul");
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (ordered !== /^\d+\.\s+/.test(line) || (!ordered && !/^[-*]\s+/.test(line))) break;
    const item = document.createElement("li");
    item.append(renderInline(line.replace(/^(\d+\.|[-*])\s+/, "")));
    list.append(item);
    index += 1;
  }
  return [list, index];
}

function renderTable(lines: string[], startIndex: number): [HTMLElement, number] {
  const scroll = el("div", "grammar-table-scroll");
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headers = splitTableRow(lines[startIndex]).slice(0, 4);
  const headerRow = document.createElement("tr");
  for (const header of headers) {
    const th = document.createElement("th");
    th.append(renderInline(header));
    headerRow.append(th);
  }
  thead.append(headerRow);
  let index = startIndex + 2;
  while (index < lines.length && isTableRow(lines[index])) {
    const cells = splitTableRow(lines[index]).slice(0, 4);
    const row = document.createElement("tr");
    for (const cell of cells) {
      const td = document.createElement("td");
      td.append(renderInline(cell));
      row.append(td);
    }
    tbody.append(row);
    index += 1;
  }
  table.append(thead, tbody);
  scroll.append(table);
  return [scroll, index];
}

function isTableStart(lines: string[], index: number): boolean {
  return isTableRow(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1]);
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length > 2;
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isListItem(line: string): boolean {
  return /^([-*]|\d+\.)\s+/.test(line);
}

function imageOrLinkOnly(line: string): boolean {
  return /^!?\[[^\]]*]\([^)]*\)$/.test(line);
}

function renderCitations(citations: GrammarCitation[]): HTMLElement {
  const wrap = el("div", "grammar-citations");
  for (const citation of citations) {
    const item = el("div", "grammar-citation");
    const chip = button(citationLabel(citation), "grammar-citation-chip");
    const source = el("p", "grammar-citation-source", citation.content);
    chip.addEventListener("click", () => item.classList.toggle("expanded"));
    item.append(chip, source);
    wrap.append(item);
  }
  return wrap;
}

function citationLabel(citation: GrammarCitation): string {
  const page =
    citation.page_start === null || citation.page_end === null
      ? ""
      : citation.page_start === citation.page_end
        ? ` · p. ${citation.page_start}`
        : ` · pp. ${citation.page_start}-${citation.page_end}`;
  return `${citation.level} · ${topicLabel(citation.topic)} · ${citation.title}: ${citation.section}${page}`;
}

function renderLoading(): HTMLElement {
  const node = el("div", "grammar-message grammar-message-assistant grammar-loading");
  node.textContent = "Typing...";
  window.setTimeout(() => {
    if (node.isConnected) node.textContent = "Thinking...";
  }, 3000);
  window.setTimeout(() => {
    if (node.isConnected) {
      node.textContent = "The server was asleep and is waking up. This takes about a minute the first time.";
    }
  }, 10000);
  return node;
}

function messageFromResponse(response: GrammarAskResponse): ChatMessage {
  if (response.status === "no_match") {
    return {
      role: "assistant",
      status: "no_match",
      text: response.answer?.trim() || "This isn't in the grammar notes yet.",
    };
  }
  if (!response.answer?.trim() || response.citations.length === 0) {
    return {
      role: "assistant",
      status: "error",
      text: "Something went wrong while answering.",
      canRetry: true,
    };
  }
  return {
    role: "assistant",
    status: "answered",
    text: response.answer,
    citations: response.citations,
    truncated: response.truncated,
  };
}

function statusFromAssistantMessage(message: ChatMessage): WidgetStatus {
  if (message.role !== "assistant") return "open";
  if (message.status === "no_match") return "no-match";
  if (message.status === "error") return "error";
  return "answered";
}

function interfaceLanguage(): "en" | "vi" {
  return document.documentElement.lang.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function passageQuestion(passage: GrammarPassageContext, language: "en" | "vi"): string {
  if (language === "vi") {
    return `Bạn có thể giải thích ngữ pháp trong đoạn đọc này không?\n\nTiêu đề: ${passage.title}\n\nĐoạn đọc:\n${passage.text}`;
  }
  return `Can you explain the grammar in this passage?\n\nTitle: ${passage.title}\n\nPassage:\n${passage.text}`;
}

function wrongAnswerQuestion(context: GrammarWrongAnswerContext, language: "en" | "vi"): string {
  if (language === "vi") {
    return `Vì sao câu trả lời của tôi sai?\n\nCâu hỏi: ${context.question}\nCâu trả lời của tôi: ${context.learnerAnswer}`;
  }
  return `Why was my answer wrong?\n\nQuestion: ${context.question}\nMy answer: ${context.learnerAnswer}`;
}

function topicLabel(topic: string): string {
  return topic
    .split("_")
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}

function mapGrammarError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("429")) return "You've asked a lot of questions. Try again in a few minutes.";
  if (message.includes("503")) return "The grammar assistant is unavailable right now.";
  if (message.includes("422")) return "Please shorten the question and try again.";
  if (message.includes("Failed to fetch")) return "I couldn't reach the grammar assistant.";
  return "Something went wrong while answering.";
}

function loadMessages(playerId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`grammar_widget_${playerId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { messages?: ChatMessage[] };
    return Array.isArray(parsed.messages) ? parsed.messages.map(normalizeMessage).slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant") return message;
  if (message.status !== "answered") return message;
  if (message.text.trim() && message.citations.length > 0) {
    return { ...message, truncated: Boolean(message.truncated) };
  }
  return {
    role: "assistant",
    status: "error",
    text: "Something went wrong while answering.",
    canRetry: true,
  };
}

function readInitialOpen(playerId: string): boolean {
  try {
    const raw = localStorage.getItem(`grammar_widget_${playerId}`);
    if (!raw) return false;
    return Boolean((JSON.parse(raw) as { open?: boolean }).open);
  } catch {
    return false;
  }
}
