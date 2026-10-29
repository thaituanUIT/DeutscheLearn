import {
  getDictationTranscript,
  getSavedDictationVideo,
  listDictationVideos,
  reportDictationVideo,
} from "../api/client";
import type { DictationTranscript, DictationVideoSummary } from "../api/types";
import { button } from "../components/button";
import { clear, el } from "../utils/dom";

export function dictationView(): HTMLElement {
  const section = el("section", "dictation-view");
  const intro = el("div", "dictation-intro");
  intro.append(
    el("p", "eyebrow", "HÖREN & SCHREIBEN"),
    el("h2", "", "German dictation"),
    el("p", "muted", "Choose a saved video or add a YouTube link. Captions are saved so the next learner can start without fetching them again."),
  );

  const library = el("section", "dictation-library");
  const libraryHeader = el("div", "dictation-library-header");
  const libraryTitle = el("div", "dictation-library-title");
  libraryTitle.append(
    el("p", "eyebrow", "READY TO PRACTICE"),
    el("h3", "", "Available videos"),
    el("p", "muted", "Saved German transcripts shared with learners."),
  );
  const count = el("span", "dictation-video-count", "Loading…");
  libraryHeader.append(libraryTitle, count);
  const catalog = el("div", "dictation-video-grid");
  const libraryStatus = el("p", "dictation-library-empty muted", "Loading saved videos…");
  library.append(libraryHeader, libraryStatus, catalog);

  const sourceHeading = el("div", "dictation-source-heading");
  sourceHeading.append(
    el("h3", "", "Add a video"),
    el("p", "muted", "New links are checked once, then saved in the shared transcript library."),
  );
  const form = el("form", "dictation-source");
  const label = el("label", "form-label", "YouTube video link");
  const input = el("input", "form-input") as HTMLInputElement;
  input.type = "url";
  input.placeholder = "https://www.youtube.com/watch?v=…";
  input.required = true;
  const loadButton = button("Add video and start", "button button-primary");
  loadButton.type = "submit";
  label.append(input);
  form.append(label, loadButton);
  const status = el("p", "dictation-status muted", "Your transcript will be saved for future practice.");
  const exercise = el("div", "dictation-exercise");

  const updateStatus = (message: string, isError = false): void => {
    status.className = `dictation-status ${isError ? "error" : "muted"}`;
    status.textContent = message;
  };

  const refreshCatalog = async (): Promise<void> => {
    try {
      const videos = await listDictationVideos();
      renderCatalog(catalog, libraryStatus, count, videos, async (videoId) => {
        updateStatus("Loading saved transcript…");
        clear(exercise);
        try {
          const transcript = await getSavedDictationVideo(videoId);
          renderExercise(exercise, transcript);
          exercise.scrollIntoView({ behavior: "smooth", block: "start" });
          updateStatus(`Loaded saved transcript · ${transcript.segments.length} lines · no caption fetch needed.`);
        } catch (error) {
          updateStatus(readableError(error), true);
        }
      });
    } catch (error) {
      count.textContent = "";
      libraryStatus.textContent = readableError(error);
      libraryStatus.className = "dictation-library-empty error";
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const videoUrl = input.value.trim();
    if (!videoUrl) return;
    loadButton.disabled = true;
    updateStatus("Checking the shared library, then fetching captions if this video is new…");
    clear(exercise);
    void getDictationTranscript(videoUrl)
      .then(async (transcript) => {
        renderExercise(exercise, transcript);
        exercise.scrollIntoView({ behavior: "smooth", block: "start" });
        updateStatus(
          transcript.cache_hit
            ? `Loaded saved transcript · ${transcript.segments.length} lines.`
            : `Transcript saved for future learners · ${transcript.segments.length} lines${transcript.is_generated ? " · automatic captions" : " · creator captions"}.`,
        );
        await refreshCatalog();
      })
      .catch((error: unknown) => {
        updateStatus(readableError(error), true);
      })
      .finally(() => {
        loadButton.disabled = false;
      });
  });

  section.append(intro, library, sourceHeading, form, status, exercise);
  void refreshCatalog();
  return section;
}

function renderCatalog(
  catalog: HTMLElement,
  emptyState: HTMLElement,
  count: HTMLElement,
  videos: DictationVideoSummary[],
  onSelect: (videoId: string) => Promise<void>,
): void {
  clear(catalog);
  count.textContent = `${videos.length} saved`;
  if (videos.length === 0) {
    emptyState.className = "dictation-library-empty muted";
    emptyState.textContent = "No videos saved yet. Add a YouTube link below to create the first transcript.";
    return;
  }

  emptyState.textContent = "Select a video to start dictation.";
  emptyState.className = "dictation-library-empty muted";
  for (const video of videos) {
    const cardWrap = el("div", "dictation-video-card-wrap");
    const card = button("", "dictation-video-card");
    const imageWrap = el("span", "dictation-video-image");
    const image = document.createElement("img");
    image.src = video.thumbnail_url ?? `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => imageWrap.classList.add("is-unavailable"), { once: true });
    imageWrap.append(image, el("span", "dictation-play-badge", "▶"));

    const details = el("span", "dictation-video-details");
    const title = el("strong", "dictation-video-name", video.title);
    const author = el("span", "dictation-video-author", video.author_name || "YouTube video");
    const meta = el("span", "dictation-video-meta", `${video.segment_count} lines · ${video.language}`);
    const kind = el("span", "dictation-video-kind", video.is_generated ? "Auto captions" : "Creator captions");
    const action = el("span", "dictation-video-action", "Start dictation →");
    details.append(title, author, meta, kind, action);
    card.append(imageWrap, details);
    card.setAttribute("aria-label", `Start dictation: ${video.title}`);
    card.addEventListener("click", () => void onSelect(video.video_id));
    const report = button("Report this video", "dictation-report-button");
    report.type = "button";
    report.title = "Report unsuitable or incorrect content";
    report.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!window.confirm("Report this video as unsuitable? It will be hidden after multiple independent reports.")) {
        return;
      }
      report.disabled = true;
      try {
        await reportDictationVideo(video.video_id);
        report.textContent = "Report received";
      } catch (error) {
        report.disabled = false;
        report.textContent = readableError(error);
      }
    });
    cardWrap.append(card, report);
    catalog.append(cardWrap);
  }
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
