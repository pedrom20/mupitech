from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import MediaFileViewSet, MediaFolderViewSet, ScheduledDeploymentViewSet, content_library_settings

router = DefaultRouter()
router.register('media', MediaFileViewSet, basename='media')
router.register('folders', MediaFolderViewSet)
router.register('schedules', ScheduledDeploymentViewSet, basename='schedule')

urlpatterns = [
    path('content-library-settings/', content_library_settings),
    path('', include(router.urls)),
]
