import "../styles/views/scramble.css";
import { getFocusWordsCorpus, shuffle } from "../api/queryClient";
import type { FocusCard, FocusLevel } from "../api/types";
import { button } from "../components/button";
import { el } from "../utils/dom";

type ScrambleViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
};

type LetterTile = {
  id: number;
  letter: string;
};

type PuzzleState = {
  groups: string[][];
  tiles: LetterTile[];
  slots: Array<number | null>;
  attempts: number;
  revealed: boolean;
  feedback: { tone: "incorrect" | "reveal"; text: string } | null;
};

type FocusTarget = "auto" | "check" | "next" | { tileId: number };

const LEVELS: Array<FocusLevel["level"] | "all"> = ["all", "A1", "A2", "B1", "B2"];
const ROUND_SIZE = 10;

export function scrambleView(options: ScrambleViewOptions): HTMLElement {
  const section = el("section", "panel scramble-card");
  void renderSetup(section, options);
  return section;
}

async function renderSetup(section: HTMLElement, options: ScrambleViewOptions): Promise<void> {
  options.onBackChange(options.onBack);
  section.replaceChildren(el("p", "prompt", "Loading words…"));

  try {
    const cards = eligibleCards(await getFocusWordsCorpus());
    if (cards.length === 0) {
      section.replaceChildren(
        el("div", "scramble-empty", "There are no words ready for a letter scramble yet."),
      );
      return;
    }

    const intro = el("div", "scramble-intro");
    intro.append(
      el("h2", "scramble-title", "Word scramble"),
      el("p", "prompt", "Use the meaning to rebuild the German word."),
    );

    const setup = el("div", "scramble-setup");
    const levelField = el("label", "scramble-level-field");
    levelField.append(el("span", "scramble-field-label", "Choose a level"));
    const levelSelect = document.createElement("select");
    levelSelect.className = "scramble-level-select";
    levelSelect.setAttribute("aria-label", "Choose a vocabulary level");

    for (const level of LEVELS) {
      const count = level === "all" ? cards.length : cards.filter((card) => card.level === level).length;
      if (level !== "all" && count === 0) continue;
      const option = document.createElement("option");
      option.value = level;
      option.textContent = level === "all" ? `All levels · ${count} words` : `${level} · ${count} words`;
      levelSelect.append(option);
    }

    const start = button("Start a round", "button primary scramble-start");
    start.addEventListener("click", () => {
      const selectedLevel = levelSelect.value;
      const levelCards = selectedLevel === "all"
        ? cards
        : cards.filter((card) => card.level === selectedLevel);
      beginRound(section, shuffle(levelCards).slice(0, ROUND_SIZE), options);
    });

    levelField.append(levelSelect);
    setup.append(levelField, start);
    section.replaceChildren(intro, setup);
  } catch (error) {
    const message = el("div", "scramble-error");
    message.setAttribute("role", "alert");
    message.append(
      el("p", "prompt", error instanceof Error ? error.message : "Could not load the word list."),
    );
    const retry = button("Try again", "button primary");
    retry.addEventListener("click", () => void renderSetup(section, options));
    message.append(retry);
    section.replaceChildren(message);
  }
}

function eligibleCards(cards: FocusCard[]): FocusCard[] {
  return cards.filter((card) => {
    const phrase = targetWords(card).join(" ");
    const letters = Array.from(phrase.replace(/\s/g, "").normalize("NFC"));
    return letters.length >= 3 && new Set(letters.map((letter) => letter.toLocaleLowerCase("de"))).size > 1;
  });
}

function targetWords(card: FocusCard): string[] {
  return [card.article, card.word]
    .filter((part): part is string => Boolean(part?.trim()))
    .flatMap((part) => part.trim().split(/\s+/));
}

function createPuzzle(words: string[]): PuzzleState {
  const groups = words.map((word) => Array.from(word.normalize("NFC")));
  const targetLetters = groups.flat();
  const tiles = shuffle(targetLetters.map((letter, id) => ({ id, letter })));
  if (
    tiles.map((tile) => tile.letter).join("") === targetLetters.join("") &&
    new Set(targetLetters.map((letter) => letter.toLocaleLowerCase("de"))).size > 1
  ) {
    tiles.push(tiles.shift() as LetterTile);
  }
  return {
    groups,
    tiles,
    slots: Array(targetLetters.length).fill(null),
    attempts: 0,
    revealed: false,
    feedback: null,
  };
}

function beginRound(
  section: HTMLElement,
  cards: FocusCard[],
  options: ScrambleViewOptions,
): void {
  if (cards.length === 0) return;
  let index = 0;
  let score = 0;
  const announcement = el("p", "sr-only");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");

  const advance = (): void => {
    index += 1;
    if (index >= cards.length) {
      renderRoundComplete(section, score, cards.length, options);
      return;
    }
    renderQuestion();
  };

  const renderQuestion = (): void => {
    renderScrambleQuestion({
      section,
      card: cards[index],
      index,
      total: cards.length,
      score,
      options,
      announcement,
      onCorrect: () => {
        score += 1;
        return score;
      },
      onAdvance: advance,
    });
  };

  renderQuestion();
}

function renderScrambleQuestion(
  args: {
    section: HTMLElement;
    card: FocusCard;
    index: number;
    total: number;
    score: number;
    options: ScrambleViewOptions;
    announcement: HTMLElement;
    onCorrect: () => number;
    onAdvance: () => void;
    puzzle?: PuzzleState;
  },
  focusTarget: FocusTarget = "auto",
  announcementText = "",
): void {
  const { section, card, index, total, options, onCorrect, onAdvance } = args;
  options.onBackChange(() => void renderSetup(section, options));

  const words = targetWords(card);
  const puzzle = args.puzzle ?? createPuzzle(words);
  const { groups, tiles, slots } = puzzle;
  let solved = false;
  const rerender = (focusTarget: FocusTarget = "auto", announcementText = ""): void => {
    renderScrambleQuestion({ ...args, puzzle }, focusTarget, announcementText);
  };

  const shell = el("div", "scramble-round");
  const header = el("div", "scramble-round-header");
  header.append(
    el("div", "question-type", `${card.level} · ${card.topic_label}`),
    el("span", "scramble-round-count", `Word ${index + 1} of ${total}`),
  );

  const score = el("p", "scramble-score", `${args.score} correct`);
  const prompt = el("div", "scramble-prompt");
  prompt.append(
    el("h2", "scramble-meaning", card.meaning_overview),
  );

  const status = el("p", "scramble-feedback");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  if (puzzle.feedback) {
    status.className = `scramble-feedback is-${puzzle.feedback.tone}`;
    status.textContent = puzzle.feedback.text;
  }

  const answer = el("div", "scramble-answer");
  answer.setAttribute("role", "group");
  const placedCount = slots.length - slots.filter((tileId) => tileId === null).length;
  const emptyCount = slots.length - placedCount;
  const answerLabel = card.article?.trim() ? "German article and word answer" : "German word answer";
  answer.setAttribute(
    "aria-label",
    `${answerLabel}: ${placedCount} of ${slots.length} letters placed; ${emptyCount} empty positions.`,
  );
  const answerDescription = el(
    "span",
    "sr-only",
    "Letters fill the answer from left to right. Activate a filled letter to return it to the shuffled tiles.",
  );
  answerDescription.id = `scramble-answer-help-${index}`;
  answer.setAttribute("aria-describedby", answerDescription.id);
  answer.append(answerDescription);
  let slotIndex = 0;
  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) answer.append(el("span", "scramble-word-space", " "));
    const word = el("span", "scramble-answer-word");
    for (let letterIndex = 0; letterIndex < group.length; letterIndex += 1) {
      const currentSlot = slotIndex;
      const tileId = slots[currentSlot];
      if (tileId === null) {
        const blank = el("span", "scramble-answer-slot is-empty", "·");
        blank.setAttribute("aria-hidden", "true");
        word.append(blank);
      } else {
        const tile = tiles.find((candidate) => candidate.id === tileId);
        const placed = button(tile?.letter ?? "", "scramble-answer-slot is-filled");
        placed.setAttribute("aria-label", `Remove letter ${tile?.letter ?? ""} from position ${currentSlot + 1}`);
        placed.addEventListener("click", () => {
          if (solved) return;
          slots[currentSlot] = null;
          puzzle.feedback = null;
          status.textContent = "";
          const announcementText = `Letter ${tile?.letter ?? ""} returned to the shuffled tiles. ${slots.length - slots.filter((id) => id === null).length} of ${slots.length} letters placed.`;
          rerender({ tileId }, announcementText);
        });
        word.append(placed);
      }
      slotIndex += 1;
    }
    answer.append(word);
  });

  const bank = el("div", "scramble-letter-bank");
  bank.setAttribute("role", "group");
  bank.setAttribute("aria-label", `Shuffled letter tiles; ${emptyCount} remaining, ${placedCount} placed.`);
  const tileTotals = new Map<string, number>();
  for (const tile of tiles) tileTotals.set(tile.letter, (tileTotals.get(tile.letter) ?? 0) + 1);
  for (const tile of tiles) {
    if (slots.includes(tile.id)) continue;
    const tileButton = button(tile.letter, "scramble-letter-tile");
    tileButton.dataset.tileId = String(tile.id);
    const total = tileTotals.get(tile.letter) ?? 1;
    tileButton.setAttribute(
      "aria-label",
      total > 1 ? `Add letter ${tile.letter}, tile ${tile.id + 1} of ${tiles.length}` : `Add letter ${tile.letter}`,
    );
    tileButton.disabled = solved || puzzle.revealed;
    tileButton.addEventListener("click", () => {
      if (solved || puzzle.revealed) return;
      const nextSlot = slots.indexOf(null);
      if (nextSlot < 0) return;
      slots[nextSlot] = tile.id;
      puzzle.feedback = null;
      status.textContent = "";
      const remaining = slots.filter((id) => id === null).length;
      const placed = slots.length - remaining;
      const update = `Placed letter ${tile.letter}. ${placed} of ${slots.length} letters placed; ${remaining} remaining.`;
      rerender(remaining === 0 ? "check" : "auto", update);
    });
    bank.append(tileButton);
  }
  if (bank.childElementCount === 0) bank.append(el("span", "sr-only", "All letters placed"));

  const actions = el("div", "scramble-actions");
  const clear = button("Clear", "button scramble-secondary");
  clear.disabled = puzzle.revealed || !slots.some((tileId) => tileId !== null);
  clear.addEventListener("click", () => {
    if (solved || puzzle.revealed) return;
    slots.fill(null);
    puzzle.feedback = null;
    status.textContent = "";
    rerender("auto", "Answer cleared. All letters are back in the shuffled tiles.");
  });

  const skip = button("Skip", "button scramble-secondary");
  skip.addEventListener("click", () => {
    if (solved || puzzle.revealed) return;
    puzzle.revealed = true;
    fillAnswer(puzzle, words);
    puzzle.feedback = { tone: "reveal", text: `Skipped. Answer: ${words.join(" ")}.` };
    rerender("next", puzzle.feedback.text);
  });

  const check = button("Check word", "button primary scramble-check");
  check.disabled = puzzle.revealed || slots.some((tileId) => tileId === null);
  check.addEventListener("click", () => {
    if (solved || puzzle.revealed || slots.some((tileId) => tileId === null)) return;
    const candidate = groups
      .map((group, groupIndex) => {
        const start = groups.slice(0, groupIndex).reduce((count, letters) => count + letters.length, 0);
        return group.map((_, offset) => {
          const tileId = slots[start + offset];
          return tiles.find((tile) => tile.id === tileId)?.letter ?? "";
        }).join("");
      })
      .join(" ")
      .normalize("NFC");
    const target = words.join(" ").normalize("NFC");
    if (candidate === target) {
      solved = true;
      puzzle.feedback = null;
      score.textContent = `${onCorrect()} correct`;
      status.className = "scramble-feedback is-correct";
      status.textContent = "Correct!";
      for (const tileButton of Array.from(bank.querySelectorAll<HTMLButtonElement>("button"))) {
        tileButton.disabled = true;
      }
      check.remove();
      clear.remove();
      skip.remove();
      const next = button(index === total - 1 ? "See your score" : "Next word", "button primary scramble-next");
      next.addEventListener("click", onAdvance);
      actions.append(next);
      next.focus();
      return;
    }

    puzzle.attempts += 1;
    if (puzzle.attempts >= 2) {
      puzzle.revealed = true;
      fillAnswer(puzzle, words);
      puzzle.feedback = {
        tone: "reveal",
        text: `Answer: ${words.join(" ")}.`,
      };
      rerender("next", puzzle.feedback.text);
      return;
    }

    puzzle.feedback = { tone: "incorrect", text: "Not quite. Try again." };
    status.className = "scramble-feedback is-incorrect";
    status.textContent = puzzle.feedback.text;
  });

  if (puzzle.revealed) {
    const next = button(index === total - 1 ? "See your score" : "Next word", "button primary scramble-next");
    next.addEventListener("click", onAdvance);
    actions.append(next);
  } else {
    actions.append(clear, skip, check);
  }
  shell.append(header, score, prompt, answer, bank, status, actions);
  section.replaceChildren(shell, args.announcement);
  if (announcementText) args.announcement.textContent = announcementText;

  if (focusTarget === "next" || puzzle.revealed) {
    section.querySelector<HTMLButtonElement>(".scramble-next")?.focus();
    return;
  }
  if (focusTarget === "check") {
    check.focus();
    return;
  }
  if (typeof focusTarget === "object") {
    const returnedTile = section.querySelector<HTMLButtonElement>(`[data-tile-id="${focusTarget.tileId}"]`);
    if (returnedTile) {
      returnedTile.focus();
      return;
    }
  }
  const nextTileId = tiles.find((tile) => !slots.includes(tile.id))?.id;
  if (nextTileId !== undefined) {
    section.querySelector<HTMLButtonElement>(`[data-tile-id="${nextTileId}"]`)?.focus();
  } else {
    check.focus();
  }
}

function fillAnswer(puzzle: PuzzleState, words: string[]): void {
  const expected = words.flatMap((word) => Array.from(word.normalize("NFC")));
  const unused = new Set(puzzle.tiles.map((tile) => tile.id));
  puzzle.slots = expected.map((letter) => {
    const tile = puzzle.tiles.find((candidate) => unused.has(candidate.id) && candidate.letter === letter);
    if (!tile) return null;
    unused.delete(tile.id);
    return tile.id;
  });
}

function renderRoundComplete(
  section: HTMLElement,
  score: number,
  total: number,
  options: ScrambleViewOptions,
): void {
  options.onBackChange(() => void renderSetup(section, options));
  const result = el("div", "scramble-result");
  result.append(
    el("h2", "scramble-title", "Round complete"),
    el("p", "scramble-result-score", `${score} / ${total} correct`),
  );
  const playAgain = button("Play another round", "button primary");
  playAgain.addEventListener("click", () => void renderSetup(section, options));
  result.append(playAgain);
  section.replaceChildren(result);
}
