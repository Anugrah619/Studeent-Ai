"""The Gemini client — the fallback chain, the cache, and the refusal to invent.

WHY THIS FILE EXISTS

    `gemini.reason` is the only door between this product and a third-party
    model, and it carries three promises the rest of the codebase relies on
    without re-checking:

      * it never returns output the model did not produce,
      * it never spends a request it does not have to, and
      * it writes a trace whatever happens, because a failure is training
        data too.

    Each of those is a behaviour under an error path, which is precisely
    the code that never runs in a demo and always runs in a pitch. The
    fallback chain in particular was written *after* a live run hit 503 on
    four models in a row; the tests below are the only thing that keeps it
    working, since reproducing Google's capacity problems on demand is not
    an option.

NOTHING HERE TOUCHES THE NETWORK

    `tests/conftest.py` replaces `gemini._client` with a landmine for every
    test in the suite, and each test here hands it a `FakeGemini` instead.
    That is not politeness: `app/.env` holds a live key, the free tier is
    500 requests a day shared with the demo, and a suite that spends it
    would also be slow, flaky and impossible to run in CI.
"""

from __future__ import annotations

import types

import pytest

from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import gemini

pytestmark = pytest.mark.django_db


# ------------------------------------------------------------------ test doubles


class ApiError(Exception):
    """Shaped like the SDK's errors: a numeric `code`, and a message.

    The message deliberately does NOT repeat the code, so a test can prove
    the decision was made on `exc.code` rather than on a substring that
    happened to be in the text. Both paths exist in `_try_another_model`
    and both need covering.
    """

    def __init__(self, code: int, message: str = "the server said no"):
        super().__init__(message)
        self.code = code


class FakeResponse:
    def __init__(self, text: str):
        self.text = text
        self.usage_metadata = types.SimpleNamespace(
            prompt_token_count=1234, candidates_token_count=88
        )


class FakeGemini:
    """Stands in for `genai.Client`. Records what it was asked, answers a script.

    `client.models.generate_content(...)` is the one call the module makes,
    so the double is its own `.models`. Each script entry is either the raw
    text to return or an exception to raise; the last entry repeats for
    every call after it, which is how "every model is down" is expressed.
    """

    def __init__(self, *script):
        self._script = list(script) or [ApiError(503, "no capacity")]
        self.calls: list[str] = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append(model)
        step = self._script[min(len(self.calls) - 1, len(self._script) - 1)]
        if isinstance(step, BaseException):
            raise step
        return FakeResponse(step)


CONTEXT = {
    "student_ref": "S-1",
    "wrong_answers": [{"q": "Q17", "chose": "C", "indicates": "MIS-ORG-EAS"}],
}
SCHEMA = {
    "type": "object",
    "properties": {"headline": {"type": "string"}},
    "required": ["headline"],
}
OUTPUT = '{"headline": "Has the directing-effects rule backwards."}'
OTHER_OUTPUT = '{"headline": "Drops the inner derivative in the chain rule."}'


def call(monkeypatch, client, *, institute_id, context=None, **kwargs):
    """`reason()` with the boilerplate filled in and the client swapped."""
    monkeypatch.setattr(gemini, "_client", lambda: client)
    kwargs.setdefault("task", ReasoningTrace.DIAGNOSE)
    kwargs.setdefault("system_prompt", "You are an experienced JEE faculty member.")
    kwargs.setdefault("response_schema", SCHEMA)
    return gemini.reason(
        context=CONTEXT if context is None else context,
        institute_id=institute_id,
        **kwargs,
    )


@pytest.fixture
def institute_id(cohort):
    return cohort.institute.id


@pytest.fixture
def chain():
    """The models `reason()` will try, in order, for its default model."""
    return gemini._model_chain(gemini.DEFAULT_MODEL)


# =========================================================== 0 · the network is closed


def test_a_test_that_forgets_to_mock_fails_instead_of_calling_google(institute_id):
    """The guard in `conftest.no_gemini_network`, asserted rather than assumed.

    `app/.env` holds a live key and pytest loads the same settings module
    the server does, so "I forgot to patch the client" is one line away
    from spending free-tier quota and flaking on Google's capacity. The
    default for every test in the suite is that the door is shut; each test
    here opens it onto a `FakeGemini` and nothing else can.
    """
    with pytest.raises(AssertionError, match="real Gemini client"):
        gemini.reason(
            task=ReasoningTrace.DIAGNOSE, context={"student_ref": "S-unmocked"},
            system_prompt="sp", response_schema=SCHEMA, institute_id=institute_id,
        )


# ================================================================ 1 · the fallback chain


def test_the_chain_starts_with_the_model_asked_for_and_never_repeats_it():
    """Order is the whole design: newest first, degrading gently.

    Falling back to an older Flash costs a little quality. A panel that
    does not render in front of a director costs the meeting.
    """
    ordered = gemini._model_chain("gemini-3.6-flash")
    assert ordered[0] == "gemini-3.6-flash"
    assert ordered.count("gemini-3.6-flash") == 1
    assert set(ordered) == {"gemini-3.6-flash", *gemini.FALLBACK_MODELS}

    unknown = gemini._model_chain("gemini-99-experimental")
    assert unknown[0] == "gemini-99-experimental"
    assert unknown[1:] == gemini.FALLBACK_MODELS


def test_a_503_falls_back_to_the_next_model_and_a_later_success_returns_normally(
    monkeypatch, institute_id, chain
):
    """Google having no capacity is not our error and not the caller's problem.

    The caller gets the output and never learns which model produced it —
    the trace does, which is where that belongs.
    """
    client = FakeGemini(ApiError(503, "this model is experiencing high demand"), OUTPUT)

    output, trace = call(monkeypatch, client, institute_id=institute_id)

    assert output == {"headline": "Has the directing-effects rule backwards."}
    assert client.calls == chain[:2]
    assert trace.model == chain[1]
    assert trace.error == ""
    assert trace.succeeded


def test_a_404_continues_the_chain_rather_than_aborting_it(
    monkeypatch, institute_id, chain
):
    """The real bug this chain was rewritten for.

    A 404 means *this* model id is gone or closed to new keys — which is
    fatal for it and says nothing about the others. The chain used to treat
    it as fatal for all of them, so the day Google retired a model id the
    whole reasoning layer went dark despite five working alternatives
    sitting behind it. That is exactly what happened on the first live run,
    on `gemini-2.5-flash`.

    The error below carries no "404" in its text, so this passes only if
    the decision is made on `exc.code`.
    """
    client = FakeGemini(ApiError(404, "that model is not available to this key"), OUTPUT)

    output, trace = call(monkeypatch, client, institute_id=institute_id)

    assert output["headline"]
    assert client.calls == chain[:2]
    assert trace.model == chain[1]


@pytest.mark.parametrize("code", [400, 401, 403])
def test_a_rejected_request_stops_the_chain_immediately(
    monkeypatch, institute_id, chain, code
):
    """Our request or our key, and every model will refuse it identically.

    Walking the chain here spends six requests out of a 500-a-day quota to
    arrive at the same answer more slowly, and buries the real cause under
    five repetitions of it.
    """
    client = FakeGemini(ApiError(code, "the request was refused"))

    with pytest.raises(gemini.GeminiUnavailable):
        call(monkeypatch, client, institute_id=institute_id)

    assert client.calls == chain[:1]
    assert ReasoningTrace.objects.count() == 1


def test_every_model_exhausted_raises_rather_than_returning_anything(
    monkeypatch, institute_id, chain
):
    """The failure this product cannot survive is a fabricated diagnosis.

    A degraded panel is honest. A confident-sounding paragraph that no
    model produced, shown to a teacher who acts on it, is not recoverable —
    so the exhausted chain raises and there is no fallback that invents.
    """
    client = FakeGemini(ApiError(503, "no capacity anywhere"))

    with pytest.raises(gemini.GeminiUnavailable) as exc:
        call(monkeypatch, client, institute_id=institute_id)

    assert "Every model in the fallback chain" in str(exc.value)
    assert client.calls == chain
    assert ReasoningTrace.objects.count() == len(chain)
    assert not ReasoningTrace.objects.filter(output__isnull=False).exists()


@pytest.mark.parametrize(
    "exc,keep_going",
    [
        # Decided on the numeric code.
        (ApiError(503), True),      # capacity
        (ApiError(500), True),
        (ApiError(502), True),
        (ApiError(504), True),
        (ApiError(429), True),      # rate limited on this model, not the next
        (ApiError(404), True),      # this id is retired; the others are not
        (ApiError(400), False),     # our request
        (ApiError(401), False),     # our key
        (ApiError(403), False),     # our permissions
        # Decided on the text, for SDK errors that carry no code.
        (RuntimeError("503 UNAVAILABLE: model overloaded"), True),
        (RuntimeError("RESOURCE_EXHAUSTED: quota"), True),
        (RuntimeError("NOT_FOUND: models/gemini-2.5-flash"), True),
        (RuntimeError("Connection reset by peer"), False),
        (ValueError("INVALID_ARGUMENT: response_schema is malformed"), False),
    ],
)
def test_which_failures_are_worth_another_model(exc, keep_going):
    """The rule, stated once, with no database or client in the way."""
    assert gemini._try_another_model(exc) is keep_going


# ========================================================================= 2 · caching


def test_identical_context_is_served_from_the_cache_with_no_api_call(
    monkeypatch, institute_id
):
    """500 requests a day, and a console that re-renders on every page load.

    Without this the free tier is gone before lunch, and the demo stutters
    for two seconds on a screen the director is looking at.
    """
    first = FakeGemini(OUTPUT)
    output, trace = call(monkeypatch, first, institute_id=institute_id)

    second = FakeGemini(OTHER_OUTPUT)          # would answer differently, if asked
    again, cached = call(monkeypatch, second, institute_id=institute_id)

    assert second.calls == []
    assert again == output
    assert cached.id == trace.id
    assert ReasoningTrace.objects.count() == 1


def test_force_bypasses_the_cache(monkeypatch, institute_id):
    """The mentor's "re-run this" button, and the developer's prompt loop."""
    call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)

    fresh = FakeGemini(OTHER_OUTPUT)
    output, trace = call(monkeypatch, fresh, institute_id=institute_id, force=True)

    assert len(fresh.calls) == 1
    assert output == {"headline": "Drops the inner derivative in the chain rule."}
    assert ReasoningTrace.objects.count() == 2


def test_the_hash_is_stable_under_key_reordering():
    """Two payloads with the same content must be the same cache entry.

    `build_context` assembles nested dicts from queryset iteration, so key
    insertion order is not stable between runs. Hashing the raw dump would
    turn every second call into a cache miss and a spent request, and the
    failure would look like the cache simply not working.
    """
    one = {
        "student_ref": "S-1",
        "totals": {"answered": 7, "wrong": 3},
        "marks_lost_by_pattern": {"MIS-ORG-EAS": 10, "MIS-CALC-CHAIN": 5},
    }
    two = {
        "marks_lost_by_pattern": {"MIS-CALC-CHAIN": 5, "MIS-ORG-EAS": 10},
        "totals": {"wrong": 3, "answered": 7},
        "student_ref": "S-1",
    }
    assert list(one) != list(two)
    assert ReasoningTrace.hash_context(one) == ReasoningTrace.hash_context(two)

    # Lists are ordered data, not a bag: reordering the questions IS a
    # different payload and must not silently replay the old answer.
    assert ReasoningTrace.hash_context({"qs": ["Q1", "Q2"]}) != \
        ReasoningTrace.hash_context({"qs": ["Q2", "Q1"]})


def test_a_different_context_is_a_different_answer(monkeypatch, institute_id):
    call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)

    moved_on = FakeGemini(OTHER_OUTPUT)
    output, _ = call(
        monkeypatch, moved_on, institute_id=institute_id,
        context={**CONTEXT, "wrong_answers": [{"q": "Q18", "chose": "A"}]},
    )
    assert len(moved_on.calls) == 1
    assert output["headline"].startswith("Drops")


def test_the_cache_is_keyed_on_the_task_as_well_as_the_payload(
    monkeypatch, institute_id
):
    """The same student state asked two different questions is two answers."""
    call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)

    other_task = FakeGemini(OTHER_OUTPUT)
    output, trace = call(
        monkeypatch, other_task, institute_id=institute_id, task=ReasoningTrace.PLAN
    )
    assert len(other_task.calls) == 1
    assert trace.task == ReasoningTrace.PLAN
    assert output["headline"].startswith("Drops")


def test_a_failed_trace_is_never_served_as_a_cache_hit(monkeypatch, institute_id):
    """Yesterday's outage must not become today's permanent answer.

    Error traces are kept — they are training data and they are the record
    of what was tried — so the cache has to distinguish them from output.
    """
    dead = FakeGemini(ApiError(503, "no capacity"))
    with pytest.raises(gemini.GeminiUnavailable):
        call(monkeypatch, dead, institute_id=institute_id)

    recovered = FakeGemini(OUTPUT)
    output, trace = call(monkeypatch, recovered, institute_id=institute_id)

    assert len(recovered.calls) == 1
    assert output["headline"]
    assert trace.succeeded


def test_an_empty_output_is_not_served_as_a_cache_hit(monkeypatch, institute_id):
    """`{}` is a row that satisfies `output__isnull=False` and says nothing."""
    ReasoningTrace.objects.create(
        institute_id=institute_id, task=ReasoningTrace.DIAGNOSE,
        context=CONTEXT, context_hash=ReasoningTrace.hash_context(CONTEXT),
        model="gemini-3.8-flash", prompt_version="diagnose-v1", output={},
    )
    client = FakeGemini(OUTPUT)
    output, _ = call(monkeypatch, client, institute_id=institute_id)

    assert len(client.calls) == 1
    assert output["headline"]


def test_a_new_prompt_version_is_not_served_the_old_prompts_answer(
    monkeypatch, institute_id
):
    call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id,
         prompt_version="diagnose-v1")

    rewritten = FakeGemini(OTHER_OUTPUT)
    output, trace = call(monkeypatch, rewritten, institute_id=institute_id,
                         prompt_version="diagnose-v2")

    assert len(rewritten.calls) == 1, "v2 was never actually asked"
    assert trace.prompt_version == "diagnose-v2"
    assert output["headline"].startswith("Drops")


def test_a_cache_hit_is_reported_as_one(monkeypatch, institute_id):
    call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)
    _, cached = call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)

    # `reason()` marks the replayed trace; views.py reads this. Latency
    # cannot carry the signal, because a cache hit returns the ORIGINAL
    # trace with the millisecond count of the live call that produced it —
    # which is why the first version of this check was always False.
    assert getattr(cached, "_from_cache", False), (
        "a replayed diagnosis is indistinguishable from a fresh one"
    )


# ============================================================ 3 · refusal to fabricate


def test_no_key_and_nothing_cached_refuses_by_name(
    monkeypatch, settings, institute_id, real_gemini_client
):
    """The error a developer reads at 11pm has to say what to do.

    `_client()` returns None before the SDK is even imported when no key is
    set, so this path cannot reach the network either.
    """
    settings.GEMINI_API_KEY = ""
    monkeypatch.setattr(gemini, "_client", real_gemini_client)

    with pytest.raises(gemini.NoCredentialsAndNoCache) as exc:
        gemini.reason(
            task=ReasoningTrace.DIAGNOSE, context=CONTEXT,
            system_prompt="sp", response_schema=SCHEMA, institute_id=institute_id,
        )

    assert "GEMINI_API_KEY" in str(exc.value)
    assert "app/.env" in str(exc.value)
    assert ReasoningTrace.objects.count() == 0


def test_no_key_but_a_cached_trace_replays_it(
    monkeypatch, settings, institute_id, real_gemini_client
):
    """Rehearse the demo once with a key; it then runs with the wifi off.

    Belt and braces with the fallback chain: one covers Google being down,
    this covers us being offline, and neither invents anything.
    """
    settings.GEMINI_API_KEY = ""
    monkeypatch.setattr(gemini, "_client", real_gemini_client)
    ReasoningTrace.objects.create(
        institute_id=institute_id, task=ReasoningTrace.DIAGNOSE,
        context=CONTEXT, context_hash=ReasoningTrace.hash_context(CONTEXT),
        model="gemini-3.8-flash", prompt_version="diagnose-v1",
        output={"headline": "Rehearsed last night."}, latency_ms=900,
    )

    output, trace = gemini.reason(
        task=ReasoningTrace.DIAGNOSE, context=CONTEXT,
        system_prompt="sp", response_schema=SCHEMA, institute_id=institute_id,
        # Must match the rehearsed trace. The cache key includes the prompt
        # version, so a v2 prompt deliberately will NOT replay a v1 answer —
        # see test_a_new_prompt_version_is_not_served_the_old_prompts_answer.
        # `diagnose()` passes its own PROMPT_VERSION here, so this mirrors
        # the real caller rather than relying on the parameter default.
        prompt_version="diagnose-v1",
    )
    assert output == {"headline": "Rehearsed last night."}
    assert trace.human_verdict == ReasoningTrace.UNREVIEWED


def test_output_that_is_not_json_raises_and_the_trace_records_why(
    monkeypatch, institute_id
):
    """Prose where JSON was asked for is a failure, not a diagnosis.

    And it is not worth another model: a schema the model cannot satisfy is
    a fact about the schema, so the chain stops at one.
    """
    client = FakeGemini("I'm sorry, I can't help with that request.")

    with pytest.raises(gemini.GeminiUnavailable) as exc:
        call(monkeypatch, client, institute_id=institute_id)

    assert "not valid JSON" in str(exc.value)
    assert len(client.calls) == 1

    trace = ReasoningTrace.objects.get()
    assert trace.output is None
    assert "not valid JSON" in trace.error
    assert not trace.succeeded


def test_an_empty_response_is_an_error_not_an_empty_diagnosis(
    monkeypatch, institute_id
):
    """A blank answer rendered as a card reads as "nothing is wrong"."""
    client = FakeGemini("   ")

    with pytest.raises(gemini.GeminiUnavailable):
        call(monkeypatch, client, institute_id=institute_id)

    assert ReasoningTrace.objects.filter(output__isnull=False).count() == 0
    assert "empty response" in ReasoningTrace.objects.first().error


# ============================================================== 4 · the trace corpus


def test_a_failed_call_still_writes_a_trace(monkeypatch, institute_id):
    """Failures are training data too, and they are the only outage record.

    "The reasoning panel was blank on Tuesday" is unanswerable without
    these rows; with them it is a query.
    """
    client = FakeGemini(ApiError(400, "the request was refused"))
    with pytest.raises(gemini.GeminiUnavailable):
        call(monkeypatch, client, institute_id=institute_id)

    trace = ReasoningTrace.objects.get()
    assert trace.output is None
    assert trace.error.startswith("ApiError:")
    assert trace.context == CONTEXT          # reproducible, or it is an anecdote
    assert trace.latency_ms is not None


def test_one_trace_per_attempt_so_the_corpus_records_what_was_tried(
    monkeypatch, institute_id, chain
):
    """Including the models that failed.

    A single row for the model that eventually answered would lose the
    thing worth knowing — that two others were down first, and how often
    that happens.
    """
    client = FakeGemini(
        ApiError(503, "no capacity"), ApiError(404, "retired"), OUTPUT
    )
    call(monkeypatch, client, institute_id=institute_id)

    traces = list(ReasoningTrace.objects.order_by("id"))
    assert [t.model for t in traces] == chain[:3]
    assert [bool(t.error) for t in traces] == [True, True, False]
    assert [t.output is None for t in traces] == [True, True, False]
    assert all(t.context_hash == ReasoningTrace.hash_context(CONTEXT) for t in traces)


def test_human_verdict_starts_unreviewed(monkeypatch, institute_id):
    """The field that makes this corpus worth more than raw model output.

    It has to default to "nobody has looked", never to agreement — a
    dataset that assumes the teacher agreed is a dataset of guesses
    wearing a label.
    """
    _, trace = call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)

    assert trace.human_verdict == ReasoningTrace.UNREVIEWED
    assert ReasoningTrace.UNREVIEWED == "unreviewed"
    assert trace.reviewed_by is None
    assert trace.human_note == ""

    field = ReasoningTrace._meta.get_field("human_verdict")
    assert field.default == ReasoningTrace.UNREVIEWED


def test_a_successful_trace_records_what_it_cost(monkeypatch, institute_id):
    """Latency and tokens, per call. Cost per diagnosis is a number the
    business plan needs and nobody can reconstruct later."""
    _, trace = call(monkeypatch, FakeGemini(OUTPUT), institute_id=institute_id)

    assert trace.pk is not None
    assert trace.latency_ms is not None and trace.latency_ms >= 0
    assert trace.input_tokens == 1234
    assert trace.output_tokens == 88
    assert trace.prompt_version == "v1"
    assert trace.institute_id == institute_id
