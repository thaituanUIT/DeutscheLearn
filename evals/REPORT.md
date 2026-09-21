# pgvector vs Qdrant Retrieval Benchmark

Generated: 2026-09-21T15:15:38+00:00

## Corpus

- Source: `dev/BasicGerman.pdf`
- Chunks: 240
- Grammar points: 233
- Mean chars: 1035.2
- Max chars: 3596

## R0

Exact-search equivalence: passed

## Retrieval Results

| Split | Backend | Config | Recall vs exact@5 | Hit@5 | MRR | p50 ms | p95 ms | Build s | Memory bytes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| dev | pgvector | R1-default-hnsw | 1.0 | 0.5333 | 0.3728 | 1.23 | 1.42 | 0.18 | 7389184 |
| dev | qdrant | R1-default-hnsw | 1.0 | 0.5333 | 0.3728 | 1.76 | 2.15 | 0.286 | 983040 |
| dev | pgvector | R2-ef-8 | 1.0 | 0.5333 | 0.3728 | 1.36 | 1.61 | 0.0 | 7389184 |
| dev | qdrant | R2-ef-8 | 1.0 | 0.5333 | 0.3728 | 1.71 | 2.1 | 0.0 | 983040 |
| dev | pgvector | R2-ef-16 | 1.0 | 0.5333 | 0.3728 | 1.36 | 1.76 | 0.0 | 7389184 |
| dev | qdrant | R2-ef-16 | 1.0 | 0.5333 | 0.3728 | 1.72 | 2.02 | 0.0 | 983040 |
| dev | pgvector | R2-ef-32 | 1.0 | 0.5333 | 0.3728 | 1.41 | 1.73 | 0.0 | 7389184 |
| dev | qdrant | R2-ef-32 | 1.0 | 0.5333 | 0.3728 | 1.8 | 2.06 | 0.0 | 983040 |
| dev | pgvector | R2-ef-64 | 1.0 | 0.5333 | 0.3728 | 1.37 | 1.74 | 0.0 | 7389184 |
| dev | qdrant | R2-ef-64 | 1.0 | 0.5333 | 0.3728 | 1.75 | 1.97 | 0.0 | 983040 |
| dev | pgvector | R2-ef-128 | 1.0 | 0.5333 | 0.3728 | 1.38 | 1.83 | 0.0 | 7389184 |
| dev | qdrant | R2-ef-128 | 1.0 | 0.5333 | 0.3728 | 1.75 | 2.0 | 0.0 | 983040 |
| dev | pgvector | R3-hybrid-rrf |  | 0.5333 | 0.3728 | 31.67 | 34.42 | 0.0 | 7389184 |
| dev | qdrant | R3-hybrid-rrf |  | 0.4667 | 0.2803 | 2.16 | 2.46 | 0.0 | 983040 |
| holdout | pgvector | R1-default-hnsw | 1.0 | 0.65 | 0.35 | 1.25 | 1.46 | 0.176 | 9011200 |
| holdout | qdrant | R1-default-hnsw | 1.0 | 0.65 | 0.35 | 1.71 | 1.88 | 0.27 | 983040 |

## Statistics

- Dev R1 McNemar p-value at Hit@5: 1.0
- Dev R1 paired bootstrap delta MRR (Qdrant - pgvector): {'observed': 0.0, 'ci95': [0.0, 0.0]}
- Hold-out R1 McNemar p-value at Hit@5: 1.0
- Hold-out R1 paired bootstrap delta MRR (Qdrant - pgvector): {'observed': 0.0, 'ci95': [0.0, 0.0]}

## Different Contexts

- Dev R1 different top-5 contexts: 0
- Hold-out R1 different top-5 contexts: 0

## Generation

For the preregistered R1 comparison, pgvector and Qdrant returned identical top-5 contexts on dev and hold-out. With context deduplication, backend-induced OpenRouter answer differences are therefore zero for this comparison. No OpenRouter generation calls or judge calls were needed for backend separation.

## Recommendation

R0 passed and R1 quality was identical on dev and hold-out: Hit@5, MRR, and recall-vs-exact all match exactly. pgvector was lower latency in this local benchmark; Qdrant used less reported vector memory. Recommendation: stay on pgvector unless there is an operations reason to add Qdrant.

## Limitations

- Golden questions are section-level labels, so they measure whether the right grammar point is retrieved, not whether the answer wording is pedagogically ideal.
- BasicGerman is a small single-PDF corpus; approximate-search differences are expected to be tiny once exact equivalence passes.
- Generation quality itself was not judged because the tested backends retrieved identical contexts for the final comparison.
- Total tracked spend: $0.00.
