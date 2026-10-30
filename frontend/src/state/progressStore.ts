import type { FocusCard, Player, QuizQuestion, StoryPassage } from "../api/types";
import type { HomeMode, HomeModeMetric } from "../views/homeView";
import type { QuizMode } from "../views/quizView";

type FocusReview = {
  dueAt: string;
  reviewedAt: string;
};

export type FocusReviewUndo = () => boolean;

export type StoryDraft = {
  selections: Record<string, string>;
};

export type Mistake = {
  mode: QuizMode | "focus" | "story";
  prompt: string;
  word?: string;
  selected: string;
  correct: string;
  createdAt: string;
};

type LearnerProgress = {
  bestTimedScore: number | null;
  lastPracticeAt: string | null;
  focusReviews: Record<string, FocusReview>;
  storyReadIds: string[];
  storyCompletedIds: string[];
  storyDrafts: Record<string, StoryDraft>;
  mistakes: Mistake[];
};

export type SessionSummary = {
  mode: QuizMode | "focus" | "story";
  score: number;
  total: number;
  missed: number;
  isRecord: boolean;
};

const empty = "—";
const storagePrefix = "deutschelearn_progress";
const maxMistakes = 24;

export function homeMetricsForPlayer(
  player: Player,
  options: { storyTotal?: number; focusCards?: FocusCard[] } = {},
): Record<HomeMode, HomeModeMetric> {
  const progress = loadProgress(player.player_id);
  const storyCompletedCount = progress.storyCompletedIds.length;
  const storyTotal = options.storyTotal ?? 0;
  const focusDue = dueFocusCount(progress, options.focusCards ?? []);

  return {
    endless: {
      label: "BESTE SERIE",
      value: player.best_endless_score > 0 ? String(player.best_endless_score) : empty,
    },
    practice: {
      label: "ZULETZT",
      value: progress.lastPracticeAt ? relativeDay(progress.lastPracticeAt) : empty,
    },
    timed: {
      label: "BESTE PUNKTZAHL",
      value: progress.bestTimedScore && progress.bestTimedScore > 0 ? String(progress.bestTimedScore) : empty,
    },
    focus: {
      label: "FÄLLIG",
      value: focusDue > 0 ? String(focusDue) : empty,
    },
    story: {
      label: "COMPLETED",
      value: storyTotal > 0 ? `${Math.min(storyCompletedCount, storyTotal)} / ${storyTotal}` : empty,
    },
    scramble: {
      label: "WÖRTER",
      value: options.focusCards ? String(options.focusCards.length) : empty,
    },
    dictation: { label: "HÖREN & SCHREIBEN", value: "YouTube" },
  };
}

export function recordQuizAnswer(
  playerId: string,
  mode: QuizMode,
  question: QuizQuestion,
  selected: string,
  correct: string,
): void {
  if (selected === correct) return;
  addMistake(playerId, {
    mode,
    prompt: question.prompt,
    word: question.word,
    selected,
    correct,
    createdAt: new Date().toISOString(),
  });
}

export function recordQuizComplete(
  playerId: string,
  mode: QuizMode,
  score: number,
  total: number,
): SessionSummary {
  const progress = loadProgress(playerId);
  const missed = Math.max(0, total - score);
  let isRecord = false;

  if (mode === "practice") {
    progress.lastPracticeAt = new Date().toISOString();
  }

  if (mode === "timed" && score > (progress.bestTimedScore ?? 0)) {
    progress.bestTimedScore = score;
    isRecord = true;
  }

  saveProgress(playerId, progress);
  return { mode, score, total, missed, isRecord };
}

export function recordFocusReview(
  playerId: string,
  card: FocusCard,
  rating: "again" | "hard" | "good" | "easy",
): FocusReviewUndo {
  const progress = loadProgress(playerId);
  const now = new Date();
  const key = focusKey(card);
  const previous = progress.focusReviews[key];
  const recorded: FocusReview = {
    reviewedAt: now.toISOString(),
    dueAt: addDays(now, ratingDays(rating)).toISOString(),
  };
  progress.focusReviews[key] = recorded;
  saveProgress(playerId, progress);

  return () => {
    const latest = loadProgress(playerId);
    if (latest.focusReviews[key]?.reviewedAt !== recorded.reviewedAt) return false;
    if (previous) latest.focusReviews[key] = previous;
    else delete latest.focusReviews[key];
    saveProgress(playerId, latest);
    return true;
  };
}

export function recordStoryComplete(
  playerId: string,
  passage: StoryPassage,
  submittedSelections?: Record<string, string>,
): boolean {
  const progress = loadProgress(playerId);
  if (!progress.storyCompletedIds.includes(passage.id)) {
    progress.storyCompletedIds.push(passage.id);
  }
  const currentDraft = progress.storyDrafts[passage.id];
  const matchesSubmission = !currentDraft || !submittedSelections || passage.questions.every(
    (question) => currentDraft.selections[question.id] === submittedSelections[question.id],
  );
  if (matchesSubmission) delete progress.storyDrafts[passage.id];
  return saveProgress(playerId, progress);
}

export function isStoryCompleted(playerId: string, passageId: string): boolean {
  return loadProgress(playerId).storyCompletedIds.includes(passageId);
}

export function loadStoryDraft(playerId: string, passage: StoryPassage): StoryDraft | null {
  const draft = loadProgress(playerId).storyDrafts[passage.id];
  if (!draft || typeof draft !== "object" || !draft.selections) return null;
  const selections = validStorySelections(passage, draft.selections);
  return Object.keys(selections).length ? { selections } : null;
}

export function saveStoryDraft(
  playerId: string,
  passage: StoryPassage,
  selections: Record<string, string>,
): boolean {
  const progress = loadProgress(playerId);
  const valid = validStorySelections(passage, selections);
  delete progress.storyDrafts[passage.id];
  if (Object.keys(valid).length) progress.storyDrafts[passage.id] = { selections: valid };
  const oldest = Object.keys(progress.storyDrafts).slice(0, -20);
  for (const id of oldest) delete progress.storyDrafts[id];
  return saveProgress(playerId, progress);
}

export function clearStoryDraft(playerId: string, passageId: string): boolean {
  const progress = loadProgress(playerId);
  delete progress.storyDrafts[passageId];
  return saveProgress(playerId, progress);
}

function validStorySelections(passage: StoryPassage, selections: Record<string, string>): Record<string, string> {
  return Object.fromEntries(passage.questions.flatMap((question) => {
    const selected = selections[question.id];
    return question.answers.some((answer) => answer.id === selected) ? [[question.id, selected]] : [];
  }));
}

export function addStoryMistakes(
  playerId: string,
  mistakes: Array<{ prompt: string; selected: string; correct: string }>,
): void {
  for (const mistake of mistakes) {
    addMistake(playerId, { mode: "story", createdAt: new Date().toISOString(), ...mistake });
  }
}

export function recentMistakes(playerId: string): Mistake[] {
  return loadProgress(playerId).mistakes;
}

function dueFocusCount(progress: LearnerProgress, cards: FocusCard[]): number {
  if (cards.length === 0) return 0;
  const now = Date.now();
  return cards.filter((card) => {
    const review = progress.focusReviews[focusKey(card)];
    return !review || Date.parse(review.dueAt) <= now;
  }).length;
}

function addMistake(playerId: string, mistake: Mistake): void {
  const progress = loadProgress(playerId);
  progress.mistakes = [mistake, ...progress.mistakes].slice(0, maxMistakes);
  saveProgress(playerId, progress);
}

function loadProgress(playerId: string): LearnerProgress {
  try {
    const raw = localStorage.getItem(storageKey(playerId));
    if (!raw) return emptyProgress();
    const progress = { ...emptyProgress(), ...JSON.parse(raw) } as LearnerProgress;
    progress.storyCompletedIds = Array.isArray(progress.storyCompletedIds)
      ? progress.storyCompletedIds.filter((id) => typeof id === "string")
      : [];
    if (!progress.storyDrafts || typeof progress.storyDrafts !== "object" || Array.isArray(progress.storyDrafts)) {
      progress.storyDrafts = {};
    }
    return progress;
  } catch {
    return emptyProgress();
  }
}

function saveProgress(playerId: string, progress: LearnerProgress): boolean {
  try {
    localStorage.setItem(storageKey(playerId), JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

function emptyProgress(): LearnerProgress {
  return {
    bestTimedScore: null,
    lastPracticeAt: null,
    focusReviews: {},
    storyReadIds: [],
    storyCompletedIds: [],
    storyDrafts: {},
    mistakes: [],
  };
}

function storageKey(playerId: string): string {
  return `${storagePrefix}_${playerId}`;
}

function focusKey(card: FocusCard): string {
  return `${card.level}:${card.topic}:${card.word}`;
}

function ratingDays(rating: "again" | "hard" | "good" | "easy"): number {
  if (rating === "again") return 0;
  if (rating === "hard") return 1;
  if (rating === "good") return 3;
  return 7;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function relativeDay(isoDate: string): string {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const then = new Date(isoDate);
  then.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "heute";
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}
