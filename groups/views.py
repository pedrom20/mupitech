from rest_framework import viewsets

from fleet_manager.permissions import IsEditorOrReadOnly

from .models import Group
from .serializers import GroupSerializer


class GroupViewSet(viewsets.ModelViewSet):
    """ViewSet for managing player groups."""
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    pagination_class = None
    permission_classes = [IsEditorOrReadOnly]
