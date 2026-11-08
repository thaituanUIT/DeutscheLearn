export async function adminFixture(page, overrides = {}) {
  const words = [
    { word: "Haus", article: "das", part_of_speech: "noun", meaning: "house", focus_entries: [{ level: "A1", topic: "home" }] },
    { word: "lernen", article: null, part_of_speech: "verb", meaning: "to learn", focus_entries: [{ level: "A2", topic: "school" }] },
  ];
  if (overrides.wordCount) {
    for (let index = 2; index < overrides.wordCount; index++) words.push({ ...words[0], word: `Wort${String(index).padStart(4, "0")}` });
  }
  const question = { prompt: "Wann beginnt der Kurs?", explanation: null, order_index: 0, answers: [{ answer_text: "Am Montag", is_correct: true, order_index: 0 }, { answer_text: "Am Dienstag", is_correct: false, order_index: 1 }] };
  const base = { level: "A1", part: null, topic: "school", title: "Ein neuer Kurs", passage_text: "Unser Deutschkurs beginnt am Montag um neun Uhr.", image_url: null, render_kind: "text", content: null, image_path: null, transcript: null, context_label: null, status: "draft", order_index: 0, ad_stimuli: [], questions: [question] };
  const passages = [{ ...base, id: "general-1", group: "general" }, { ...base, id: "goethe-2", group: "goethe", level: "A2", part: "teil_2", title: "Information am Bahnhof" }];
  const video = { video_id: "reviewvideo", title: "Deutsch lernen im Alltag", video_url: "https://www.youtube.com/watch?v=reviewvideo", report_count: 3, is_hidden: false, created_at: "2026-11-01T10:00:00Z", report_reasons: { not_german: 2, broken: 1 }, review_history: [] };
  const requests = [];
  const savedWords = [];
  const savedPassages = [];
  let detailFailed = false;
  let deleteFailed = false;
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|i\.ytimg\.com)/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const method = request.method();
    const body = request.postDataJSON();
    requests.push({ path, method, body });
    let data = [];
    if (path === "/api/admin/words" && method === "GET") data = words.slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + 200);
    else if (path.startsWith("/api/admin/words") && ["POST", "PATCH"].includes(method)) {
      if (overrides.saveDelay) await new Promise((resolve) => setTimeout(resolve, overrides.saveDelay));
      if (overrides.wordError) return route.fulfill({ status: 422, json: { detail: [{ loc: ["body", "meaning"], type: "string_too_short", msg: "Meaning is required" }] } });
      data = { ...(words.find((word) => word.word === decodeURIComponent(path.split("/").pop())) ?? {}), ...body };
      savedWords.push(data);
      const index = words.findIndex((word) => word.word === data.word);
      if (index < 0) words.push(data); else words[index] = data;
    } else if (path === "/api/focus/topic-aliases") data = [{ topic: "home", label: "Home" }, { topic: "school", label: "School" }];
    else if (path === "/api/admin/reading/passages" && method === "GET") data = passages.filter((passage) => passage.group === url.searchParams.get("group")).map((passage) => ({ ...passage, question_count: passage.questions.length }));
    else if (path.startsWith("/api/admin/reading/passages/") && method === "GET") {
      if (overrides.detailErrorOnce && !detailFailed) { detailFailed = true; return route.fulfill({ status: 503, json: { detail: "Could not load this passage. Try again." } }); }
      data = passages.find((passage) => passage.id === path.split("/").pop());
    } else if (path.startsWith("/api/admin/reading/passages") && ["POST", "PATCH"].includes(method)) {
      data = { ...body, id: body.id ?? "new-passage" }; savedPassages.push(data);
      const index = passages.findIndex((passage) => passage.id === data.id);
      if (index < 0) passages.push(data); else passages[index] = data;
    } else if (path === "/api/admin/dictation/reports") data = [video];
    else if (path.startsWith("/api/admin/dictation/videos/")) {
      Object.assign(video, body); video.review_history.unshift({ is_hidden: video.is_hidden, created_at: new Date().toISOString() }); data = video;
    } else if (path.includes("/api/admin/import/")) data = { total: 1, valid: 1, created: 1, updated: 0, skipped: 0, errors: [] };
    if (method === "DELETE") {
      if (!deleteFailed && overrides.failDelete === decodeURIComponent(path.split("/").pop())) {
        deleteFailed = true;
        return route.fulfill({ status: 503, json: { detail: "Try this item again." } });
      }
      const index = words.findIndex((word) => word.word === decodeURIComponent(path.split("/").pop()));
      if (index >= 0) words.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 200, json: data });
  });
  await page.addInitScript(() => localStorage.setItem("recognition_admin_token", "test-only"));
  return { requests, savedWords, savedPassages };
}
