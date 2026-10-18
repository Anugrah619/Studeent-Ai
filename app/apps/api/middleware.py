"""Refuse the API to anyone who still owes a password change.

A student's first password is chosen by someone else, written down, and
handed over. Making them replace it is only a policy if the server enforces
it: a rule that lives in the login screen is a rule a script ignores. So the
check is here, in middleware, where it covers every `/api/` route including
ones that do not exist yet — the alternative, a permission class each
viewset has to remember to include, fails open the first time somebody forgets.

The allow-list is short and is the whole of what an account in this state may
do: say who it is (`/api/me/`, so the app can see the flag), change the
password, log out, and fetch a CSRF cookie. Everything else is a 403 carrying
`code: "password_change_required"`, which the client branches on rather than
parsing the sentence.

Only `/api/` is gated. The Django admin has its own password-change flow and
is reachable only by staff, who are never issued a temporary password by the
provisioning endpoints.
"""

from __future__ import annotations

from django.http import JsonResponse

CODE = "password_change_required"

#: Prefix match. `/api/auth/` covers csrf, login, logout and password; a
#: person mid-change may still sign in again or out.
ALLOWED_PREFIXES = ("/api/auth/", "/api/me/")


class PasswordChangeRequiredMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/") and not request.path.startswith(ALLOWED_PREFIXES):
            user = getattr(request, "user", None)
            if user is not None and user.is_authenticated and user.must_change_password:
                return JsonResponse(
                    {
                        "detail": "Choose a new password before you continue.",
                        "code": CODE,
                    },
                    status=403,
                )
        return self.get_response(request)
