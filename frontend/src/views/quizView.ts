import "../styles/views/quiz.css";
import {
  startEndlessQuiz,
  startPracticeQuiz,
  startTimedQuiz,
  submitEndlessAnswer,
  submitPracticeAnswer,
  submitTimedAnswer,
} from "../api/client";
import type {
  EndlessStart,
  LeaderboardEntry,
  PracticeStart,
  QuizQuestion,
  TimedStart,
} from "../api/types";
import { button } from "../components/button";
import type { GrammarWrongAnswerContext } from "../components/grammarWidget";
import { scoreBadge } from "../components/scoreBadge";
import { getPlayer } from "../state/playerStore";
import {
  recordQuizAnswer,
  recordQuizComplete,
  type SessionSummary,
} from "../state/progressStore";
import { advanceQuestion, finishAttempt, getQuizState, startAttempt } from "../state/quizStore";
import { el } from "../utils/dom";

export type QuizMode = "endless" | "practice" | "timed";

type QuizViewOptions = {
  mode: QuizMode;
  bestScore: number;
  onLeaderboardRefresh: () => Promise<LeaderboardEntry[]>;
  onBack: () => void;
  onRender: () => void;
  onError: (message: string) => void;
  onExplainAnswer: (answer: GrammarWrongAnswerContext) => void;
  onBeginnerPractice: () => void;
  onGrammarContextChange: (context: { wrongAnswer?: GrammarWrongAnswerContext | null }) => void;
};

type AnswerReceipt = {
  question: QuizQuestion;
  selected: string;
  correct: string;
  meaning?: string;
};

let timedTimerId: number | null = null;
let pendingAnswerKey: string | null = null;

export function quizView(options: QuizViewOptions): HTMLElement {
  const section = el("section", "panel quiz-card");
  renderStart(section, options);
  return section;
}

export function abandonTimedRun(): void {
  stopTimedTimer();
  pendingAnswerKey = null;
  const state = getQuizState();
  if (state.running) finishAttempt(state.score, state.totalQuestions);
}

function renderStart(section: HTMLElement, options: QuizViewOptions): void {
  stopTimedTimer();
  pendingAnswerKey = null;
  options.onGrammarContextChange({ wrongAnswer: null });
  section.replaceChildren();
  const config = modeConfig(options.mode);
  const intro = el("div");
  intro.append(
    el("h2", "focus-title", config.title),
    el("p", "prompt", config.prompt),
  );
  const actions = el("div", "actions");
  const start = button(config.startLabel, "button primary");
  let starting = false;
  const startStatus = el("p", "prompt");
  startStatus.setAttribute("role", "status");
  start.addEventListener("click", async () => {
    if (starting) return;
    starting = true;
    start.disabled = true;
    section.setAttribute("aria-busy", "true");
    startStatus.textContent = "Starting your quiz…";
    try {
      const payload = await startMode(options.mode);
      const secondsRemaining = "duration_seconds" in payload ? payload.duration_seconds : null;
      const totalQuestions = "total_questions" in payload ? payload.total_questions : 0;
      if (!section.isConnected) return;
      startAttempt(payload.attempt_id, payload.question, payload.score, totalQuestions, secondsRemaining);
      renderQuestion(section, payload.question, options);
    } catch (error) {
      startStatus.textContent = "Could not start the quiz. Check your connection and try again.";
    } finally {
      starting = false;
      start.disabled = false;
      section.setAttribute("aria-busy", "false");
    }
  });
  const guidance = el("div", "quiz-level-guidance");
  guidance.append(el("p", "prompt", "Mixed-level vocabulary. For a guided beginner start, practice A1 flashcards first."));
  const beginner = button("Start with A1 flashcards", "button quiz-secondary");
  beginner.onclick = options.onBeginnerPractice;
  guidance.append(beginner);
  actions.append(start);
  section.append(intro, guidance, actions, startStatus);
}

function renderQuestion(
  section: HTMLElement,
  question: QuizQuestion,
  options: QuizViewOptions,
  receipt?: AnswerReceipt,
): void {
  pendingAnswerKey = null;
  options.onGrammarContextChange({ wrongAnswer: null });
  section.replaceChildren();
  if (options.mode === "timed") startTimedTimer(section, options);

  const questionBlock = el("div");
  const word = el("h2", "question-word", question.word);
  word.lang = "de";
  questionBlock.append(
    el("div", "question-type", question.type === "article" ? "Article" : "Word type"),
    word,
    el("p", "prompt", question.prompt),
  );

  const answers = el("div", "answers");
  for (const choice of question.choices) {
    const option = button(choice, "answer-option");
    option.addEventListener("click", async () => {
      await handleAnswer(choice, section, options);
    });
    if (question.type === "article") option.lang = "de";
    answers.append(option);
  }

  section.append(stats(options));
  if (receipt) {
    const last = el("p", "quiz-answer-receipt");
    announceResult(last);
    last.append(document.createTextNode(receipt.selected === receipt.correct ? "Last answer: correct — " : "Last answer: not quite — "));
    const correction = el("span", "", correctedWord(receipt));
    correction.lang = "de";
    last.append(correction, document.createTextNode(receipt.question.type === "word_type" ? ` (${receipt.correct})` : ""));
    section.append(last);
  }
  section.append(questionBlock, answers);
  focusQuizElement(word);
}

async function handleAnswer(
  choice: string,
  section: HTMLElement,
  options: QuizViewOptions,
): Promise<void> {
  const state = getQuizState();
  if (!state.attemptId || !state.currentQuestion) return;

  const attemptId = state.attemptId;
  const active = (): boolean => section.isConnected && getQuizState().attemptId === attemptId;
  const answeredQuestion = state.currentQuestion;
  const questionId = answeredQuestion.question_id;
  const answerKey = `${state.attemptId}:${questionId}`;
  if (pendingAnswerKey === answerKey) return;

  pendingAnswerKey = answerKey;
  setAnswerOptionsDisabled(section, true);

  try {
    if (options.mode === "practice") {
      const answer = await submitPracticeAnswer(
        state.attemptId,
        questionId,
        choice,
      );
      if (!active()) return;
      recordCurrentQuizAnswer(options.mode, choice, answer.correct_answer);
      recordCurrentQuizComplete(options.mode, answer.score, answer.total_questions);
      if (!answer.correct && state.currentQuestion) {
        options.onGrammarContextChange({
          wrongAnswer: {
            question: state.currentQuestion.prompt,
            learnerAnswer: choice,
            correctAnswer: answer.correct_answer,
            word: state.currentQuestion.word,
            mode: options.mode,
          },
        });
      }
      advanceQuestion(answer.next_question, answer.score, answer.total_questions);
      renderPracticeFeedback(section, answer.correct, {
        question: { ...answeredQuestion, word: answer.answered_word }, selected: choice, correct: answer.correct_answer, meaning: answer.meaning_overview,
      }, answer.next_question, options);
      return;
    }

    if (options.mode === "timed") {
      const answer = await submitTimedAnswer(state.attemptId, questionId, choice);
      if (!active() || !getQuizState().running) return;
      recordCurrentQuizAnswer(options.mode, choice, answer.correct_answer);
      if (!answer.attempt_finished && answer.next_question) {
        advanceQuestion(
          answer.next_question,
          answer.score,
          answer.total_questions,
          answer.seconds_remaining,
        );
        renderQuestion(section, answer.next_question, options, {
          question: answeredQuestion, selected: choice, correct: answer.correct_answer,
        });
        return;
      }

      finishAttempt(answer.score, answer.total_questions);
      renderTimedResult(
        section,
        answer.score,
        answer.total_questions,
        options,
        recordCurrentQuizComplete(options.mode, answer.score, answer.total_questions),
      );
      return;
    }

    const answer = await submitEndlessAnswer(attemptId, questionId, choice);
    if (!active()) return;
    recordCurrentQuizAnswer(options.mode, choice, answer.correct_answer);
    if (answer.correct && answer.next_question) {
      advanceQuestion(answer.next_question, answer.score);
      renderEndlessFeedback(
        section,
        answer.answered_word,
        answer.meaning_overview,
        answer.next_question,
        options,
      );
      return;
    }

    finishAttempt(answer.score);
    if (state.currentQuestion) {
      options.onGrammarContextChange({
        wrongAnswer: {
          question: state.currentQuestion.prompt,
          learnerAnswer: choice,
          correctAnswer: answer.correct_answer,
          word: state.currentQuestion.word,
          mode: options.mode,
        },
      });
    }
    await options.onLeaderboardRefresh().catch(() => undefined);
    if (!active()) return;
    const summary = recordCurrentQuizComplete(options.mode, answer.score, answer.score + 1);
    renderResult(
      section,
      answer.score,
      options,
      summary,
      { question: { ...answeredQuestion, word: answer.answered_word }, selected: choice, correct: answer.correct_answer, meaning: answer.meaning_overview },
    );
  } catch (error) {
    if (!active()) return;
    pendingAnswerKey = null;
    setAnswerOptionsDisabled(section, false);
    options.onError(error instanceof Error ? error.message : "Could not submit answer");
  }
}

function setAnswerOptionsDisabled(section: HTMLElement, disabled: boolean): void {
  for (const option of section.querySelectorAll<HTMLButtonElement>(".answer-option")) {
    option.disabled = disabled;
  }
}

function renderEndlessFeedback(
  section: HTMLElement,
  answeredWord: string,
  meaningOverview: string,
  nextQuestion: QuizQuestion,
  options: QuizViewOptions,
): void {
  section.replaceChildren();
  const content = el("div", "result");
  announceResult(content);
  content.append(
    el("h2", "", "Correct"),
    Object.assign(el("p", "answered-word", answeredWord), { lang: "de" }),
    el("p", "meaning-overview", meaningOverview),
  );
  const next = button("Next question", "button primary");
  next.addEventListener("click", () => renderQuestion(section, nextQuestion, options));
  section.append(stats(options), content, next);
  focusQuizElement(content.querySelector<HTMLElement>("h2")!);
}

function renderPracticeFeedback(
  section: HTMLElement,
  correct: boolean,
  receipt: AnswerReceipt,
  nextQuestion: QuizQuestion,
  options: QuizViewOptions,
): void {
  section.replaceChildren();
  const content = answerReview(correct ? "Correct" : "Not quite", receipt, options);
  const next = button("Next question", "button primary");
  next.onclick = () => renderQuestion(section, nextQuestion, options);
  section.append(stats(options), content, next);
  focusQuizElement(content.querySelector<HTMLElement>("h2")!);
}

function correctedWord(receipt: AnswerReceipt): string {
  const word = receipt.question.word;
  return receipt.question.type === "article" ? `${receipt.correct} ${word.charAt(0).toLocaleUpperCase("de")}${word.slice(1)}` : word;
}

function answerReview(title: string, receipt: AnswerReceipt, options: QuizViewOptions): HTMLElement {
  const content = el("div", "result quiz-answer-review");
  announceResult(content);
  const heading = el("h2", "", title);
  const word = el("p", "answered-word", correctedWord(receipt));
  word.lang = "de";
  content.append(heading, word);
  if (receipt.meaning) content.append(el("p", "meaning-overview", receipt.meaning));
  const comparison = el("dl", "quiz-answer-comparison");
  for (const [label, value] of [["Your answer", receipt.selected], ["Correct answer", receipt.correct]]) {
    const row = el("div", "");
    const answer = el("dd", "", value);
    if (receipt.question.type === "article") answer.lang = "de";
    row.append(el("dt", "", label), answer);
    comparison.append(row);
  }
  content.append(comparison);
  if (receipt.selected !== receipt.correct) {
    const explain = button("Explain this answer", "button quiz-secondary");
    explain.onclick = () => options.onExplainAnswer({
      question: receipt.question.prompt, learnerAnswer: receipt.selected,
      correctAnswer: receipt.correct, word: receipt.question.word, mode: options.mode,
    });
    content.append(explain);
  }
  return content;
}

function focusQuizElement(node: HTMLElement): void {
  node.tabIndex = -1;
  queueMicrotask(() => { if (node.isConnected) node.focus(); });
}

function renderResult(
  section: HTMLElement,
  score: number,
  options: QuizViewOptions,
  summary: SessionSummary | null,
  receipt: AnswerReceipt,
): void {
  section.replaceChildren();
  const content = answerReview("Run finished", receipt, options);
  content.prepend(el("p", "prompt", `Final streak: ${score}.`));
  if (summary) content.append(sessionSummary(summary));
  const retry = button("Try again", "button primary");
  retry.addEventListener("click", () => renderStart(section, options));
  section.append(stats({ ...options, bestScore: Math.max(options.bestScore, score) }), content, retry);
  focusQuizElement(content.querySelector<HTMLElement>("h2")!);
  options.onRender();
}

function renderTimedResult(
  section: HTMLElement,
  score: number,
  totalQuestions: number,
  options: QuizViewOptions,
  summary: SessionSummary | null = null,
): void {
  stopTimedTimer();
  section.replaceChildren();
  const content = el("div", "result");
  announceResult(content);
  content.append(
    el("h2", "", "Time up"),
    el("p", "prompt", `Final score: ${score} correct from ${totalQuestions} answers.`),
  );
  if (summary) content.append(sessionSummary(summary));
  const retry = button("Try timed again", "button primary");
  retry.addEventListener("click", () => renderStart(section, options));
  section.append(stats(options), content, retry);
  focusQuizElement(content.querySelector<HTMLElement>("h2")!);
}

function announceResult(node: HTMLElement): void {
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("aria-atomic", "true");
}

function sessionSummary(summary: SessionSummary): HTMLElement {
  const wrap = el("div", "session-summary");
  wrap.append(
    summaryItem("Correct", String(summary.score)),
    summaryItem("Answered", String(summary.total)),
    summaryItem("Mistakes", String(summary.missed)),
  );
  if (summary.isRecord) {
    wrap.append(summaryItem("Record", "New"));
  }
  return wrap;
}

function summaryItem(label: string, value: string): HTMLElement {
  const item = el("span", "session-summary-item");
  item.append(el("span", "session-summary-label", label), el("strong", "", value));
  return item;
}

function stats(options: QuizViewOptions): HTMLElement {
  const state = getQuizState();
  const wrap = el("div", "stats");
  wrap.append(scoreBadge("Score", state.score));
  if (options.mode === "endless") {
    wrap.append(scoreBadge("Best", options.bestScore));
  }
  if (options.mode === "practice" || options.mode === "timed") {
    wrap.append(scoreBadge("Answered", state.totalQuestions));
  }
  if (options.mode === "timed") {
    const timer = scoreBadge("Time", state.secondsRemaining ?? 60);
    timer.classList.add("timer-value");
    wrap.append(timer);
  }
  return wrap;
}

function modeConfig(mode: QuizMode): {
  title: string;
  prompt: string;
  startLabel: string;
} {
  if (mode === "practice") {
    return {
      title: "Practice",
      prompt: "Answer freely, see the correct answer, and keep practicing without a leaderboard.",
      startLabel: "Start practice",
    };
  }
  if (mode === "timed") {
    return {
      title: "Timed quiz",
      prompt: "Answer as many questions as you can before the timer runs out.",
      startLabel: "Start timed run",
    };
  }
  return {
    title: "Endless quiz",
    prompt: "Answer until your first miss. Your longest streak goes on the board.",
    startLabel: "Start endless run",
  };
}

async function startMode(mode: QuizMode): Promise<EndlessStart | PracticeStart | TimedStart> {
  if (mode === "practice") return startPracticeQuiz();
  if (mode === "timed") return startTimedQuiz();
  return startEndlessQuiz();
}

function startTimedTimer(section: HTMLElement, options: QuizViewOptions): void {
  stopTimedTimer();
  timedTimerId = window.setInterval(() => {
    const state = getQuizState();
    if (!state.running || state.secondsRemaining === null) return;
    state.secondsRemaining = Math.max(0, state.secondsRemaining - 1);
    const timer = section.querySelector(".timer-value strong");
    if (timer) timer.textContent = String(state.secondsRemaining);
    if (state.secondsRemaining === 0) {
      finishAttempt(state.score, state.totalQuestions);
      renderTimedResult(
        section,
        state.score,
        state.totalQuestions,
        options,
        recordCurrentQuizComplete(options.mode, state.score, state.totalQuestions),
      );
    }
  }, 1000);
}

function stopTimedTimer(): void {
  if (timedTimerId !== null) {
    window.clearInterval(timedTimerId);
    timedTimerId = null;
  }
}

function recordCurrentQuizAnswer(mode: QuizMode, selected: string, correct: string): void {
  const player = getPlayer();
  const question = getQuizState().currentQuestion;
  if (!player || !question) return;
  recordQuizAnswer(player.player_id, mode, question, selected, correct);
}

function recordCurrentQuizComplete(
  mode: QuizMode,
  score: number,
  total: number,
): SessionSummary | null {
  const player = getPlayer();
  if (!player) return null;
  return recordQuizComplete(player.player_id, mode, score, total);
}
