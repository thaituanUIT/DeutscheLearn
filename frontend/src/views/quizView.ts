import { startEndlessQuiz, submitEndlessAnswer } from "../api/client";
import type { LeaderboardEntry, QuizQuestion } from "../api/types";
import { answerOption } from "../components/answerOption";
import { button } from "../components/button";
import { scoreBadge } from "../components/scoreBadge";
import { advanceQuestion, finishAttempt, getQuizState, startAttempt } from "../state/quizStore";
import { el } from "../utils/dom";

type QuizViewOptions = {
  bestScore: number;
  onLeaderboardRefresh: () => Promise<LeaderboardEntry[]>;
  onRender: () => void;
  onError: (message: string) => void;
};

export function quizView(options: QuizViewOptions): HTMLElement {
  const section = el("section", "panel quiz-card");
  renderStart(section, options);
  return section;
}

function renderStart(section: HTMLElement, options: QuizViewOptions): void {
  section.replaceChildren();
  const intro = el("div");
  intro.append(
    el("div", "question-type", "Endless mode"),
    el("h2", "question-word", "Wort?"),
    el("p", "prompt", "Answer until your first miss. Your longest streak goes on the board."),
  );
  const start = button("Start endless run", "button primary");
  start.addEventListener("click", async () => {
    try {
      const payload = await startEndlessQuiz();
      startAttempt(payload.attempt_id, payload.question, payload.score);
      renderQuestion(section, payload.question, options);
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "Could not start quiz");
    }
  });
  section.append(stats(options.bestScore), intro, start);
}

function renderQuestion(
  section: HTMLElement,
  question: QuizQuestion,
  options: QuizViewOptions,
): void {
  const state = getQuizState();
  section.replaceChildren();

  const questionBlock = el("div");
  questionBlock.append(
    el("div", "question-type", question.type === "article" ? "Article" : "Word type"),
    el("h2", "question-word", question.word),
    el("p", "prompt", question.prompt),
  );

  const answers = el("div", "answers");
  for (const choice of question.choices) {
    answers.append(
      answerOption(choice, async () => {
        await handleAnswer(choice, section, options);
      }),
    );
  }

  section.append(stats(options.bestScore), questionBlock, answers);
}

async function handleAnswer(
  choice: string,
  section: HTMLElement,
  options: QuizViewOptions,
): Promise<void> {
  const state = getQuizState();
  if (!state.attemptId || !state.currentQuestion) return;

  try {
    const answer = await submitEndlessAnswer(state.attemptId, state.currentQuestion.question_id, choice);
    if (answer.correct && answer.next_question) {
      advanceQuestion(answer.next_question, answer.score);
      renderQuestion(section, answer.next_question, options);
      return;
    }

    finishAttempt(answer.score);
    await options.onLeaderboardRefresh();
    renderResult(section, answer.score, answer.correct_answer, options);
  } catch (error) {
    options.onError(error instanceof Error ? error.message : "Could not submit answer");
  }
}

function renderResult(
  section: HTMLElement,
  score: number,
  correctAnswer: string,
  options: QuizViewOptions,
): void {
  section.replaceChildren();
  const content = el("div", "result");
  content.append(
    el("h2", "", "Run finished"),
    el("p", "prompt", `Final streak: ${score}. Correct answer: ${correctAnswer}.`),
  );
  const retry = button("Try again", "button primary");
  retry.addEventListener("click", () => renderStart(section, options));
  section.append(stats(Math.max(options.bestScore, score)), content, retry);
  options.onRender();
}

function stats(bestScore: number): HTMLElement {
  const state = getQuizState();
  const wrap = el("div", "stats");
  wrap.append(scoreBadge("Current", state.score), scoreBadge("Best", bestScore));
  return wrap;
}
