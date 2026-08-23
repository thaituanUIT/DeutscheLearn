import json
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Item, ItemOption, Stimulus
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
    if db.scalar(select(func.count(Stimulus.id))) or not json_path.exists():
        return

    passages = json.loads(json_path.read_text(encoding="utf-8"))
    for passage_data in passages:
        ad_stimuli = [
            _seed_ad_stimulus(passage_data, ad, index)
            for index, ad in enumerate(passage_data.get("ad_stimuli", []))
        ]
        passage = Stimulus(
            collection=passage_data.get("group", "general").strip().lower(),
            level=passage_data["level"].strip().upper(),
            teil=_clean_part(passage_data.get("part")),
            kind=passage_data.get("kind", "text").strip().lower(),
            title=passage_data["title"].strip(),
            body=passage_data["passage_text"].strip(),
            image_url=_clean_optional_text(passage_data.get("image_url")),
            context_label=_clean_optional_text(passage_data.get("context_label")),
            sort_order=int(passage_data.get("order_index", 0)),
            items=[
                _seed_item(
                    prompt=question["prompt"].strip(),
                    explanation=_clean_optional_text(question.get("explanation")),
                    sort_order=int(question.get("order_index", index)),
                    answers=question.get("answers", []),
                    ad_stimuli=ad_stimuli if index == 0 else [],
                )
                for index, question in enumerate(passage_data.get("questions", []))
            ],
        )
        db.add(passage)
    db.commit()


def get_story_groups(db: Session) -> list[dict[str, int | str]]:
    counts = dict(
        db.execute(
            select(Stimulus.collection, func.count(Stimulus.id))
            .where(Stimulus.kind != "ad", Stimulus.status == "published")
            .group_by(Stimulus.collection)
        ).all()
    )
    question_counts = dict(
        db.execute(
            select(Stimulus.collection, func.count(Item.id))
            .join(Item, Item.stimulus_id == Stimulus.id)
            .where(Stimulus.kind != "ad", Stimulus.status == "published")
            .group_by(Stimulus.collection)
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
            select(Stimulus.level, func.count(Stimulus.id))
            .where(Stimulus.collection == group, Stimulus.kind != "ad")
            .where(Stimulus.status == "published")
            .group_by(Stimulus.level)
        ).all()
    )
    question_counts = dict(
        db.execute(
            select(Stimulus.level, func.count(Item.id))
            .join(Item, Item.stimulus_id == Stimulus.id)
            .where(Stimulus.collection == group, Stimulus.kind != "ad")
            .where(Stimulus.status == "published")
            .group_by(Stimulus.level)
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
            select(Stimulus.teil, func.count(Stimulus.id))
            .where(Stimulus.collection == "goethe", Stimulus.level == level, Stimulus.kind != "ad")
            .where(Stimulus.status == "published")
            .group_by(Stimulus.teil)
        ).all()
    )
    question_counts = dict(
        db.execute(
            select(Stimulus.teil, func.count(Item.id))
            .join(Item, Item.stimulus_id == Stimulus.id)
            .where(Stimulus.collection == "goethe", Stimulus.level == level, Stimulus.kind != "ad")
            .where(Stimulus.status == "published")
            .group_by(Stimulus.teil)
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
        select(Item.stimulus_id, func.count(Item.id).label("question_count"))
        .group_by(Item.stimulus_id)
        .subquery()
    )
    rows = db.execute(
        select(Stimulus, func.coalesce(question_counts.c.question_count, 0))
        .outerjoin(question_counts, question_counts.c.stimulus_id == Stimulus.id)
        .where(Stimulus.collection == group, Stimulus.level == level, Stimulus.kind != "ad")
        .where(Stimulus.status == "published")
        .where(Stimulus.teil == part if part else Stimulus.teil.is_(None))
        .order_by(Stimulus.sort_order, Stimulus.title)
    ).all()
    return [
        {
            "id": passage.id,
            "group": passage.group,
            "level": passage.level,
            "part": passage.part,
            "exercise_type": _exercise_type(passage),
            "topic": passage.topic,
            "title": passage.title,
            "order_index": passage.order_index,
            "question_count": question_count,
        }
        for passage, question_count in rows
    ]


def get_story_passage(db: Session, passage_id: str) -> Stimulus | None:
    return db.scalar(
        select(Stimulus)
        .options(selectinload(Stimulus.items).selectinload(Item.options).selectinload(ItemOption.ref_stimulus))
        .where(Stimulus.id == passage_id, Stimulus.status == "published")
    )


def get_story_answer(db: Session, question_id: str, answer_id: str) -> ItemOption | None:
    return db.scalar(
        select(ItemOption)
        .join(Item, Item.id == ItemOption.item_id)
        .where(ItemOption.item_id == question_id, ItemOption.id == answer_id)
    )


def get_correct_story_answer(db: Session, question_id: str) -> ItemOption | None:
    return db.scalar(
        select(ItemOption)
        .join(Item, Item.correct_option_id == ItemOption.id)
        .where(Item.id == question_id)
    )


def _seed_item(
    *,
    prompt: str,
    explanation: str | None,
    sort_order: int,
    answers: list[dict],
    ad_stimuli: list[Stimulus] | None = None,
) -> Item:
    item = Item(
        prompt=prompt,
        explanation=explanation,
        answer_type="choice" if ad_stimuli else ("true_false" if _looks_true_false(answers) else "choice"),
        sort_order=sort_order,
    )
    correct_option = None
    for answer_index, answer in enumerate(answers):
        ref_stimulus = ad_stimuli[answer_index] if ad_stimuli and answer_index < len(ad_stimuli) else None
        option = ItemOption(
            key=str(answer.get("key") or answer_index),
            label=answer["answer_text"].strip(),
            ref_stimulus=ref_stimulus,
            sort_order=int(answer.get("order_index", answer_index)),
        )
        item.options.append(option)
        if bool(answer.get("is_correct", False)):
            correct_option = option
    item.correct_option = correct_option
    return item


def _seed_ad_stimulus(passage_data: dict, ad: dict, sort_order: int) -> Stimulus:
    key = str(ad.get("key") or ("a" if sort_order == 0 else "b")).strip()
    title = str(ad["title"]).strip()
    return Stimulus(
        collection="goethe",
        level=passage_data["level"].strip().upper(),
        teil=_clean_part(passage_data.get("part")),
        kind="ad",
        title=f"{key}) {title}",
        body=str(ad["body"]).strip(),
        context_label=_clean_optional_text(ad.get("context_label")),
        sort_order=sort_order,
    )


def _looks_true_false(answers: list[dict]) -> bool:
    labels = {str(answer.get("answer_text", "")).casefold() for answer in answers}
    return labels <= {"richtig", "falsch", "true", "false"} and len(labels) == 2


def _exercise_type(stimulus: Stimulus) -> str | None:
    if stimulus.collection != "goethe":
        return None
    if stimulus.teil == "teil_2":
        return "source_choice"
    if stimulus.kind == "sign" or stimulus.teil == "teil_3":
        return "true_false_notice"
    return "standard"


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
