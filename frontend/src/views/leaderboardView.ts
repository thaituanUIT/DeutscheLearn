import type { LeaderboardEntry, WordOfDay } from "../api/types";
import { el } from "../utils/dom";
import { formatSeconds } from "../utils/format";

export function wordOfDayView(word: WordOfDay): HTMLElement {
  const section = el("aside", "panel word-card");
  const shownWord = word.article ? `${word.article} ${word.word}` : word.word;
  section.append(
    el("div", "card-label", "Word of the day"),
    el("h2", "", shownWord),
    el("div", "word-meta", word.part_of_speech),
    el("p", "", word.meaning),
  );
  return section;
}

export function leaderboardView(entries: LeaderboardEntry[]): HTMLElement {
  const section = el("aside", "panel leaderboard");
  section.append(el("h2", "", "Endless leaderboard"));

  if (entries.length === 0) {
    section.append(el("p", "muted", "No completed runs yet."));
    return section;
  }

  const list = el("ol", "leaderboard-list");
  for (const entry of entries) {
    const row = el("li", "leaderboard-row");
    const meta = el(
      "small",
      "muted",
      `${entry.total_questions} correct · ${formatSeconds(entry.duration_seconds)}`,
    );
    const nameWrap = el("div");
    nameWrap.append(el("div", "name", entry.display_name), meta);
    row.append(el("span", "rank", `#${entry.rank}`), nameWrap, el("span", "score", String(entry.score)));
    list.append(row);
  }

  section.append(list);
  return section;
}
