import { button } from "../components/button";
import { el } from "../utils/dom";

export type DraftState<T> = { selected: T; draft?: T; isNew: boolean; notice?: string };
type EditorController = {
  dirty: boolean;
  busy: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  lastFocus?: HTMLElement;
};
const editors = new Map<HTMLElement, EditorController>();
const disabledControls = new WeakMap<HTMLElement, Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement, boolean>>();
const DRAFT_PREFIX = "recognition_admin_draft:";

export function readDraft<T>(key: string, fallback: DraftState<T>): DraftState<T> {
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + key) ?? "null");
    if (value?.selected && value?.draft && typeof value.isNew === "boolean") return value;
  } catch { /* An unavailable or outdated browser draft must not block the editor. */ }
  return fallback;
}

export function storeDraft<T>(key: string, state: DraftState<T>): void {
  try { sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(state)); } catch { /* In-memory drafts remain available. */ }
}

export function removeDraft(key: string): void {
  try { sessionStorage.removeItem(DRAFT_PREFIX + key); } catch { /* Storage may be disabled. */ }
}

export function clearAdminDrafts(): void {
  try {
    Object.keys(sessionStorage).filter((key) => key.startsWith(DRAFT_PREFIX)).forEach((key) => sessionStorage.removeItem(key));
  } catch { /* Storage may be disabled. */ }
}

export function adminDialog(title: string, description?: string): {
  dialog: HTMLDialogElement;
  content: HTMLElement;
  actions: HTMLElement;
  close: () => void;
} {
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "admin-modal";
  const heading = el("h2", "focus-title", title);
  heading.id = `admin-dialog-${crypto.randomUUID()}`;
  dialog.setAttribute("aria-labelledby", heading.id);
  const content = el("div", "admin-dialog-content");
  const actions = el("div", "admin-action-buttons");
  dialog.append(heading);
  if (description) {
    const text = el("p", "prompt", description);
    text.id = `${heading.id}-description`;
    dialog.setAttribute("aria-describedby", text.id);
    dialog.append(text);
  }
  dialog.append(content, actions);
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter((node) => node.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, content, actions, close: () => dialog.close() };
}

export function confirmAdminAction(title: string, description: string, actionLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { dialog, actions, close } = adminDialog(title, description);
    const cancel = button("Cancel", "button");
    const confirm = button(actionLabel, "button primary");
    let confirmed = false;
    cancel.onclick = close;
    confirm.onclick = () => { confirmed = true; close(); };
    dialog.addEventListener("close", () => resolve(confirmed), { once: true });
    actions.append(cancel, confirm);
    cancel.focus();
  });
}

export function registerEditor(
  host: HTMLElement,
  form: HTMLElement,
  options: { dirty: boolean; save: () => Promise<boolean>; capture: () => void; discard: () => void; changed: () => void },
): void {
  const controller: EditorController = { dirty: options.dirty, busy: false, save: options.save, discard: options.discard };
  editors.set(host, controller);
  const changed = (): void => {
    controller.dirty = true;
    options.capture();
    options.changed();
  };
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  form.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) controller.lastFocus = event.target;
  });
}

export function editorChanged(node: HTMLElement): void {
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

export function editorIsBusy(host: HTMLElement): boolean {
  return editors.get(host)?.busy ?? false;
}

export function setEditorBusy(host: HTMLElement, busy: boolean): void {
  const controller = editors.get(host);
  if (controller) controller.busy = busy;
  host.setAttribute("aria-busy", String(busy));
  if (busy) {
    const controls = new Map<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement, boolean>();
    host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input, button, select, textarea").forEach((control) => {
      controls.set(control, control.disabled);
      control.disabled = true;
    });
    disabledControls.set(host, controls);
  } else {
    disabledControls.get(host)?.forEach((disabled, control) => { control.disabled = disabled; });
    disabledControls.delete(host);
  }
}

export function editorSaved(host: HTMLElement): void {
  const controller = editors.get(host);
  if (controller) controller.dirty = false;
}

export async function leaveEditor(host: HTMLElement): Promise<boolean> {
  const controller = editors.get(host);
  if (!controller) return true;
  if (controller.busy) return false;
  if (!controller.dirty) return true;
  const choice = await new Promise<"save" | "discard" | "stay">((resolve) => {
    const { dialog, actions, close } = adminDialog("Save your changes?", "This editor has unsaved changes. Save them, discard them, or keep editing.");
    let value: "save" | "discard" | "stay" = "stay";
    for (const [label, result, className] of [["Keep editing", "stay", "button"], ["Discard changes", "discard", "button"], ["Save changes", "save", "button primary"]] as const) {
      const action = button(label, className);
      action.onclick = () => { value = result; close(); };
      actions.append(action);
    }
    dialog.addEventListener("close", () => resolve(value), { once: true });
    actions.querySelector<HTMLButtonElement>("button")?.focus();
  });
  if (choice === "stay") {
    if (controller.lastFocus?.isConnected) controller.lastFocus.focus({ preventScroll: true });
    return false;
  }
  if (choice === "save") return controller.save();
  controller.discard();
  controller.dirty = false;
  return true;
}

export async function leaveAllEditors(): Promise<boolean> {
  for (const [host] of editors) {
    if (host.isConnected && !await leaveEditor(host)) return false;
  }
  return true;
}

export function protectAdminDrafts(): void {
  window.addEventListener("beforeunload", (event) => {
    if (document.querySelector('.admin-modal[aria-busy="true"]') || [...editors].some(([host, editor]) => host.isConnected && (editor.dirty || editor.busy))) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
