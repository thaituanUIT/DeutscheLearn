---
target: current UX (whole app)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/home/thaituan_uit/Recognition/frontend/src/main.ts"
target_fingerprint: "sha256:af4ed4aee8b360e62cd3c0aaf55246c028cf3f975cb1e55646a5b6aba0009ebb"
target_path: /home/thaituan_uit/Recognition/frontend/src/main.ts
timestamp: 2026-10-30T06-04-55Z
slug: frontend-src-main-ts
---
Method: dual-agent (A: /root/critique_review · B: /root/critique_evidence)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | Some flows show progress; errors and loading states lack consistent recovery or announcement. |
| 2 | Match System / Real World | 3/4 | Mostly plain language, but English UI mixes in terms such as “Hörtippen,” “Teil,” and “Übung.” |
| 3 | User Control and Freedom | 3/4 | Back navigation exists; timed-run exit behavior and flashcard completion are unclear. |
| 4 | Consistency and Standards | 2/4 | Core controls are shared, but terminology and feedback behavior vary by mode. |
| 5 | Error Prevention | 3/4 | Story answers and in-flight quiz choices have useful guardrails. |
| 6 | Recognition Rather Than Recall | 3/4 | Actions and progress are visible, though the current level/topic can be easy to lose in nested flows. |
| 7 | Flexibility and Efficiency | 2/4 | Flashcards have a few shortcuts; other practice modes are largely one-at-a-time. |
| 8 | Aesthetic and Minimalist Design | 3/4 | The interface is restrained, but the home screen combines six mode choices with metrics and sidebar content. |
| 9 | Error Recovery | 2/4 | Some local errors are clear; focus/story load failures can leave “Loading…” content without a retry action. |
| 10 | Help and Documentation | 2/4 | Contextual grammar help is useful, but there is little task-level guidance across the app. |
| **Total** |  | **25/40** | **Acceptable** |

## Design Specificity Verdict

The learning structure and behavior are product-specific: mistake-aware grammar help, Goethe-style exercises, level/topic flashcards, and caption-based dictation. Most of the visual structure remains familiar dashboard and practice patterns rather than a distinctive “workshop.” The home’s open rows and restrained palette do align with the documented **Language Workshop** direction.

The detector reported one warning: a “side-tab accent border” on the dictation score panel at `frontend/src/styles/views/dictation.css:74`. That accent edge is part of score feedback, so it may be useful as a status cue; it is also a candidate for simplification given the preference for restrained color. The detector exited with status 2, indicating a finding.

## Overall Impression

The app makes several forms of German practice accessible without an account and gives learners useful feedback when they make mistakes. The main opportunities are at transitions: leaving a timed run, finishing the last flashcard, and recovering from failed content loads. Those moments currently feel less deliberate than the core exercise flows.

## What's Working

- Practice mode explains how it differs from timed and endless runs before the learner starts.
- The grammar assistant receives passage or wrong-answer context, supporting focused explanations rather than generic grammar answers.
- Story submission is disabled until all answers are selected, and dictation provides replay, checking, transcript reveal, and line progress.

## Priority Issues

1. **[P1] Leaving a timed run does not stop its timer.** `appView` routes Back to the home screen, while `quizView`’s interval continues and can finish the attempt in the detached view. This can produce surprising run state. Stop the timer on route departure and define whether Back pauses, abandons, or confirms ending the run. Suggested command: `$impeccable harden`.

2. **[P2] Six equal mode choices compete on the home screen.** `homeView` presents six peer rows; the home layout also includes mode metrics, word-of-the-day, and leaderboard content. A first-time learner has no clear starting recommendation. Group by learner intent or make a suggested starting mode easier to identify. Suggested command: `$impeccable distill`.

3. **[P2] The final flashcard has no completion state.** Rating the last card records it, but does not advance or show a finished state; “Next” remains disabled. Show deck completion and offer a clear next action such as restarting, reviewing, or leaving the deck. Suggested command: `$impeccable clarify`.

4. **[P2] Focus and story load errors have weak recovery.** Failures are routed to a general error banner while the selection area can remain on “Loading…” without a nearby Retry action. Keep the selected level/topic visible, show the error at the failing task, and let the learner retry. Suggested command: `$impeccable harden`.

## Persona Red Flags

- **Jordan, first-time learner:** Six equally weighted modes make the first choice harder. English explanations alongside “Hörtippen” and Goethe labels such as “Teil” may leave Jordan unsure what to choose.
- **Sam, keyboard or screen-reader user:** Many actions use semantic buttons, but mode links replace their accessible names with action-only labels. Some app errors and quiz feedback lack live-region announcements, so changes may not be announced.
- **Alex, power user:** Flashcards offer rating shortcuts, but most other practice modes have no visible accelerators and remain linear.

## Cognitive Load

Four checklist items are weak on the home and nested selection flows:

- **Single focus:** Mode selection competes with metrics and sidebar content.
- **Chunking:** The six modes appear as one flat group.
- **Minimal choices:** The home decision point has six choices; the dictation library has a runtime-dependent number of videos.
- **Working memory:** In nested focus/story flows, selected level or topic is not always prominent as the learner moves forward.

Other dynamic lists may also exceed four options depending on the content loaded.

## Minor Observations

- The home’s “01 — ÜBERSICHT” label is CSS-generated rather than a semantic heading.
- The global error banner appends new errors without clearing older ones.
- The dictation status area uses `aria-live="polite"`; equivalent feedback is less consistent elsewhere.
- The detector’s score-panel border finding is low priority because the border communicates feedback state, though the extra accent may be unnecessary.

## Questions to Consider

- Should the home screen recommend a mode based on learner intent or progress, or keep all six modes equally prominent?
- When a learner leaves a timed run, should it pause, end immediately, or ask for confirmation?
- After a flashcard deck ends, should the next action be review, restart, or return to mode selection?
