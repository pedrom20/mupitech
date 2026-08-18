from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import PlaylistViewSet, playlist_settings

router = DefaultRouter()
router.register('playlists', PlaylistViewSet)

urlpatterns = [
    path('playlist-settings/', playlist_settings),
    path('', include(router.urls)),
]
