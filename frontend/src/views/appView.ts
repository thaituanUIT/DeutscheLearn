import { getCurrentPlayer, getLeaderboard, getWordOfDay } from "../api/client";
import {
  getCachedFocusWords,
  getCachedStoryPassages,
  prefetchFocusWords,
  prefetchStoryPassages,
} from "../api/queryClient";
import type { LeaderboardEntry, Player, WordOfDay } from "../api/types";
import { appHeader } from "../components/appHeader";
import { button } from "../components/button";
import {
  mountGrammarWidget,
  type GrammarPassageContext,
  type GrammarWrongAnswerContext,
} from "../components/grammarWidget";
import { setPlayer } from "../state/playerStore";
import { homeMetricsForPlayer, recentMistakes } from "../state/progressStore";
import { getQuizState } from "../state/quizStore";
import { clear, el } from "../utils/dom";
import { focusView } from "./focusView";
import { homeView, type HomeMode } from "./homeView";
import { leaderboardView, wordOfDayView } from "./leaderboardView";
import { abandonTimedRun, quizView } from "./quizView";
import { storyView } from "./storyView";
import { dictationView } from "./dictationView";

type AppRoute = HomeMode | "home";

const appRoutes = new Set<AppRoute>(["home", "endless", "practice", "timed", "focus", "story", "dictation"]);

export async function renderApp(root: HTMLElement): Promise<void> {
  clear(root);
  root.append(el("div", "shell", "Loading..."));
  void prefetchStoryPassages();
  void prefetchFocusWords();

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
    const message = el("div", "error", error instanceof Error ? error.message : "Could not load app");
    message.setAttribute("role", "alert");
    message.setAttribute("aria-atomic", "true");
    shell.append(
      el("h1", "brand", "DeutscheLearn"),
      message,
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
  let grammarWidget: ReturnType<typeof mountGrammarWidget> | null = null;
  let refreshedHomeMetrics = false;
  let currentRoute: AppRoute = readRoute();
  let routeInitialized = false;
  let restoringTimedRoute = false;

  const shell = el("div", "shell");
  const playerNode = el("div", "player");
  playerNode.append(el("span", "muted", "Anonymous learner"), el("strong", "", player.display_name));
  const { header, headerStart } = appHeader("DeutscheLearn", playerNode);

  const layout = el("div", "layout");
  const mainHost = el("div");
  const sidebar = el("div", "sidebar");
  const leaderboardHost = el("div");
  const renderLeaderboard = (): void => {
    leaderboardHost.replaceChildren(leaderboardView(leaderboard));
  };

  const showHome = (syncRoute = true): void => {
    if (syncRoute && !confirmLeavingTimedRun("home")) return;
    if (currentRoute === "timed") abandonTimedRun();
    currentRoute = "home";
    if (syncRoute) writeRoute("home");
    grammarWidget?.updateContext({ route: "home", passage: null, wrongAnswer: null });
    layout.className = "layout home-layout";
    headerStart.replaceChildren(el("h1", "brand", "DeutscheLearn"));
    mainHost.replaceChildren(
      homeView({
        onSelectMode: showMode,
        metrics: homeMetricsForPlayer(player, {
          focusCards: getCachedFocusWords(),
          storyTotal: getCachedStoryPassages()?.length,
        }),
        mistakes: recentMistakes(player.player_id),
      }),
    );
    const more = el("details", "home-more");
    more.append(el("summary", "", "Word of the day and leaderboard"), wordOfDayView(wordOfDay), leaderboardHost);
    sidebar.replaceChildren(more);
    layout.replaceChildren(mainHost, sidebar);
    if (!refreshedHomeMetrics) {
      refreshedHomeMetrics = true;
      void Promise.allSettled([prefetchFocusWords(), prefetchStoryPassages()]).then(() => {
        if (readRoute() === "home") showHome(false);
      });
    }
  };

  const renderHeaderBack = (onClick: () => void): void => {
    const back = button("← Back", "button header-back");
    back.addEventListener("click", onClick);
    headerStart.replaceChildren(back);
  };

  const showMode = (mode: HomeMode, syncRoute = true): void => {
    if (syncRoute && !confirmLeavingTimedRun(mode)) return;
    if (currentRoute === "timed" && mode !== "timed") abandonTimedRun();
    currentRoute = mode;
    if (syncRoute) writeRoute(mode);
    grammarWidget?.updateContext({ route: mode, passage: null, wrongAnswer: null });
    layout.className = mode === "story" ? "layout mode-layout story-mode-layout" : "layout mode-layout";
    layout.replaceChildren(mainHost);
    renderHeaderBack(showHome);
    if (mode === "focus") {
      mainHost.replaceChildren(
        focusView({
          onBack: showHome,
          onBackChange: renderHeaderBack,
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
          onGrammarContextChange: (context: {
            passage?: GrammarPassageContext | null;
            wrongAnswer?: GrammarWrongAnswerContext | null;
          }) => grammarWidget?.updateContext(context),
        }),
      );
      return;
    }

    if (mode === "dictation") {
      mainHost.replaceChildren(
        dictationView({
          onBack: showHome,
          onBackChange: renderHeaderBack,
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
        onGrammarContextChange: (context: { wrongAnswer?: GrammarWrongAnswerContext | null }) =>
          grammarWidget?.updateContext(context),
        onError: showError,
      }),
    );
  };

  const showError = (message: string): void => {
    layout.querySelector(".app-error")?.remove();
    const error = el("div", "error app-error", message);
    error.setAttribute("role", "alert");
    error.setAttribute("aria-atomic", "true");
    layout.prepend(error);
  };

  const confirmLeavingTimedRun = (destination: AppRoute): boolean => {
    if (currentRoute !== "timed" || destination === "timed" || !getQuizState().running) return true;
    const destinationLabel = destination === "home" ? "the home screen" : "another mode";
    return window.confirm(`End this timed run and return to ${destinationLabel}? The timer will stop.`);
  };

  renderLeaderboard();
  const renderRoute = (): void => {
    const route = readRoute();
    if (restoringTimedRoute) {
      if (route === currentRoute) restoringTimedRoute = false;
      return;
    }
    if (routeInitialized && route === currentRoute) return;
    routeInitialized = true;
    if (route !== currentRoute) {
      if (!confirmLeavingTimedRun(route)) {
        restoringTimedRoute = true;
        window.history.forward();
        return;
      }
      if (currentRoute === "timed") abandonTimedRun();
      currentRoute = route;
    }
    if (route === "home") {
      showHome(false);
      return;
    }
    showMode(route, false);
  };

  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("popstate", renderRoute);
  shell.replaceChildren(header, layout);
  clear(root);
  root.append(shell);
  grammarWidget = mountGrammarWidget(root, player);
  grammarWidget.updateContext({ route: readRoute() });
  renderRoute();
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
