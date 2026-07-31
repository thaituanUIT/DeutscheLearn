export type Player = {
  player_id: string;
  display_name: string;
  best_endless_score: number;
};

export type QuizQuestion = {
  question_id: string;
  word: string;
  type: "article" | "word_type";
  prompt: string;
  choices: string[];
};

export type EndlessStart = {
  attempt_id: string;
  score: number;
  question: QuizQuestion;
};

export type EndlessAnswer = {
  correct: boolean;
  score: number;
  correct_answer: string;
  attempt_finished: boolean;
  next_question: QuizQuestion | null;
};

export type LeaderboardEntry = {
  rank: number;
  display_name: string;
  score: number;
  total_questions: number;
  accuracy: number | null;
  duration_seconds: number | null;
  ended_at: string | null;
};
