export const GOETHE_PARTS = ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"] as const;

export type GoetheLevel = "A1" | "A2" | "B1" | "B2";
export type GoethePart = (typeof GOETHE_PARTS)[number];
export type ReadingShape =
  | "general_free_form"
  | "goethe_true_false_text"
  | "goethe_source_choice"
  | "goethe_true_false_notice"
  | "goethe_yes_no"
  | "goethe_abc_choice"
  | "goethe_matching"
  | "goethe_gap_match"
  | "goethe_standard";

export type GoethePartSpec = {
  shape: ReadingShape;
  label: string;
  description: string;
  defaultOptions: string[];
};

export const GOETHE_PART_SPECS: Record<GoetheLevel, Partial<Record<GoethePart, GoethePartSpec>>> = {
  A1: {
    teil_1: {
      shape: "goethe_true_false_text",
      label: "Teil 1 · Short text · Richtig/Falsch",
      description: "Read a short personal text and mark each statement as Richtig or Falsch.",
      defaultOptions: ["Richtig", "Falsch"],
    },
    teil_2: {
      shape: "goethe_source_choice",
      label: "Teil 2 · Two adverts · a/b",
      description: "Read a situation and choose which of two adverts fits.",
      defaultOptions: ["a", "b"],
    },
    teil_3: {
      shape: "goethe_true_false_notice",
      label: "Teil 3 · Sign or notice · Richtig/Falsch",
      description: "Read a sign, notice, or short announcement and mark Richtig or Falsch.",
      defaultOptions: ["Richtig", "Falsch"],
    },
  },
  A2: {
    teil_1: {
      shape: "goethe_abc_choice",
      label: "Teil 1 · Newspaper article · a/b/c",
      description: "Read one article and choose a, b, or c for tasks 1-5.",
      defaultOptions: ["a", "b", "c"],
    },
    teil_2: {
      shape: "goethe_abc_choice",
      label: "Teil 2 · Information board · a/b/c",
      description: "Use an information board/table and choose a, b, or c for tasks 6-10.",
      defaultOptions: ["a", "b", "c"],
    },
    teil_3: {
      shape: "goethe_abc_choice",
      label: "Teil 3 · E-mail · a/b/c",
      description: "Read one e-mail and choose a, b, or c for tasks 11-15.",
      defaultOptions: ["a", "b", "c"],
    },
    teil_4: {
      shape: "goethe_matching",
      label: "Teil 4 · Ad matching · a-f/x",
      description: "Match situations to adverts a-f; one task has no solution and uses X.",
      defaultOptions: ["a", "b", "c", "d", "e", "f", "X"],
    },
  },
  B1: {
    teil_1: {
      shape: "goethe_true_false_text",
      label: "Teil 1 · Text · Richtig/Falsch",
      description: "Read one text and mark each statement as Richtig or Falsch.",
      defaultOptions: ["Richtig", "Falsch"],
    },
    teil_2: {
      shape: "goethe_abc_choice",
      label: "Teil 2 · Article · a/b/c",
      description: "Read one article and choose a, b, or c.",
      defaultOptions: ["a", "b", "c"],
    },
    teil_3: {
      shape: "goethe_matching",
      label: "Teil 3 · Advertisement matching · a-j/x",
      description: "Match situations to adverts a-j; use X when none fits.",
      defaultOptions: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "X"],
    },
    teil_4: {
      shape: "goethe_yes_no",
      label: "Teil 4 · Opinion texts · Ja/Nein",
      description: "Read opinions and choose whether each person supports the statement.",
      defaultOptions: ["Ja", "Nein"],
    },
    teil_5: {
      shape: "goethe_abc_choice",
      label: "Teil 5 · Rules text · a/b/c",
      description: "Read rules or regulations and choose a, b, or c.",
      defaultOptions: ["a", "b", "c"],
    },
  },
  B2: {
    teil_1: {
      shape: "goethe_matching",
      label: "Teil 1 · Four people · a-d",
      description: "Match statements to people a-d; people can be selected more than once.",
      defaultOptions: ["a", "b", "c", "d"],
    },
    teil_2: {
      shape: "goethe_gap_match",
      label: "Teil 2 · Gap sentences · a-h",
      description: "Choose which sentence a-h fits each gap; two sentences do not fit.",
      defaultOptions: ["a", "b", "c", "d", "e", "f", "g", "h"],
    },
    teil_3: {
      shape: "goethe_abc_choice",
      label: "Teil 3 · Article · a/b/c",
      description: "Read one article and choose a, b, or c.",
      defaultOptions: ["a", "b", "c"],
    },
    teil_4: {
      shape: "goethe_matching",
      label: "Teil 4 · Headline matching · a-h",
      description: "Match opinion texts to headings a-h; one option does not fit.",
      defaultOptions: ["a", "b", "c", "d", "e", "f", "g", "h"],
    },
    teil_5: {
      shape: "goethe_matching",
      label: "Teil 5 · Regulation headings · a-h",
      description: "Match paragraphs from rules or regulations to headings a-h.",
      defaultOptions: ["a", "b", "c", "d", "e", "f", "g", "h"],
    },
  },
};

export function goethePartSpec(level: GoetheLevel, part: GoethePart): GoethePartSpec | null {
  return GOETHE_PART_SPECS[level]?.[part] ?? null;
}

export function allowedGoetheParts(level: GoetheLevel): GoethePart[] {
  return Object.keys(GOETHE_PART_SPECS[level] ?? { teil_1: null }) as GoethePart[];
}

export function resolveReadingShape(
  collection: "general" | "goethe",
  level: GoetheLevel,
  teil: GoethePart | null,
): ReadingShape {
  if (collection === "general") return "general_free_form";
  return goethePartSpec(level, teil ?? "teil_1")?.shape ?? "goethe_standard";
}

export function isTrueFalseShape(shape: ReadingShape): boolean {
  return shape === "goethe_true_false_text" || shape === "goethe_true_false_notice";
}

export function partLabel(part: GoethePart): string {
  return part.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function goethePartLabel(level: GoetheLevel, part: GoethePart): string {
  return goethePartSpec(level, part)?.label ?? partLabel(part);
}

export function resolvedExerciseLabel(shape: ReadingShape): string {
  if (shape === "general_free_form") return "Free-form practice";
  if (shape === "goethe_true_false_text") return "Personal text - true/false";
  if (shape === "goethe_source_choice") return "Two adverts - choose one";
  if (shape === "goethe_true_false_notice") return "Sign or notice - true/false";
  if (shape === "goethe_yes_no") return "Opinion task - yes/no";
  if (shape === "goethe_abc_choice") return "Multiple choice - a/b/c";
  if (shape === "goethe_matching") return "Matching task";
  if (shape === "goethe_gap_match") return "Gap sentence matching";
  return "Standard questions";
}
