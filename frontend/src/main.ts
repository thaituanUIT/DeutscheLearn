import "./styles.css";
import { renderAdminApp } from "./views/adminView";
import { renderApp } from "./views/appView";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

if (window.location.pathname === "/admin") {
  renderAdminApp(root);
} else {
  renderApp(root);
}
