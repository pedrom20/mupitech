from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from fleet_manager.permissions import IsEditorOrReadOnly
from history.logging import log_action

from .models import Location
from .serializers import LocationSerializer


class LocationViewSet(viewsets.ModelViewSet):
    """ViewSet for managing locations."""
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    pagination_class = None
    permission_classes = [IsEditorOrReadOnly]

    def get_queryset(self):
        from access.scoping import filter_locations
        return filter_locations(super().get_queryset(), self.request.user)

    def perform_create(self, serializer):
        location = serializer.save()
        log_action(self.request, 'create', 'location', target_id=location.id, target_name=location.name)

    def perform_update(self, serializer):
        location = serializer.save()
        log_action(self.request, 'update', 'location', target_id=location.id, target_name=location.name)

    def perform_destroy(self, instance):
        log_action(self.request, 'delete', 'location', target_id=instance.id, target_name=instance.name)
        instance.delete()

    @action(detail=True, methods=['post', 'delete'], url_path='logo')
    def logo(self, request, pk=None):
        """Upload or remove this location's own splash logo override."""
        location = self.get_object()
        from players.branding import save_logo_upload

        if request.method == 'DELETE':
            if location.splash_logo:
                location.splash_logo.delete(save=True)
            return Response(status=204)

        file = request.FILES.get('logo')
        if not file:
            return Response({'error': 'logo file is required'}, status=400)
        try:
            save_logo_upload(location, file)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'logo_url': location.splash_logo.url})

    @action(detail=True, methods=['post', 'delete'], url_path='standby')
    def standby(self, request, pk=None):
        """Upload or remove this location's own standby image override."""
        location = self.get_object()
        from players.branding import save_standby_upload

        if request.method == 'DELETE':
            if location.standby_image:
                location.standby_image.delete(save=True)
            return Response(status=204)

        file = request.FILES.get('standby')
        if not file:
            return Response({'error': 'standby file is required'}, status=400)
        try:
            save_standby_upload(location, file)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response({'success': True, 'standby_url': location.standby_image.url})
