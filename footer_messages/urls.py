from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FooterMessageViewSet

router = DefaultRouter()
router.register('footer-messages', FooterMessageViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
