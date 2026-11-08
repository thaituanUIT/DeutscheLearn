import { button } from "../components/button";
import { el } from "../utils/dom";

export type ContentListItem = { id: string; title: string; meta: string; level: string[]; topic?: string[]; status?: string; searchText?: string; assignments?: { level: string; topic: string }[] };
type BulkAction = { label: string; run: (ids: string[]) => Promise<void | boolean> };

export function adminContentList(options: {
  title: string;
  noun: string;
  onNew: () => Promise<void>;
  onImport: () => void;
  onSelect: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  selectedId: () => string | undefined;
  errorMessage: (error: unknown) => string;
  bulk: BulkAction[];
  topics?: boolean;
  publication?: boolean;
  collection?: HTMLElement;
}): {
  node: HTMLElement;
  setItems: (items: ContentListItem[]) => void;
  setStatus: (loading: boolean, error?: unknown) => void;
  updateSelection: () => void;
} {
  const node = el("section", "admin-list");
  node.setAttribute("aria-label", options.title);
  let items: ContentListItem[] = [];
  let loading = true;
  let working = false;
  let selecting = false;
  let visibleLimit = 100;
  const selected = new Set<string>();
  const header = el("div", "admin-list-header");
  const actions = el("div", "admin-list-actions");
  const create = button("New", "button primary");
  create.ariaLabel = `New ${options.noun}`;
  const importButton = button("Import", "button");
  importButton.ariaLabel = `Import ${options.title.toLowerCase()}`;
  importButton.onclick = options.onImport;
  actions.append(importButton, create);
  header.append(el("h2", "focus-title", options.title), actions);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "admin-input";
  search.placeholder = `Search ${options.title.toLowerCase()}`;
  search.ariaLabel = search.placeholder;
  const filters = el("div", "admin-list-filters");
  const level = filterSelect("Filter by level", ["A1", "A2", "B1", "B2"], "All levels");
  const topic = filterSelect("Filter by topic", [], "All topics");
  const publication = filterSelect("Filter by publication status", ["draft", "published"], "All statuses");
  filters.append(level);
  if (options.topics) filters.append(topic);
  if (options.publication) filters.append(publication);
  const toolbar = el("div", "admin-list-toolbar");
  const summary = el("p", "prompt admin-list-status");
  summary.setAttribute("role", "status");
  const select = button("Select", "button compact-button");
  select.setAttribute("aria-pressed", "false");
  const refresh = button("Refresh", "button compact-button");
  refresh.onclick = () => void options.onRefresh();
  toolbar.append(summary, refresh, select);
  const feedback = el("div", "admin-list-feedback");
  const bulk = el("div", "admin-bulk-actions");
  const bulkCount = el("p", "prompt");
  const selectAll = button("Select results", "button compact-button");
  const clearSelection = button("Clear selection", "button compact-button");
  const results = el("div", "admin-items");
  results.id = `admin-results-${crypto.randomUUID()}`;
  search.setAttribute("aria-controls", results.id);
  const filtered = (): ContentListItem[] => {
    const term = search.value.trim().toLocaleLowerCase("de");
    return items.filter((item) => (!term || `${item.title} ${item.meta} ${item.searchText ?? ""} ${item.topic?.join(" ") ?? ""}`.toLocaleLowerCase("de").includes(term))
      && (!level.value || item.level.includes(level.value))
      && (!options.topics || !topic.value || item.topic?.includes(topic.value))
      && (!item.assignments || (!level.value && !topic.value) || item.assignments.some((entry) => (!level.value || entry.level === level.value) && (!topic.value || entry.topic === topic.value)))
      && (!options.publication || !publication.value || item.status === publication.value));
  };
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (working || loading) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    working = true;
    feedback.replaceChildren();
    updateDisabled();
    try { await action(); }
    catch (error) {
      const completed = error && typeof error === "object" && "completedIds" in error ? error.completedIds : [];
      if (Array.isArray(completed)) completed.forEach((id) => selected.delete(String(id)));
      const message = el("p", "error", options.errorMessage(error));
      message.setAttribute("role", "alert");
      const retry = button("Try again", "button compact-button");
      retry.onclick = () => void run(action);
      feedback.replaceChildren(message, retry);
      message.tabIndex = -1;
      message.focus({ preventScroll: true });
    } finally {
      working = false; renderResults();
      if (document.activeElement === document.body && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }
  };
  create.onclick = () => void run(options.onNew);
  const bulkButtons = options.bulk.map((action) => {
    const control = button(action.label, "button compact-button");
    control.onclick = () => void run(async () => {
      if (await action.run([...selected]) !== false) selected.clear();
    });
    return control;
  });
  bulk.append(bulkCount, selectAll, clearSelection, ...bulkButtons);
  const updateDisabled = (): void => {
    node.setAttribute("aria-busy", String(working || loading));
    if (working) summary.textContent = "Working…";
    for (const control of [create, importButton, refresh, select, selectAll, clearSelection, ...bulkButtons]) control.disabled = working || loading;
    bulkButtons.forEach((control) => { control.disabled ||= selected.size === 0; });
    results.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((control) => { control.disabled = working || loading; });
  };
  const renderResults = (): void => {
    const matches = filtered();
    const scrollTop = results.scrollTop;
    results.replaceChildren();
    bulk.hidden = !selecting;
    bulkCount.textContent = `${selected.size} selected`;
    selectAll.textContent = matches.length > 0 && matches.every((item) => selected.has(item.id)) ? "Deselect results" : "Select results";
    summary.textContent = loading ? (items.length ? "Refreshing…" : `Loading ${options.title.toLowerCase()}…`) : `${matches.length} of ${items.length}`;
    if (!loading && matches.length === 0) results.append(el("p", "prompt", items.length ? "No matches. Clear search or change the filters." : `No ${options.title.toLowerCase()} yet. Create or import your first ${options.noun}.`));
    for (const item of matches.slice(0, visibleLimit)) {
      const row = el("div", "admin-list-row");
      if (selecting) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(item.id);
        checkbox.ariaLabel = `Select ${item.title}`;
        checkbox.onchange = () => {
          checkbox.checked ? selected.add(item.id) : selected.delete(item.id);
          bulkCount.textContent = `${selected.size} selected`;
          updateDisabled();
        };
        row.append(checkbox);
      }
      const itemButton = button("", "list-card");
      itemButton.dataset.selected = String(item.id === options.selectedId());
      if (item.id === options.selectedId()) itemButton.setAttribute("aria-current", "true");
      itemButton.append(el("span", "list-card-title", item.title || "Untitled passage"), el("span", "list-card-meta", item.meta));
      itemButton.onclick = () => void run(() => options.onSelect(item.id));
      row.append(itemButton);
      results.append(row);
    }
    if (matches.length > visibleLimit) {
      const more = button(`Show next ${Math.min(100, matches.length - visibleLimit)}`, "button");
      more.onclick = () => { visibleLimit += 100; renderResults(); };
      results.append(more);
    }
    results.scrollTop = scrollTop;
    updateDisabled();
  };
  const filterChanged = (): void => { selected.clear(); visibleLimit = 100; renderResults(); results.scrollTop = 0; };
  search.oninput = filterChanged;
  [level, topic, publication].forEach((control) => { control.onchange = filterChanged; });
  select.onclick = () => { selecting = !selecting; selected.clear(); select.textContent = selecting ? "Done" : "Select"; select.setAttribute("aria-pressed", String(selecting)); renderResults(); };
  selectAll.onclick = () => { const matches = filtered(); const all = matches.every((item) => selected.has(item.id)); matches.forEach((item) => all ? selected.delete(item.id) : selected.add(item.id)); renderResults(); };
  clearSelection.onclick = () => { selected.clear(); renderResults(); };
  node.append(header);
  if (options.collection) node.append(options.collection);
  node.append(search, filters, toolbar, feedback, bulk, results);
  renderResults();
  return {
    node,
    setItems: (next): void => {
      items = next;
      const validIds = new Set(items.map((item) => item.id));
      [...selected].filter((id) => !validIds.has(id)).forEach((id) => selected.delete(id));
      if (options.topics) {
        const value = topic.value;
        const values = [...new Set(items.flatMap((item) => item.topic ?? []))].sort();
        topic.replaceChildren(...filterSelect("", values, "All topics").options);
        topic.value = values.includes(value) ? value : "";
      }
      renderResults();
    },
    setStatus: (pending, error): void => {
      loading = pending;
      feedback.replaceChildren();
      if (error) {
        const message = el("p", "error", options.errorMessage(error));
        message.setAttribute("role", "alert");
        const retry = button("Try again", "button compact-button");
        retry.onclick = () => void options.onRefresh();
        feedback.append(message, retry);
      }
      renderResults();
    },
    updateSelection: renderResults,
  };
}

function filterSelect(label: string, values: string[], placeholder: string): HTMLSelectElement {
  const control = document.createElement("select");
  control.className = "admin-input";
  control.ariaLabel = label;
  for (const value of ["", ...values]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value ? value[0].toUpperCase() + value.slice(1).replace(/_/g, " ") : placeholder;
    control.append(option);
  }
  return control;
}
