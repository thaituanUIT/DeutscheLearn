# Admin

Admin features manage vocabulary and reading exercise content. All admin routes require a bearer token.

## Configuration

Set:

```text
ADMIN_TOKEN=your-secret-token
```

Requests must include:

```text
Authorization: Bearer your-secret-token
```

`ADMIN_KEY` is accepted as a legacy fallback when `ADMIN_TOKEN` is not set.

## Word Management

Routes:

- `GET /api/admin/words`
- `POST /api/admin/words`
- `PATCH /api/admin/words/{word_key}`
- `DELETE /api/admin/words/{word_key}`

Words include:

- `word`
- `article`
- `part_of_speech`
- `meaning`
- `focus_entries`

Focus entries connect a word to a CEFR level and known topic slug. Duplicate level/topic entries are ignored during replacement.

## Reading Passage Management

Routes:

- `GET /api/admin/reading/passages`
- `POST /api/admin/reading/passages`
- `GET /api/admin/reading/passages/{passage_id}`
- `PATCH /api/admin/reading/passages/{passage_id}`
- `DELETE /api/admin/reading/passages/{passage_id}`

Validation rules:

- General passages are always plain text and do not keep Goethe-specific fields.
- Goethe `teil_2` must include exactly two advert stimuli.
- Goethe `teil_2` adverts must use `image`, `website_box`, or `ad_box`.
- Goethe `teil_3` validates structured render content.
- Each question must have exactly one correct answer.

## Stimulus Image Uploads

Route:

```http
POST /api/stimuli/{stimulus_id}/image-upload-url
```

Accepted content types:

- `image/jpeg`
- `image/png`
- `image/webp`

Maximum size is `2 MiB`.

The route creates a signed Supabase Storage upload URL for the `stimuli` bucket and stores an `Upload` row. Uploaded images are claimed when a passage references the generated path.

Required Supabase settings:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Key Files

- `app/api/routes.py`
- `app/schemas.py`
- `app/db/models.py`
- `frontend/src/views/adminView.ts`
