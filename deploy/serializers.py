from rest_framework import serializers

from players.models import Player

from .models import DeployTask


class DeployTaskSerializer(serializers.ModelSerializer):
    target_players = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Player.objects.all(),
    )

    class Meta:
        model = DeployTask
        fields = '__all__'
        read_only_fields = ['id', 'status', 'progress', 'created_at']
