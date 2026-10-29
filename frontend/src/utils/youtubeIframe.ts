export type YouTubePlayerStateEvent = {
  data: number;
  target: YouTubePlayer;
};

export type YouTubePlayer = {
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  destroy: () => void;
  getCurrentTime: () => number;
  getIframe: () => HTMLIFrameElement;
  getPlayerState: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};

type YouTubePlayerReadyEvent = {
  target: YouTubePlayer;
};

type YouTubeIframeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      host: string;
      playerVars: Record<string, string | number>;
      videoId: string;
      events: {
        onReady: (event: YouTubePlayerReadyEvent) => void;
        onStateChange: (event: YouTubePlayerStateEvent) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeIframeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeIframeApi> | null = null;

export function loadYouTubeIframeApi(): Promise<YouTubeIframeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeIframeApi>((resolve, reject) => {
    const priorReadyHandler = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      priorReadyHandler?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API did not initialize."));
    };

    const script = document.querySelector<HTMLScriptElement>("script[data-youtube-iframe-api]");
    if (script) {
      script.addEventListener("error", () => reject(new Error("Could not load YouTube player API.")), { once: true });
      return;
    }

    const apiScript = document.createElement("script");
    apiScript.src = "https://www.youtube.com/iframe_api";
    apiScript.async = true;
    apiScript.dataset.youtubeIframeApi = "true";
    apiScript.onerror = () => reject(new Error("Could not load YouTube player API."));
    document.head.append(apiScript);
  }).catch((error: unknown) => {
    apiPromise = null;
    throw error;
  });

  return apiPromise;
}
