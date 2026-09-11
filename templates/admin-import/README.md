# Admin Import Templates

Use these files as blueprints for `/admin` imports.

## Vocabulary

- `words.csv`
- `words.json`

CSV supports vocabulary only. The `focus_entries` cell uses:

```text
LEVEL:topic_slug;LEVEL:topic_slug
```

Example:

```text
A1:travel_transport;A2:city_places
```

## Reading

- `reading-passages.json`

Reading imports should use JSON because passages contain nested questions, answers, render content, and Goethe advert stimuli.

## Import Behavior

- Preview validates every row before writing.
- Import creates missing records and updates existing records.
- Any row error blocks the commit for that file.
- Word imports match existing records by `word`.
- Reading imports match existing records by `id` when provided.
