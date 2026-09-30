from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import auth, views

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
router.register("my/plan", views.MyPlanViewSet, basename="my-plan")
router.register("my/study-logs", views.StudyLogViewSet, basename="my-study-log")

urlpatterns = [
    # Auth first: these must not be swallowed by the router's catch-all
    # detail routes, and they are the only endpoints an anonymous caller
    # can reach.
    path("auth/csrf/", auth.CsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", auth.LoginView.as_view(), name="auth-login"),
    path("auth/logout/", auth.LogoutView.as_view(), name="auth-logout"),
    path("me/", auth.MeView.as_view(), name="me"),
    path("", include(router.urls)),
]
