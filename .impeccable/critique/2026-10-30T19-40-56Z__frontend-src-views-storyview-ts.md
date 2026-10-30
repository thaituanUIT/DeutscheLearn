---
target: Story mode
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/thaituan_uit/Recognition/frontend/src/views/storyView.ts"
target_fingerprint: "sha256:2279073580f56c2312a041bf07910dce4efb03e5f6560b02f535fe743cd180b3"
target_path: /home/thaituan_uit/Recognition/frontend/src/views/storyView.ts
timestamp: 2026-10-30T19-40-56Z
slug: frontend-src-views-storyview-ts
---
Method: dual-agent (A: /root/story_design_review · B: /root/story_detector_review)

Story mode has a calm reading foundation, but answering interrupts the reading flow. This is a source-based assessment; rendered layout, contrast, and mobile behavior remain unverified.

**Design health: 22/40 — Acceptable**

| Heuristic | Score | Key issue |
|---|---:|---|
| System status | 2/4 | Counts exist; changes/results lack announcements. |
| Match with real world | 3/4 | “Topic” actually asks General versus Goethe. |
| User control | 2/4 | Back/retry exist; drafts cannot resume. |
| Consistency | 2/4 | Legacy grids conflict with shared row styling. |
| Error prevention | 2/4 | Answers remain editable during submission. |
| Recognition | 3/4 | Passage and questions visible; selection is visual only. |
| Efficiency | 1/4 | Each selection recreates the reader. |
| Minimalist design | 2/4 | Calm typography; oversized chooser options. |
| Error recovery | 3/4 | Retry exists; leaving loses the draft. |
| Help | 2/4 | Review explanations exist; task guidance is sparse. |

**Design specificity and overall impression**

CEFR levels, German prose, exam formats, and restrained typography fit DeutscheLearn’s workshop identity. The strongest opportunity is preserving learners’ place as they move between reading and answering. The detector reported zero findings; it does not assess these interaction problems.

**What works**

- Prose uses 18px text, 1.7 line height, and paragraph spacing.
- Review includes score, correct answers, and explanations beyond color alone.
- Load failures provide an alert and retry with context.

**Priority issues**

1. **P1 — Answering resets reading position and keyboard focus.** `storyView.ts:302` calls the full renderer; `:358` replaces both passage and questions. New scrolling containers lose their previous positions, and the focused button is removed. Update selections/counts in place, use native radio groups, and announce results. Suggested command: `$impeccable harden`.
2. **P1 — Choices can change while answers are being graded.** Only Submit is disabled at `storyView.ts:335`; answer controls stay active until results exist (`:301`). Another choice recreates an enabled Submit button and can leave displayed selections different from the submitted snapshot. Add explicit submitting state, snapshot selections, lock edits/duplicate submissions, and preserve answers on failure. Suggested command: `$impeccable harden`.
3. **P2 — Interruptions discard the exercise, while opening already counts as read.** `storyView.ts:224` records read progress on open; `:229` initializes an empty session on each visit. Review offers only Try again (`:326`). Save drafts per passage, distinguish opened/completed state, and offer a next reading action. Suggested command: `$impeccable harden`.
4. **P2 — Mobile separates the passage from all its questions.** `story.css:263` stacks the complete passage before the questionnaire. Referencing text requires long trips up and down; desktop also hides both scrollbars (`:97`, `:171`). Add a passage/questions switch preserving each position or an accessible passage reference, and show desktop scroll affordances. Validate at phone widths and zoom. Suggested command: `$impeccable adapt`.
5. **P2 — Choosers mix incompatible layout patterns.** `focus.css:16` retains two-column groups and five-column parts, while choices now use horizontal flex rows; `story.css:6` and `:40` retain 178/190px heights. Use full-width rows with grouped name/description and separate counts, remove old heights/grid overrides, and rename “Choose a reading topic” to reflect reading versus exam practice. Suggested command: `$impeccable layout`.

**Cognitive load and emotional journey**

Individual answer groups are manageable. Orientation creates the avoidable load: full rerenders, mobile reference travel, and weak continuity. Checklist concerns are single focus, working-memory support, and progressive disclosure. Five Goethe parts are a familiar named set, not sufficient evidence of overload alone. Selection starts clearly, reading feels calm, answering disrupts confidence, explanations help, and the ending lacks a forward action.

**Persona red flags**

- Sam, keyboard/screen-reader learner: removed focus, no radio/pressed selection semantics, and German content inherits English language.
- Casey, interrupted mobile learner: no draft resume and distant passage reference.
- Jordan, first-time learner: “topic” mismatch and no concise instruction that all questions are required.

**Minor observations**

Add `lang="de"` to German content. Zero-question passages are disabled in the list despite an implemented read-only state. Correct answers repeat even after successful responses.

**Questions to consider**

- Should mobile prioritize continuous reading or quick question/reference switching?
- Should progress represent opening, submitting, or completing review?
