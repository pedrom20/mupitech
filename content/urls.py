from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import MediaFileViewSet, MediaFolderViewSet, ScheduledDeploymentViewSet

router = DefaultRouter()
router.register('media', MediaFileViewSet, basename='media')
router.register('folders', MediaFolderViewSet)
router.register('schedules', ScheduledDeploymentViewSet, basename='schedule')

urlpatterns = [
    path('', include(router.urls)),
]
