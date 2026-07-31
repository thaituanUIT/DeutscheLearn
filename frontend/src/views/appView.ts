import { getCurrentPlayer, getLeaderboard } from "../api/client";
import type { LeaderboardEntry, Player } from "../api/types";
import { setPlayer } from "../state/playerStore";
import { clear, el } from "../utils/dom";
import { leaderboardView } from "./leaderboardView";
import { quizView } from "./quizView";

export async function renderApp(root: HTMLElement): Promise<void> {
  clear(root);
  root.append(el("div", "shell", "Loading..."));

  try {
    const [player, leaderboard] = await Promise.all([getCurrentPlayer(), getLeaderboard()]);
    setPlayer(player);
    draw(root, player, leaderboard);
  } catch (error) {
    clear(root);
    const shell = el("div", "shell");
    shell.append(
      el("h1", "brand", "German Word Quiz"),
      el("div", "error", error instanceof Error ? error.message : "Could not load app"),
    );
    root.append(shell);
  }
}

function draw(root: HTMLElement, player: Player, initialLeaderboard: LeaderboardEntry[]): void {
  let leaderboard = initialLeaderboard;
  let bestScore = player.best_endless_score;

  const shell = el("div", "shell");
  const header = el("header", "topbar");
  const playerNode = el("div", "player");
  playerNode.append(el("span", "muted", "Anonymous player"), el("strong", "", player.display_name));
  header.append(el("h1", "brand", "German Word Quiz"), playerNode);

  const layout = el("div", "layout");
  const leaderboardHost = el("div");
  const renderLeaderboard = (): void => {
    leaderboardHost.replaceChildren(leaderboardView(leaderboard));
  };

  const quiz = quizView({
    bestScore,
    onLeaderboardRefresh: async () => {
      leaderboard = await getLeaderboard();
      const ownBest = leaderboard.find((entry) => entry.display_name === player.display_name);
      if (ownBest) bestScore = Math.max(bestScore, ownBest.score);
      renderLeaderboard();
      return leaderboard;
    },
    onRender: () => undefined,
    onError: (message: string) => {
      const error = el("div", "error", message);
      layout.prepend(error);
    },
  });

  renderLeaderboard();
  layout.replaceChildren(quiz, leaderboardHost);
  shell.replaceChildren(header, layout);
  clear(root);
  root.append(shell);
}
