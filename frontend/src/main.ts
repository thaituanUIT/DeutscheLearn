import "./styles/index.css";
import { initializeThemeController } from "./state/themeStore";
import { el } from "./utils/dom";
import { renderApp } from "./views/appView";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

initializeThemeController();

if (window.location.pathname === "/admin") {
  root.replaceChildren(el("div", "shell", "Loading admin panel…"));
  void import("./views/adminView")
    .then(({ renderAdminApp }) => renderAdminApp(root))
    .catch(() => {
      const errorShell = el("div", "shell");
      const message = el("div", "error", "Could not load the admin panel. Refresh the page and try again.");
      message.setAttribute("role", "alert");
      errorShell.append(message);
      root.replaceChildren(errorShell);
    });
} else {
  renderApp(root);
}
