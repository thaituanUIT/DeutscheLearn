import type { EndlessAnswer, EndlessStart, LeaderboardEntry, Player } from "./types";

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

export function getLeaderboard(): Promise<LeaderboardEntry[]> {
  return request<LeaderboardEntry[]>("/api/leaderboard?mode=endless&limit=20");
}
