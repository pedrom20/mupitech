import logging
from urllib.parse import urlparse

from django.db.models import Count
from rest_framework import parsers, serializers, status, viewsets
from rest_framework.response import Response

from fleet_manager.permissions import IsEditorOrReadOnly
from deploy.audit import log_action

from .models import MediaFile, MediaFolder, detect_file_type
from .serializers import MediaFileSerializer, MediaFolderSerializer
from .tasks import _is_safe_url, fetch_og_image_task, generate_image_thumbnail, transcode_video

logger = logging.getLogger(__name__)


class MediaFolderViewSet(viewsets.ModelViewSet):
    """ViewSet for managing media folders."""
    queryset = MediaFolder.objects.annotate(file_count=Count('files'))
    serializer_class = MediaFolderSerializer
    permission_classes = [IsEditorOrReadOnly]

    def perform_create(self, serializer):
        folder = serializer.save()
        log_action(self.request, 'create', 'folder', target_id=folder.id, target_name=folder.name)

    def perform_update(self, serializer):
        folder = serializer.save()
        log_action(self.request, 'update', 'folder', target_id=folder.id, target_name=folder.name)

    def perform_destroy(self, instance):
        log_action(self.request, 'delete', 'folder', target_id=instance.id, target_name=instance.name)
        instance.delete()


class MediaFileViewSet(viewsets.ModelViewSet):
    """ViewSet for managing uploaded media files."""
    serializer_class = MediaFileSerializer
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]
    permission_classes = [IsEditorOrReadOnly]

    def get_queryset(self):
        qs = MediaFile.objects.select_related('folder').prefetch_related('cctv_config__cameras').all()
        folder = self.request.query_params.get('folder')
        if folder == 'none':
            qs = qs.filter(folder__isnull=True)
        elif folder:
            qs = qs.filter(folder_id=folder)
        file_type = self.request.query_params.get('file_type')
        if file_type:
            qs = qs.filter(file_type=file_type)
        return qs

    def perform_destroy(self, instance):
        """Delete MediaFile; if CCTV, stop stream and delete config first."""
        log_action(self.request, 'delete', 'media', target_id=instance.id, target_name=instance.name)
        if instance.file_type == 'cctv':
            try:
                cctv_config = instance.cctv_config
                if cctv_config.is_active:
                    from cctv.services import stop_stream
                    stop_stream(str(cctv_config.id))
                cctv_config.delete()
            except Exception:
                pass  # cctv_config may not exist
        instance.delete()

    def perform_create(self, serializer):
        uploaded_file = self.request.FILES.get('file')
        source_url = self.request.data.get('source_url')
        if uploaded_file:
            name = self.request.data.get('name') or uploaded_file.name
            file_type = detect_file_type(uploaded_file.name)
            instance = serializer.save(
                name=name,
                file_type=file_type,
                file_size=uploaded_file.size,
            )
            log_action(self.request, 'upload', 'media', target_id=instance.id, target_name=name, details={'file_type': file_type, 'size': uploaded_file.size})
            if file_type == 'video':
                instance.processing_status = 'processing'
                instance.save(update_fields=['processing_status'])
                transcode_video.delay(str(instance.id))
            elif file_type == 'image':
                generate_image_thumbnail.delay(str(instance.id))
        elif source_url:
            # Allow CCTV player URLs on the same server (local network)
            parsed = urlparse(source_url)
            is_cctv_url = parsed.path.startswith('/cctv/')
            if not is_cctv_url and not _is_safe_url(source_url):
                raise serializers.ValidationError({'source_url': 'URL points to a private or disallowed network.'})
            name = self.request.data.get('name') or source_url
            instance = serializer.save(
                name=name,
                source_url=source_url,
                file_type='web',
                file_size=0,
            )
            log_action(self.request, 'create', 'media', target_id=instance.id, target_name=name, details={'source_url': source_url})
            # Fetch og:image asynchronously to avoid blocking the request
            fetch_og_image_task.delay(str(instance.id), source_url)
