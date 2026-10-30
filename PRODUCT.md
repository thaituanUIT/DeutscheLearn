# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-guided learners of German at different proficiency levels who want to practice grammar, vocabulary, reading, exam-style tasks, and listening.

## Product Purpose

DeutscheLearn helps German learners build skill through several kinds of active practice in one web app. Success means learners can choose a useful exercise, practice independently, and get support when they make mistakes.

## Positioning

The product combines practice modes with grammar help grounded in curated grammar notes and learner answer context. Its dictation mode lets learners practice with transcripts from captioned videos they choose or find in the shared video library.

## Operating Context

- Learners use the web app for flashcards, quiz and Goethe-style exercises, reading practice, grammar questions, and video dictation.
- Dictation uses YouTube videos with available captions. Learners can choose a cached library video or submit a video URL; fetched transcripts are stored for reuse.
- The app currently identifies learners anonymously with a cookie-based player identity.

## Capabilities and Constraints

- The frontend is a TypeScript single-page app built with Vite. The backend is FastAPI with SQLAlchemy; the repository configures Postgres for hosted use.
- Grammar assistance retrieves curated Markdown grammar notes and generates grounded answers with cited material. Wrong-answer context can be included to make help specific to the learner's mistake.
- The app supports flashcards, quiz modes, reading passages, Goethe-style exercises, and caption-based dictation.
- Anonymous access is a deliberate constraint for the current phase. Authentication is a future direction when the user base is large; no size threshold or transition date has been set.
- Grammar generation and transcript fetching depend on external services and are subject to their availability, quotas, and operating cost.

## Evidence on Hand

- Product and development overview: `README.md`.
- Feature and system documentation: `docs/`.
- Curated grammar content: `data/grammar/`.
- Application implementation: `frontend/src/` and `app/`.

## Product Principles

- Keep practice accessible without requiring an account during the current product phase.
- Support learners through active exercises across different skills and proficiency levels.
- Ground grammar help in the available learning material and the learner's answer context.
- Reuse stored video transcripts to avoid fetching the same caption data repeatedly.
