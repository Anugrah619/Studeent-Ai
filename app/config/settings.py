"""
Django settings for the Student AI platform.

Config comes from the environment (see .env / .env.example) so nothing
secret is ever committed.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["127.0.0.1", "localhost"])


# ---------------------------------------------------------------- apps

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

# Order matters for readability, not for loading: syllabus defines the topic
# spine, tenancy hangs people off it, events reference both, derived is
# rebuildable from events.
THIRD_PARTY_APPS = [
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
]

LOCAL_APPS = [
    "apps.syllabus",
    "apps.tenancy",
    "apps.events",
    "apps.ingestion",
    "apps.derived",
    "apps.reasoning",
    "apps.api",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Also needs request.user. Before the tenant middleware so a refused
    # request never bothers to bind a tenant.
    "apps.api.middleware.PasswordChangeRequiredMiddleware",
    # Must sit after AuthenticationMiddleware: it reads request.user to pick
    # the tenant, then binds the connection to it for the rest of the
    # request. See apps/tenancy/middleware.py and migration tenancy/0003.
    "apps.tenancy.middleware.TenantMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# ------------------------------------------------------------ database

DATABASES = {
    "default": env.db("DATABASE_URL"),
}


# ---------------------------------------------------------------- auth

# Set before the first migration and never changed. Django makes swapping
# the user model after initial migrate extremely painful.
AUTH_USER_MODEL = "tenancy.User"

# One backend for every kind of account: a staff username, or a student's
# roll number. See apps/tenancy/auth_backends.py for why it is one backend
# and not two in a list.
AUTHENTICATION_BACKENDS = ["apps.tenancy.auth_backends.AccountBackend"]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# ------------------------------------------------------------- i18n/tz

LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True


# -------------------------------------------------------------- static

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"


# ----------------------------------------------------------------- API

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,

    # Throttles are opt-in per view, by scope (`ScopedRateThrottle`), so no
    # existing route changes behaviour. These cover the places where a
    # stranger can guess, or an account can be made to write without limit:
    #
    #   login        per client address. Generous enough for a classroom
    #                behind one NAT, tight enough that 8-character temporary
    #                passwords (~40 bits) cannot be walked.
    #   password     per account. Changing a password needs the old one, so
    #                this is the second place a stolen session could guess.
    #   credentials  per staff account. Issuing a login costs a full password
    #                hash (~1 s), which is also a cheap way to tie up a worker.
    #   student_write  per student, for the two append-only tables a student
    #                can now write to.
    #   plan_generate  per student. Building a plan reads their whole state.
    #   ingest       per staff account. Parsing a results file is the heaviest
    #                thing a request can ask for.
    #
    # Per-account lockout is deliberately absent: it hands anyone who knows a
    # roll number the ability to lock that student out. The cache behind this
    # is Django's default, which is per-process — fine for one dev server, and
    # the thing to swap for a shared cache before running more than one worker.
    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
        "password": "5/min",
        "credentials": "30/hour",
        "student_write": "120/hour",
        "plan_generate": "30/hour",
        "ingest": "20/hour",
    },
    # Zero trusted proxies: identify a client by the socket address, never by
    # an `X-Forwarded-For` header the client wrote itself. With DRF's default
    # (None) that header is believed, and rotating it defeats every throttle
    # above. Set NUM_PROXIES behind a reverse proxy.
    "NUM_PROXIES": env.int("NUM_PROXIES", default=0),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Student AI API",
    "DESCRIPTION": (
        "Contract between the Django backend and the React console / student PWA. "
        "This schema is the source of truth — regenerate with "
        "`manage.py spectacular --file ../openapi.yaml` after any serializer change."
    ),
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api",
    # Pins component names the generated client already imports. Without this
    # a new field named `source` or `status` renames `SourceEnum` /
    # `StatusEnum` to a hash. See apps/api/enums.py.
    "ENUM_NAME_OVERRIDES": {
        "StatusEnum": "apps.api.enums.ATTEMPT_STATUS",
        "SourceEnum": "apps.api.enums.ATTEMPT_SOURCE",
        "PaperSourceEnum": "apps.api.enums.PAPER_SOURCE",
    },
}

# React dev server. Tightened before anything is deployed.
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:5173", "http://127.0.0.1:5173"],
)
CORS_ALLOW_CREDENTIALS = True


# ------------------------------------------------------- reasoning layer

# Google AI Studio key. Absent is a supported state: the reasoning layer
# replays cached traces and otherwise reports that it cannot run. It never
# fabricates a diagnosis — a made-up finding presented as the model's is
# the one failure this product could not survive.
GEMINI_API_KEY = env("GEMINI_API_KEY", default="")
GEMINI_MODEL = env("GEMINI_MODEL", default="gemini-2.5-flash")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.console.EmailBackend",
    },
}
