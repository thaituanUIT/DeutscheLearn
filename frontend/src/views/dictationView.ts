import "../styles/views/dictation.css";
import {
  getDictationTranscript,
  getSavedDictationVideo,
  reportDictationVideo,
} from "../api/client";
import {
  getCachedDictationVideos,
  getDictationVideosCatalog,
  invalidateDictationVideos,
} from "../api/queryClient";
import type { DictationTranscript, DictationVideoSummary } from "../api/types";
import { button } from "../components/button";
import { clear, el } from "../utils/dom";
import { loadYouTubeIframeApi, type YouTubePlayer } from "../utils/youtubeIframe";

type DictationViewOptions = {
  onBack: () => void;
  onBackChange: (handler: () => void) => void;
};

const VIDEOS_PER_PAGE = 8;

export function dictationView(options: DictationViewOptions): HTMLElement {
  const section = el("section", "dictation-view");
  const browsePanel = el("div", "dictation-browse-panel");
  const intro = el("div", "dictation-intro");
  intro.append(el("h2", "", "Hörtippen"));

  const library = el("section", "dictation-library");
  const libraryHeader = el("div", "dictation-library-header");
  const libraryTitle = el("div", "dictation-library-title");
  libraryTitle.append(
    el("h3", "", "Available videos"),
  );
  const count = el("span", "dictation-video-count", "Loading…");
  libraryHeader.append(libraryTitle, count);
  const catalog = el("div", "dictation-video-grid");
  const libraryStatus = el("p", "dictation-library-empty muted", "Loading saved videos…");
  library.append(libraryHeader, libraryStatus, catalog);
  const cachedVideos = getCachedDictationVideos();
  let videos: DictationVideoSummary[] = cachedVideos ?? [];
  let currentPage = 1;

  const addVideo = el("section", "dictation-add-video");
  const sourceHeading = el("div", "dictation-source-heading");
  sourceHeading.append(el("h3", "", "Can’t find the video you want?"));
  const form = el("form", "dictation-source");
  const label = el("label", "form-label", "Paste a YouTube link");
  const input = el("input", "form-input") as HTMLInputElement;
  input.type = "url";
  input.placeholder = "https://www.youtube.com/watch?v=…";
  input.required = true;
  const loadButton = button("Start dictation", "button button-primary");
  loadButton.type = "submit";
  label.append(input);
  form.append(label, loadButton);
  addVideo.append(sourceHeading, form);
  browsePanel.append(intro, library, addVideo);

  const practicePanel = el("section", "dictation-practice-panel");
  practicePanel.hidden = true;
  const practiceHeader = el("div", "dictation-practice-header");
  const practiceTitle = el("h2", "dictation-practice-title", "");
  practiceTitle.tabIndex = -1;
  practiceHeader.append(practiceTitle);
  const status = el("p", "dictation-status muted", "");
  status.setAttribute("aria-live", "polite");
  const exercise = el("div", "dictation-exercise");
  practicePanel.append(practiceHeader, status, exercise);
  let disposeExercise: (() => void) | null = null;

  const clearExercise = (): void => {
    disposeExercise?.();
    disposeExercise = null;
    clear(exercise);
  };

  const showBrowsePanel = (): void => {
    practicePanel.hidden = true;
    browsePanel.hidden = false;
    clearExercise();
    options.onBackChange(options.onBack);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const showPracticePanel = (title: string): void => {
    browsePanel.hidden = true;
    practicePanel.hidden = false;
    practiceTitle.textContent = title;
    practiceTitle.focus({ preventScroll: true });
    options.onBackChange(showBrowsePanel);
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const updateStatus = (message: string, isError = false): void => {
    status.className = `dictation-status ${isError ? "error" : "muted"}`;
    status.textContent = message;
  };

  const selectVideo = async (videoId: string): Promise<void> => {
    const video = videos.find((item) => item.video_id === videoId);
    showPracticePanel(video?.title ?? "Hörtippen");
    updateStatus("");
    clearExercise();
    try {
      const transcript = await getSavedDictationVideo(videoId);
      practiceTitle.textContent = transcript.title;
      disposeExercise = renderExercise(exercise, transcript, () => {
        updateStatus("YouTube could not play this video. Try another video.", true);
      });
      updateStatus("");
    } catch (error) {
      updateStatus(readableError(error), true);
    }
  };

  const renderCurrentCatalogPage = (): void => {
    renderCatalog(catalog, libraryStatus, count, videos, currentPage, selectVideo, (page) => {
      currentPage = page;
      renderCurrentCatalogPage();
    });
  };

  if (cachedVideos) renderCurrentCatalogPage();

  const refreshCatalog = async (): Promise<void> => {
    try {
      videos = await getDictationVideosCatalog();
      currentPage = Math.min(currentPage, Math.max(1, Math.ceil(videos.length / VIDEOS_PER_PAGE)));
      renderCurrentCatalogPage();
    } catch (error) {
      if (!cachedVideos) {
        count.textContent = "";
        libraryStatus.textContent = readableError(error);
        libraryStatus.className = "dictation-library-empty error";
      }
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const videoUrl = input.value.trim();
    if (!videoUrl) return;
    loadButton.disabled = true;
    showPracticePanel("Hörtippen");
    updateStatus("");
    clearExercise();
    void getDictationTranscript(videoUrl)
      .then(async (transcript) => {
        practiceTitle.textContent = transcript.title;
        disposeExercise = renderExercise(exercise, transcript, () => {
          updateStatus("YouTube could not play this video. Try another video.", true);
        });
        updateStatus("");
        currentPage = 1;
        await invalidateDictationVideos();
        await refreshCatalog();
      })
      .catch((error: unknown) => {
        practiceTitle.textContent = "Couldn’t load this video";
        updateStatus(readableError(error), true);
      })
      .finally(() => {
        loadButton.disabled = false;
      });
  });

  section.append(browsePanel, practicePanel);
  void refreshCatalog();
  return section;
}

function renderCatalog(
  catalog: HTMLElement,
  emptyState: HTMLElement,
  count: HTMLElement,
  videos: DictationVideoSummary[],
  page: number,
  onSelect: (videoId: string) => Promise<void>,
  onPageChange: (page: number) => void,
): void {
  clear(catalog);
  count.textContent = `${videos.length} videos`;
  if (videos.length === 0) {
    emptyState.className = "dictation-library-empty muted";
    emptyState.textContent = "No videos yet.";
    return;
  }

  emptyState.textContent = "Choose a video to start.";
  emptyState.className = "dictation-library-empty muted";
  const totalPages = Math.ceil(videos.length / VIDEOS_PER_PAGE);
  for (const video of videos.slice((page - 1) * VIDEOS_PER_PAGE, page * VIDEOS_PER_PAGE)) {
    const cardWrap = el("div", "dictation-video-card-wrap");
    const card = button("", "dictation-video-card");
    const imageWrap = el("span", "dictation-video-image");
    const image = document.createElement("img");
    image.src = video.thumbnail_url ?? `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/hqdefault.jpg`;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => imageWrap.classList.add("is-unavailable"), { once: true });
    imageWrap.append(
      image,
      el("span", "dictation-play-badge", "▶"),
      el("span", "dictation-image-action", "Start dictation"),
    );

    const details = el("span", "dictation-video-details");
    const title = el("strong", "dictation-video-name", video.title);
    const author = el("span", "dictation-video-author", video.author_name || "YouTube video");
    const meta = el("span", "dictation-video-meta", `${video.segment_count} lines · ${video.language}`);
    const kind = el("span", "dictation-video-kind", video.is_generated ? "Auto captions" : "Creator captions");
    details.append(title, author, meta, kind);
    card.append(imageWrap, details);
    card.setAttribute("aria-label", `Start dictation: ${video.title}`);
    card.addEventListener("click", () => void onSelect(video.video_id));
    const report = button("Report this video", "dictation-report-button");
    report.type = "button";
    report.title = "Report unsuitable or incorrect content";
    report.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!window.confirm("Send this video to the review queue? Reports do not hide videos automatically.")) {
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
  if (totalPages > 1) {
    const pagination = el("nav", "dictation-pagination");
    pagination.setAttribute("aria-label", "Available video pages");
    const previous = button("← Previous", "button button-quiet dictation-page-button");
    previous.disabled = page <= 1;
    previous.addEventListener("click", () => onPageChange(page - 1));
    const pageLabel = el("span", "dictation-page-label", `Page ${page} of ${totalPages}`);
    pageLabel.setAttribute("aria-live", "polite");
    const next = button("Next →", "button button-quiet dictation-page-button");
    next.disabled = page >= totalPages;
    next.addEventListener("click", () => onPageChange(page + 1));
    pagination.append(previous, pageLabel, next);
    catalog.append(pagination);
  }
}

function renderExercise(
  host: HTMLElement,
  transcript: DictationTranscript,
  onPlayerError: () => void,
): () => void {
  const exercise = el("div", "dictation-workspace");
  const player = el("div", "dictation-player");
  const playerMount = el("div", "dictation-player-mount");
  player.append(playerMount);

  const practice = el("div", "dictation-practice");
  const progress = el("div", "dictation-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Dictation progress");
  progress.setAttribute("aria-valuemin", "1");
  progress.setAttribute("aria-valuemax", String(transcript.segments.length));
  const progressTrack = el("span", "dictation-progress-track");
  const progressFill = el("span", "dictation-progress-fill");
  progressTrack.append(progressFill);
  progress.append(progressTrack);
  const answerPanel = el("div", "dictation-answer-panel");
  const answerLabel = el("label", "dictation-answer-label", "Your answer");
  const answer = el("textarea", "dictation-answer") as HTMLTextAreaElement;
  answer.rows = 3;
  answer.placeholder = "Type what you hear…";
  answer.setAttribute("aria-label", "Type the German line you hear");
  answerLabel.htmlFor = "dictation-answer-input";
  answer.id = "dictation-answer-input";
  answerPanel.append(answerLabel, answer);
  const feedback = el("div", "dictation-feedback");
  const play = button("▶ Replay line", "button button-secondary");
  const check = button("Check answer", "button button-primary");
  const reveal = button("Reveal transcript", "button button-quiet dictation-reveal-button");
  const next = button("Next line →", "button button-secondary");
  let index = 0;
  let skipAnswerShown = false;
  let youtubePlayer: YouTubePlayer | null = null;
  let disposed = false;
  let lineEndWatcher: number | null = null;

  const clearLineEndWatcher = (): void => {
    if (lineEndWatcher !== null) window.clearInterval(lineEndWatcher);
    lineEndWatcher = null;
  };

  const watchLineEnd = (): void => {
    clearLineEndWatcher();
    lineEndWatcher = window.setInterval(() => {
      if (!youtubePlayer || youtubePlayer.getPlayerState() !== 1) return;
      const segment = transcript.segments[index];
      const segmentEnd = segment.start + segment.duration;
      if (youtubePlayer.getCurrentTime() >= segmentEnd) {
        youtubePlayer.pauseVideo();
        youtubePlayer.seekTo(segmentEnd, false);
        clearLineEndWatcher();
      }
    }, 100);
  };

  const showLine = (autoplay = false): void => {
    const segment = transcript.segments[index];
    progress.setAttribute("aria-valuenow", String(index + 1));
    progress.setAttribute("aria-valuetext", `Line ${index + 1} of ${transcript.segments.length}`);
    progressFill.style.width = `${((index + 1) / transcript.segments.length) * 100}%`;
    answer.value = "";
    skipAnswerShown = false;
    next.textContent = "Next line →";
    clear(feedback);
    reveal.textContent = "Reveal transcript";
    reveal.dataset.open = "false";
    if (youtubePlayer) {
      youtubePlayer.pauseVideo();
      youtubePlayer.seekTo(segment.start, true);
      if (autoplay) youtubePlayer.playVideo();
    }
  };

  play.addEventListener("click", () => {
    const segment = transcript.segments[index];
    if (!youtubePlayer) return;
    youtubePlayer.pauseVideo();
    youtubePlayer.seekTo(segment.start, true);
    youtubePlayer.playVideo();
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

  next.addEventListener("click", () => {
    if (!answer.value.trim() && !skipAnswerShown) {
      skipAnswerShown = true;
      reveal.dataset.open = "true";
      reveal.textContent = "Hide transcript";
      feedback.replaceChildren(
        el("p", "dictation-gold", transcript.segments[index].text),
        el(
          "p",
          "dictation-skip-advice",
          "Tip: replay the line and listen for the verb position and word endings. Those clues can make it easier to catch the whole sentence.",
        ),
      );
      next.textContent = "Continue →";
      return;
    }
    index = (index + 1) % transcript.segments.length;
    showLine(true);
  });
  const controls = el("div", "dictation-controls");
  play.classList.add("dictation-replay-button");
  check.classList.add("dictation-check-button");
  next.classList.add("dictation-next-button");
  controls.append(play, check, next);
  const revealRow = el("div", "dictation-reveal-row");
  revealRow.append(reveal);
  practice.append(progress, answerPanel, controls, feedback, revealRow);
  exercise.append(player, practice);
  host.replaceChildren(exercise);
  showLine();

  void loadYouTubeIframeApi()
    .then((youtube) => {
      if (disposed) return;
      youtubePlayer = new youtube.Player(playerMount, {
        host: "https://www.youtube-nocookie.com",
        videoId: transcript.video_id,
        playerVars: {
          playsinline: 1,
          rel: 0,
          cc_load_policy: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (disposed) {
              event.target.destroy();
              return;
            }
            youtubePlayer = event.target;
            youtubePlayer.getIframe().title = "YouTube dictation video";
            youtubePlayer.cueVideoById({
              videoId: transcript.video_id,
              startSeconds: transcript.segments[index].start,
            });
            play.disabled = false;
            next.disabled = false;
          },
          onStateChange: (event) => {
            if (event.data === 1) watchLineEnd();
            else clearLineEndWatcher();
          },
          onError: onPlayerError,
        },
      });
    })
    .catch(onPlayerError);

  play.disabled = true;
  next.disabled = true;
  return () => {
    disposed = true;
    clearLineEndWatcher();
    youtubePlayer?.destroy();
    youtubePlayer = null;
  };
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
  const scoreLevel = score >= 80 ? "is-strong" : score >= 50 ? "is-partial" : "is-low";
  const heading = el("h3", "dictation-result-heading", "Your result");
  const summary = el("div", `dictation-score ${scoreLevel}`);
  summary.append(
    el("strong", "dictation-score-value", `${score}%`),
    el("span", "dictation-score-copy", score === 100 ? "All words correct" : `${matched} of ${right.length} words matched`),
  );
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
  host.replaceChildren(...(score === 100 ? [heading, summary] : [heading, summary, diff]));
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
