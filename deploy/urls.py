from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DeployTaskViewSet

router = DefaultRouter()
router.register('deploy', DeployTaskViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
