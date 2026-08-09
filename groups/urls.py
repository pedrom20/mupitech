from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import GroupViewSet

router = DefaultRouter()
router.register('groups', GroupViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
