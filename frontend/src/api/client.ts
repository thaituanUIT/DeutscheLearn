import type {
  EndlessAnswer,
  EndlessStart,
  LeaderboardEntry,
  Player,
  PracticeAnswer,
  PracticeStart,
  TimedAnswer,
  TimedStart,
} from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getCurrentPlayer(): Promise<Player> {
  return request<Player>("/api/players/me");
}

export function startEndlessQuiz(): Promise<EndlessStart> {
  return request<EndlessStart>("/api/quiz/endless/start", { method: "POST" });
}

export function startPracticeQuiz(): Promise<PracticeStart> {
  return request<PracticeStart>("/api/quiz/practice/start", { method: "POST" });
}

export function startTimedQuiz(): Promise<TimedStart> {
  return request<TimedStart>("/api/quiz/timed/start", { method: "POST" });
}

export function submitEndlessAnswer(
  attemptId: string,
  questionId: string,
  selectedAnswer: string,
): Promise<EndlessAnswer> {
  return request<EndlessAnswer>("/api/quiz/endless/answer", {
    method: "POST",
    body: JSON.stringify({
      attempt_id: attemptId,
      question_id: questionId,
      selected_answer: selectedAnswer,
    }),
  });
}

export function submitPracticeAnswer(
  attemptId: string,
  questionId: string,
  selectedAnswer: string,
): Promise<PracticeAnswer> {
  return request<PracticeAnswer>("/api/quiz/practice/answer", {
    method: "POST",
    body: JSON.stringify({
      attempt_id: attemptId,
      question_id: questionId,
      selected_answer: selectedAnswer,
    }),
  });
}

export function submitTimedAnswer(
  attemptId: string,
  questionId: string,
  selectedAnswer: string,
): Promise<TimedAnswer> {
  return request<TimedAnswer>("/api/quiz/timed/answer", {
    method: "POST",
    body: JSON.stringify({
      attempt_id: attemptId,
      question_id: questionId,
      selected_answer: selectedAnswer,
    }),
  });
}

export function getLeaderboard(): Promise<LeaderboardEntry[]> {
  return request<LeaderboardEntry[]>("/api/leaderboard?mode=endless&limit=20");
}
