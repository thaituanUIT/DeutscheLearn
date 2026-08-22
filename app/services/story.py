import json
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import ReadingAnswer, ReadingPassage, ReadingQuestion
from app.services.focus import FOCUS_LEVELS

STORY_SEED_PATH = Path("data/story_passages.json")
STORY_GROUPS = ("general", "goethe")
GOETHE_PARTS_BY_LEVEL = {
    "A1": ("teil_1", "teil_2", "teil_3"),
    "A2": ("teil_1", "teil_2", "teil_3", "teil_4"),
    "B1": ("teil_1", "teil_2", "teil_3", "teil_4", "teil_5"),
    "B2": ("teil_1", "teil_2", "teil_3", "teil_4", "teil_5"),
}


def import_story_passages(db: Session, json_path: Path = STORY_SEED_PATH) -> None:
    if db.scalar(select(func.count(ReadingPassage.id))) or not json_path.exists():
        return

    passages = json.loads(json_path.read_text(encoding="utf-8"))
    for passage_data in passages:
        passage = ReadingPassage(
            group=passage_data.get("group", "general").strip().lower(),
            level=passage_data["level"].strip().upper(),
            part=_clean_part(passage_data.get("part")),
            exercise_type=_clean_optional_text(passage_data.get("exercise_type")),
            topic=_clean_optional_text(passage_data.get("topic")),
            title=passage_data["title"].strip(),
            passage_text=passage_data["passage_text"].strip(),
            content_json=_dump_optional_json(passage_data.get("content")),
            order_index=int(passage_data.get("order_index", 0)),
            questions=[
                ReadingQuestion(
                    prompt=question["prompt"].strip(),
                    explanation=_clean_optional_text(question.get("explanation")),
                    order_index=int(question.get("order_index", index)),
                    answers=[
                        ReadingAnswer(
                            answer_text=answer["answer_text"].strip(),
                            is_correct=bool(answer.get("is_correct", False)),
                            order_index=int(answer.get("order_index", answer_index)),
                        )
                        for answer_index, answer in enumerate(question.get("answers", []))
                    ],
                )
                for index, question in enumerate(passage_data.get("questions", []))
            ],
        )
        db.add(passage)
    db.commit()


def get_story_groups(db: Session) -> list[dict[str, int | str]]:
    counts = dict(
        db.execute(
            select(ReadingPassage.group, func.count(ReadingPassage.id))
            .group_by(ReadingPassage.group)
        ).all()
    )
    question_counts = dict(
        db.execute(
            select(ReadingPassage.group, func.count(ReadingQuestion.id))
            .join(ReadingQuestion, ReadingQuestion.passage_id == ReadingPassage.id)
            .group_by(ReadingPassage.group)
        ).all()
    )
    labels = {
        "general": "General",
        "goethe": "Goethe-Institut",
    }
    return [
        {
            "group": group,
            "label": labels[group],
            "passage_count": counts.get(group, 0),
            "question_count": question_counts.get(group, 0),
        }
        for group in STORY_GROUPS
    ]


def get_story_levels(db: Session, group: str = "general") -> list[dict[str, int | str]]:
    counts = dict(
        db.execute(
            select(ReadingPassage.level, func.count(ReadingPassage.id))
            .where(ReadingPassage.group == group)
            .group_by(ReadingPassage.level)
        ).all()
    )
    question_counts = dict(
        db.execute(
            select(ReadingPassage.level, func.count(ReadingQuestion.id))
            .join(ReadingQuestion, ReadingQuestion.passage_id == ReadingPassage.id)
            .where(ReadingPassage.group == group)
            .group_by(ReadingPassage.level)
        ).all()
    )
    return [
        {
            "level": level,
            "passage_count": counts.get(level, 0),
            "question_count": question_counts.get(level, 0),
        }
        for level in FOCUS_LEVELS
    ]


def get_goethe_parts(db: Session, level: str) -> list[dict[str, int | str]]:
    parts = GOETHE_PARTS_BY_LEVEL.get(level, ())
    counts = dict(
        db.execute(
            select(ReadingPassage.part, func.count(ReadingPassage.id))
            .where(ReadingPassage.group == "goethe", ReadingPassage.level == level)
            .group_by(ReadingPassage.part)
        ).all()
    )
    question_counts = dict(
        db.execute(
            select(ReadingPassage.part, func.count(ReadingQuestion.id))
            .join(ReadingQuestion, ReadingQuestion.passage_id == ReadingPassage.id)
            .where(ReadingPassage.group == "goethe", ReadingPassage.level == level)
            .group_by(ReadingPassage.part)
        ).all()
    )
    return [
        {
            "part": part,
            "label": part.replace("_", " ").title(),
            "passage_count": counts.get(part, 0),
            "question_count": question_counts.get(part, 0),
        }
        for part in parts
    ]


def get_story_passages(
    db: Session,
    level: str,
    group: str = "general",
    part: str | None = None,
) -> list[dict[str, int | str | None]]:
    question_counts = (
        select(ReadingQuestion.passage_id, func.count(ReadingQuestion.id).label("question_count"))
        .group_by(ReadingQuestion.passage_id)
        .subquery()
    )
    rows = db.execute(
        select(ReadingPassage, func.coalesce(question_counts.c.question_count, 0))
        .outerjoin(question_counts, question_counts.c.passage_id == ReadingPassage.id)
        .where(ReadingPassage.group == group, ReadingPassage.level == level)
        .where(ReadingPassage.part == part if part else ReadingPassage.part.is_(None))
        .order_by(ReadingPassage.order_index, ReadingPassage.title)
    ).all()
    return [
        {
            "id": passage.id,
            "group": passage.group,
            "level": passage.level,
            "part": passage.part,
            "exercise_type": passage.exercise_type,
            "topic": passage.topic,
            "title": passage.title,
            "order_index": passage.order_index,
            "question_count": question_count,
        }
        for passage, question_count in rows
    ]


def get_story_passage(db: Session, passage_id: str) -> ReadingPassage | None:
    return db.scalar(
        select(ReadingPassage)
        .options(selectinload(ReadingPassage.questions).selectinload(ReadingQuestion.answers))
        .where(ReadingPassage.id == passage_id)
    )


def get_story_answer(db: Session, question_id: str, answer_id: str) -> ReadingAnswer | None:
    return db.scalar(
        select(ReadingAnswer)
        .join(ReadingQuestion, ReadingQuestion.id == ReadingAnswer.question_id)
        .where(ReadingAnswer.question_id == question_id, ReadingAnswer.id == answer_id)
    )


def get_correct_story_answer(db: Session, question_id: str) -> ReadingAnswer | None:
    return db.scalar(
        select(ReadingAnswer)
        .where(ReadingAnswer.question_id == question_id, ReadingAnswer.is_correct.is_(True))
    )


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    return text or None


def _clean_part(value: str | None) -> str | None:
    if value is None:
        return None
    text = "_".join(value.strip().lower().split())
    return text or None


def _dump_optional_json(value: object) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)
