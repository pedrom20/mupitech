from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .branding_library_views import BrandingImageViewSet
from .bulk_views import bulk_detail, bulk_list, bulk_scan, bulk_start
from .provision_views import provision_create, provision_detail, provision_retry
from .views import BulkActionView, PlayerViewSet, install_phonehome, register_player

router = DefaultRouter()
router.register('players', PlayerViewSet)
router.register('branding-library', BrandingImageViewSet)

urlpatterns = [
    path('players/register/', register_player, name='register-player'),
    path('players/install-phonehome/', install_phonehome, name='install-phonehome'),
    path('provision/', provision_create, name='provision-create'),
    path('provision/<uuid:task_id>/', provision_detail, name='provision-detail'),
    path('provision/<uuid:task_id>/retry/', provision_retry, name='provision-retry'),
    path('bulk-provision/scan/', bulk_scan, name='bulk-provision-scan'),
    path('bulk-provision/start/', bulk_start, name='bulk-provision-start'),
    path('bulk-provision/<uuid:task_id>/', bulk_detail, name='bulk-provision-detail'),
    path('bulk-provision/', bulk_list, name='bulk-provision-list'),
    path('', include(router.urls)),
    path('bulk/<str:action>/', BulkActionView.as_view(), name='bulk-action'),
]
