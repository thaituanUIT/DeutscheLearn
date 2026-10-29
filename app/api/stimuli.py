from app.core.config import get_settings
from app.db.models import ReadingPassage
from app.services.goethe_reading import exercise_type_for


def exercise_type_for_passage(passage: ReadingPassage) -> str | None:
    return exercise_type_for(passage.group, passage.level, passage.part, passage.kind)


def stimulus_image_url(stimulus: ReadingPassage) -> str | None:
    if stimulus.image_url:
        return stimulus.image_url
    if not stimulus.image_path:
        return None
    settings = get_settings()
    if not settings.supabase_url:
        return stimulus.image_path
    return f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/stimuli/{stimulus.image_path}"
