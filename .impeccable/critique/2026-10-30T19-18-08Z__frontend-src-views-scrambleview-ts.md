---
target: Scramble mode
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/thaituan_uit/Recognition/frontend/src/views/scrambleView.ts"
target_fingerprint: "sha256:c11ae35183eb8760835a345a5b085a9683416546ce3683cefec2a91ed9fc582d"
target_path: /home/thaituan_uit/Recognition/frontend/src/views/scrambleView.ts
timestamp: 2026-10-30T19-18-08Z
slug: frontend-src-views-scrambleview-ts
---
## Scramble mode critique

**Method: dual-agent (A: `/root/scramble_design_review` · B: `/root/scramble_detector_review`)**

### Design health score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3/4 | Round position, score, and answer feedback are visible. |
| 2 | Match system / real world | 4/4 | Meaning-to-spelling and article reconstruction fit German vocabulary practice. |
| 3 | User control and freedom | 3/4 | Clear, Skip, and Back exist; Skip is immediate. |
| 4 | Consistency and standards | 3/4 | It uses the app’s shared visual language, with a new puzzle interaction. |
| 5 | Error prevention | 3/4 | Check stays disabled until every tile is placed; Skip can be accidental. |
| 6 | Recognition rather than recall | 3/4 | Meaning and tiles stay visible, but duplicate letters have identical accessible names. |
| 7 | Flexibility and efficiency | 2/4 | One tile at a time; no keyboard accelerators. |
| 8 | Aesthetic and minimalist design | 4/4 | The screen is restrained and focused. |
| 9 | Error recovery | 3/4 | Clear and retry help, but repeated misses don’t reveal the answer. |
| 10 | Help and documentation | 2/4 | The inline instruction is brief; there’s no contextual help beyond it. |
| **Total** |  | **30/40 — Good** | Strong foundation; accessibility and learning feedback need work. |

### Design specificity verdict

**LLM assessment:** Moderate. German meanings, article-plus-word reconstruction, CEFR/topic context, and German success feedback tie the exercise to DeutscheLearn. The tile interaction and visual treatment could still be reused unchanged in a generic word puzzle; it has limited character from the product’s “Language Workshop” identity.

**Deterministic scan:** No findings. The detector returned an empty result for `scrambleView.ts`; the CSS file was not scanned because the CLI accepts markup files or directories. No false positives to assess.

**Visual overlays:** None. Browser automation was unavailable, so I could not inspect a live render or inject the overlay.

### Overall impression

The core exercise is understandable and visually focused. The main opportunity is to make every interaction work predictably for keyboard and screen-reader users, while ensuring wrong answers teach rather than merely delay completion.

### What’s working

- Level selection shows vocabulary counts and the start action is explicit.
- The round gives useful orientation with topic, level, word count, score, and live feedback.
- Shared buttons, visible focus styling, reduced-motion handling, and generously sized mobile tiles provide a solid accessibility baseline.

### Priority issues

1. **[P2] Narrow screens may overflow on long compounds.** Each answer word is an unbreakable inline group of fixed-width slots. At mobile widths, a long German compound may exceed the available width. **Fix:** allow the slots to wrap or make the answer area horizontally scrollable, then check realistic long words at phone widths. **Suggested command:** `$impeccable adapt`.

2. **[P2] Tile edits can move keyboard focus unexpectedly.** Each placement or removal rebuilds the exercise and focuses the first available bank tile, regardless of which control had focus. This can disorient keyboard and screen-reader users. **Fix:** preserve focus by tile/slot identity; after removal, focus the returned tile, and after a completed answer, focus “Check word.” **Suggested command:** `$impeccable audit`.

3. **[P2] Repeated misses and Skip don’t reveal the answer.** Feedback asks learners to check the article and spelling, but the round only reports a correct-count score. Learners can brute-force, but they may leave without learning the word. **Fix:** after a bounded number of attempts or on Skip, show the correct article and word before advancing. **Suggested command:** `$impeccable clarify`.

4. **[P2] Empty slots and duplicate tiles are unclear to assistive technology.** Empty positions are labeled spans outside the tab order, and identical letters all use the same “Add letter X” name. **Fix:** expose the current answer pattern and slot positions as meaningful text, and give duplicate tiles distinguishing position or occurrence labels. **Suggested command:** `$impeccable audit`.

### Persona red flags

- **Alex (power user):** Every letter requires a separate tile action and there are no keyboard accelerators, slowing repeated rounds.
- **Sam (accessibility-dependent):** Blank answer positions cannot be reached by Tab; duplicate tile names are indistinguishable; rerenders move focus.
- **Casey (distracted mobile user):** Long compounds may overflow narrow screens, and progress is held in memory, so a refresh or interruption loses the round.

### Minor observations

- Skip advances immediately, with no confirmation and no answer reveal.
- The desktop answer layout has not been visually checked at small widths or with long vocabulary entries.

### Questions to consider

- Should a skipped or repeatedly missed word reveal its correct spelling before the next prompt?
- Is one-tile-at-a-time play intentional, or should keyboard entry be supported too?
