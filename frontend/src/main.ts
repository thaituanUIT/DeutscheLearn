import "./styles.css";
import { renderApp } from "./views/appView";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

renderApp(root);
