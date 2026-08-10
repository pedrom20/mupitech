from rest_framework import viewsets

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
