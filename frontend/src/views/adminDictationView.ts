import { getAdminDictationReports, setAdminDictationVideoHidden } from "../api/client";
import type { AdminDictationVideo } from "../api/types";
import { button } from "../components/button";
import { el } from "../utils/dom";

type ListStatus = "idle" | "loading" | "error";

export function renderDictationAdmin(host: HTMLElement, token: string): () => void {
  let videos: AdminDictationVideo[] = [];
  let disposed = false;
  let requestId = 0;
  let pendingVideoId: string | null = null;
  let loading = false;
  let loadError: unknown;
  let actionError: unknown;
  let focusTarget: string | null = null;
  const expandedVideos = new Set<string>();

  const render = (status: ListStatus = "idle", error?: unknown): void => {
    const scrollTop = host.querySelector(".admin-dictation-list")?.scrollTop ?? 0;
    const section = el("section", "admin-dictation");
    const header = el("div", "admin-list-header");
    const heading = el("h2", "focus-title", "Reported videos");
    const refresh = button(loading ? "Refreshing…" : "Refresh", "button compact-button");
    refresh.disabled = loading || pendingVideoId !== null;
    refresh.addEventListener("click", () => { focusTarget = "refresh"; void loadVideos(); });
    refresh.dataset.moderationFocus = "refresh";
    header.append(heading, refresh);

    const summary = el(
      "p",
      "prompt admin-dictation-summary",
      "Review reports and hide videos that should no longer appear in the learner library. Hidden videos can be restored here.",
    );
    const list = el("div", "admin-dictation-list");
    list.setAttribute("aria-live", "polite");
    if (status === "loading") {
      list.append(el("p", "prompt admin-list-placeholder", "Loading reported videos…"));
    } else {
      const visibleError = actionError ?? (status === "error" ? error : loadError);
      if (visibleError) {
        const alert = errorMessage(visibleError);
        alert.setAttribute("role", "alert");
        list.append(alert);
        const retry = button("Try again", "button compact-button");
        retry.disabled = loading || pendingVideoId !== null;
        retry.addEventListener("click", () => void loadVideos());
        list.append(retry);
      }

      if (videos.length === 0 && !visibleError) {
        list.append(
          el("h3", "admin-dictation-empty-title", "No reported videos"),
          el("p", "prompt", "New reports will appear here for review."),
        );
      }
      for (const video of videos) list.append(renderModerationRow(video));
    }
    section.append(header, summary, list);
    host.replaceChildren(section);
    list.scrollTop = scrollTop;
    if (!loading && pendingVideoId === null && focusTarget) {
      host.querySelectorAll<HTMLButtonElement>("[data-moderation-focus]").forEach((control) => {
        if (control.dataset.moderationFocus === focusTarget) control.focus({ preventScroll: true });
      });
    }
  };

  const renderModerationRow = (video: AdminDictationVideo): HTMLElement => {
    const row = el("article", "admin-dictation-row");
    const thumbnailFrame = el("div", "admin-dictation-thumbnail");
    const thumbnail = document.createElement("img");
    thumbnail.className = "admin-dictation-image";
    thumbnail.src = `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/mqdefault.jpg`;
    thumbnail.alt = "";
    thumbnail.loading = "lazy";
    thumbnail.addEventListener("error", () => thumbnail.remove(), { once: true });
    thumbnailFrame.append(thumbnail);

    const details = el("div", "admin-dictation-details");
    const titleLink = document.createElement("a");
    titleLink.className = "admin-dictation-title";
    titleLink.href = video.video_url;
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    titleLink.textContent = video.title;
    const meta = el(
      "p",
      "prompt admin-dictation-meta",
      `${video.report_count} ${video.report_count === 1 ? "report" : "reports"} · Added ${formatDate(video.created_at)}`,
    );
    const state = el(
      "span",
      `admin-dictation-state${video.is_hidden ? " is-hidden" : ""}`,
      video.is_hidden ? "Hidden" : "In learner library",
    );
    details.append(titleLink, meta, state);
    const review = document.createElement("details");
    review.className = "admin-moderation-details";
    review.open = expandedVideos.has(video.video_id);
    review.addEventListener("toggle", () => {
      review.open ? expandedVideos.add(video.video_id) : expandedVideos.delete(video.video_id);
    });
    review.append(el("summary", "", "Report reasons and review history"));
    const reasons = video.report_reasons ?? {};
    const reasonLabels: Record<string, string> = { not_german: "Not German", inappropriate: "Inappropriate content", broken: "Video unavailable", other: "Other" };
    for (const [reason, count] of Object.entries(reasons)) {
      review.append(el("p", "prompt", `${reasonLabels[reason] ?? reason}: ${count}`));
    }
    const knownReports = Object.values(reasons).reduce((sum, count) => sum + count, 0);
    if (knownReports < video.report_count) review.append(el("p", "prompt", `${video.report_count - knownReports} older reports have no recorded reason.`));
    const history = video.review_history ?? [];
    if (history.length) {
      review.append(el("h3", "admin-section-title", "Recent review actions"));
      const events = el("ol", "admin-review-history");
      for (const event of history) {
        events.append(el("li", "prompt", `${event.is_hidden ? "Hidden from learners" : "Restored to library"} · ${formatDate(event.created_at, true)}`));
      }
      review.append(events);
    } else review.append(el("p", "prompt", "No review actions recorded yet."));
    details.append(review);

    const action = button(
      pendingVideoId === video.video_id ? "Saving…" : video.is_hidden ? "Restore video" : "Hide video",
      video.is_hidden ? "button" : "button admin-dictation-hide",
    );
    action.disabled = pendingVideoId !== null || loading;
    action.dataset.moderationFocus = video.video_id;
    action.addEventListener("click", () => { focusTarget = video.video_id; void updateVideo(video); });
    row.append(thumbnailFrame, details, action);
    return row;
  };

  const loadVideos = async (): Promise<void> => {
    const currentRequest = ++requestId;
    loading = true;
    loadError = undefined;
    actionError = undefined;
    render(videos.length === 0 ? "loading" : "idle");
    try {
      const result = await getAdminDictationReports(token);
      if (disposed || currentRequest !== requestId) return;
      videos = result;
    } catch (error) {
      if (disposed || currentRequest !== requestId) return;
      loadError = error;
    } finally {
      if (!disposed && currentRequest === requestId) {
        loading = false;
        render(loadError ? "error" : "idle", loadError);
      }
    }
  };

  const updateVideo = async (video: AdminDictationVideo): Promise<void> => {
    pendingVideoId = video.video_id;
    actionError = undefined;
    render();
    try {
      const updated = await setAdminDictationVideoHidden(token, video.video_id, !video.is_hidden);
      if (disposed) return;
      videos = videos.map((item) => item.video_id === updated.video_id ? updated : item);
    } catch (error) {
      if (disposed) return;
      actionError = error;
    } finally {
      if (!disposed) {
        pendingVideoId = null;
        render();
      }
    }
  };

  render("loading");
  void loadVideos();
  return () => {
    disposed = true;
  };
}

function formatDate(value: string, includeTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", ...(includeTime ? { timeStyle: "short" as const } : {}) }).format(date);
}

function errorMessage(error: unknown): HTMLElement {
  const fallback = error instanceof Error ? error.message : "Dictation moderation request failed.";
  if (error instanceof Error) {
    try {
      const payload = JSON.parse(error.message) as { detail?: string };
      return el("div", "error", payload.detail ?? fallback);
    } catch {
      // Keep the request message when the response body is not JSON.
    }
  }
  return el("div", "error", fallback);
}
