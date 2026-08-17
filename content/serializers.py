from rest_framework import serializers

from cctv.models import CctvCamera, CctvConfig
from groups.serializers import GroupSerializer
from locations.serializers import LocationSerializer
from players.serializers import PlayerListSerializer

from .models import MediaFile, MediaFolder, ScheduledDeployment


class MediaFolderSerializer(serializers.ModelSerializer):
    file_count = serializers.IntegerField(read_only=True, default=0)
    location_name = serializers.CharField(source='location.name', read_only=True, default=None)
    group_name = serializers.CharField(source='group.name', read_only=True, default=None)
    # "Effective" = this folder's own location/group/common flag, or
    # (if unset) the nearest ancestor's — see MediaFolder's own
    # docstring. Read-only: a subfolder inherits by leaving its own
    # location/group/is_common unset, not by echoing the parent's
    # values back onto itself.
    effective_location_name = serializers.SerializerMethodField()
    effective_group_name = serializers.SerializerMethodField()
    effective_is_common = serializers.BooleanField(read_only=True)

    class Meta:
        model = MediaFolder
        fields = [
            'id', 'name', 'parent', 'location', 'location_name', 'group', 'group_name',
            'is_common', 'effective_location_name', 'effective_group_name', 'effective_is_common',
            'file_count', 'created_at',
        ]
        # is_common is deliberately not editable through the normal
        # create/update path every editor can reach — set from Settings
        # > Content Library (admin-only) via MediaFolderViewSet.
        # set_common instead. See content/views.py.
        read_only_fields = ['id', 'created_at', 'is_common']

    def get_effective_location_name(self, obj):
        loc = obj.effective_location
        return loc.name if loc else None

    def get_effective_group_name(self, obj):
        group = obj.effective_group
        return group.name if group else None

    def validate_parent(self, parent):
        if parent is None:
            return parent
        if self.instance and parent.pk == self.instance.pk:
            raise serializers.ValidationError('A folder cannot be its own parent.')
        if self.instance:
            node = parent
            while node is not None:
                if node.pk == self.instance.pk:
                    raise serializers.ValidationError("A folder can't be moved inside its own subfolder.")
                node = node.parent
        return parent


class _CctvCameraInlineSerializer(serializers.ModelSerializer):
    class Meta:
        model = CctvCamera
        fields = ['id', 'name', 'rtsp_url', 'sort_order']


class _CctvConfigInlineSerializer(serializers.ModelSerializer):
    cameras = _CctvCameraInlineSerializer(many=True, read_only=True)

    class Meta:
        model = CctvConfig
        fields = ['id', 'name', 'display_mode', 'rotation_interval', 'resolution', 'fps', 'cameras', 'is_active']


class MediaFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    thumbnail_file_url = serializers.SerializerMethodField()
    folder_name = serializers.CharField(source='folder.name', read_only=True, default=None)
    cctv_config = _CctvConfigInlineSerializer(read_only=True, default=None)

    class Meta:
        model = MediaFile
        fields = ['id', 'name', 'file', 'source_url', 'thumbnail_url', 'thumbnail_file_url', 'file_type', 'file_size', 'processing_status', 'url', 'folder', 'folder_name', 'cctv_config', 'width', 'height', 'is_deleted', 'deleted_at', 'created_at']
        read_only_fields = ['id', 'file_type', 'file_size', 'processing_status', 'thumbnail_url', 'width', 'height', 'is_deleted', 'deleted_at', 'created_at']

    def get_thumbnail_file_url(self, obj):
        if obj.thumbnail:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.thumbnail.url)
            return obj.thumbnail.url
        return None

    def validate_name(self, value):
        qs = MediaFile.objects.filter(name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Content with this name already exists.')
        return value

    def get_url(self, obj):
        if obj.source_url:
            return obj.source_url
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None


class _PlaylistInlineSerializer(serializers.Serializer):
    """Minimal playlist representation for ScheduledDeploymentSerializer.

    Not importing playlists.serializers.PlaylistSerializer here on
    purpose — that module already imports MediaFileSerializer from this
    one, and content <-> playlists both importing each other's
    serializers would be a circular import.
    """
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)


class ScheduledDeploymentSerializer(serializers.ModelSerializer):
    media_file_detail = MediaFileSerializer(source='media_file', read_only=True)
    playlist_detail = _PlaylistInlineSerializer(source='playlist', read_only=True)
    target_players_detail = PlayerListSerializer(source='target_players', many=True, read_only=True)
    target_groups_detail = GroupSerializer(source='target_groups', many=True, read_only=True)
    target_locations_detail = LocationSerializer(source='target_locations', many=True, read_only=True)

    class Meta:
        model = ScheduledDeployment
        fields = [
            'id', 'media_file', 'media_file_detail', 'playlist', 'playlist_detail',
            'target_players', 'target_players_detail',
            'target_groups', 'target_groups_detail',
            'target_locations', 'target_locations_detail',
            'duration', 'start_date', 'end_date',
            'last_deploy_status', 'created_at',
        ]
        read_only_fields = ['id', 'last_deploy_status', 'created_at']

    def validate(self, attrs):
        media_file = attrs.get('media_file', getattr(self.instance, 'media_file', None))
        playlist = attrs.get('playlist', getattr(self.instance, 'playlist', None))
        if bool(media_file) == bool(playlist):
            raise serializers.ValidationError('Set exactly one of media_file or playlist.')
        return attrs
