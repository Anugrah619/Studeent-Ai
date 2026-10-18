"""Session auth for the console and the student PWA.

    GET  /api/auth/csrf/     hand the browser a CSRF cookie
    POST /api/auth/login/    {username, password} -> the caller's identity
    POST /api/auth/logout/   end the session
    POST /api/auth/password/ change my password (required on first sign-in)
    GET  /api/me/            who am I, what am I allowed to see

SIGNING IN
    `username` is a staff username *or a student's roll number*; the password
    decides which. A student's first password is a temporary one issued by the
    institute, and `must_change_password` in the response says so. Until it is
    changed every route except this module's returns 403
    `password_change_required` (see `middleware.py`) — enforced on the server,
    not by the login screen.

WHY SESSIONS AND NOT TOKENS
    Not inertia. `TenantMiddleware` reads `request.user` to decide which
    institute to bind the Postgres connection to, and `request.user` is
    populated by Django's `AuthenticationMiddleware` — i.e. *before* the
    view runs. DRF's token and JWT authenticators run **inside** the view,
    by which time the middleware has already seen `AnonymousUser`, decided
    this is not a tenant request, and left the connection unscoped.

    The failure is silent: the request succeeds, RLS never engages, and
    only `TenantScopedMixin` stands between a caller and another
    institute's students. Moving to tokens therefore means moving tenant
    binding into a DRF authentication class or a DRF-aware hook — it is a
    deliberate piece of work, not a settings change. Flagged prominently
    in AGENT_HANDOFF.md; the DB agent asked to be told.

CSRF
    `CsrfViewMiddleware` is active, so every unsafe request needs the
    cookie and the `X-CSRFToken` header. A fresh browser has neither, hence
    `/api/auth/csrf/`: call it once at app boot, then log in. Login itself
    also re-issues the cookie, because `django.contrib.auth.login()`
    rotates the CSRF token along with the session key and a client holding
    the pre-login token would fail its next POST.
"""

from __future__ import annotations

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import serializers as ser

MENTOR, STUDENT, DIRECTOR = "mentor", "student", "director"


def role_of(user) -> str | None:
    """The caller's role, derived from what they are attached to.

    There is no `role` column anywhere — a person's role *is* which table
    points at their user row, which keeps the two from disagreeing. The
    director case is the exception and the one soft spot: it falls back to
    `is_staff`, because no `Director` model exists yet. That matches the
    DB agent's guidance that production directors should be staff,
    non-superuser accounts (which RLS then scopes normally), but it does
    mean any staff account without a Mentor or Student row reads as a
    director. Recorded as a schema gap rather than papered over.
    """
    if user is None or not user.is_authenticated:
        return None
    if getattr(user, "student", None) is not None:
        return STUDENT
    if getattr(user, "mentor", None) is not None:
        return MENTOR
    if user.is_staff or user.is_superuser:
        return DIRECTOR
    return None


def identity(user) -> dict:
    """The `/api/me/` payload. One shape, used by login and by me."""
    mentor = getattr(user, "mentor", None)
    student = getattr(user, "student", None)
    owner = mentor or student
    return {
        "id": user.id,
        "username": user.get_username(),
        "name": (getattr(owner, "name", "") or user.get_full_name() or user.get_username()),
        "email": user.email or getattr(owner, "email", "") or "",
        "role": role_of(user),
        "institute": owner.institute if owner is not None else None,
        "mentor_id": mentor.id if mentor else None,
        "student_id": student.id if student else None,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "must_change_password": user.must_change_password,
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Set the CSRF cookie so a fresh browser can POST to login."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(
        request=None,
        responses={200: ser.DetailSerializer},
        tags=["auth"],
        description="Sets the `csrftoken` cookie. Call once before POSTing to login.",
    )
    def get(self, request):
        return Response({"detail": "CSRF cookie set."})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class LoginView(APIView):
    """Exchange credentials for a session cookie.

    `authentication_classes` is empty on purpose: DRF's
    `SessionAuthentication` enforces CSRF on the *authenticated* path, and
    running it here would have it inspect a session that does not exist
    yet. Django's `CsrfViewMiddleware` still protects this POST.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(
        request=ser.LoginSerializer,
        responses={
            200: ser.MeSerializer,
            400: ser.DetailSerializer,
            429: ser.DetailSerializer,
        },
        tags=["auth"],
    )
    def post(self, request):
        form = ser.LoginSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        credentials = {
            "username": form.validated_data["username"],
            "password": form.validated_data["password"],
        }
        if form.validated_data.get("institute"):
            credentials["institute"] = form.validated_data["institute"]
        user = authenticate(request, **credentials)
        if user is None:
            # One message for both "no such user" and "wrong password".
            # Distinguishing them tells an attacker which usernames exist.
            return Response(
                {"detail": "Incorrect username or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user.is_active:
            return Response(
                {"detail": "This account is disabled."},
                status=status.HTTP_403_FORBIDDEN,
            )
        login(request, user)
        return Response(ser.MeSerializer(identity(user)).data)


class LogoutView(APIView):
    """End the session. POST only — a GET logout is a CSRF vector."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None}, tags=["auth"])
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordChangeView(APIView):
    """Replace my password. For a new student this is the end of first sign-in.

    Needs the current password even though the caller is signed in: a
    session left open on a shared phone should not be enough to take over
    the account. On success the session survives (the hash that ties a
    session to a password is refreshed) and `must_change_password` clears, so
    the same tab carries straight on into the app.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password"

    @extend_schema(
        request=ser.PasswordChangeSerializer,
        responses={200: ser.MeSerializer, 400: ser.DetailSerializer, 429: ser.DetailSerializer},
        tags=["auth"],
    )
    def post(self, request):
        form = ser.PasswordChangeSerializer(data=request.data, context={"request": request})
        form.is_valid(raise_exception=True)
        user = request.user
        user.set_password(form.validated_data["new_password"])
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        # `set_password` changes the value the session is bound to; without
        # this the caller is logged out by their own successful request.
        update_session_auth_hash(request, user)
        return Response(ser.MeSerializer(identity(user)).data)


class MeView(APIView):
    """Who the caller is, and which institute they are bound to.

    The console reads `role` to decide which navigation to render, and
    `institute` to label it. Both come from the same place the tenant
    middleware reads, so a UI that trusts this payload and a database that
    enforces RLS cannot disagree about who the caller is.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ser.MeSerializer, tags=["auth"])
    def get(self, request):
        return Response(ser.MeSerializer(identity(request.user)).data)
