import { getCurrentPlayer, getLeaderboard, getWordOfDay } from "../api/client";
import type { LeaderboardEntry, Player, WordOfDay } from "../api/types";
import { button } from "../components/button";
import { setPlayer } from "../state/playerStore";
import { clear, el } from "../utils/dom";
import { focusView } from "./focusView";
import { homeView, type HomeMode } from "./homeView";
import { leaderboardView, wordOfDayView } from "./leaderboardView";
import { quizView } from "./quizView";
import { storyView } from "./storyView";

type AppRoute = HomeMode | "home";

const appRoutes = new Set<AppRoute>(["home", "endless", "practice", "timed", "focus", "story"]);

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
  const headerStart = el("div", "header-start");
  const playerNode = el("div", "player");
  playerNode.append(el("span", "muted", "Anonymous learner"), el("strong", "", player.display_name));
  header.append(headerStart, playerNode);

  const layout = el("div", "layout");
  const mainHost = el("div");
  const sidebar = el("div", "sidebar");
  const leaderboardHost = el("div");
  const renderLeaderboard = (): void => {
    leaderboardHost.replaceChildren(leaderboardView(leaderboard));
  };

  const showHome = (syncRoute = true): void => {
    if (syncRoute) writeRoute("home");
    headerStart.replaceChildren(el("h1", "brand", "German Word Quiz"));
    mainHost.replaceChildren(homeView({ onSelectMode: showMode }));
  };

  const renderHeaderBack = (onClick: () => void): void => {
    const back = button("Back", "button header-back");
    back.addEventListener("click", onClick);
    headerStart.replaceChildren(back);
  };

  const showMode = (mode: HomeMode, syncRoute = true): void => {
    if (syncRoute) writeRoute(mode);
    renderHeaderBack(showHome);
    if (mode === "focus") {
      mainHost.replaceChildren(
        focusView({
          onBack: showHome,
          onBackChange: renderHeaderBack,
          onError: showError,
        }),
      );
      return;
    }

    if (mode === "story") {
      mainHost.replaceChildren(
        storyView({
          onBack: showHome,
          onBackChange: renderHeaderBack,
          onError: showError,
        }),
      );
      return;
    }

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
        onError: showError,
      }),
    );
  };

  const showError = (message: string): void => {
    const error = el("div", "error", message);
    layout.prepend(error);
  };

  renderLeaderboard();
  const renderRoute = (): void => {
    const route = readRoute();
    if (route === "home") {
      showHome(false);
      return;
    }
    showMode(route, false);
  };

  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("popstate", renderRoute);
  renderRoute();
  sidebar.replaceChildren(wordOfDayView(wordOfDay), leaderboardHost);
  layout.replaceChildren(mainHost, sidebar);
  shell.replaceChildren(header, layout);
  clear(root);
  root.append(shell);
}

function readRoute(): AppRoute {
  const hashRoute = window.location.hash.replace(/^#/, "");
  if (appRoutes.has(hashRoute as AppRoute)) return hashRoute as AppRoute;
  return "home";
}

function writeRoute(route: AppRoute): void {
  const nextHash = route === "home" ? "" : `#${route}`;
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  if (window.location.hash === nextHash) return;
  window.history.pushState({}, "", nextUrl);
}
