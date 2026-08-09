from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import MediaFileViewSet, MediaFolderViewSet

router = DefaultRouter()
router.register('media', MediaFileViewSet, basename='media')
router.register('folders', MediaFolderViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
