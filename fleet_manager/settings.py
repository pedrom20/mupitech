import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Both django-ratelimit (below) and DRF's own AnonRateThrottle/
# UserRateThrottle (REST_FRAMEWORK, further down) hit the same real,
# shared Redis-backed cache — with them live during `manage.py test`,
# unrelated tests that each make a handful of requests (DualMFALoginTests,
# EmailOTPTests, SetupWizardTests, ...) collectively trip a real
# "N/minute" limit against the same 127.0.0.1 test-client IP, well
# before any single test means to exercise rate-limiting itself —
# nothing in the suite asserts on a 429/403 *from* a limit, so there's
# nothing to lose by turning both off only here. Never disabled outside
# the test runner.
_UNDER_TEST = 'test' in sys.argv
RATELIMIT_ENABLE = not _UNDER_TEST

_DEFAULT_DEV_KEY = 'django-insecure-fleet-manager-dev-key-change-in-production'

DEBUG = os.environ.get('DJANGO_DEBUG', 'False').lower() in ('true', '1')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '' if not DEBUG else _DEFAULT_DEV_KEY)
if not SECRET_KEY:
    raise RuntimeError(
        'DJANGO_SECRET_KEY environment variable is required when DEBUG is off.'
    )

# Dedicated Fernet key (base64, `Fernet.generate_key()`) for encrypting
# MFA/TOTP secrets at rest — kept separate from SECRET_KEY so rotating
# SECRET_KEY doesn't also silently invalidate everyone's 2FA (see
# mfa/crypto.py for the fallback used in dev when this is unset).
MFA_ENCRYPTION_KEY = os.environ.get('MFA_ENCRYPTION_KEY', '')

# Duo Security Auth API credentials (mfa/duo.py) — from an "Auth API"
# application created in the Duo Admin Panel. Optional: Duo push stays
# unavailable (mfa.duo.duo_configured() is False) until all three are
# set, TOTP keeps working either way.
DUO_IKEY = os.environ.get('DUO_IKEY', '')
DUO_SKEY = os.environ.get('DUO_SKEY', '')
DUO_HOST = os.environ.get('DUO_HOST', '')

# privacyIDEA server credentials (mfa/privacyidea.py) — a self-hosted
# instance deployed separately (see deploy/privacyidea/). Optional:
# privacyIDEA stays unavailable (mfa.privacyidea.privacyidea_configured()
# is False) until all four are set.
PRIVACYIDEA_URL = os.environ.get('PRIVACYIDEA_URL', '')
PRIVACYIDEA_ADMIN_USER = os.environ.get('PRIVACYIDEA_ADMIN_USER', '')
PRIVACYIDEA_ADMIN_PASSWORD = os.environ.get('PRIVACYIDEA_ADMIN_PASSWORD', '')
PRIVACYIDEA_REALM = os.environ.get('PRIVACYIDEA_REALM', '')
PRIVACYIDEA_RESOLVER = os.environ.get('PRIVACYIDEA_RESOLVER', '')
# Most self-hosted privacyIDEA instances (see deploy/privacyidea/) run
# behind a self-signed certificate — set to a falsy value to skip TLS
# verification on the Fleet Manager -> privacyIDEA link. Defaults to
# verifying, same as requests' own default; only turn this off for an
# instance you control on a trusted network.
PRIVACYIDEA_VERIFY_SSL = os.environ.get('PRIVACYIDEA_VERIFY_SSL', 'true').lower() not in ('false', '0', 'no')

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1' if not DEBUG else '*').split(',')

INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'django_celery_beat',
    'channels',
    'locations',
    'groups',
    'content',
    'cctv',
    'history',
    'players',
    'deploy',
    'playlists',
    'access',
    'mfa',
    'footer_messages',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'fleet_manager.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'fleet_manager.context_processors.app_version',
            ],
        },
    },
]

WSGI_APPLICATION = 'fleet_manager.wsgi.application'
ASGI_APPLICATION = 'fleet_manager.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')],
        },
    },
}

if os.environ.get('DATABASE_URL') or os.environ.get('DB_ENGINE', '').startswith('django.db.backends.postgresql'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('DB_NAME', 'fleet_manager'),
            'USER': os.environ.get('DB_USER', 'fleet_manager'),
            'PASSWORD': os.environ.get('DB_PASSWORD', 'fleet_manager'),
            'HOST': os.environ.get('DB_HOST', 'db'),
            'PORT': os.environ.get('DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

AUTHENTICATION_BACKENDS = ['django.contrib.auth.backends.ModelBackend']

# Optional AD/LDAP login (fleet_manager/ldap_backend.py) — inert unless
# all four AUTH_LDAP_* env vars below are set; django_auth_ldap /
# python-ldap are only imported when they are. See that module's
# docstring for what this does and doesn't handle (notably: no
# AD-group-to-role mapping yet).
from fleet_manager.ldap_backend import ldap_configured, ldap_settings  # noqa: E402

if ldap_configured():
    globals().update(ldap_settings())
    AUTHENTICATION_BACKENDS.append('django_auth_ldap.backend.LDAPBackend')

# Internationalization
LANGUAGE_CODE = os.environ.get('LANGUAGE_CODE', 'pt')

LANGUAGES = [
    ('pt', 'Português'),
    ('en', 'English'),
    ('uk', 'Ukrainian'),
    ('fr', 'French'),
    ('de', 'German'),
    ('pl', 'Polish'),
]

LOCALE_PATHS = [BASE_DIR / 'locale']

USE_I18N = True
USE_TZ = True
TIME_ZONE = os.environ.get('TIME_ZONE', 'Europe/Lisbon')

# Static files
STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

# Media files (user uploads)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# This FM's own public base URL (no trailing slash), e.g.
# https://fm.example.com — needed anywhere an absolute URL has to be
# built outside of a request/response cycle (request.build_absolute_uri()
# isn't available there). Currently only footer_messages' footer logo
# uses this: devices fetch it directly from this FM over HTTP, so they
# need a real absolute URL, not the request-relative one the frontend
# uses. Left blank by default — the footer logo just doesn't show
# until this is set.
FM_PUBLIC_URL = os.environ.get('FM_PUBLIC_URL', '').rstrip('/')

# Allow large file uploads (500MB)
DATA_UPLOAD_MAX_MEMORY_SIZE = 500 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 500 * 1024 * 1024

# CSRF
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CSRF_TRUSTED_ORIGINS', 'http://localhost:9000').split(',')
]

# REST Framework
REST_FRAMEWORK = {
    # TokenAuthentication first, SessionAuthentication second — order
    # matters here beyond which one actually authenticates a request
    # (that part is unaffected: Token only engages when an Authorization
    # header is present, so normal cookie-based frontend requests still
    # authenticate via the session either way). DRF's
    # APIView.handle_exception() coerces a NotAuthenticated (401) down
    # to 403 whenever get_authenticate_header() — which only ever
    # consults get_authenticators()[0] — returns falsy, and
    # SessionAuthentication.authenticate_header() is unimplemented
    # (returns None). With Session listed first, every anonymous
    # request to any endpoint was silently coerced to 403, identical to
    # an authenticated-but-forbidden response — the frontend's global
    # 401 handler (services/api.ts) could never tell "not logged in"
    # apart from "logged in, no permission" and had no reliable signal
    # to redirect an expired session back to /login. TokenAuthentication.
    # authenticate_header() returns 'Token' (truthy), so listing it
    # first restores real 401s for the anonymous case.
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [] if _UNDER_TEST else [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/minute',
        'user': '300/minute',
    },
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 100,
}

CORS_ALLOW_ALL_ORIGINS = DEBUG

# Cache (used for distributed locks, e.g. poll dedup)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0'),
    }
}

# Celery
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')
CELERY_RESULT_EXPIRES = 3600
CELERY_TASK_ROUTES = {
    'content.tasks.transcode_video': {'queue': 'transcode'},
    'content.tasks.generate_image_thumbnail': {'queue': 'transcode'},
}

# Fleet Manager settings
PLAYER_POLL_INTERVAL = int(os.environ.get('PLAYER_POLL_INTERVAL', '60'))
PLAYER_REQUEST_TIMEOUT = int(os.environ.get('PLAYER_REQUEST_TIMEOUT', '10'))

# Legado: fork de terceiros alex1981-tech, mantido só como fallback
# defensivo para um device_type desconhecido — nenhum dos 3 tipos reais
# (x86/pi4/pi5) usa isto desde a Fase 5 do plano de imagem personalizada.
# Ver docs/anthias-version-analysis.md.
ANTHIAS_IMAGE_REGISTRY = os.environ.get('ANTHIAS_IMAGE_REGISTRY', 'ghcr.io/alex1981-tech')

# Fork próprio (pedrom20/mupitech-player, ramo mupitech-custom — ver
# MAINTENANCE.md nesse repo) com paridade de funcionalidades construída
# sobre o Anthias oficial atual, substituindo a dependência do fork
# alex1981-tech acima. Nomenclatura de imagem diferente da do fork antigo
# (hífen antes do nome do serviço, não barra) — ver
# docker-compose-player-{x86,pi4,pi5}.yml. Tags de board seguem
# tools/image_builder/constants.py (x86, pi4-64, pi5).
#
# Pi4/Pi5 já constroem e publicam (Fase 5), mas ainda não foram validados
# em hardware real — ver MAINTENANCE.md no fork antes de confiar neles em
# produção.
ANTHIAS_IMAGE_REGISTRY_X86 = os.environ.get('ANTHIAS_IMAGE_REGISTRY_X86', 'ghcr.io/pedrom20/mupitech-player')
ANTHIAS_IMAGE_TAG_SUFFIX_X86 = os.environ.get('ANTHIAS_IMAGE_TAG_SUFFIX_X86', 'latest-x86')
ANTHIAS_IMAGE_REGISTRY_PI4 = os.environ.get('ANTHIAS_IMAGE_REGISTRY_PI4', 'ghcr.io/pedrom20/mupitech-player')
ANTHIAS_IMAGE_TAG_SUFFIX_PI4 = os.environ.get('ANTHIAS_IMAGE_TAG_SUFFIX_PI4', 'latest-pi4-64')
ANTHIAS_IMAGE_REGISTRY_PI5 = os.environ.get('ANTHIAS_IMAGE_REGISTRY_PI5', 'ghcr.io/pedrom20/mupitech-player')
ANTHIAS_IMAGE_TAG_SUFFIX_PI5 = os.environ.get('ANTHIAS_IMAGE_TAG_SUFFIX_PI5', 'latest-pi5')

# Shared secret for player phone-home registration (empty = open mode)
PLAYER_REGISTER_TOKEN = os.environ.get('PLAYER_REGISTER_TOKEN', '')

# Feature flags — lets a deployment turn off functionality it doesn't need
# (e.g. CCTV) without removing the code. Read by the frontend via
# GET /api/system/features/.
FEATURES = {
    'cctv': os.environ.get('FEATURE_CCTV_ENABLED', 'False').lower() in ('true', '1'),
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# App version (set via Docker build args, fallback to changelog.ts)
APP_VERSION = os.environ.get('APP_VERSION', '').strip()
if not APP_VERSION or APP_VERSION == 'dev':
    try:
        import re as _re
        _changelog_path = os.path.join(BASE_DIR, 'static', 'src', 'changelog.ts')
        with open(_changelog_path) as _f:
            _m = _re.search(r"APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", _f.read())
            if _m:
                APP_VERSION = _m.group(1)
            else:
                APP_VERSION = 'dev'
    except Exception:
        APP_VERSION = 'dev'
BUILD_DATE = os.environ.get('BUILD_DATE', 'unknown')

# ---------- Production security (when behind Cloudflare / reverse proxy) ----------
if not DEBUG:
    # Most deployments of this app are reached over plain HTTP on a LAN
    # (nginx.conf itself never terminates TLS) — a *_COOKIE_SECURE=True
    # cookie gets silently dropped by the browser on such a connection
    # (it's only ever sent back over HTTPS), which breaks login/session
    # persistence entirely despite the server-side login succeeding.
    # Default off; set to true only for a deployment genuinely served
    # over HTTPS end-to-end (e.g. the optional cloudflared tunnel
    # profile in docker-compose.yml, or your own TLS-terminating proxy
    # in front of nginx).
    SESSION_COOKIE_SECURE = os.environ.get('SESSION_COOKIE_SECURE', 'false').lower() in ('true', '1', 'yes')
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    SESSION_COOKIE_AGE = 28800  # 8 hours
    CSRF_COOKIE_SECURE = os.environ.get('CSRF_COOKIE_SECURE', 'false').lower() in ('true', '1', 'yes')
    CSRF_COOKIE_SAMESITE = 'Lax'
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'SAMEORIGIN'
