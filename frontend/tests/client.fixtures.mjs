export async function clientFixture(page, options = {}) {
  const player = { player_id: "client-test", display_name: options.longName ? "AnonymousLearner".repeat(9) : "TestLearner", best_endless_score: 0 };
  const cards = ["Haus", "Buch", "Tisch", "Stuhl", "Blume", "Zeit"].map((word, index) => ({
    word, article: index === 4 || index === 5 ? "die" : index === 2 || index === 3 ? "der" : "das",
    part_of_speech: "noun", meaning_overview: `Meaning of ${word}`, topic: "housing_furniture", topic_label: "Housing & Furniture", level: "A1",
  }));
  const passages = Array.from({ length: 4 }, (_, index) => ({
    id: `story-${index}`, group: "general", level: "A1", part: null, exercise_type: "multiple_choice", topic: "daily_life",
    title: `Eine Nachricht ${index + 1}`, passage_text: "Anna kommt am Montag zur Schule.", image_url: null,
    render_kind: "text", content: null, image_path: null, transcript: null, context_label: null, order_index: index,
    questions: [{ id: `question-${index}`, prompt: "Wann kommt Anna?", explanation: "Anna kommt am Montag.", order_index: 0,
      answers: [{ id: `answer-${index}-a`, answer_text: "Am Montag", order_index: 0 }, { id: `answer-${index}-b`, answer_text: "Am Dienstag", order_index: 1 }] }],
  }));
  const video = { video_id: "fixture0001", video_url: "https://www.youtube.com/watch?v=fixture0001", title: "Local test dictation", author_name: "Test fixture", thumbnail_url: null, language: "de", is_generated: false, segment_count: 2, created_at: "2026-11-01T10:00:00Z" };
  const transcript = { ...video, cache_hit: true, segments: [{ start: 0, duration: 3, text: "Ich heiße Anna." }, { start: 3, duration: 3, text: "Heute lerne ich Deutsch." }] };
  const question = (id) => ({ question_id: id, word: id === "q1" ? "Eigenbeteiligung" : "Haus", type: "article", prompt: `Which article belongs with '${id === "q1" ? "Eigenbeteiligung" : "Haus"}'?`, choices: ["der", "die", "das"] });
  const requests = [];
  let playerFailed = false;
  let startFailed = false;
  await page.addInitScript(({ player, mistakes }) => {
    localStorage.setItem("theme", "light");
    if (mistakes) localStorage.setItem(`deutschelearn_progress_${player.player_id}`, JSON.stringify({
      bestTimedScore: 1, lastPracticeAt: new Date().toISOString(), focusReviews: {}, storyReadIds: [], storyCompletedIds: [], storyDrafts: {},
      mistakes: Array.from({ length: 3 }, () => ({ mode: "practice", word: "Haus", prompt: "Article?", selected: "der", correct: "das", createdAt: new Date().toISOString() })),
    }));
    window.YT = { Player: class {
      constructor(element, options) {
        this.options = options; this.state = 2; this.time = 0;
        this.iframe = document.createElement("iframe"); this.iframe.src = "about:blank";
        element.replaceWith(this.iframe);
        setTimeout(() => options.events.onReady({ target: this }), 0);
      }
      cueVideoById(value) { this.time = value.startSeconds || 0; }
      destroy() { this.iframe.remove(); }
      getCurrentTime() { return this.time; }
      getIframe() { return this.iframe; }
      getPlayerState() { return this.state; }
      pauseVideo() { this.state = 2; }
      playVideo() { this.state = 1; this.options.events.onStateChange({ data: 1, target: this }); }
      seekTo(value) { this.time = value; }
    } };
  }, { player, mistakes: options.mistakes });
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|i\.ytimg\.com)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const body = req.postDataJSON();
    requests.push({ path, method: req.method(), body });
    let data;
    if (path === "/api/players/me") {
      if (options.playerFailsOnce && !playerFailed) { playerFailed = true; return route.fulfill({ status: 503, json: { detail: "Unavailable" } }); }
      data = player;
    } else if (path === "/api/focus/cards") data = cards;
    else if (path === "/api/story/passages") data = passages;
    else if (path === "/api/word-of-the-day") data = { word: "Haus", article: "das", part_of_speech: "noun", meaning: "house", date: "2026-11-09" };
    else if (path === "/api/leaderboard") data = [];
    else if (/\/quiz\/.+\/start$/.test(path)) {
      if (options.startDelay) await new Promise((resolve) => setTimeout(resolve, options.startDelay));
      if (options.startFailsOnce && !startFailed) { startFailed = true; return route.fulfill({ status: 503, json: { detail: "Try again" } }); }
      const firstQuestion = question("q1");
      if (options.lowerCaseQuestion) firstQuestion.word = firstQuestion.word.toLowerCase();
      data = { attempt_id: "attempt-1", score: 0, total_questions: 0, duration_seconds: options.duration ?? 60, question: firstQuestion };
    } else if (/\/quiz\/.+\/answer$/.test(path)) {
      if (options.answerDelay) await new Promise((resolve) => setTimeout(resolve, options.answerDelay));
      const correctAnswer = body.question_id === "q1" ? "die" : "das";
      const correct = body.selected_answer === correctAnswer;
      const finished = path.includes("endless") && !correct;
      data = { correct, score: correct ? 1 : 0, total_questions: 1, correct_answer: correctAnswer,
        answered_word: question(body.question_id).word, meaning_overview: "A personal contribution to a cost.",
        attempt_finished: finished, seconds_remaining: 5, next_question: finished ? null : question("q2") };
    } else if (path === "/api/dictation/videos") data = [video];
    else if (path === "/api/dictation/videos/fixture0001" || path === "/api/dictation/transcript") data = transcript;
    else if (path.endsWith("/report")) data = { status: "received" };
    else if (path === "/api/story/answer") data = { correct: body.answer_id.endsWith("-a"), correct_answer_id: body.question_id.replace("question", "answer") + "-a", correct_answer_text: "Am Montag", explanation: "Anna kommt am Montag." };
    else if (path === "/api/grammar/ask") {
      if (options.grammarDelay) await new Promise((resolve) => setTimeout(resolve, options.grammarDelay));
      data = { status: "answered", answer: "This noun takes **die**. Learn the article together with the noun.", citations: [{ chunk_id: "test", title: "Articles", section: "Nouns", content: "Learn articles with nouns.", level: "A1", topic: "articles", similarity: 1, source_path: "test.md", source_kind: "markdown", page_start: null, page_end: null }], retrieval_debug: null, cached: false, finish_reason: "stop", truncated: false, retrieval_query: null };
    } else return route.fulfill({ status: 404, json: { detail: `Unmocked test endpoint: ${path}` } });
    return route.fulfill({ json: data });
  });
  return { requests, transcript };
}
