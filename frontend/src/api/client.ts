import type {
  AdminReadingPassage,
  AdminReadingPassageSummary,
  AdminWord,
  EndlessAnswer,
  EndlessStart,
  FocusCard,
  FocusLevel,
  FocusRevisionQuestion,
  FocusTopic,
  FocusTopicAlias,
  LeaderboardEntry,
  Player,
  PracticeAnswer,
  PracticeStart,
  StoryAnswer,
  StoryLevel,
  StoryPassage,
  StoryPassageSummary,
  TimedAnswer,
  TimedStart,
  WordOfDay,
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

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const message = await response.text();
    throw new Error(message || `Expected JSON but received ${contentType || "an unknown response type"}`);
  }

  return response.json() as Promise<T>;
}

async function adminRequest<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return request<T>(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

async function adminRequestNoContent(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<void> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
}

export function getCurrentPlayer(): Promise<Player> {
  return request<Player>("/api/players/me");
}

export function getWordOfDay(): Promise<WordOfDay> {
  return request<WordOfDay>("/api/word-of-the-day");
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
  return request<LeaderboardEntry[]>("/api/leaderboard?mode=endless&limit=5");
}

export function getFocusLevels(): Promise<FocusLevel[]> {
  return request<FocusLevel[]>("/api/focus/levels");
}

export function getFocusTopics(level: string): Promise<FocusTopic[]> {
  return request<FocusTopic[]>(`/api/focus/topics?level=${encodeURIComponent(level)}`);
}

export function getFocusTopicAliases(): Promise<FocusTopicAlias[]> {
  return request<FocusTopicAlias[]>("/api/focus/topic-aliases");
}

export function getFocusCards(level: string, topic: string): Promise<FocusCard[]> {
  const params = new URLSearchParams({ level, topic });
  return request<FocusCard[]>(`/api/focus/cards?${params.toString()}`);
}

export function getFocusRevision(level: string, topic: string): Promise<FocusRevisionQuestion[]> {
  const params = new URLSearchParams({ level, topic });
  return request<FocusRevisionQuestion[]>(`/api/focus/revision?${params.toString()}`);
}

export function getStoryLevels(): Promise<StoryLevel[]> {
  return request<StoryLevel[]>("/api/story/levels");
}

export function getStoryPassages(level: string): Promise<StoryPassageSummary[]> {
  return request<StoryPassageSummary[]>(`/api/story/passages?level=${encodeURIComponent(level)}`);
}

export function getStoryPassage(passageId: string): Promise<StoryPassage> {
  return request<StoryPassage>(`/api/story/passages/${encodeURIComponent(passageId)}`);
}

export function submitStoryAnswer(questionId: string, answerId: string): Promise<StoryAnswer> {
  return request<StoryAnswer>("/api/story/answer", {
    method: "POST",
    body: JSON.stringify({
      question_id: questionId,
      answer_id: answerId,
    }),
  });
}

export function getAdminWords(
  token: string,
  filters: { search?: string; level?: string; topic?: string } = {},
): Promise<AdminWord[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.level) params.set("level", filters.level);
  if (filters.topic) params.set("topic", filters.topic);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return adminRequest<AdminWord[]>(token, `/api/admin/words${suffix}`);
}

export function createAdminWord(token: string, word: AdminWord): Promise<AdminWord> {
  return adminRequest<AdminWord>(token, "/api/admin/words", {
    method: "POST",
    body: JSON.stringify(word),
  });
}

export function updateAdminWord(token: string, word: AdminWord): Promise<AdminWord> {
  return adminRequest<AdminWord>(token, `/api/admin/words/${encodeURIComponent(word.word)}`, {
    method: "PATCH",
    body: JSON.stringify({
      article: word.article,
      part_of_speech: word.part_of_speech,
      meaning: word.meaning,
      focus_entries: word.focus_entries,
    }),
  });
}

export function deleteAdminWord(token: string, word: string): Promise<void> {
  return adminRequestNoContent(token, `/api/admin/words/${encodeURIComponent(word)}`, {
    method: "DELETE",
  });
}

export function getAdminReadingPassages(
  token: string,
  level = "",
): Promise<AdminReadingPassageSummary[]> {
  const suffix = level ? `?level=${encodeURIComponent(level)}` : "";
  return adminRequest<AdminReadingPassageSummary[]>(token, `/api/admin/reading/passages${suffix}`);
}

export function getAdminReadingPassage(
  token: string,
  passageId: string,
): Promise<AdminReadingPassage> {
  return adminRequest<AdminReadingPassage>(
    token,
    `/api/admin/reading/passages/${encodeURIComponent(passageId)}`,
  );
}

export function createAdminReadingPassage(
  token: string,
  passage: AdminReadingPassage,
): Promise<AdminReadingPassage> {
  return adminRequest<AdminReadingPassage>(token, "/api/admin/reading/passages", {
    method: "POST",
    body: JSON.stringify(passage),
  });
}

export function updateAdminReadingPassage(
  token: string,
  passage: AdminReadingPassage,
): Promise<AdminReadingPassage> {
  if (!passage.id) throw new Error("Missing passage id");
  return adminRequest<AdminReadingPassage>(
    token,
    `/api/admin/reading/passages/${encodeURIComponent(passage.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(passage),
    },
  );
}

export function deleteAdminReadingPassage(token: string, passageId: string): Promise<void> {
  return adminRequestNoContent(
    token,
    `/api/admin/reading/passages/${encodeURIComponent(passageId)}`,
    { method: "DELETE" },
  );
}
