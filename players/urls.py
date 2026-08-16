from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .branding_library_views import BrandingImageViewSet
from .bulk_views import bulk_detail, bulk_list, bulk_scan, bulk_start
from .pairing_views import (
    pairing_approve,
    pairing_list,
    pairing_reject,
    pairing_request,
    pairing_status,
)
from .provision_views import provision_create, provision_detail, provision_retry
from .views import BulkActionView, PlayerViewSet, install_phonehome, register_player

router = DefaultRouter()
router.register('players', PlayerViewSet)
router.register('branding-library', BrandingImageViewSet)

urlpatterns = [
    path('players/register/', register_player, name='register-player'),
    path('pairing/request/', pairing_request, name='pairing-request'),
    path('pairing/pending/', pairing_list, name='pairing-list'),
    path('pairing/<uuid:pairing_id>/status/', pairing_status, name='pairing-status'),
    path('pairing/<uuid:pairing_id>/approve/', pairing_approve, name='pairing-approve'),
    path('pairing/<uuid:pairing_id>/reject/', pairing_reject, name='pairing-reject'),
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
