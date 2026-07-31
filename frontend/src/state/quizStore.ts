import type { QuizQuestion } from "../api/types";

export type QuizState = {
  attemptId: string | null;
  score: number;
  currentQuestion: QuizQuestion | null;
  running: boolean;
};

const state: QuizState = {
  attemptId: null,
  score: 0,
  currentQuestion: null,
  running: false,
};

export function getQuizState(): QuizState {
  return state;
}

export function startAttempt(attemptId: string, question: QuizQuestion, score: number): void {
  state.attemptId = attemptId;
  state.currentQuestion = question;
  state.score = score;
  state.running = true;
}

export function advanceQuestion(question: QuizQuestion, score: number): void {
  state.currentQuestion = question;
  state.score = score;
}

export function finishAttempt(score: number): void {
  state.score = score;
  state.running = false;
}
