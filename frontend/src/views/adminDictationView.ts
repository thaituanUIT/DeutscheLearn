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

  const render = (status: ListStatus = "idle", error?: unknown): void => {
    const section = el("section", "admin-dictation");
    const header = el("div", "admin-list-header");
    const heading = el("h2", "focus-title", "Reported videos");
    const refresh = button(loading ? "Refreshing…" : "Refresh", "button compact-button");
    refresh.disabled = loading || pendingVideoId !== null;
    refresh.addEventListener("click", () => void loadVideos());
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
  };

  const renderModerationRow = (video: AdminDictationVideo): HTMLElement => {
    const row = el("article", "admin-dictation-row");
    const thumbnail = document.createElement("img");
    thumbnail.className = "admin-dictation-thumbnail";
    thumbnail.src = `https://i.ytimg.com/vi/${encodeURIComponent(video.video_id)}/mqdefault.jpg`;
    thumbnail.alt = "";
    thumbnail.loading = "lazy";

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

    const action = button(
      pendingVideoId === video.video_id ? "Saving…" : video.is_hidden ? "Restore video" : "Hide video",
      video.is_hidden ? "button" : "button admin-dictation-hide",
    );
    action.disabled = pendingVideoId !== null || loading;
    action.addEventListener("click", () => void updateVideo(video));
    row.append(thumbnail, details, action);
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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
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
