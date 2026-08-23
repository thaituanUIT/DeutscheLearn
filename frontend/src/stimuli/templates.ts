import type { StimulusContent, StimulusRenderKind } from "../api/types";
import { button } from "../components/button";
import { el } from "../utils/dom";
import { prepareStimulusImage, uploadPreparedStimulusImage } from "./uploads";

export type StimulusViewModel = {
  id?: string;
  title: string;
  body: string;
  context_label: string | null;
  render_kind: StimulusRenderKind;
  content: StimulusContent | null;
  image_url: string | null;
  image_path?: string | null;
  transcript?: string | null;
};

type FieldSchema =
  | { kind: "string"; key: string; label: string; optional?: boolean; multiline?: boolean }
  | { kind: "enum"; key: string; label: string; options: string[] }
  | { kind: "stringList"; key: string; label: string; min?: number; max?: number }
  | { kind: "objectList"; key: string; label: string; fields: Array<{ key: string; label: string; optional?: boolean }>; min?: number };

export type StimulusTemplate = {
  id: Exclude<StimulusRenderKind, "text" | "image">;
  label: string;
  teil: number[];
  schema: FieldSchema[];
  createDefaultContent: () => StimulusContent;
  deriveText: (content: StimulusContent) => { title: string; body: string };
  renderSurface: (content: StimulusContent) => HTMLElement;
};

export type StimulusEditor = {
  node: HTMLElement;
  renderKind: HTMLSelectElement;
  imagePath: HTMLInputElement;
  transcript: HTMLTextAreaElement;
  getValue: () => {
    render_kind: StimulusRenderKind;
    content: StimulusContent | null;
    image_path: string | null;
    transcript: string | null;
    title: string;
    body: string;
  };
  renderPreview: (host: HTMLElement, contextLabel: string | null) => void;
};

export type StimulusUploadHandler = (stimulusId: string, file: File) => Promise<{
  path: string;
  upload_url: string;
  token: string;
  bucket: "stimuli";
}>;

export const stimulusTemplates: StimulusTemplate[] = [
  {
    id: "ad_box",
    label: "Classified advert",
    teil: [2],
    schema: [
      { kind: "string", key: "business_name", label: "Business name" },
      { kind: "string", key: "tagline", label: "Tagline", optional: true },
      { kind: "stringList", key: "lines", label: "Selling points", min: 2, max: 4 },
      { kind: "string", key: "hours", label: "Hours", optional: true },
      { kind: "string", key: "address", label: "Address", optional: true },
      { kind: "string", key: "phone", label: "Phone", optional: true },
      { kind: "string", key: "price", label: "Price", optional: true },
    ],
    createDefaultContent: () => ({
      business_name: "",
      tagline: "",
      lines: ["", ""],
      hours: "",
      address: "",
      phone: "",
      price: "",
    }),
    deriveText: (content) => ({
      title: stringValue(content.business_name) || "Classified advert",
      body: [
        stringValue(content.tagline),
        ...stringList(content.lines),
        stringValue(content.hours),
        stringValue(content.address),
        stringValue(content.phone),
        stringValue(content.price),
      ].filter(Boolean).join("\n"),
    }),
    renderSurface: renderAdBox,
  },
  {
    id: "hours_table",
    label: "Opening hours",
    teil: [3],
    schema: [
      { kind: "string", key: "place_name", label: "Place name" },
      { kind: "objectList", key: "rows", label: "Rows", min: 2, fields: [
        { key: "label", label: "Label" },
        { key: "value", label: "Value" },
      ] },
      { kind: "string", key: "note", label: "Note", optional: true },
    ],
    createDefaultContent: () => ({
      place_name: "",
      rows: [{ label: "Mo-Fr", value: "8:00-18:00" }, { label: "Sa", value: "9:00-13:00" }],
      note: "",
    }),
    deriveText: (content) => ({
      title: stringValue(content.place_name) || "Opening hours",
      body: [...rowsText(content.rows, ["label", "value"]), stringValue(content.note)].filter(Boolean).join("\n"),
    }),
    renderSurface: renderHoursTable,
  },
  {
    id: "notice_sheet",
    label: "Printed notice",
    teil: [3],
    schema: [
      { kind: "string", key: "heading", label: "Heading" },
      { kind: "stringList", key: "body_lines", label: "Body lines", min: 1 },
      { kind: "string", key: "signature", label: "Signature", optional: true },
      { kind: "string", key: "date", label: "Date", optional: true },
    ],
    createDefaultContent: () => ({ heading: "", body_lines: [""], signature: "", date: "" }),
    deriveText: (content) => ({
      title: stringValue(content.heading) || "Notice",
      body: [...stringList(content.body_lines), stringValue(content.signature), stringValue(content.date)]
        .filter(Boolean).join("\n"),
    }),
    renderSurface: renderNoticeSheet,
  },
  {
    id: "door_sign",
    label: "Door sign",
    teil: [3],
    schema: [
      { kind: "string", key: "message", label: "Message" },
      { kind: "string", key: "sub_message", label: "Sub message", optional: true },
    ],
    createDefaultContent: () => ({ message: "", sub_message: "" }),
    deriveText: (content) => ({
      title: stringValue(content.message) || "Door sign",
      body: [stringValue(content.message), stringValue(content.sub_message)].filter(Boolean).join("\n"),
    }),
    renderSurface: renderDoorSign,
  },
  {
    id: "timetable",
    label: "Timetable",
    teil: [3],
    schema: [
      { kind: "string", key: "route_name", label: "Route name" },
      { kind: "string", key: "direction", label: "Direction", optional: true },
      { kind: "objectList", key: "rows", label: "Rows", min: 2, fields: [
        { key: "time", label: "Time" },
        { key: "note", label: "Note", optional: true },
      ] },
      { kind: "string", key: "footnote", label: "Footnote", optional: true },
    ],
    createDefaultContent: () => ({
      route_name: "",
      direction: "",
      rows: [{ time: "8:15", note: "" }, { time: "8:45", note: "" }],
      footnote: "",
    }),
    deriveText: (content) => ({
      title: stringValue(content.route_name) || "Timetable",
      body: [stringValue(content.direction), ...rowsText(content.rows, ["time", "note"]), stringValue(content.footnote)]
        .filter(Boolean).join("\n"),
    }),
    renderSurface: renderTimetable,
  },
  {
    id: "pictogram_sign",
    label: "Pictogram sign",
    teil: [3],
    schema: [
      {
        kind: "enum",
        key: "icon",
        label: "Icon",
        options: ["dog", "smoking", "bicycle", "camera", "food", "phone", "parking", "swimming", "warning", "arrow"],
      },
      { kind: "string", key: "message", label: "Message" },
      { kind: "string", key: "sub_message", label: "Sub message", optional: true },
    ],
    createDefaultContent: () => ({ icon: "warning", message: "", sub_message: "" }),
    deriveText: (content) => ({
      title: stringValue(content.message) || "Pictogram sign",
      body: [stringValue(content.message), stringValue(content.sub_message)].filter(Boolean).join("\n"),
    }),
    renderSurface: renderPictogramSign,
  },
];

export function templateForKind(kind: StimulusRenderKind): StimulusTemplate | undefined {
  return stimulusTemplates.find((template) => template.id === kind);
}

export function templatesForTeil(part: string | null): StimulusTemplate[] {
  const teil = Number((part ?? "").replace("teil_", ""));
  return stimulusTemplates.filter((template) => template.teil.includes(teil));
}

export function createStimulusEditor(
  stimulus: StimulusViewModel,
  part: string | null,
  onInput: () => void,
  uploadHandler?: StimulusUploadHandler,
): StimulusEditor {
  let activeKind: StimulusRenderKind = normalizeKind(stimulus.render_kind, part);
  let activeContent = templateForKind(activeKind)?.createDefaultContent() ?? {};
  if (stimulus.content && templateForKind(activeKind)) activeContent = structuredClone(stimulus.content);

  const node = el("div", "stimulus-template-editor");
  const renderKind = document.createElement("select");
  renderKind.className = "admin-input";
  renderKind.dataset.label = "Stimulus template";
  const imagePath = document.createElement("input");
  imagePath.type = "text";
  imagePath.className = "admin-input";
  imagePath.dataset.label = "Uploaded image path";
  imagePath.placeholder = "Uploaded image path";
  imagePath.value = stimulus.image_path ?? "";
  const transcript = document.createElement("textarea");
  transcript.className = "admin-input admin-textarea";
  transcript.dataset.label = "Transcript";
  transcript.rows = 4;
  transcript.value = stimulus.transcript ?? "";

  const fields = el("div", "stimulus-template-fields");
  const warning = el("p", "stimulus-warning");

  const render = (): void => {
    const templates = templatesForTeil(part);
    renderKind.replaceChildren(
      ...templates.map((template) => {
        const option = document.createElement("option");
        option.value = template.id;
        option.textContent = template.label;
        option.selected = template.id === activeKind;
        return option;
      }),
      imageOption(activeKind === "image"),
    );
    renderKind.value = activeKind;
    const template = templateForKind(activeKind);
    fields.replaceChildren();
    if (template) {
      fields.append(...template.schema.map((field) => controlForField(field, activeContent, updateWarningAndNotify)));
    } else {
      fields.append(
        imageDropZone(stimulus.id, imagePath, uploadHandler, updateWarningAndNotify),
        fieldWrap(transcript, "Transcript"),
      );
    }
    updateWarning();
  };

  const updateWarning = (): void => {
    const longFields = collectStrings(activeKind === "image" ? { transcript: transcript.value } : activeContent)
      .filter((value) => value.length > 60);
    warning.textContent = longFields.length ? "Some fields are long for A1. Keep them only if the item needs it." : "";
  };
  const updateWarningAndNotify = (): void => {
    updateWarning();
    onInput();
  };

  renderKind.addEventListener("change", () => {
    activeKind = renderKind.value as StimulusRenderKind;
    const template = templateForKind(activeKind);
    activeContent = template?.createDefaultContent() ?? {};
    render();
    onInput();
  });
  imagePath.addEventListener("input", updateWarningAndNotify);
  transcript.addEventListener("input", updateWarningAndNotify);
  node.append(fieldWrap(renderKind, "Stimulus template"), fields, warning);
  render();

  return {
    node,
    renderKind,
    imagePath,
    transcript,
    getValue: () => {
      if (activeKind === "image") {
        return {
          render_kind: "image",
          content: null,
          image_path: imagePath.value.trim() || null,
          transcript: transcript.value.trim() || null,
          title: "Image stimulus",
          body: transcript.value.trim() || "Image stimulus",
        };
      }
      const template = templateForKind(activeKind);
      if (!template) {
        return { render_kind: "text", content: null, image_path: null, transcript: null, title: stimulus.title, body: stimulus.body };
      }
      const text = template.deriveText(activeContent);
      return {
        render_kind: activeKind,
        content: structuredClone(activeContent),
        image_path: null,
        transcript: null,
        title: text.title,
        body: text.body || text.title,
      };
    },
    renderPreview: (host, contextLabel) => {
      const value = activeKind === "image"
        ? { ...stimulus, render_kind: activeKind, image_path: imagePath.value, transcript: transcript.value, image_url: stimulus.image_url }
        : { ...stimulus, ...templateForKind(activeKind)?.deriveText(activeContent), render_kind: activeKind, content: activeContent };
      host.replaceChildren(stimulusRenderer({ ...value, context_label: contextLabel }));
    },
  };
}

export function stimulusRenderer(stimulus: StimulusViewModel): HTMLElement {
  const figure = el("figure", "stimulus-figure");
  figure.lang = "de";
  if (stimulus.context_label) figure.append(el("figcaption", "stimulus-caption", stimulus.context_label));

  if (stimulus.render_kind === "image") {
    const image = document.createElement("img");
    image.className = "stimulus-image";
    image.src = stimulus.image_url || stimulus.image_path || "";
    image.alt = stimulus.transcript || stimulus.title;
    figure.append(image);
    return figure;
  }

  const template = templateForKind(stimulus.render_kind);
  if (template && stimulus.content) {
    figure.append(template.renderSurface(stimulus.content));
    return figure;
  }

  const fallback = el("div", "stimulus-surface stimulus-legacy");
  fallback.append(el("strong", "", stimulus.title), el("p", "", stimulus.body));
  figure.append(fallback);
  return figure;
}

function controlForField(field: FieldSchema, content: StimulusContent, onInput: () => void): HTMLElement {
  if (field.kind === "string") {
    const control = field.multiline ? document.createElement("textarea") : document.createElement("input");
    control.className = field.multiline ? "admin-input admin-textarea" : "admin-input";
    control.dataset.label = field.label;
    control.value = stringValue(content[field.key]);
    control.addEventListener("input", () => {
      content[field.key] = control.value;
      onInput();
    });
    return fieldWrap(control, field.label);
  }
  if (field.kind === "enum") {
    const select = document.createElement("select");
    select.className = "admin-input";
    select.dataset.label = field.label;
    for (const value of field.options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = stringValue(content[field.key]) === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      content[field.key] = select.value;
      onInput();
    });
    return fieldWrap(select, field.label);
  }
  if (field.kind === "stringList") {
    return stringRepeater(field, content, onInput);
  }
  return objectRepeater(field, content, onInput);
}

function stringRepeater(field: Extract<FieldSchema, { kind: "stringList" }>, content: StimulusContent, onInput: () => void): HTMLElement {
  const wrap = el("div", "admin-field stimulus-repeater");
  wrap.append(el("span", "", field.label));
  const list = el("div", "stimulus-repeater-list");
  const render = (): void => {
    const values = stringList(content[field.key]);
    if (values.length === 0) values.push("");
    list.replaceChildren(...values.map((value, index) => {
      const row = el("div", "stimulus-repeater-row");
      const input = document.createElement("input");
      input.className = "admin-input";
      input.value = value;
      input.addEventListener("input", () => {
        values[index] = input.value;
        content[field.key] = values;
        onInput();
      });
      const up = button("↑", "admin-text-button");
      const down = button("↓", "admin-text-button");
      const remove = button("Remove", "admin-text-button danger-text-button");
      up.disabled = index === 0;
      down.disabled = index === values.length - 1;
      remove.disabled = values.length <= (field.min ?? 1);
      up.addEventListener("click", () => move(values, index, index - 1, field.key, content, render, onInput));
      down.addEventListener("click", () => move(values, index, index + 1, field.key, content, render, onInput));
      remove.addEventListener("click", () => {
        values.splice(index, 1);
        content[field.key] = values;
        render();
        onInput();
      });
      row.append(input, up, down, remove);
      return row;
    }));
  };
  const add = button("+ Add", "button compact-button");
  add.addEventListener("click", () => {
    const values = stringList(content[field.key]);
    if (field.max && values.length >= field.max) return;
    values.push("");
    content[field.key] = values;
    render();
    onInput();
  });
  wrap.append(list, add);
  render();
  return wrap;
}

function objectRepeater(field: Extract<FieldSchema, { kind: "objectList" }>, content: StimulusContent, onInput: () => void): HTMLElement {
  const wrap = el("div", "admin-field stimulus-repeater");
  wrap.append(el("span", "", field.label));
  const list = el("div", "stimulus-repeater-list");
  const render = (): void => {
    const rows = objectList(content[field.key], field.fields);
    list.replaceChildren(...rows.map((rowValue, index) => {
      const row = el("div", "stimulus-object-row");
      for (const child of field.fields) {
        const input = document.createElement("input");
        input.className = "admin-input";
        input.placeholder = child.label;
        input.value = stringValue(rowValue[child.key]);
        input.addEventListener("input", () => {
          rowValue[child.key] = input.value;
          content[field.key] = rows;
          onInput();
        });
        row.append(input);
      }
      const controls = el("div", "stimulus-row-controls");
      const up = button("↑", "admin-text-button");
      const down = button("↓", "admin-text-button");
      const remove = button("Remove", "admin-text-button danger-text-button");
      up.disabled = index === 0;
      down.disabled = index === rows.length - 1;
      remove.disabled = rows.length <= (field.min ?? 1);
      up.addEventListener("click", () => move(rows, index, index - 1, field.key, content, render, onInput));
      down.addEventListener("click", () => move(rows, index, index + 1, field.key, content, render, onInput));
      remove.addEventListener("click", () => {
        rows.splice(index, 1);
        content[field.key] = rows;
        render();
        onInput();
      });
      controls.append(up, down, remove);
      row.append(controls);
      return row;
    }));
  };
  const add = button("+ Add row", "button compact-button");
  add.addEventListener("click", () => {
    const rows = objectList(content[field.key], field.fields);
    rows.push(Object.fromEntries(field.fields.map((child) => [child.key, ""])));
    content[field.key] = rows;
    render();
    onInput();
  });
  wrap.append(list, add);
  render();
  return wrap;
}

function renderAdBox(content: StimulusContent): HTMLElement {
  const surface = el("div", "stimulus-surface stimulus-ad-box");
  surface.append(el("strong", "stimulus-ad-name", stringValue(content.business_name) || "Name"));
  if (stringValue(content.tagline)) surface.append(el("p", "stimulus-ad-tagline", stringValue(content.tagline)));
  surface.append(detailList(stringList(content.lines)));
  const meta = [content.hours, content.address, content.phone, content.price].map(stringValue).filter(Boolean);
  if (meta.length) surface.append(el("p", "stimulus-meta", meta.join(" · ")));
  return surface;
}

function renderHoursTable(content: StimulusContent): HTMLElement {
  const surface = el("div", "stimulus-surface stimulus-hours-table");
  surface.append(el("strong", "stimulus-board-title", stringValue(content.place_name) || "Öffnungszeiten"));
  const table = document.createElement("table");
  for (const row of objectList(content.rows, [{ key: "label" }, { key: "value" }])) {
    const tr = document.createElement("tr");
    tr.append(el("td", "", stringValue(row.label)), el("td", "", stringValue(row.value)));
    table.append(tr);
  }
  surface.append(table);
  if (stringValue(content.note)) surface.append(el("p", "stimulus-note", stringValue(content.note)));
  return surface;
}

function renderNoticeSheet(content: StimulusContent): HTMLElement {
  const surface = el("div", "stimulus-surface stimulus-notice-sheet");
  surface.append(el("strong", "stimulus-notice-heading", stringValue(content.heading) || "Hinweis"));
  for (const line of stringList(content.body_lines)) surface.append(el("p", "", line));
  if (stringValue(content.signature)) surface.append(el("p", "stimulus-signature", stringValue(content.signature)));
  if (stringValue(content.date)) surface.append(el("p", "stimulus-date", stringValue(content.date)));
  return surface;
}

function renderDoorSign(content: StimulusContent): HTMLElement {
  const surface = el("div", "stimulus-surface stimulus-door-sign");
  surface.append(el("strong", "", stringValue(content.message) || "Heute geschlossen"));
  if (stringValue(content.sub_message)) surface.append(el("span", "", stringValue(content.sub_message)));
  return surface;
}

function renderTimetable(content: StimulusContent): HTMLElement {
  const surface = el("div", "stimulus-surface stimulus-timetable");
  surface.append(el("strong", "stimulus-board-title", stringValue(content.route_name) || "Abfahrt"));
  if (stringValue(content.direction)) surface.append(el("p", "stimulus-note", stringValue(content.direction)));
  for (const row of objectList(content.rows, [{ key: "time" }, { key: "note" }])) {
    const line = el("div", "stimulus-timetable-row");
    line.append(el("span", "", stringValue(row.time)), el("span", "", stringValue(row.note)));
    surface.append(line);
  }
  if (stringValue(content.footnote)) surface.append(el("p", "stimulus-note", stringValue(content.footnote)));
  return surface;
}

function renderPictogramSign(content: StimulusContent): HTMLElement {
  const surface = el("div", "stimulus-surface stimulus-pictogram-sign");
  surface.append(pictogram(stringValue(content.icon)), el("strong", "", stringValue(content.message) || "Hinweis"));
  if (stringValue(content.sub_message)) surface.append(el("span", "", stringValue(content.sub_message)));
  return surface;
}

function imageDropZone(
  stimulusId: string | undefined,
  imagePath: HTMLInputElement,
  uploadHandler: StimulusUploadHandler | undefined,
  onInput: () => void,
): HTMLElement {
  const wrap = el("div", "stimulus-upload-zone");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp";
  const status = el("p", "stimulus-upload-status");
  const preview = document.createElement("img");
  preview.className = "stimulus-upload-thumbnail";
  preview.alt = "";
  status.textContent = imagePath.value ? `Uploaded path: ${imagePath.value}` : "";
  const processFile = async (selected: File): Promise<void> => {
    if (!uploadHandler) {
      status.textContent = "Upload is not configured in this editor.";
      return;
    }
    try {
      status.textContent = "Processing image...";
      const prepared = await prepareStimulusImage(selected);
      status.textContent = "Uploading 0%...";
      const target = await uploadHandler(stimulusId ?? crypto.randomUUID(), prepared.file);
      await uploadPreparedStimulusImage(target, prepared.file, (percent) => {
        status.textContent = `Uploading ${percent}%...`;
      });
      imagePath.value = target.path;
      preview.src = URL.createObjectURL(prepared.file);
      status.textContent = `Uploaded ${Math.round(prepared.file.size / 1024)} KB, ${prepared.width} x ${prepared.height}.`;
      onInput();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Upload failed.";
    }
  };
  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (selected) void processFile(selected);
  });
  wrap.addEventListener("paste", (event) => {
    const selected = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
    if (!selected) return;
    event.preventDefault();
    void processFile(selected);
  });
  wrap.addEventListener("dragover", (event) => {
    event.preventDefault();
    wrap.classList.add("drag-over");
  });
  wrap.addEventListener("dragleave", () => {
    wrap.classList.remove("drag-over");
  });
  wrap.addEventListener("drop", (event) => {
    event.preventDefault();
    wrap.classList.remove("drag-over");
    const selected = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));
    if (selected) void processFile(selected);
  });
  const remove = button("Remove", "admin-text-button danger-text-button");
  remove.addEventListener("click", () => {
    imagePath.value = "";
    preview.removeAttribute("src");
    status.textContent = "";
    onInput();
  });
  wrap.append(
    el("p", "", "Drop, paste, or choose a JPEG, PNG, or WebP. Images are resized before upload; final limit is 2 MB."),
    file,
    preview,
    status,
    remove,
    fieldWrap(imagePath, "Uploaded image path"),
  );
  return wrap;
}

function detailList(items: string[]): HTMLElement {
  const list = el("ul", "stimulus-detail-list");
  for (const item of items.filter(Boolean)) list.append(el("li", "", item));
  return list;
}

function fieldWrap(control: HTMLElement, label: string): HTMLElement {
  const wrap = el("label", "admin-field");
  wrap.dataset.field = label;
  wrap.append(el("span", "", label), control);
  return wrap;
}

function imageOption(selected: boolean): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = "image";
  option.textContent = "Image fallback";
  option.selected = selected;
  return option;
}

function normalizeKind(kind: StimulusRenderKind, part: string | null): StimulusRenderKind {
  if (kind === "image") return "image";
  if (templateForKind(kind)) return kind;
  return templatesForTeil(part)[0]?.id ?? "image";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue) : [];
}

function objectList(value: unknown, fields: Array<{ key: string }>): Record<string, string>[] {
  if (!Array.isArray(value)) {
    return [Object.fromEntries(fields.map((field) => [field.key, ""]))];
  }
  return value.map((row) => {
    if (!row || typeof row !== "object") return Object.fromEntries(fields.map((field) => [field.key, ""]));
    const source = row as Record<string, unknown>;
    return Object.fromEntries(fields.map((field) => [field.key, stringValue(source[field.key])]));
  });
}

function rowsText(value: unknown, keys: string[]): string[] {
  return objectList(value, keys.map((key) => ({ key }))).map((row) => keys.map((key) => row[key]).filter(Boolean).join(" "));
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function move<T>(
  values: T[],
  from: number,
  to: number,
  key: string,
  content: StimulusContent,
  render: () => void,
  onInput: () => void,
): void {
  const [item] = values.splice(from, 1);
  values.splice(to, 0, item);
  content[key] = values as unknown as StimulusContent[string];
  render();
  onInput();
}

function pictogram(icon: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("stimulus-pictogram");
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", "24");
  text.setAttribute("y", "31");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "18");
  text.setAttribute("font-weight", "800");
  text.textContent = iconGlyph(icon);
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "24");
  circle.setAttribute("cy", "24");
  circle.setAttribute("r", "21");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "3");
  svg.append(circle, text);
  return svg;
}

function iconGlyph(icon: string): string {
  const glyphs: Record<string, string> = {
    dog: "DOG",
    smoking: "NO",
    bicycle: "RAD",
    camera: "CAM",
    food: "ESS",
    phone: "TEL",
    parking: "P",
    swimming: "BAD",
    warning: "!",
    arrow: "->",
  };
  return glyphs[icon] ?? "!";
}
