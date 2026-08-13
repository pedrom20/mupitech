from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from fleet_manager.permissions import IsAdmin, IsSuperAdmin
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
        if self.request.query_params.get('deleted') == '1':
            qs = qs.filter(is_deleted=True)
        else:
            qs = qs.filter(is_deleted=False)
        kind = self.request.query_params.get('kind')
        if kind:
            qs = qs.filter(kind=kind)
        return qs

    def perform_create(self, serializer):
        image = serializer.save()
        log_action(self.request, 'create', 'branding_image', target_id=image.id, target_name=image.name)

    def perform_destroy(self, instance):
        """Soft-delete — recoverable from the recycle bin."""
        log_action(self.request, 'delete', 'branding_image', target_id=instance.id, target_name=instance.name)
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['is_deleted', 'deleted_at'])

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Recover a soft-deleted branding image from the recycle bin."""
        instance = BrandingImage.objects.filter(pk=pk).first()
        if not instance:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        instance.is_deleted = False
        instance.deleted_at = None
        instance.save(update_fields=['is_deleted', 'deleted_at'])
        log_action(request, 'restore', 'branding_image', target_id=instance.id, target_name=instance.name)
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=['delete'], permission_classes=[IsSuperAdmin])
    def purge(self, request, pk=None):
        """Permanently delete a branding image — only a superadmin can do this."""
        instance = BrandingImage.objects.filter(pk=pk).first()
        if not instance:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        log_action(request, 'purge', 'branding_image', target_id=instance.id, target_name=instance.name)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
