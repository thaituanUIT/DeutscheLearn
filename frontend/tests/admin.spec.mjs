import { test, expect } from "@playwright/test";
import { adminFixture } from "./admin.fixtures.mjs";

test("search retains focus and filters without refetching", async ({ page }) => {
  const api = await adminFixture(page);
  await page.goto("/admin");
  const search = page.getByRole("searchbox", { name: "Search words" });
  await expect(page.getByRole("button", { name: /das Haus/ })).toBeVisible();
  await search.pressSequentially("Haus");
  await expect(search).toHaveValue("Haus"); await expect(search).toBeFocused();
  await expect(page.getByRole("button", { name: /^lernen/ })).toHaveCount(0);
  await search.fill("house");
  await expect(page.getByRole("button", { name: /das Haus/ })).toBeVisible();
  expect(api.requests.filter((r) => r.path === "/api/admin/words")).toHaveLength(1);
  await page.getByRole("tab", { name: "Reading", exact: true }).click();
  const readingSearch = page.getByRole("searchbox", { name: "Search passages" });
  await readingSearch.pressSequentially("Kurs");
  await expect(readingSearch).toHaveValue("Kurs"); await expect(readingSearch).toBeFocused();
});

test("drafts survive tabs and guard replacement with save, discard, and stay", async ({ page }) => {
  await adminFixture(page); await page.goto("/admin");
  await page.getByRole("button", { name: /das Haus/ }).click();
  await page.getByRole("textbox", { name: "Meaning", exact: true }).fill("A protected draft");
  await page.getByRole("tab", { name: "Reading", exact: true }).click();
  await page.getByRole("tab", { name: "Vocabulary", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toHaveValue("A protected draft");
  await page.getByRole("button", { name: "New word", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Save your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toHaveValue("A protected draft");
  await page.getByRole("button", { name: "New word", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New word", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /das Haus/ }).click();
  await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toHaveValue("A protected draft");
  await page.getByRole("textbox", { name: "Meaning", exact: true }).fill("Discard this");
  await page.getByRole("button", { name: "New word", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "New word", exact: true })).toBeVisible();
});

test("partial reading questions recover after refresh and section is remembered", async ({ page }) => {
  await adminFixture(page); await page.goto("/admin#reading");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Unfinished draft");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An incomplete question");
  await page.getByRole("textbox", { name: "Answer option 1", exact: true }).fill("Partial answer");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Reading", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Unfinished draft");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("An incomplete question");
  await expect(page.getByRole("textbox", { name: "Answer option 1", exact: true })).toHaveValue("Partial answer");
});

test("saving is protected from duplicate requests and validation preserves edits", async ({ page }) => {
  const api = await adminFixture(page, { saveDelay: 500, wordError: true }); await page.goto("/admin");
  await page.getByRole("button", { name: /das Haus/ }).click();
  await page.getByRole("textbox", { name: "Meaning", exact: true }).fill("Keep this text");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save word", exact: true })).toBeDisabled();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toHaveValue("Keep this text");
  expect(api.requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
});

test("draft saving and publishing are separate and explicit", async ({ page }) => {
  const api = await adminFixture(page); await page.goto("/admin#reading");
  await page.getByRole("button", { name: /Ein neuer Kurs/ }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved. Learners cannot see this passage.", { exact: true })).toBeVisible();
  expect(api.savedPassages.at(-1).status).toBe("draft");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Publish this passage?" })).toBeVisible();
  await page.getByRole("button", { name: "Publish passage", exact: true }).click();
  await expect(page.getByText("Saved. This passage is available to learners.", { exact: true })).toBeVisible();
  expect(api.savedPassages.at(-1).status).toBe("published");
});

test("import has a named modal, keyboard dismissal, templates, and completion", async ({ page }) => {
  await adminFixture(page); await page.goto("/admin");
  const open = page.getByRole("button", { name: "Import words", exact: true });
  await open.click();
  await expect(page.getByRole("dialog", { name: "Import words", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download words.csv template" })).toBeVisible();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(open).toBeFocused();
  await open.click();
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "words.json", mimeType: "application/json", buffer: Buffer.from('[{"word":"Baum"}]') });
  await expect(page.getByText("Will create", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import 1 item", exact: true }).click();
  await expect(page.getByText("Import complete. 1 created, 0 updated.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(open).toBeFocused();
});

test("passage load failures keep the editor and offer a working retry", async ({ page }) => {
  await adminFixture(page, { detailErrorOnce: true }); await page.goto("/admin#reading");
  await page.getByRole("button", { name: /Ein neuer Kurs/ }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not load this passage. Try again.");
  await expect(page.getByRole("heading", { name: "New passage", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ein neuer Kurs", exact: true })).toBeVisible();
});

test("batch selection deletes only chosen words", async ({ page }) => {
  await adminFixture(page); await page.goto("/admin");
  await expect(page.getByRole("button", { name: /das Haus/ })).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select das Haus", exact: true }).check();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete words", exact: true }).click();
  await expect(page.getByRole("button", { name: /das Haus/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /lernen/ })).toBeVisible();
});

test("moderation exposes reasons and persists hide/restore history", async ({ page }) => {
  await adminFixture(page); await page.goto("/admin#dictation");
  await page.getByText("Report reasons and review history", { exact: true }).click();
  await expect(page.getByText("Not German: 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hide video", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore video", exact: true })).toBeFocused();
  await expect(page.getByText(/Hidden from learners ·/)).toBeVisible();
});

test("reading preview works on tablets and mobile without hiding the editor behind a long list", async ({ page }, testInfo) => {
  await adminFixture(page); await page.goto("/admin#reading");
  await page.getByRole("radio", { name: "Goethe", exact: true }).click();
  await page.getByRole("button", { name: /Information am Bahnhof/ }).click();
  await expect(page.locator(".admin-preview-text")).toContainText("Unser Deutschkurs beginnt");
  for (const width of [1440, 1024, 821, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 1180) await page.getByRole("radio", { name: "Preview", exact: true }).click();
    await expect(page.locator(".admin-preview-column")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reading-${width}.png`), fullPage: true });
    if (width <= 1180) await page.getByRole("radio", { name: "Editor", exact: true }).click();
  }
  await page.getByRole("button", { name: "Back to results", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search passages" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeHidden();
});

test("large libraries remain searchable beyond the first API page", async ({ page }) => {
  const api = await adminFixture(page, { wordCount: 1001 }); await page.goto("/admin");
  await expect(page.getByText("1001 of 1001", { exact: true })).toBeVisible();
  expect(api.requests.filter((r) => r.path === "/api/admin/words")).toHaveLength(6);
  await page.getByRole("searchbox", { name: "Search words" }).fill("Wort1000");
  await expect(page.getByRole("button", { name: /das Wort1000/ })).toBeVisible();
});

test("partial batch failures retry only the items that failed", async ({ page }) => {
  const api = await adminFixture(page, { failDelete: "lernen" }); await page.goto("/admin");
  await expect(page.getByRole("button", { name: /das Haus/ })).toBeVisible();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select results", exact: true }).click();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete words", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("1 completed; 1 could not be updated");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete words", exact: true }).click();
  await expect(page.getByRole("button", { name: /lernen/ })).toHaveCount(0);
  expect(api.requests.filter((r) => r.method === "DELETE" && r.path.endsWith("Haus"))).toHaveLength(1);
});

test("editor layouts, selected text, and dialogs work in both themes", async ({ page }, testInfo) => {
  await adminFixture(page); await page.goto("/admin");
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("tab", { name: "Vocabulary", exact: true }).click();
    await page.getByRole("button", { name: /das Haus/ }).click();
    const selectedContrast = await page.locator('#admin-section-words .list-card[data-selected="true"]').evaluate((element) => {
      const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
      const luminance = (color) => { const [r, g, b] = rgb(color); return .2126 * r + .7152 * g + .0722 * b; };
      const fg = luminance(getComputedStyle(element.querySelector(".list-card-meta")).color);
      const bg = luminance(getComputedStyle(element).backgroundColor);
      return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
    });
    expect(selectedContrast).toBeGreaterThanOrEqual(4.5);
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("textbox", { name: "Meaning", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`vocabulary-${theme}-${width}.png`), fullPage: true });
    }
    await page.getByRole("tab", { name: "Reading", exact: true }).click();
    const back = page.getByRole("button", { name: "Back to results", exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole("button", { name: /Ein neuer Kurs/ }).click();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`reading-editor-${theme}-mobile.png`), fullPage: true });
    await page.getByRole("tab", { name: "Dictation", exact: true }).click();
    await page.getByText("Report reasons and review history", { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`dictation-${theme}-mobile.png`), fullPage: true });
  }
  expect(runtimeErrors).toEqual([]);
});
