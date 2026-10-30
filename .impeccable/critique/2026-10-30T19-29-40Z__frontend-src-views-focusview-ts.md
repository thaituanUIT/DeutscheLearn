---
target: Focus flashcard mode
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/thaituan_uit/Recognition/frontend/src/views/focusView.ts"
target_fingerprint: "sha256:9f96db445928b40d70fb5cdb5a8a6c8b7fba8e4f2633c04b382655860cf87541"
target_path: /home/thaituan_uit/Recognition/frontend/src/views/focusView.ts
timestamp: 2026-10-30T19-29-40Z
slug: frontend-src-views-focusview-ts
---
Method: dual-agent (A: `/root/focus_design_review` · B: `/root/focus_detector_review`)

## Design health score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3/4 | Loading, progress, errors, and completion are represented; rating effects aren’t explained. |
| 2 | Match system / real world | 3/4 | CEFR and vocabulary suit the task; “Hard/Good/Easy” lack review context. |
| 3 | User control and freedom | 3/4 | Back, previous/next, retry, and topic switching are available; ratings commit without undo. |
| 4 | Consistency and standards | 2/4 | English interface copy is mixed with German chooser labels. |
| 5 | Error prevention | 2/4 | Rating buttons don’t explain their scheduling consequences. |
| 6 | Recognition rather than recall | 1/4 | The card shows the meaning immediately, before the learner can recall it. |
| 7 | Flexibility and efficiency | 3/4 | Number-key ratings and previous/next controls help frequent use; shortcuts aren’t well introduced. |
| 8 | Aesthetic and minimalist design | 2/4 | Chooser grids and four saturated rating colors conflict with the documented open-row, restrained palette. |
| 9 | Error recovery | 3/4 | Loading failures have a retry path, though raw technical errors may appear. |
| 10 | Help and documentation | 1/4 | There’s no contextual explanation of the ratings or the Quiz action. |
| **Total** |  | **23/40 — Acceptable** | The core recall and self-rating interaction needs the most attention. |

## Design specificity verdict

**Design review:** Moderately specific. CEFR levels, topics, German articles and parts of speech, review ratings, and keyboard shortcuts suit DeutscheLearn. But the card reveals the word and meaning together, weakening the recall exercise; parts of the layout could still belong to a generic flashcard app.

**Deterministic scan:** No findings. The detector returned an empty result for `focusView.ts`; no false positives to assess.

**Visual overlays:** None. Browser automation was unavailable, so I couldn’t inspect a live render or inject the overlay. Layout observations are based on source and the design system.

## Overall impression

The mode has useful organization and navigation, but its central interaction asks learners to self-grade without first attempting recall or understanding how ratings affect future reviews.

## What’s working

- CEFR levels and topics help learners narrow the vocabulary deck.
- Progress, keyboard shortcuts, previous/next controls, and a completion state support repeated practice.
- Loading errors offer retry, and shared navigation gives learners a clear way back.

## Cognitive load and emotional journey

- Level choice has four options; topic choice has 5–7 options for A1–B1 and two for B2. Counts help compare options, but the topic list lacks obvious ordering by visible label.
- The card screen combines the word, part of speech, meaning, progress, Quiz, four ratings, and navigation controls. Showing the meaning removes the recall step, while the rating choices ask learners to judge familiarity without explaining the scheduling result.
- Progress and completion reassure, but the rating moment is under-supported: learners may not know what their choice changed or when a word will return.

## Priority issues

1. **[P1] The card reveals the answer before recall.** It displays the word, part of speech, and meaning together, and there’s no reveal step. This undermines the active-recall purpose of flashcards. **Fix:** show the meaning only after the learner explicitly reveals it, with a keyboard-accessible reveal action. **Suggested command:** `$impeccable shape`.

2. **[P1] Rating choices have unexplained consequences.** The ratings schedule a card for 0, 1, 3, or 7 days and advance immediately, but learners aren’t told what those choices mean. **Fix:** add concise guidance near the controls, including when the card will return; provide a way to undo the latest rating. **Suggested command:** `$impeccable clarify`.

3. **[P2] The chooser layout conflicts with the documented pattern.** Level and topic choices use grids, while the design system calls for open, stacked rows on focus screens. **Fix:** present the choices as open rows with clear selected states and counts. **Suggested command:** `$impeccable layout`.

4. **[P2] Four saturated rating colors compete for attention.** Red, gold, teal, and blue make every choice equally prominent, contrary to the design system’s restrained color use. **Fix:** make the ratings quiet and consistent, reserving the primary color for the leading action. **Suggested command:** `$impeccable quieter`.

5. **[P2] Chooser labels switch languages.** German labels such as “Umfang” and “Status” appear within otherwise English copy, and “Status” doesn’t clarify what a count represents. **Fix:** use consistent language and explicit labels such as “Words” and “Topics.” **Suggested command:** `$impeccable clarify`.

## Persona red flags

- **Jordan (first-timer):** “Hard” and “Easy” are unexplained as review ratings, and “Quiz” doesn’t describe its five-question format.
- **Sam (keyboard/screen-reader user):** Card content changes in place without a clear announcement of the new word; shortcut instructions are easy to miss.
- **Casey (mobile user):** The four rating buttons remain in one row below 820px and may feel crowded on narrow phones; interruption recovery isn’t visible.

## Minor observations

- Empty levels are disabled and explain that content is unavailable.
- The German “Umfang” label describes a count, but the word it counts isn’t explicit.
- The Back control changes destination as learners move through the flow, but doesn’t state where it leads.

## Questions to consider

- Should learners attempt recall before revealing the word, then rate it?
- Should “Again” show the word again immediately, or schedule it for the next review session?
