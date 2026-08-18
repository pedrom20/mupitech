from rest_framework import serializers

from groups.serializers import GroupSerializer
from locations.serializers import LocationSerializer
from players.serializers import PlayerListSerializer

from .models import FooterMessage


class FooterMessageSerializer(serializers.ModelSerializer):
    target_players_detail = PlayerListSerializer(source='target_players', many=True, read_only=True)
    target_groups_detail = GroupSerializer(source='target_groups', many=True, read_only=True)
    target_locations_detail = LocationSerializer(source='target_locations', many=True, read_only=True)

    class Meta:
        model = FooterMessage
        fields = [
            'id', 'text', 'order', 'is_active',
            'target_players', 'target_players_detail',
            'target_groups', 'target_groups_detail',
            'target_locations', 'target_locations_detail',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        request = self.context.get('request')
        target_fields = ('target_players', 'target_groups', 'target_locations')
        touches_targets = any(f in self.initial_data for f in target_fields)
        if request and touches_targets:
            from fleet_manager.permissions import _user_role
            if _user_role(request.user) == 'editor_simplificado':
                raise serializers.ValidationError(
                    'Only an admin can change which devices show this message. '
                    'You can still edit its text and ordering.'
                )
        return attrs
