import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.stimuli import exercise_type_for_passage, stimulus_image_url
from app.db.models import (
    ReadingPassage,
)
from app.db.session import get_db
from app.schemas import (
    FocusCardOut,
    FocusLevelOut,
    FocusRevisionQuestionOut,
    FocusTopicAliasOut,
    FocusTopicOut,
    StoryAnswerChoiceOut,
    StoryAnswerIn,
    StoryAnswerOut,
    StoryGroupOut,
    StoryLevelOut,
    StoryOptionStimulusOut,
    StoryPartOut,
    StoryPassageOut,
    StoryQuestionOut,
)
from app.services.focus import (
    TOPIC_LABELS,
    get_focus_cards,
    get_focus_levels,
    get_focus_revision_questions,
    get_focus_topics,
)
from app.services.story import (
    get_all_story_passages,
    get_correct_story_answer,
    get_goethe_parts,
    get_story_answer,
    get_story_groups,
    get_story_levels,
    get_story_passage,
)

router = APIRouter(tags=["content"])
logger = logging.getLogger(__name__)


@router.get("/focus/levels", response_model=list[FocusLevelOut])
def focus_levels(db: Session = Depends(get_db)) -> list[FocusLevelOut]:
    return [FocusLevelOut(**level) for level in get_focus_levels(db)]


@router.get("/focus/topics", response_model=list[FocusTopicOut])
def focus_topics(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    db: Session = Depends(get_db),
) -> list[FocusTopicOut]:
    return [FocusTopicOut(**topic) for topic in get_focus_topics(db, level)]


@router.get("/focus/topic-aliases", response_model=list[FocusTopicAliasOut])
def focus_topic_aliases() -> list[FocusTopicAliasOut]:
    return [
        FocusTopicAliasOut(topic=topic, label=label)
        for topic, label in sorted(TOPIC_LABELS.items())
    ]


@router.get("/focus/cards", response_model=list[FocusCardOut])
def focus_cards(
    level: str | None = Query(default=None, pattern="^(A1|A2|B1|B2)$"),
    topic: str | None = Query(default=None, min_length=1, max_length=80),
    db: Session = Depends(get_db),
) -> list[FocusCardOut]:
    return [FocusCardOut(**card) for card in get_focus_cards(db, level, topic)]


@router.get("/focus/revision", response_model=list[FocusRevisionQuestionOut])
def focus_revision(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    topic: str = Query(min_length=1, max_length=80),
    db: Session = Depends(get_db),
) -> list[FocusRevisionQuestionOut]:
    return [
        FocusRevisionQuestionOut(**question)
        for question in get_focus_revision_questions(db, level, topic)
    ]


@router.get("/story/groups", response_model=list[StoryGroupOut])
def story_groups(db: Session = Depends(get_db)) -> list[StoryGroupOut]:
    return [StoryGroupOut(**group) for group in get_story_groups(db)]


@router.get("/story/levels", response_model=list[StoryLevelOut])
def story_levels(
    group: str = Query(default="general", pattern="^(general|goethe)$"),
    db: Session = Depends(get_db),
) -> list[StoryLevelOut]:
    return [StoryLevelOut(**level) for level in get_story_levels(db, group)]


@router.get("/story/parts", response_model=list[StoryPartOut])
def story_parts(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    db: Session = Depends(get_db),
) -> list[StoryPartOut]:
    return [StoryPartOut(**part) for part in get_goethe_parts(db, level)]


@router.get("/story/passages", response_model=list[StoryPassageOut])
def story_passages(
    group: str | None = Query(default=None, pattern="^(general|goethe)$"),
    level: str | None = Query(default=None, pattern="^(A1|A2|B1|B2)$"),
    part: str | None = Query(default=None, pattern="^teil_[1-5]$"),
    db: Session = Depends(get_db),
) -> list[StoryPassageOut]:
    return [
        _story_passage_out(passage) for passage in get_all_story_passages(db, level, group, part)
    ]


@router.get("/story/passages/{passage_id}", response_model=StoryPassageOut)
def story_passage(passage_id: str, db: Session = Depends(get_db)) -> StoryPassageOut:
    passage = get_story_passage(db, passage_id)
    if passage is None:
        raise HTTPException(status_code=404, detail="Story passage not found")
    return _story_passage_out(passage)


@router.post("/story/answer", response_model=StoryAnswerOut)
def story_answer(payload: StoryAnswerIn, db: Session = Depends(get_db)) -> StoryAnswerOut:
    selected = get_story_answer(db, payload.question_id, payload.answer_id)
    if selected is None:
        raise HTTPException(status_code=404, detail="Story answer not found")
    correct = get_correct_story_answer(db, payload.question_id)
    if correct is None:
        raise HTTPException(status_code=409, detail="Story question has no correct answer")
    return StoryAnswerOut(
        correct=selected.id == correct.id,
        correct_answer_id=correct.id,
        correct_answer_text=correct.answer_text,
        explanation=selected.question.explanation,
    )


def _story_passage_out(passage: ReadingPassage) -> StoryPassageOut:
    return StoryPassageOut(
        id=passage.id,
        group=passage.group,
        level=passage.level,
        part=passage.part,
        exercise_type=exercise_type_for_passage(passage),
        topic=passage.topic,
        title=passage.title,
        passage_text=passage.passage_text,
        image_url=stimulus_image_url(passage),
        render_kind=passage.render_kind,
        content=passage.content,
        image_path=passage.image_path,
        transcript=passage.transcript,
        context_label=passage.context_label,
        order_index=passage.order_index,
        questions=[
            StoryQuestionOut(
                id=question.id,
                prompt=question.prompt,
                order_index=question.order_index,
                answers=[
                    StoryAnswerChoiceOut(
                        id=answer.id,
                        answer_text=answer.answer_text,
                        order_index=answer.order_index,
                        ref_stimulus=(
                            StoryOptionStimulusOut(
                                id=answer.ref_stimulus.id,
                                title=answer.ref_stimulus.title,
                                body=answer.ref_stimulus.body,
                                context_label=answer.ref_stimulus.context_label,
                                render_kind=answer.ref_stimulus.render_kind,
                                content=answer.ref_stimulus.content,
                                image_path=answer.ref_stimulus.image_path,
                                image_url=stimulus_image_url(answer.ref_stimulus),
                                transcript=answer.ref_stimulus.transcript,
                            )
                            if answer.ref_stimulus
                            else None
                        ),
                    )
                    for answer in question.answers
                ],
            )
            for question in passage.questions
        ],
    )
