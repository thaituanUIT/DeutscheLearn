# Documentation

This folder documents the main DeutscheLearn feature areas and the operational paths that support them.

## Feature Docs

- [API](API.md): backend structure, public endpoints, admin authentication, and error behavior.
- [Quiz](QUIZ.md): endless, practice, timed modes, leaderboard behavior, and question generation.
- [Focus Vocabulary](FOCUS.md): CEFR/topic vocabulary cards, revision questions, and CSV import.
- [Reading Exercises](READING.md): general reading passages, Goethe-style exercises, rendered stimuli, and answers.
- [Admin](ADMIN.md): word management, reading passage management, image uploads, and content validation.
- [Data And Deployment](DATA_AND_DEPLOYMENT.md): local setup, seeding, migrations, production settings, and CI/deploy notes.
- [RAG](RAG.md): grammar assistant retrieval, Cohere embedding ingestion, hybrid ranking, and evaluation.

## Quick Commands

```bash
uv sync --locked
npm install --prefix frontend
uv run pytest
npm run build --prefix frontend
```

Run the API locally:

```bash
uv run uvicorn app.main:app --reload
```

Run the frontend locally:

```bash
npm run dev --prefix frontend
```
