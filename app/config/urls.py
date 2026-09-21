from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),

    # DRF's browsable-API login form. Moved off `api/auth/` — that prefix
    # now carries the JSON login/logout the console posts to, and these
    # HTML form views would shadow them. `api-auth/` is DRF's own
    # documented prefix for this.
    path("api-auth/", include("rest_framework.urls")),

    # The contract, and two ways to read it.
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
