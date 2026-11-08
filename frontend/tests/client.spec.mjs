import { test, expect } from "@playwright/test";
import { clientFixture } from "./client.fixtures.mjs";

async function setTheme(page, theme) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  // Let authored control transitions finish before judging their final colors.
  await page.waitForTimeout(250);
}

async function expectReadable(page, selector) {
  const ratios = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => {
        const value = n / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    let ancestor = node;
    while (getComputedStyle(ancestor).backgroundColor === "rgba(0, 0, 0, 0)") ancestor = ancestor.parentElement;
    const ink = luminance(getComputedStyle(node).color);
    const surface = luminance(getComputedStyle(ancestor).backgroundColor);
    return (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05);
  }));
  expect(ratios.length).toBeGreaterThan(0);
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
}

test("all home modes remain reachable with review history and long names at every width", async ({ page }, testInfo) => {
  await clientFixture(page, { longName: true, mistakes: true }); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Review recent mistakes" })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await setTheme(page, theme);
    for (const width of [320, 390, 430, 821, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator(".mode-grid").evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
      const listening = page.getByRole("link", { name: "Hörtippen: Start listening", exact: true });
      await listening.scrollIntoViewIfNeeded(); await expect(listening).toBeInViewport();
      const last = await listening.boundingBox();
      expect(last.x + last.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`home-${theme}-${width}.png`), fullPage: true });
    }
  }
  await expect(page.locator(".mode-card")).toHaveCount(7);
  await expect(page.getByText("Last practiced", { exact: true })).toBeVisible();
});

test("practice corrections retain word, meaning, answers, focus and contextual explanation", async ({ page }, testInfo) => {
  const api = await clientFixture(page, { lowerCaseQuestion: true }); await page.goto("/#practice");
  await expect(page.getByText(/Mixed-level vocabulary/)).toBeVisible();
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "eigenbeteiligung", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "der", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Not quite", exact: true })).toBeFocused();
  await expect(page.getByText("die Eigenbeteiligung", { exact: true })).toBeVisible();
  await expect(page.getByText("A personal contribution to a cost.", { exact: true })).toBeVisible();
  await expect(page.getByText("Your answer", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("practice-feedback.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await setTheme(page, "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("practice-feedback-dark-320.png"), fullPage: true });
  await page.getByRole("button", { name: "Explain this answer", exact: true }).click();
  const question = page.getByRole("textbox", { name: "Your grammar question", exact: true });
  await expect(question).toBeFocused(); await expect(question).toHaveValue(/Eigenbeteiligung/);
  expect(api.requests.some((request) => request.path === "/api/grammar/ask")).toBe(false);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Next question", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Haus", exact: true })).toBeFocused();
});

test("quiz startup prevents repeated requests and provides retry after failure", async ({ page }) => {
  const api = await clientFixture(page, { startDelay: 350, startFailsOnce: true }); await page.goto("/#practice");
  const start = page.getByRole("button", { name: "Start practice", exact: true });
  await start.click(); await expect(start).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Could not start the quiz/)).toBeVisible();
  expect(api.requests.filter((request) => request.path.endsWith("/start"))).toHaveLength(1);
  await start.click(); await expect(page.getByRole("heading", { name: "Eigenbeteiligung", exact: true })).toBeVisible();
});

test("beginner guidance opens A1 flashcard topics directly", async ({ page }) => {
  await clientFixture(page); await page.goto("/#practice");
  await page.getByRole("button", { name: "Start with A1 flashcards", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a topic", exact: true })).toBeFocused();
  await expect(page.locator(".question-type")).toHaveText("A1");
});

test("an answer arriving after navigation cannot replace a new quiz", async ({ page }) => {
  const api = await clientFixture(page, { answerDelay: 500 }); await page.goto("/#practice");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await page.getByRole("button", { name: "der", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: "Practice: Start practice", exact: true }).click();
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect.poll(() => api.requests.filter((request) => request.path.endsWith("/start")).length).toBe(2);
  await page.waitForTimeout(650);
  await expect(page.getByRole("heading", { name: "Eigenbeteiligung", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Not quite", exact: true })).toHaveCount(0);
});

test("timed mode announces the previous answer while keeping the next question usable", async ({ page }) => {
  await clientFixture(page); await page.goto("/#timed");
  await page.getByRole("button", { name: "Start timed run", exact: true }).click();
  await page.getByRole("button", { name: "der", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Last answer: not quite — die Eigenbeteiligung");
  await expect(page.getByRole("heading", { name: "Haus", exact: true })).toBeFocused();
});

test("timed expiry ends the run and focuses its summary", async ({ page }) => {
  await clientFixture(page, { duration: 2 }); await page.goto("/#timed");
  await page.getByRole("button", { name: "Start timed run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Time up", exact: true })).toBeFocused({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Try timed again", exact: true })).toBeVisible();
});

test("endless result retains its correction and explanation action", async ({ page }) => {
  await clientFixture(page); await page.goto("/#endless");
  await page.getByRole("button", { name: "Start endless run", exact: true }).click();
  await page.getByRole("button", { name: "der", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run finished", exact: true })).toBeFocused();
  await expect(page.getByText("die Eigenbeteiligung", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explain this answer", exact: true })).toBeVisible();
});

test("startup failure has a working retry instead of silently showing demo data", async ({ page }) => {
  await clientFixture(page, { playerFailsOnce: true }); await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Could not load your learning session");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a way to practice", exact: true })).toBeVisible();
});

test("reading labels use stories and do not inject a fake step number", async ({ page }) => {
  await clientFixture(page); await page.goto("/#story");
  await expect(page.getByRole("button", { name: /General.*4 stories/ })).toBeVisible();
  const prefix = await page.locator(".question-type").evaluate((node) => getComputedStyle(node, "::before").content);
  expect(["none", "normal"]).toContain(prefix);
});

test("closing the grammar assistant during a request keeps it closed when the answer arrives", async ({ page }) => {
  const api = await clientFixture(page, { grammarDelay: 500 }); await page.goto("/");
  await page.getByRole("button", { name: "Open grammar assistant", exact: true }).click();
  await page.getByRole("textbox", { name: "Your grammar question", exact: true }).fill("Why does this noun take die?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close grammar assistant", exact: true }).click();
  await page.waitForTimeout(650);
  await expect(page.getByRole("dialog", { name: "Grammar assistant", exact: true })).toBeHidden();
  expect(api.requests.filter((request) => request.path === "/api/grammar/ask")).toHaveLength(1);
});

test("dictation comparison stays readable and finishes instead of looping", async ({ page }, testInfo) => {
  await clientFixture(page); await page.goto("/#dictation");
  await page.getByRole("button", { name: "Start dictation: Local test dictation", exact: true }).click();
  const answer = page.getByRole("textbox", { name: "Type the German line you hear", exact: true });
  await answer.fill("Ich bin Anna"); await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transcript", exact: true })).toBeVisible();
  await expect(page.getByText("Ich heiße Anna.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Underlined words: add or correct/)).toBeVisible();
  await expectReadable(page, ".dictation-answer, .dictation-word");
  await page.screenshot({ path: testInfo.outputPath("dictation-comparison.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, "dark");
  await expectReadable(page, ".dictation-answer, .dictation-word");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dictation-comparison-dark-390.png"), fullPage: true });
  await page.getByRole("button", { name: "Next line", exact: true }).click();
  await expect(answer).toBeFocused(); await answer.fill("Heute lerne ich Deutsch.");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Finish dictation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dictation complete", exact: true })).toBeFocused();
  await expect(page.getByText("2 lines checked · 0 transcripts revealed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Practice again", exact: true }).click();
  await expect(page.getByText("Line 1 of 2", { exact: true })).toBeVisible();
});

test("revealing or skipping captions still leads to completion with honest counts", async ({ page }) => {
  await clientFixture(page); await page.goto("/#dictation");
  await page.getByRole("button", { name: "Start dictation: Local test dictation", exact: true }).click();
  await page.getByRole("button", { name: "Next line", exact: true }).click();
  await page.getByRole("button", { name: "Continue to next line", exact: true }).click();
  await page.getByRole("button", { name: "Finish dictation", exact: true }).click();
  await page.getByRole("button", { name: "Finish dictation", exact: true }).click();
  await expect(page.getByText("0 lines checked · 2 transcripts revealed", { exact: true })).toBeVisible();
  await expect(page.getByText(/Average checked-line score/)).toHaveCount(0);
  await page.getByRole("button", { name: "Choose another video", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Available videos", exact: true })).toBeVisible();
});
