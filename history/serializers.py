from rest_framework import serializers

from .models import AuditLog, PlaybackLog


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = ['id', 'timestamp', 'user', 'username', 'action',
                  'target_type', 'target_id', 'target_name', 'details',
                  'ip_address']


class PlaybackLogSerializer(serializers.ModelSerializer):
    player_name = serializers.CharField(source='player.name', read_only=True)

    class Meta:
        model = PlaybackLog
        fields = [
            'id',
            'player',
            'player_name',
            'asset_id',
            'asset_name',
            'mimetype',
            'event',
            'timestamp',
        ]
        read_only_fields = fields
