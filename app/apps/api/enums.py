"""Choice sets the OpenAPI schema needs to name on purpose.

drf-spectacular names an enum component after the field that carries it
(`status` → `StatusEnum`). That works until a second field with the same name
and a *different* set of choices appears, at which point it falls back to a
hash (`StatusFb6Enum`) for both — silently renaming a component the generated
TypeScript client, and the hand-written types built on it, already import.

That happened once: giving `TestPaper` a visible `source` made it collide with
`Attempt.source`, and `SourceEnum` became `Source0b7Enum`. These module-level
names exist because `ENUM_NAME_OVERRIDES` takes an import path, and a class
attribute like `Attempt.STATUS` is not one. Config in `settings.py` names the
component each of them must keep.
"""

from apps.events.models import Attempt
from apps.ingestion.models import Source

ATTEMPT_STATUS = Attempt.STATUS
ATTEMPT_SOURCE = Attempt.SOURCE
PAPER_SOURCE = Source.choices
