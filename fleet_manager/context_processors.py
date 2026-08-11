from django.conf import settings


def app_version(request):
    # BUILD_DATE changes on every CI build (unlike APP_VERSION, which is
    # only bumped for actual releases) — used to cache-bust the static
    # asset URLs in index.html so every deploy forces a fresh fetch,
    # regardless of whether the human-facing version number changed.
    return {'app_version': settings.APP_VERSION, 'build_date': settings.BUILD_DATE}
