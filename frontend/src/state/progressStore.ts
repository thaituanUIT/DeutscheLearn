import type { FocusCard, Player, QuizQuestion, StoryPassage } from "../api/types";
import type { HomeMode, HomeModeMetric } from "../views/homeView";
import type { QuizMode } from "../views/quizView";

type FocusReview = {
  dueAt: string;
  reviewedAt: string;
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
  const storyReadCount = progress.storyReadIds.length;
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
      label: "GELESEN",
      value: storyTotal > 0 ? `${Math.min(storyReadCount, storyTotal)} / ${storyTotal}` : empty,
    },
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

export function recordFocusReview(playerId: string, card: FocusCard, rating: "again" | "hard" | "good" | "easy"): void {
  const progress = loadProgress(playerId);
  const now = new Date();
  progress.focusReviews[focusKey(card)] = {
    reviewedAt: now.toISOString(),
    dueAt: addDays(now, ratingDays(rating)).toISOString(),
  };
  saveProgress(playerId, progress);
}

export function recordStoryRead(playerId: string, passage: StoryPassage): void {
  const progress = loadProgress(playerId);
  if (!progress.storyReadIds.includes(passage.id)) {
    progress.storyReadIds.push(passage.id);
    saveProgress(playerId, progress);
  }
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
    return { ...emptyProgress(), ...JSON.parse(raw) } as LearnerProgress;
  } catch {
    return emptyProgress();
  }
}

function saveProgress(playerId: string, progress: LearnerProgress): void {
  localStorage.setItem(storageKey(playerId), JSON.stringify(progress));
}

function emptyProgress(): LearnerProgress {
  return {
    bestTimedScore: null,
    lastPracticeAt: null,
    focusReviews: {},
    storyReadIds: [],
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
