from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import auth, ingest_views, my_views, views

router = DefaultRouter()
router.register("batches", views.BatchViewSet, basename="batch")
router.register("mentors", views.MentorViewSet, basename="mentor")
router.register("students", views.StudentViewSet, basename="student")
router.register("flags", views.FlagViewSet, basename="flag")
router.register("papers", views.TestPaperViewSet, basename="paper")
# Retrieve-only: `GET /api/questions/{id}/`. The router generates no list
# route because the viewset has no `list` method, which is the intent —
# see `QuestionViewSet`.
router.register("questions", views.QuestionViewSet, basename="question")
router.register("dashboard", views.DashboardViewSet, basename="dashboard")

# Getting the institute's own results in. See `ingest_views` for the order.
router.register("ingest/batches", ingest_views.IngestBatchViewSet, basename="ingest-batch")
router.register("ingest/mappings", ingest_views.MappingProfileViewSet, basename="ingest-mapping")

# The student app. Everything under `my/` is addressed by account, never by
# id — see the docstring of `my_views` for why that is the whole design.
# `my/plan`, `my/study-logs` and so on are registered before the bare `my`
# so the longer prefixes are matched first; `MyViewSet` itself has no list
# or detail route, only named actions (`my/profile/`, `my/topics/`, …).
router.register("my/plan", my_views.MyPlanViewSet, basename="my-plan")
router.register("my/study-logs", my_views.StudyLogViewSet, basename="my-study-log")
router.register("my/confidence", my_views.ConfidenceRatingViewSet, basename="my-confidence")
router.register("my/revisions", my_views.RevisionViewSet, basename="my-revision")
router.register("my/attempts", my_views.MyAttemptViewSet, basename="my-attempt")
router.register("my/questions", my_views.MyQuestionViewSet, basename="my-question")
router.register("my", my_views.MyViewSet, basename="my")

urlpatterns = [
    # Auth first: these must not be swallowed by the router's catch-all
    # detail routes, and they are the only endpoints an anonymous caller
    # can reach.
    path("auth/csrf/", auth.CsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", auth.LoginView.as_view(), name="auth-login"),
    path("auth/logout/", auth.LogoutView.as_view(), name="auth-logout"),
    path("auth/password/", auth.PasswordChangeView.as_view(), name="auth-password"),
    path("me/", auth.MeView.as_view(), name="me"),
    # Before the router: `papers/<pk>/blueprint/` and `ingest/results/` are
    # not viewset routes, and the router's catch-all detail pattern must not
    # get the first look at them.
    path("papers/<int:pk>/blueprint/", ingest_views.PaperBlueprintView.as_view(),
         name="paper-blueprint"),
    path("ingest/results/", ingest_views.IngestResultsView.as_view(), name="ingest-results"),
    path("", include(router.urls)),
]
