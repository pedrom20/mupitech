from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FooterMessageViewSet, footer_logo, footer_settings

router = DefaultRouter()
router.register('footer-messages', FooterMessageViewSet)

urlpatterns = [
    path('footer-messages-settings/', footer_settings),
    path('footer-messages-settings/logo/', footer_logo),
    path('', include(router.urls)),
]
