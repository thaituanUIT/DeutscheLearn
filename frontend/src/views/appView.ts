import { getCurrentPlayer, getLeaderboard, getWordOfDay } from "../api/client";
import type { LeaderboardEntry, Player, WordOfDay } from "../api/types";
import { setPlayer } from "../state/playerStore";
import { clear, el } from "../utils/dom";
import { homeView } from "./homeView";
import { leaderboardView, wordOfDayView } from "./leaderboardView";
import { quizView, type QuizMode } from "./quizView";

export async function renderApp(root: HTMLElement): Promise<void> {
  clear(root);
  root.append(el("div", "shell", "Loading..."));

  try {
    const [player, leaderboard, wordOfDay] = await Promise.all([
      getCurrentPlayer(),
      getLeaderboard(),
      getWordOfDay(),
    ]);
    setPlayer(player);
    draw(root, player, leaderboard, wordOfDay);
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

function draw(
  root: HTMLElement,
  player: Player,
  initialLeaderboard: LeaderboardEntry[],
  wordOfDay: WordOfDay,
): void {
  let leaderboard = initialLeaderboard;
  let bestScore = player.best_endless_score;

  const shell = el("div", "shell");
  const header = el("header", "topbar");
  const playerNode = el("div", "player");
  playerNode.append(el("span", "muted", "Anonymous player"), el("strong", "", player.display_name));
  header.append(el("h1", "brand", "German Word Quiz"), playerNode);

  const layout = el("div", "layout");
  const mainHost = el("div");
  const sidebar = el("div", "sidebar");
  const leaderboardHost = el("div");
  const renderLeaderboard = (): void => {
    leaderboardHost.replaceChildren(leaderboardView(leaderboard));
  };

  const showHome = (): void => {
    mainHost.replaceChildren(homeView({ onSelectMode: showMode }));
  };

  const showMode = (mode: QuizMode): void => {
    mainHost.replaceChildren(
      quizView({
        mode,
        bestScore,
        onLeaderboardRefresh: async () => {
          leaderboard = await getLeaderboard();
          const ownBest = leaderboard.find((entry) => entry.display_name === player.display_name);
          if (ownBest) bestScore = Math.max(bestScore, ownBest.score);
          renderLeaderboard();
          return leaderboard;
        },
        onBack: showHome,
        onRender: () => undefined,
        onError: (message: string) => {
          const error = el("div", "error", message);
          layout.prepend(error);
        },
      }),
    );
  };

  renderLeaderboard();
  showHome();
  sidebar.replaceChildren(wordOfDayView(wordOfDay), leaderboardHost);
  layout.replaceChildren(mainHost, sidebar);
  shell.replaceChildren(header, layout);
  clear(root);
  root.append(shell);
}
