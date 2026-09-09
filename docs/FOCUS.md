# Focus Vocabulary

Focus vocabulary provides CEFR-level vocabulary cards and short revision questions grouped by topic.

## Data Source

The import source is:

```text
data/focus_words.csv
```

Expected columns:

- `word`
- `topic`
- `level`
- `article`
- `part_of_speech`
- `meaning`

The importer is `import_focus_words` in `app/services/focus.py`. It runs during startup when `SEED_ON_STARTUP=true`.

## Levels And Topics

Supported levels:

- `A1`
- `A2`
- `B1`
- `B2`

Topic slugs are mapped to labels in `TOPIC_LABELS`. Unknown topic slugs imported from CSV get title-cased fallback labels, but admin word editing validates against known topic labels.

## Public API

List available levels:

```http
GET /api/focus/levels
```

List topics for a level:

```http
GET /api/focus/topics?level=A1
```

List all topic aliases:

```http
GET /api/focus/topic-aliases
```

Fetch cards:

```http
GET /api/focus/cards?level=A1&topic=food_drink
```

Fetch revision questions:

```http
GET /api/focus/revision?level=A1&topic=food_drink
```

## Revision Questions

Revision questions sample up to five words from the selected level/topic. Each question asks for the word meaning and includes distractors sampled from the global meaning pool.

## Maintenance

After editing `data/focus_words.csv`, restart the app with seeding enabled or run the import path from a script/session. The importer adds missing words, topics, and focus entries. It does not delete rows that were removed from the CSV.

## Key Files

- `data/focus_words.csv`
- `app/services/focus.py`
- `app/api/routes.py`
- `frontend/src/views/focusView.ts`
