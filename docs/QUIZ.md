# Quiz

The quiz feature provides three vocabulary modes backed by `QuizAttempt` and `QuizAttemptQuestion` rows.

## Modes

Endless:

- starts with `POST /api/quiz/endless/start`
- continues while the learner answers correctly
- finishes on the first wrong answer
- updates `best_endless_score` when finished

Practice:

- starts with `POST /api/quiz/practice/start`
- never ends automatically
- returns a new question after every answer
- tracks score and total answered questions

Timed:

- starts with `POST /api/quiz/timed/start`
- lasts `60` seconds
- returns `seconds_remaining` with every answer
- finishes when time expires

## Question Generation

Question generation lives in `app/services/quiz.py`.

Supported question types:

- `article`: asks for `der`, `die`, or `das`; only uses nouns with an article.
- `word_type`: asks whether a word is a noun, verb, adjective, or adverb.

The picker avoids repeating word/type pairs already seen by the player when possible. If the pool is exhausted, it falls back to unused pairs in the current attempt, then to the full valid pool.

## Answer Validation

Answer endpoints require:

- `attempt_id`
- `question_id`
- `selected_answer`

The selected answer must be one of the choices generated for that question. Previously answered questions return `409`.

## Leaderboard

`GET /api/leaderboard` supports:

- `mode=endless`
- `mode=timed`
- `limit=1..100`

Only finished attempts with score greater than zero are ranked. Each player contributes only their best attempt per mode. Ranking sorts by score descending, accuracy descending, then earliest end time.

## Key Files

- `app/api/routes.py`
- `app/services/quiz.py`
- `app/services/words.py`
- `app/db/models.py`
- `frontend/src/views/quizView.ts`
- `frontend/src/views/leaderboardView.ts`
