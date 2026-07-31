import type { QuizQuestion } from "../api/types";

export type QuizState = {
  attemptId: string | null;
  score: number;
  totalQuestions: number;
  secondsRemaining: number | null;
  currentQuestion: QuizQuestion | null;
  running: boolean;
};

const state: QuizState = {
  attemptId: null,
  score: 0,
  totalQuestions: 0,
  secondsRemaining: null,
  currentQuestion: null,
  running: false,
};

export function getQuizState(): QuizState {
  return state;
}

export function startAttempt(
  attemptId: string,
  question: QuizQuestion,
  score: number,
  totalQuestions = 0,
  secondsRemaining: number | null = null,
): void {
  state.attemptId = attemptId;
  state.currentQuestion = question;
  state.score = score;
  state.totalQuestions = totalQuestions;
  state.secondsRemaining = secondsRemaining;
  state.running = true;
}

export function advanceQuestion(
  question: QuizQuestion,
  score: number,
  totalQuestions = state.totalQuestions,
  secondsRemaining: number | null = state.secondsRemaining,
): void {
  state.currentQuestion = question;
  state.score = score;
  state.totalQuestions = totalQuestions;
  state.secondsRemaining = secondsRemaining;
}

export function finishAttempt(score: number, totalQuestions = state.totalQuestions): void {
  state.score = score;
  state.totalQuestions = totalQuestions;
  state.running = false;
}
