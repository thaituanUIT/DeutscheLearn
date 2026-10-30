import hashlib
import hmac
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from requests.exceptions import RequestException, RetryError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.security import has_admin_bearer
from app.core.config import get_settings
from app.db.models import DictationFetchCounter, DictationVideo, DictationVideoReport
from app.db.session import get_db
from app.schemas import (
    DictationSegmentOut,
    DictationTranscriptIn,
    DictationTranscriptOut,
    DictationVideoModerationIn,
    DictationVideoModerationOut,
    DictationVideoReportIn,
    DictationVideoSummaryOut,
)

router = APIRouter(tags=["dictation"])
logger = logging.getLogger(__name__)


@router.get("/dictation/videos", response_model=list[DictationVideoSummaryOut])
def list_dictation_videos(
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[DictationVideoSummaryOut]:
    videos = db.scalars(
        select(DictationVideo)
        .where(DictationVideo.is_hidden.is_(False))
        .order_by(DictationVideo.created_at.desc(), DictationVideo.video_id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        DictationVideoSummaryOut.model_validate(video, from_attributes=True) for video in videos
    ]


@router.get("/dictation/videos/{video_id}", response_model=DictationTranscriptOut)
def get_dictation_video(video_id: str, db: Session = Depends(get_db)) -> DictationTranscriptOut:
    video = db.get(DictationVideo, video_id)
    if video is None or video.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved video not found.")
    return dictation_transcript_out(video, cache_hit=True)


@router.post("/dictation/transcript", response_model=DictationTranscriptOut)
def dictation_transcript(
    payload: DictationTranscriptIn,
    request: Request,
    db: Session = Depends(get_db),
) -> DictationTranscriptOut:
    video_id = youtube_video_id(payload.video_url)
    cached_video = db.get(DictationVideo, video_id)
    if cached_video is not None:
        if cached_video.is_hidden:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="This video is unavailable in the shared library.",
            )
        return dictation_transcript_out(cached_video, cache_hit=True)

    settings = get_settings()
    saved_video_count = db.scalar(select(func.count()).select_from(DictationVideo)) or 0
    if saved_video_count >= settings.dictation_max_saved_videos:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail="The shared dictation library is full. New videos are paused until it is reviewed.",
        )
    client_ip = request.client.host if request.client else "unknown"
    enforce_dictation_fetch_limits(db, client_ip)

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import RequestBlocked, YouTubeTranscriptApiException
        from youtube_transcript_api.proxies import WebshareProxyConfig
    except ImportError as exc:
        logger.exception("YouTube transcript support is not installed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="YouTube transcript import is unavailable right now.",
        ) from exc

    settings = get_settings()
    proxy_username = settings.webshare_proxy_username
    proxy_password = settings.webshare_proxy_password
    if bool(proxy_username) != bool(proxy_password):
        logger.error("Webshare proxy configuration is incomplete")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Caption fetching is not configured correctly. Please try again later.",
        )
    proxy_config = None
    if proxy_username and proxy_password:
        proxy_config = WebshareProxyConfig(
            proxy_username=proxy_username,
            proxy_password=proxy_password,
        )

    try:
        transcript_api = YouTubeTranscriptApi(proxy_config=proxy_config)
        transcript_list = transcript_api.list(video_id)
        german_tracks = [
            transcript
            for transcript in transcript_list
            if transcript.language_code.casefold().startswith("de")
        ]
        german_tracks.sort(key=lambda transcript: transcript.is_generated)
        if not german_tracks:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No German captions were found for this video. Try another link with German captions.",
            )
        transcript = german_tracks[0].fetch()
    except RetryError as exc:
        logger.warning("Caption requests were repeatedly rate-limited for video %s", video_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Caption requests are being rate-limited by YouTube or the proxy. "
                "Please try again later."
            ),
        ) from exc
    except RequestBlocked as exc:
        logger.warning("YouTube blocked transcript requests for video %s", video_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="YouTube is temporarily blocking caption requests from the server. Please try again later.",
        ) from exc
    except YouTubeTranscriptApiException as exc:
        logger.info("No usable German transcript for video %s: %s", video_id, type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No German captions were found for this video. Try another link with German captions.",
        ) from exc

    snippets = list(transcript)
    transcript_chars = sum(len(" ".join(snippet.text.split())) for snippet in snippets)
    if transcript_chars < 40:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The German captions did not contain enough speech for dictation. Try another video.",
        )
    if transcript_chars > settings.dictation_max_transcript_chars or len(snippets) > 5000:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="This transcript is too long to add to the shared dictation library.",
        )
    segments = group_transcript_snippets(snippets)
    if not segments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The German captions did not contain any usable speech. Try another video.",
        )
    if len(segments) > settings.dictation_max_transcript_segments:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="This transcript has too many caption lines to add to the shared library.",
        )
    useful_words = re.findall(
        r"\b[\wÄÖÜäöüß]{2,}\b", " ".join(segment.text for segment in segments)
    )
    if len(useful_words) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="These captions do not contain enough spoken words for dictation.",
        )

    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    title, author_name, thumbnail_url = fetch_dictation_video_metadata(
        canonical_url,
        video_id,
        proxy_config,
    )
    stored_video = DictationVideo(
        video_id=video_id,
        video_url=canonical_url,
        title=title,
        author_name=author_name,
        thumbnail_url=thumbnail_url,
        language=transcript.language,
        is_generated=transcript.is_generated,
        segments=[segment.model_dump() for segment in segments],
        segment_count=len(segments),
    )
    db.add(stored_video)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        concurrent_video = db.get(DictationVideo, video_id)
        if concurrent_video is not None:
            return dictation_transcript_out(concurrent_video, cache_hit=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The transcript was loaded but could not be saved. Please try again.",
        )
    db.refresh(stored_video)
    return dictation_transcript_out(stored_video, cache_hit=False)


@router.post("/dictation/videos/{video_id}/report")
def report_dictation_video(
    video_id: str,
    payload: DictationVideoReportIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    video = db.get(DictationVideo, video_id)
    if video is None or video.is_hidden:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved video not found.")
    client_ip = request.client.host if request.client else "unknown"
    reporter_key = dictation_client_key(client_ip)
    if db.get(DictationVideoReport, (video_id, reporter_key)) is not None:
        return {"status": "received"}
    enforce_dictation_report_limits(db, client_ip)
    db.add(
        DictationVideoReport(video_id=video_id, reporter_key=reporter_key, reason=payload.reason)
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"status": "received"}
    video.report_count = (
        db.scalar(
            select(func.count())
            .select_from(DictationVideoReport)
            .where(DictationVideoReport.video_id == video_id)
        )
        or 0
    )
    db.commit()
    return {"status": "received"}


@router.get("/admin/dictation/reports", response_model=list[DictationVideoModerationOut])
def list_reported_dictation_videos(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[DictationVideoModerationOut]:
    if not has_admin_bearer(authorization):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin authorization required."
        )
    videos = db.scalars(
        select(DictationVideo)
        .where(DictationVideo.report_count > 0)
        .order_by(DictationVideo.report_count.desc(), DictationVideo.created_at.desc())
        .limit(100)
    ).all()
    return [
        DictationVideoModerationOut.model_validate(video, from_attributes=True) for video in videos
    ]


@router.patch("/admin/dictation/videos/{video_id}", response_model=DictationVideoModerationOut)
def moderate_dictation_video(
    video_id: str,
    payload: DictationVideoModerationIn,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> DictationVideoModerationOut:
    if not has_admin_bearer(authorization):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin authorization required."
        )
    video = db.get(DictationVideo, video_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved video not found.")
    video.is_hidden = payload.is_hidden
    db.commit()
    db.refresh(video)
    return DictationVideoModerationOut.model_validate(video, from_attributes=True)


def dictation_client_key(client_ip: str) -> str:
    settings = get_settings()
    key = (
        settings.dictation_rate_limit_salt
        or settings.admin_token
        or settings.webshare_proxy_password
        or "deutschelearn-dictation-rate-limit"
    ).encode()
    return hmac.new(key, client_ip.encode(), hashlib.sha256).hexdigest()


def enforce_dictation_fetch_limits(db: Session, client_ip: str) -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    naive_now = now.replace(tzinfo=None)
    client_key = dictation_client_key(client_ip)
    buckets = [
        (
            f"client:{client_key}:hour:{now:%Y%m%d%H}",
            settings.dictation_new_videos_per_ip_hour,
            status.HTTP_429_TOO_MANY_REQUESTS,
        ),
        (
            f"client:{client_key}:day:{now:%Y%m%d}",
            settings.dictation_new_videos_per_ip_day,
            status.HTTP_429_TOO_MANY_REQUESTS,
        ),
        (
            f"global:day:{now:%Y%m%d}",
            settings.dictation_global_new_videos_per_day,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        ),
    ]
    insert = _counter_insert(db)
    try:
        db.execute(
            delete(DictationFetchCounter).where(
                DictationFetchCounter.updated_at < naive_now - timedelta(days=2)
            )
        )
        for bucket_key, maximum, error_status in buckets:
            count = _reserve_counter(db, insert, bucket_key, maximum, naive_now)
            if count is None:
                db.rollback()
                if error_status == status.HTTP_503_SERVICE_UNAVAILABLE:
                    logger.warning("Daily dictation transcript fetch budget exhausted")
                    detail = "New transcript requests are paused for today. Saved videos remain available."
                else:
                    detail = "You've added several new videos recently. Try again later; saved videos remain available."
                raise HTTPException(status_code=error_status, detail=detail)
        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not reserve dictation fetch quota")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transcript fetching is temporarily unavailable. Saved videos remain available.",
        ) from exc


def enforce_dictation_report_limits(db: Session, client_ip: str) -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    naive_now = now.replace(tzinfo=None)
    client_key = dictation_client_key(client_ip)
    global_bucket_key = f"global-report:day:{now:%Y%m%d}"
    client_bucket_key = f"client-report:{client_key}:day:{now:%Y%m%d}"
    dialect = db.get_bind().dialect.name
    insert = (
        pg_insert if dialect == "postgresql" else sqlite_insert if dialect == "sqlite" else None
    )
    if insert is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reporting is temporarily unavailable.",
        )
    try:
        db.execute(
            delete(DictationFetchCounter).where(
                DictationFetchCounter.updated_at < naive_now - timedelta(days=2)
            )
        )
        for bucket_key, maximum in (
            (client_bucket_key, settings.dictation_reports_per_ip_day),
            (global_bucket_key, settings.dictation_global_reports_per_day),
        ):
            count = _reserve_counter(db, insert, bucket_key, maximum, naive_now)
            if count is None:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="You've sent several reports recently. Please try again later.",
                )
        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Could not reserve dictation report quota")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reporting is temporarily unavailable.",
        ) from exc


def _counter_insert(db: Session):
    dialect = db.get_bind().dialect.name
    insert = (
        pg_insert if dialect == "postgresql" else sqlite_insert if dialect == "sqlite" else None
    )
    if insert is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dictation rate limits are unavailable with this database configuration.",
        )
    return insert


def _reserve_counter(
    db: Session, insert, bucket_key: str, maximum: int, now: datetime
) -> int | None:
    statement = insert(DictationFetchCounter).values(
        bucket_key=bucket_key,
        request_count=1,
        updated_at=now,
    )
    statement = statement.on_conflict_do_update(
        index_elements=[DictationFetchCounter.bucket_key],
        set_={
            "request_count": DictationFetchCounter.request_count + 1,
            "updated_at": now,
        },
        where=DictationFetchCounter.request_count < maximum,
    ).returning(DictationFetchCounter.request_count)
    count = db.scalar(statement)
    return int(count) if count is not None else None


def dictation_transcript_out(video: DictationVideo, *, cache_hit: bool) -> DictationTranscriptOut:
    return DictationTranscriptOut(
        video_id=video.video_id,
        video_url=video.video_url,
        title=video.title,
        author_name=video.author_name,
        thumbnail_url=video.thumbnail_url,
        language=video.language,
        is_generated=video.is_generated,
        cache_hit=cache_hit,
        segments=video.segments,
    )


def fetch_dictation_video_metadata(
    video_url: str,
    video_id: str,
    proxy_config: Any,
) -> tuple[str, str | None, str | None]:
    fallback_title = f"German dictation · {video_id}"
    fallback_thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    proxies = proxy_config.to_requests_dict() if proxy_config is not None else None
    try:
        response = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": video_url, "format": "json"},
            proxies=proxies,
            timeout=(3, 7),
        )
        response.raise_for_status()
        metadata = response.json()
    except (RequestException, ValueError) as exc:
        logger.info("YouTube metadata unavailable for %s: %s", video_id, type(exc).__name__)
        return fallback_title, None, fallback_thumbnail

    return (
        str(metadata.get("title") or fallback_title)[:500],
        str(metadata["author_name"])[:255] if metadata.get("author_name") else None,
        str(metadata.get("thumbnail_url") or fallback_thumbnail)[:1000],
    )


def youtube_video_id(video_url: str) -> str:
    parsed = urlparse(video_url.strip())
    host = (parsed.hostname or "").lower()
    video_id = ""
    if host in {"youtu.be", "www.youtu.be"}:
        video_id = parsed.path.strip("/").split("/")[0]
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        else:
            match = re.fullmatch(r"/(?:embed|shorts|live)/([\w-]{11})/?", parsed.path)
            video_id = match.group(1) if match else ""
    if not re.fullmatch(r"[\w-]{11}", video_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid YouTube video link.",
        )
    return video_id


def group_transcript_snippets(transcript: Any) -> list[DictationSegmentOut]:
    result: list[DictationSegmentOut] = []
    current_text: list[str] = []
    current_start = 0.0
    current_end = 0.0

    def flush() -> None:
        if current_text:
            result.append(
                DictationSegmentOut(
                    start=round(current_start, 3),
                    duration=round(max(0.25, current_end - current_start), 3),
                    text=" ".join(current_text).strip(),
                )
            )

    for snippet in transcript:
        text = " ".join(snippet.text.split())
        if not text:
            continue
        start = float(snippet.start)
        end = start + float(snippet.duration)

        if current_text and starts_new_german_sentence(text):
            flush()
            current_text = []

        sentences = split_german_sentences(text)
        if len(sentences) > 1:
            if current_text:
                flush()
                current_text = []
            weights = [max(1, len(re.findall(r"\b\w+\b", sentence))) for sentence in sentences]
            total_weight = sum(weights)
            elapsed = 0.0
            duration = max(0.25, end - start)
            for sentence, weight in zip(sentences, weights, strict=True):
                sentence_duration = duration * weight / total_weight
                result.append(
                    DictationSegmentOut(
                        start=round(start + elapsed, 3),
                        duration=round(sentence_duration, 3),
                        text=sentence,
                    )
                )
                elapsed += sentence_duration
            continue

        if not current_text:
            current_start = start
        current_text.append(text)
        current_end = end
        combined = " ".join(current_text)
        if re.search(r"[.!?…][\"'»)]?$", text) or len(combined) >= 120:
            flush()
            current_text = []
    flush()
    return result


GERMAN_SENTENCE_STARTERS = "Das|Es|Er|Sie|Wir|Ich|Du|Ihr|Man|Dann|Aber|Und|Jetzt|Heute|Hier|Dort|Trotzdem|Deshalb|Außerdem|Doch"


def split_german_sentences(text: str) -> list[str]:
    """Split clear sentence punctuation and common capitalized German restart words."""
    parts = re.split(r'(?<=[.!?…])\s+(?=["„»(]*[A-ZÄÖÜ])', text)
    sentences: list[str] = []
    for part in parts:
        sentences.extend(
            sentence.strip()
            for sentence in re.split(rf"(?<=\w)\s+(?=(?:{GERMAN_SENTENCE_STARTERS})\b)", part)
            if sentence.strip()
        )
    return sentences


def starts_new_german_sentence(text: str) -> bool:
    return re.match(rf"^(?:{GERMAN_SENTENCE_STARTERS})\b", text) is not None
