import { QueryClient } from "@tanstack/query-core";

import { fetchAllPassages, fetchAllWords } from "./client";
import type {
  FocusCard,
  FocusLevel,
  FocusRevisionQuestion,
  FocusTopic,
  StoryGroup,
  StoryLevel,
  StoryPart,
  StoryPassage,
  StoryPassageSummary,
} from "./types";

export const PASSAGES_QUERY_KEY = ["passages"] as const;
export const WORDS_QUERY_KEY = ["words"] as const;
export const PASSAGES_STALE_TIME = 1000 * 60 * 60;
export const WORDS_STALE_TIME = 1000 * 60 * 60;

export const queryClient = new QueryClient();

export function prefetchStoryPassages(): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: PASSAGES_QUERY_KEY,
    queryFn: fetchAllPassages,
    staleTime: PASSAGES_STALE_TIME,
  });
}

export function prefetchFocusWords(): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: WORDS_QUERY_KEY,
    queryFn: fetchAllWords,
    staleTime: WORDS_STALE_TIME,
  });
}

export function getCachedFocusWords(): FocusCard[] | undefined {
  return queryClient.getQueryData<FocusCard[]>(WORDS_QUERY_KEY);
}

export function getFocusWordsCorpus(): Promise<FocusCard[]> {
  return queryClient.ensureQueryData({
    queryKey: WORDS_QUERY_KEY,
    queryFn: fetchAllWords,
    staleTime: WORDS_STALE_TIME,
  });
}

export function invalidateFocusWords(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: WORDS_QUERY_KEY });
}

export function getCachedStoryPassages(): StoryPassage[] | undefined {
  return queryClient.getQueryData<StoryPassage[]>(PASSAGES_QUERY_KEY);
}

export function getStoryCorpus(): Promise<StoryPassage[]> {
  return queryClient.ensureQueryData({
    queryKey: PASSAGES_QUERY_KEY,
    queryFn: fetchAllPassages,
    staleTime: PASSAGES_STALE_TIME,
  });
}

export function invalidateStoryPassages(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: PASSAGES_QUERY_KEY });
}

export function focusLevelsFromWords(words: FocusCard[]): FocusLevel[] {
  return (["A1", "A2", "B1", "B2"] as const).map((level) => {
    const levelWords = words.filter((word) => word.level === level);
    return {
      level,
      word_count: levelWords.length,
      topic_count: new Set(levelWords.map((word) => word.topic)).size,
    };
  });
}

export function focusTopicsFromWords(words: FocusCard[], level: FocusLevel["level"]): FocusTopic[] {
  const topics = new Map<string, { label: string; count: number }>();
  for (const word of words) {
    if (word.level !== level) continue;
    const current = topics.get(word.topic);
    topics.set(word.topic, {
      label: word.topic_label,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...topics.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([topic, value]) => ({
      topic,
      label: value.label,
      word_count: value.count,
    }));
}

export function focusCardsFromWords(
  words: FocusCard[],
  level: FocusLevel["level"],
  topic: string,
): FocusCard[] {
  return words
    .filter((word) => word.level === level && word.topic === topic)
    .sort((first, second) => first.word.localeCompare(second.word));
}

export function focusRevisionFromWords(
  topicWords: FocusCard[],
  allWords: FocusCard[],
  limit = 5,
): FocusRevisionQuestion[] {
  const meanings = [...new Set(allWords.map((word) => word.meaning_overview).filter(Boolean))];
  return shuffle(topicWords).slice(0, limit).map((word) => {
    const distractors = shuffle(meanings.filter((meaning) => meaning !== word.meaning_overview)).slice(0, 2);
    return {
      ...word,
      choices: shuffle([...distractors, word.meaning_overview]),
      correct_answer: word.meaning_overview,
    };
  });
}

export function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function storyGroupsFromCorpus(passages: StoryPassage[]): StoryGroup[] {
  return (["general", "goethe"] as const).map((group) => {
    const groupPassages = passages.filter((passage) => passage.group === group);
    return {
      group,
      label: group === "goethe" ? "Goethe-Institut" : "General",
      passage_count: groupPassages.length,
      question_count: countQuestions(groupPassages),
    };
  });
}

export function storyLevelsFromCorpus(
  passages: StoryPassage[],
  group: StoryGroup["group"],
): StoryLevel[] {
  return (["A1", "A2", "B1", "B2"] as const).map((level) => {
    const levelPassages = passages.filter((passage) => passage.group === group && passage.level === level);
    return {
      level,
      passage_count: levelPassages.length,
      question_count: countQuestions(levelPassages),
    };
  });
}

export function storyPartsFromCorpus(
  passages: StoryPassage[],
  level: StoryLevel["level"],
): StoryPart[] {
  const allowedParts = {
    A1: ["teil_1", "teil_2", "teil_3"],
    A2: ["teil_1", "teil_2", "teil_3", "teil_4"],
    B1: ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"],
    B2: ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"],
  } satisfies Record<StoryLevel["level"], StoryPart["part"][]>;

  return allowedParts[level].map((part) => {
    const partPassages = passages.filter(
      (passage) => passage.group === "goethe" && passage.level === level && passage.part === part,
    );
    return {
      part,
      label: part.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      passage_count: partPassages.length,
      question_count: countQuestions(partPassages),
    };
  });
}

export function storyPassageSummariesFromCorpus(
  passages: StoryPassage[],
  group: StoryGroup["group"],
  level: StoryLevel["level"],
  part: StoryPart["part"] | null,
): StoryPassageSummary[] {
  return passages
    .filter((passage) =>
      passage.group === group
      && passage.level === level
      && (part ? passage.part === part : passage.part === null),
    )
    .sort((first, second) => first.order_index - second.order_index || first.title.localeCompare(second.title))
    .map((passage) => ({
      id: passage.id,
      group: passage.group,
      level: passage.level,
      part: passage.part,
      exercise_type: passage.exercise_type,
      topic: passage.topic,
      title: passage.title,
      order_index: passage.order_index,
      question_count: passage.questions.length,
    }));
}

export function storyPassageFromCorpus(passages: StoryPassage[], passageId: string): StoryPassage | null {
  return passages.find((passage) => passage.id === passageId) ?? null;
}

function countQuestions(passages: StoryPassage[]): number {
  return passages.reduce((total, passage) => total + passage.questions.length, 0);
}
