export type Player = {
  player_id: string;
  display_name: string;
  best_endless_score: number;
};

export type WordOfDay = {
  word: string;
  article: string | null;
  part_of_speech: string;
  meaning: string;
  date: string;
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

export type PracticeStart = {
  attempt_id: string;
  score: number;
  total_questions: number;
  question: QuizQuestion;
};

export type TimedStart = {
  attempt_id: string;
  score: number;
  total_questions: number;
  duration_seconds: number;
  question: QuizQuestion;
};

export type EndlessAnswer = {
  correct: boolean;
  score: number;
  correct_answer: string;
  answered_word: string;
  meaning_overview: string;
  attempt_finished: boolean;
  next_question: QuizQuestion | null;
};

export type PracticeAnswer = {
  correct: boolean;
  score: number;
  total_questions: number;
  correct_answer: string;
  next_question: QuizQuestion;
};

export type TimedAnswer = {
  correct: boolean;
  score: number;
  total_questions: number;
  correct_answer: string;
  attempt_finished: boolean;
  seconds_remaining: number;
  next_question: QuizQuestion | null;
};

export type FocusLevel = {
  level: "A1" | "A2" | "B1" | "B2";
  word_count: number;
  topic_count: number;
};

export type FocusTopic = {
  topic: string;
  label: string;
  word_count: number;
};

export type FocusTopicAlias = {
  topic: string;
  label: string;
};

export type FocusCard = {
  word: string;
  article: string | null;
  part_of_speech: string;
  meaning_overview: string;
  topic: string;
  topic_label: string;
  level: "A1" | "A2" | "B1" | "B2";
};

export type FocusRevisionQuestion = FocusCard & {
  choices: string[];
  correct_answer: string;
};

export type StoryLevel = {
  level: "A1" | "A2" | "B1" | "B2";
  passage_count: number;
  question_count: number;
};

export type StoryGroup = {
  group: "general" | "goethe";
  label: string;
  passage_count: number;
  question_count: number;
};

export type StoryPart = {
  part: "teil_1" | "teil_2" | "teil_3" | "teil_4" | "teil_5";
  label: string;
  passage_count: number;
  question_count: number;
};

export type StoryPassageSummary = {
  id: string;
  group: "general" | "goethe";
  level: "A1" | "A2" | "B1" | "B2";
  part: StoryPart["part"] | null;
  exercise_type: string | null;
  topic: string | null;
  title: string;
  order_index: number;
  question_count: number;
};

export type StoryAnswerChoice = {
  id: string;
  answer_text: string;
  order_index: number;
  ref_stimulus: {
    id: string;
    title: string;
    body: string;
    context_label: string | null;
    render_kind: StimulusRenderKind;
    content: StimulusContent | null;
    image_path: string | null;
    image_url: string | null;
    transcript: string | null;
  } | null;
};

export type StoryQuestion = {
  id: string;
  prompt: string;
  order_index: number;
  answers: StoryAnswerChoice[];
};

export type StoryPassage = {
  id: string;
  group: "general" | "goethe";
  level: "A1" | "A2" | "B1" | "B2";
  part: StoryPart["part"] | null;
  exercise_type: string | null;
  topic: string | null;
  title: string;
  passage_text: string;
  image_url: string | null;
  render_kind: StimulusRenderKind;
  content: StimulusContent | null;
  image_path: string | null;
  transcript: string | null;
  context_label: string | null;
  order_index: number;
  questions: StoryQuestion[];
};

export type StoryAnswer = {
  correct: boolean;
  correct_answer_id: string;
  correct_answer_text: string;
  explanation: string | null;
};

export type GrammarCitation = {
  chunk_id: string;
  title: string;
  section: string;
  content: string;
  level: "A1" | "A2" | "B1";
  topic: string;
  similarity: number;
  source_path: string;
};

export type GrammarAskResponse = {
  status: "answered" | "no_match";
  answer: string | null;
  citations: GrammarCitation[];
  retrieval_debug: Record<string, unknown> | null;
  cached: boolean;
};

export type AdminFocusEntry = {
  id?: string;
  level: "A1" | "A2" | "B1" | "B2";
  topic: string;
};

export type AdminWord = {
  word: string;
  article: string | null;
  part_of_speech: string;
  meaning: string;
  focus_entries: AdminFocusEntry[];
};

export type AdminReadingAnswer = {
  id?: string;
  answer_text: string;
  is_correct: boolean;
  order_index: number;
};

export type AdminReadingQuestion = {
  id?: string;
  prompt: string;
  explanation: string | null;
  order_index: number;
  answers: AdminReadingAnswer[];
};

export type AdminReadingAdStimulus = {
  id?: string;
  key: "a" | "b";
  title: string;
  body: string;
  render_kind: StimulusRenderKind;
  content: StimulusContent | null;
  image_path: string | null;
  transcript: string | null;
  context_label: string | null;
  order_index: number;
};

export type AdminReadingPassageSummary = {
  id: string;
  group: "general" | "goethe";
  level: "A1" | "A2" | "B1" | "B2";
  part: StoryPart["part"] | null;
  exercise_type: string | null;
  topic: string | null;
  title: string;
  status: "draft" | "published";
  order_index: number;
  question_count: number;
};

export type AdminReadingPassage = {
  id?: string;
  group: "general" | "goethe";
  level: "A1" | "A2" | "B1" | "B2";
  part: StoryPart["part"] | null;
  topic: string | null;
  title: string;
  passage_text: string;
  image_url: string | null;
  render_kind: StimulusRenderKind;
  content: StimulusContent | null;
  image_path: string | null;
  transcript: string | null;
  context_label: string | null;
  status: "draft" | "published";
  order_index: number;
  ad_stimuli: AdminReadingAdStimulus[];
  questions: AdminReadingQuestion[];
};

export type StimulusRenderKind =
  | "text"
  | "image"
  | "website_box"
  | "ad_box"
  | "hours_table"
  | "notice_sheet"
  | "door_sign"
  | "timetable"
  | "pictogram_sign";

export type StimulusContent = Record<string, unknown>;

export type StimulusImageUploadTarget = {
  bucket: "stimuli";
  path: string;
  token: string;
  upload_url: string;
};

export type LeaderboardEntry = {
  rank: number;
  display_name: string;
  score: number;
  total_questions: number;
  accuracy: number | null;
  duration_seconds: number | null;
  ended_at: string | null;
  is_current_player: boolean;
};
