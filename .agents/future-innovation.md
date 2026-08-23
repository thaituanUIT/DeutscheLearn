# Future Innovation Notes

## Stimulus Bulk Generation

LLM-assisted bulk generation for Goethe A1 Lesen Teil 2 and Teil 3 stimuli is intentionally
not enabled in the current app.

The template registry and schema-validated `stimulus.content` shape make future generation
possible, but there should be no exposed generation endpoint or admin UI until the product
needs it and an LLM provider, evaluation workflow, and human review process are selected.

If revived later:
- Generate only draft stimuli.
- Validate output against the template schema before insert.
- For Teil 2, generate the situation, both adverts, the correct answer, the matching
  keyword/line, and the distractor line together.
- Require human publish before learners can see generated content.
