import { getDictationTranscript } from "../api/client";
import type { DictationTranscript } from "../api/types";
import { button } from "../components/button";
import { clear, el } from "../utils/dom";

type DictationOptions = { onBack: () => void };

export function dictationView(options: DictationOptions): HTMLElement {
  const section = el("section", "dictation-view");
  const intro = el("div", "dictation-intro");
  intro.append(
    el("p", "eyebrow", "HÖREN & SCHREIBEN"),
    el("h2", "", "German dictation"),
    el("p", "muted", "Paste a YouTube link with German captions. Listen to each line, type what you hear, then check your transcription."),
  );

  const form = el("form", "dictation-source");
  const label = el("label", "form-label", "YouTube video link");
  const input = el("input", "form-input") as HTMLInputElement;
  input.type = "url";
  input.placeholder = "https://www.youtube.com/watch?v=…";
  input.required = true;
  const loadButton = button("Load German captions", "button button-primary");
  loadButton.type = "submit";
  label.append(input);
  form.append(label, loadButton);
  const status = el("p", "dictation-status muted", "Captions are checked when you submit the link.");
  const exercise = el("div", "dictation-exercise");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const videoUrl = input.value.trim();
    if (!videoUrl) return;
    loadButton.disabled = true;
    status.className = "dictation-status muted";
    status.textContent = "Checking for German captions…";
    clear(exercise);
    void getDictationTranscript(videoUrl)
      .then((transcript) => {
        status.textContent = `${transcript.segments.length} lines loaded${transcript.is_generated ? " · automatic captions" : " · creator captions"}.`;
        renderExercise(exercise, transcript);
      })
      .catch((error: unknown) => {
        status.className = "dictation-status error";
        status.textContent = readableError(error);
      })
      .finally(() => {
        loadButton.disabled = false;
      });
  });

  const back = button("← Back to modes", "button button-quiet");
  back.addEventListener("click", options.onBack);
  section.append(back, intro, form, status, exercise);
  return section;
}

function renderExercise(host: HTMLElement, transcript: DictationTranscript): void {
  const exercise = el("div", "dictation-workspace");
  const player = el("div", "dictation-player");
  const iframe = el("iframe", "") as HTMLIFrameElement;
  iframe.title = "YouTube dictation video";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(transcript.video_id)}?playsinline=1&rel=0`;
  player.append(iframe);

  const practice = el("div", "dictation-practice");
  const progress = el("p", "eyebrow", `LINE 1 OF ${transcript.segments.length}`);
  const answer = el("textarea", "dictation-answer") as HTMLTextAreaElement;
  answer.rows = 4;
  answer.placeholder = "Type what you hear…";
  answer.setAttribute("aria-label", "Type the German line you hear");
  const feedback = el("div", "dictation-feedback");
  const play = button("▶ Replay line", "button button-secondary");
  const check = button("Check answer", "button button-primary");
  const reveal = button("Reveal transcript", "button button-quiet");
  let index = 0;

  const showLine = (): void => {
    const segment = transcript.segments[index];
    progress.textContent = `LINE ${index + 1} OF ${transcript.segments.length}`;
    answer.value = "";
    clear(feedback);
    reveal.textContent = "Reveal transcript";
    reveal.dataset.open = "false";
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(transcript.video_id)}?playsinline=1&rel=0&start=${Math.floor(segment.start)}&end=${Math.ceil(segment.start + segment.duration)}`;
  };

  play.addEventListener("click", () => {
    const segment = transcript.segments[index];
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(transcript.video_id)}?autoplay=1&playsinline=1&rel=0&start=${Math.floor(segment.start)}&end=${Math.ceil(segment.start + segment.duration)}`;
  });
  check.addEventListener("click", () => {
    if (!answer.value.trim()) {
      answer.focus();
      return;
    }
    renderDiff(feedback, answer.value, transcript.segments[index].text);
  });
  reveal.addEventListener("click", () => {
    const open = reveal.dataset.open !== "true";
    reveal.dataset.open = String(open);
    reveal.textContent = open ? "Hide transcript" : "Reveal transcript";
    if (open) feedback.replaceChildren(el("p", "dictation-gold", transcript.segments[index].text));
    else clear(feedback);
  });

  const next = button("Next line →", "button button-secondary");
  next.addEventListener("click", () => {
    index = (index + 1) % transcript.segments.length;
    showLine();
  });
  const controls = el("div", "dictation-controls");
  controls.append(play, check, reveal, next);
  practice.append(progress, answer, controls, feedback);
  exercise.append(player, practice);
  host.replaceChildren(exercise);
  showLine();
}

function renderDiff(host: HTMLElement, typed: string, target: string): void {
  const left = words(typed);
  const right = words(target);
  const rows: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = left[i - 1].normalized === right[j - 1].normalized
        ? rows[i - 1][j - 1]
        : Math.min(rows[i - 1][j - 1] + 1, rows[i - 1][j] + 1, rows[i][j - 1] + 1);
    }
  }
  const matched = Math.max(0, right.length - rows[left.length][right.length]);
  const score = right.length ? Math.round((matched / right.length) * 100) : 0;
  const summary = el("p", "dictation-score", `${score}% word match · spelling and umlauts count`);
  const diff = el("p", "dictation-diff");
  let i = left.length;
  let j = right.length;
  const tokens: Array<{ text: string; kind: string }> = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1].normalized === right[j - 1].normalized) {
      tokens.push({ text: right[j - 1].text, kind: "match" }); i -= 1; j -= 1;
    } else if (j > 0 && (i === 0 || rows[i][j - 1] <= rows[i - 1][j])) {
      tokens.push({ text: right[j - 1].text, kind: "missing" }); j -= 1;
    } else {
      tokens.push({ text: left[i - 1].text, kind: "extra" }); i -= 1;
    }
  }
  for (const token of tokens.reverse()) {
    const node = el("span", `dictation-word is-${token.kind}`, token.text);
    diff.append(node, document.createTextNode(" "));
  }
  host.replaceChildren(summary, diff);
}

function words(text: string): Array<{ text: string; normalized: string }> {
  return text.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)?.map((value) => ({
    text: value,
    normalized: value.toLocaleLowerCase("de-DE"),
  })) ?? [];
}

function readableError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not load captions. Try another YouTube link.";
  try {
    const detail = JSON.parse(error.message) as { detail?: string };
    return detail.detail ?? "Could not load captions. Try another YouTube link.";
  } catch {
    return error.message || "Could not load captions. Try another YouTube link.";
  }
}
