# Reading Exercises

Reading exercises power both general reading practice and Goethe-Institut style tasks.

## Data Model

Reading content is stored as `Stimulus` rows with related `Item` and `ItemOption` rows.

Main passage fields:

- `collection`: `general` or `goethe`
- `level`: `A1`, `A2`, `B1`, or `B2`
- `teil`: Goethe part, or `null` for general passages
- `kind`: usually `text`, with `ad` used for attached Goethe Teil 2 adverts
- `title`
- `body`
- `render_kind`
- `content`
- `image_path`
- `transcript`
- `status`: `draft` or `published`

## Exercise Groups

General:

- ordinary reading passages
- no Goethe part
- text-first rendering

Goethe:

- supports `teil_1` through `teil_5` depending on level
- `teil_2` uses two attached advert stimuli
- `teil_3` can render structured notices, signs, timetables, or uploaded images

## Render Kinds

Supported render kinds are validated in `app/schemas.py`:

- `text`
- `image`
- `website_box`
- `ad_box`
- `hours_table`
- `notice_sheet`
- `door_sign`
- `timetable`
- `pictogram_sign`

Image stimuli require both an uploaded image path and a faithful transcript.

## Public API

List groups:

```http
GET /api/story/groups
```

List levels:

```http
GET /api/story/levels?group=goethe
```

List Goethe parts:

```http
GET /api/story/parts?level=A2
```

List passages:

```http
GET /api/story/passages?group=goethe&level=A2&part=teil_3
```

Fetch one passage:

```http
GET /api/story/passages/{passage_id}
```

Submit an answer:

```http
POST /api/story/answer
```

## Seeding

Starter passages live in:

```text
data/story_passages.json
```

The import function is `import_story_passages` in `app/services/story.py`. It only seeds when the stimulus table is empty.

## Key Files

- `data/story_passages.json`
- `app/services/story.py`
- `app/schemas.py`
- `app/api/routes.py`
- `frontend/src/views/storyView.ts`
- `frontend/src/components/readingText.ts`
- `frontend/src/stimuli/templates.ts`
- `frontend/src/stimuli/uploads.ts`
