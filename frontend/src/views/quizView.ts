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
import { answerOption } from "../components/answerOption";
import { button } from "../components/button";
import { scoreBadge } from "../components/scoreBadge";
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
};

let timedTimerId: number | null = null;
let pendingAnswerKey: string | null = null;

export function quizView(options: QuizViewOptions): HTMLElement {
  const section = el("section", "panel quiz-card");
  renderStart(section, options);
  return section;
}

function renderStart(section: HTMLElement, options: QuizViewOptions): void {
  stopTimedTimer();
  pendingAnswerKey = null;
  section.replaceChildren();
  const config = modeConfig(options.mode);
  const intro = el("div");
  intro.append(
    el("div", "question-type", config.eyebrow),
    el("h2", "question-word", config.title),
    el("p", "prompt", config.prompt),
  );
  const actions = el("div", "actions");
  const start = button(config.startLabel, "button primary");
  start.addEventListener("click", async () => {
    try {
      const payload = await startMode(options.mode);
      const secondsRemaining = "duration_seconds" in payload ? payload.duration_seconds : null;
      const totalQuestions = "total_questions" in payload ? payload.total_questions : 0;
      startAttempt(payload.attempt_id, payload.question, payload.score, totalQuestions, secondsRemaining);
      renderQuestion(section, payload.question, options);
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "Could not start quiz");
    }
  });
  actions.append(start);
  section.append(stats(options), intro, actions);
}

function renderQuestion(
  section: HTMLElement,
  question: QuizQuestion,
  options: QuizViewOptions,
): void {
  const state = getQuizState();
  pendingAnswerKey = null;
  section.replaceChildren();
  if (options.mode === "timed") startTimedTimer(section, options);

  const questionBlock = el("div");
  questionBlock.append(
    el("div", "question-type", question.type === "article" ? "Article" : "Word type"),
    el("h2", "question-word", question.word),
    el("p", "prompt", question.prompt),
  );

  const answers = el("div", "answers");
  for (const choice of question.choices) {
    answers.append(
      answerOption(choice, async () => {
        await handleAnswer(choice, section, options);
      }),
    );
  }

  section.append(stats(options), questionBlock, answers);
}

async function handleAnswer(
  choice: string,
  section: HTMLElement,
  options: QuizViewOptions,
): Promise<void> {
  const state = getQuizState();
  if (!state.attemptId || !state.currentQuestion) return;

  const questionId = state.currentQuestion.question_id;
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
      advanceQuestion(answer.next_question, answer.score, answer.total_questions);
      renderPracticeFeedback(section, answer.correct, answer.correct_answer, answer.next_question, options);
      return;
    }

    if (options.mode === "timed") {
      const answer = await submitTimedAnswer(state.attemptId, questionId, choice);
      if (!answer.attempt_finished && answer.next_question) {
        advanceQuestion(
          answer.next_question,
          answer.score,
          answer.total_questions,
          answer.seconds_remaining,
        );
        renderQuestion(section, answer.next_question, options);
        return;
      }

      finishAttempt(answer.score, answer.total_questions);
      renderTimedResult(section, answer.score, answer.total_questions, options);
      return;
    }

    const answer = await submitEndlessAnswer(state.attemptId, questionId, choice);
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
    await options.onLeaderboardRefresh();
    renderResult(
      section,
      answer.score,
      answer.correct_answer,
      answer.answered_word,
      answer.meaning_overview,
      options,
    );
  } catch (error) {
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
  content.append(
    el("h2", "", "Correct"),
    el("p", "answered-word", answeredWord),
    el("p", "meaning-overview", meaningOverview),
  );
  const next = button("Next question", "button primary");
  next.addEventListener("click", () => renderQuestion(section, nextQuestion, options));
  section.append(stats(options), content, next);
}

function renderPracticeFeedback(
  section: HTMLElement,
  correct: boolean,
  correctAnswer: string,
  nextQuestion: QuizQuestion,
  options: QuizViewOptions,
): void {
  section.replaceChildren();
  const content = el("div", "result");
  content.append(
    el("h2", "", correct ? "Correct" : "Not quite"),
    el("p", "prompt", correct ? "Keep going." : `Correct answer: ${correctAnswer}.`),
  );
  const next = button("Next question", "button primary");
  next.addEventListener("click", () => renderQuestion(section, nextQuestion, options));
  section.append(stats(options), content, next);
}

function renderResult(
  section: HTMLElement,
  score: number,
  correctAnswer: string,
  answeredWord: string,
  meaningOverview: string,
  options: QuizViewOptions,
): void {
  section.replaceChildren();
  const content = el("div", "result");
  content.append(
    el("h2", "", "Run finished"),
    el("p", "prompt", `Final streak: ${score}. Correct answer: ${correctAnswer}.`),
    el("p", "answered-word", answeredWord),
    el("p", "meaning-overview", meaningOverview),
  );
  const retry = button("Try again", "button primary");
  retry.addEventListener("click", () => renderStart(section, options));
  section.append(stats({ ...options, bestScore: Math.max(options.bestScore, score) }), content, retry);
  options.onRender();
}

function renderTimedResult(
  section: HTMLElement,
  score: number,
  totalQuestions: number,
  options: QuizViewOptions,
): void {
  stopTimedTimer();
  section.replaceChildren();
  const content = el("div", "result");
  content.append(
    el("h2", "", "Time up"),
    el("p", "prompt", `Final score: ${score} correct from ${totalQuestions} answers.`),
  );
  const retry = button("Try timed again", "button primary");
  retry.addEventListener("click", () => renderStart(section, options));
  section.append(stats(options), content, retry);
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
  eyebrow: string;
  title: string;
  prompt: string;
  startLabel: string;
} {
  if (mode === "practice") {
    return {
      eyebrow: "Practice mode",
      title: "Train",
      prompt: "Answer freely, see the correct answer, and keep practicing without a leaderboard.",
      startLabel: "Start practice",
    };
  }
  if (mode === "timed") {
    return {
      eyebrow: "Timed mode",
      title: "60s",
      prompt: "Answer as many questions as you can before the timer runs out.",
      startLabel: "Start timed run",
    };
  }
  return {
    eyebrow: "Endless mode",
    title: "Wort?",
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
      renderTimedResult(section, state.score, state.totalQuestions, options);
    }
  }, 1000);
}

function stopTimedTimer(): void {
  if (timedTimerId !== null) {
    window.clearInterval(timedTimerId);
    timedTimerId = null;
  }
}
