from rest_framework import viewsets

from fleet_manager.permissions import IsAdmin
from history.logging import log_action

from .models import BrandingImage
from .serializers import BrandingImageSerializer


class BrandingImageViewSet(viewsets.ModelViewSet):
    """Reusable library of splash-logo/standby images — uploaded once,
    picked from wherever branding is set (fleet-wide, group, location,
    device) instead of always uploading a fresh file."""
    queryset = BrandingImage.objects.all()
    serializer_class = BrandingImageSerializer
    pagination_class = None
    permission_classes = [IsAdmin]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        kind = self.request.query_params.get('kind')
        if kind:
            qs = qs.filter(kind=kind)
        return qs

    def perform_create(self, serializer):
        image = serializer.save()
        log_action(self.request, 'create', 'branding_image', target_id=image.id, target_name=image.name)

    def perform_destroy(self, instance):
        log_action(self.request, 'delete', 'branding_image', target_id=instance.id, target_name=instance.name)
        instance.delete()
