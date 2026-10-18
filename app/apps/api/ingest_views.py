"""Getting an institute's own results in: create a paper, set its blueprint, upload the sitting.

    POST /api/papers/                     make the paper (in views.py)
    POST /api/papers/{id}/blueprint/      question → chapter + right answer, once
    POST /api/ingest/results/             a class's answers, against that blueprint
    GET  /api/ingest/batches/             what has been uploaded, and how it went
    GET/POST /api/ingest/mappings/        saved column renamings, for the next upload

The order is the point. Results are read against a blueprint, and a blueprint
needs a paper; each step fails with a sentence that names the one before it.
The reasoning behind the rules — what stops an upload, what only skips a
student — is in `apps/ingestion/services/results.py` and `blueprint.py`; the
views here are only HTTP: parse the form, pick the status code, and make sure
the same bytes that were checked are the bytes that were hashed.

STATUS CODES
    200  a dry run, or a blueprint that applied      body: the report
    201  results were written (some students may have failed — read the report)
    400  the request or file is malformed            body: {detail}
    404  no such paper in this institute
    409  this exact file was already imported        body: {detail, batch_id}
    422  the file was understood and cannot be used  body: the report
         (unmapped questions, no answer key, or no student could be ingested)
"""

from __future__ import annotations

import hashlib
import json
import logging

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.ingestion.models import ColumnMappingProfile, IngestBatch, TestPaper
from apps.ingestion.services import blueprint, results
from apps.ingestion.services.tabular import MAX_BYTES, UnreadableFile, read_table

from . import serializers as ser
from .pagination import StandardPagination
from .views import CONSOLE_PERMISSIONS, INSTITUTE_PARAM, TenantScopedMixin

logger = logging.getLogger(__name__)


def read_upload(upload) -> tuple[bytes, str]:
    """The uploaded bytes and their SHA-256 — computed once, from the same read.

    Reading `MAX_BYTES + 1` is how an oversized file is noticed without
    pulling a gigabyte into memory first. The hash is of exactly these bytes,
    so "the file that was parsed" and "the file that was recorded" cannot be
    two different things.
    """
    raw = upload.read(MAX_BYTES + 1)
    return raw, hashlib.sha256(raw).hexdigest()


@extend_schema(
    tags=["ingest"],
    request={"multipart/form-data": ser.BlueprintUploadSerializer},
    parameters=[INSTITUTE_PARAM],
    responses={
        200: ser.BlueprintReportSerializer,
        400: ser.DetailSerializer,
        404: ser.DetailSerializer,
        422: ser.BlueprintReportSerializer,
        429: ser.DetailSerializer,
    },
)
class PaperBlueprintView(TenantScopedMixin, APIView):
    """Set which chapter each question tests and what its right answer is.

    Once per paper, before any results. All or nothing: one bad row and
    nothing is written, with every problem listed at once. 200 means applied
    (or, with `dry_run`, that it would be); 422 means it was not and why.
    Idempotent — uploading the same blueprint again changes nothing.
    """

    permission_classes = CONSOLE_PERMISSIONS
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ingest"

    def post(self, request, pk):
        form = ser.BlueprintUploadSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        institute_id = self.institute_id()
        paper = (
            TestPaper.objects.select_related("exam").filter(pk=pk, institute_id=institute_id).first()
            if institute_id else None
        )
        if paper is None:
            return Response({"detail": "No such paper."}, status=status.HTTP_404_NOT_FOUND)

        raw, _ = read_upload(form.validated_data["file"])
        try:
            report = blueprint.import_blueprint(
                paper=paper, table=read_table(raw), user=request.user,
                dry_run=form.validated_data["dry_run"],
            )
        except UnreadableFile as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        body = ser.BlueprintReportSerializer(report).data
        code = status.HTTP_200_OK if report.ok else status.HTTP_422_UNPROCESSABLE_ENTITY
        return Response(body, status=code)


@extend_schema(
    tags=["ingest"],
    request={"multipart/form-data": ser.ResultsUploadSerializer},
    parameters=[INSTITUTE_PARAM],
    responses={
        200: ser.ResultsReportSerializer,
        201: ser.ResultsReportSerializer,
        400: ser.DetailSerializer,
        404: ser.DetailSerializer,
        409: OpenApiResponse(
            description="This exact file was already imported. Body: `{detail, batch_id}`."
        ),
        422: ser.ResultsReportSerializer,
        429: ser.DetailSerializer,
    },
)
class IngestResultsView(TenantScopedMixin, APIView):
    """Upload a class's results for one paper. Run it with `dry_run` first.

    A dry run does everything an import does except write, and returns the
    same report — which students would fail and why, which questions the
    blueprint is missing, how many answers are new. The cheapest way to find
    out a file is wrong is to ask before it is real.
    """

    permission_classes = CONSOLE_PERMISSIONS
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "ingest"

    def post(self, request):
        form = ser.ResultsUploadSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data

        institute_id = self.institute_id()
        paper = (
            TestPaper.objects.select_related("exam")
            .filter(pk=data["paper"], institute_id=institute_id).first()
            if institute_id else None
        )
        if paper is None:
            return Response({"detail": "No such paper."}, status=status.HTTP_404_NOT_FOUND)

        column_map = self._column_map(data, institute_id)
        raw, file_hash = read_upload(data["file"])
        try:
            table = read_table(raw)
            report = results.import_results(
                paper=paper, table=table, filename=data["file"].name, file_hash=file_hash,
                column_map=column_map, dry_run=data["dry_run"],
            )
        except UnreadableFile as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except results.AlreadyImported as exc:
            batch = exc.batch
            when = batch.created_at.strftime("%d %b %Y")
            return Response(
                {
                    "detail": f"This exact file was already imported on {when} "
                              f"({batch.rows_ok} students ingested, {batch.rows_failed} failed). "
                              "To import rows that failed, correct them and upload the new file.",
                    "batch_id": batch.id,
                },
                status=status.HTTP_409_CONFLICT,
            )

        body = ser.ResultsReportSerializer(report).data
        if data["dry_run"]:
            return Response(body, status=status.HTTP_200_OK)
        if not report.ok:
            return Response(body, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        if data.get("save_mapping_as") and column_map and data.get("column_map"):
            ColumnMappingProfile.objects.update_or_create(
                institute_id=institute_id, name=data["save_mapping_as"].strip(),
                defaults={"mapping": column_map},
            )
        return Response(body, status=status.HTTP_201_CREATED)

    def _column_map(self, data, institute_id) -> dict[str, str]:
        """A saved profile, overlaid by the inline map. Validated either way."""
        merged: dict[str, str] = {}
        if data.get("mapping_profile") is not None:
            profile = ColumnMappingProfile.objects.filter(
                pk=data["mapping_profile"], institute_id=institute_id
            ).first()
            if profile is None:
                raise ValidationError({"mapping_profile": "No such saved mapping."})
            merged.update(profile.mapping)
        if data.get("column_map"):
            try:
                inline = json.loads(data["column_map"])
            except json.JSONDecodeError:
                raise ValidationError({"column_map": "That is not valid JSON."}) from None
            if not isinstance(inline, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in inline.items()
            ):
                raise ValidationError({"column_map": 'Use an object of strings: {"Their name": "roll_no"}.'})
            unknown = sorted(set(inline.values()) - results.MAPPABLE_FIELDS)
            if unknown:
                raise ValidationError({
                    "column_map": f"Unknown field: {', '.join(unknown)}. "
                                  f"Use one of {', '.join(sorted(results.MAPPABLE_FIELDS))}."
                })
            merged.update(inline)
        return merged


@extend_schema(tags=["ingest"], parameters=[INSTITUTE_PARAM])
class IngestBatchViewSet(TenantScopedMixin, mixins.ListModelMixin,
                         mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Every results file that has been imported, newest first.

    There is deliberately no delete. Attempts are an append-only log, and a
    batch is the receipt for the ones it wrote; removing the receipt would
    leave the attempts with nothing saying where they came from.
    """

    serializer_class = ser.IngestBatchSerializer
    permission_classes = CONSOLE_PERMISSIONS
    pagination_class = StandardPagination

    def get_queryset(self):
        return self.scoped(IngestBatch.objects.select_related("test_paper")).order_by("-created_at", "-id")


@extend_schema(tags=["ingest"], parameters=[INSTITUTE_PARAM])
class MappingProfileViewSet(TenantScopedMixin, mixins.ListModelMixin,
                            mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Saved column renamings — so the second upload of a format is automatic.

    An institute's export names its columns however its software does
    (`Candidate No`, `Seat`), and the same software names them the same way
    next month. Save the mapping once and name it on later uploads.
    """

    serializer_class = ser.ColumnMappingProfileSerializer
    permission_classes = CONSOLE_PERMISSIONS
    pagination_class = StandardPagination

    def get_queryset(self):
        return self.scoped(ColumnMappingProfile.objects.all()).order_by("name", "id")

    def perform_create(self, serializer):
        institute_id = self.institute_id()
        if not institute_id:
            raise ValidationError({"detail": "No institute in scope."})
        if ColumnMappingProfile.objects.filter(
            institute_id=institute_id, name__iexact=serializer.validated_data["name"].strip()
        ).exists():
            raise ValidationError({"name": "A mapping with that name already exists."})
        serializer.save(institute_id=institute_id)
