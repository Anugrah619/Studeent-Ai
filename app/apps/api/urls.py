from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("batches", views.BatchViewSet, basename="batch")
router.register("students", views.StudentViewSet, basename="student")
router.register("flags", views.FlagViewSet, basename="flag")
router.register("papers", views.TestPaperViewSet, basename="paper")
router.register("dashboard", views.DashboardViewSet, basename="dashboard")
router.register("my/plan", views.MyPlanViewSet, basename="my-plan")
router.register("my/study-logs", views.StudyLogViewSet, basename="my-study-log")

urlpatterns = [path("", include(router.urls))]
