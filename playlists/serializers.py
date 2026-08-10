from rest_framework import serializers

from content.serializers import MediaFileSerializer
from groups.serializers import GroupSerializer
from locations.serializers import LocationSerializer
from players.serializers import PlayerListSerializer

from .models import Playlist, PlaylistItem


class PlaylistItemSerializer(serializers.ModelSerializer):
    media_file_detail = MediaFileSerializer(source='media_file', read_only=True)

    class Meta:
        model = PlaylistItem
        fields = ['id', 'media_file', 'media_file_detail', 'order', 'duration']
        read_only_fields = ['id']


class PlaylistSerializer(serializers.ModelSerializer):
    items = PlaylistItemSerializer(many=True)
    target_players_detail = PlayerListSerializer(source='target_players', many=True, read_only=True)
    target_groups_detail = GroupSerializer(source='target_groups', many=True, read_only=True)
    target_locations_detail = LocationSerializer(source='target_locations', many=True, read_only=True)

    class Meta:
        model = Playlist
        fields = [
            'id', 'name', 'description', 'items',
            'target_players', 'target_players_detail',
            'target_groups', 'target_groups_detail',
            'target_locations', 'target_locations_detail',
            'last_deploy_status', 'last_deployed_at', 'created_at',
        ]
        read_only_fields = ['id', 'last_deploy_status', 'last_deployed_at', 'created_at']

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        target_players = validated_data.pop('target_players', [])
        target_groups = validated_data.pop('target_groups', [])
        target_locations = validated_data.pop('target_locations', [])

        playlist = Playlist.objects.create(**validated_data)
        playlist.target_players.set(target_players)
        playlist.target_groups.set(target_groups)
        playlist.target_locations.set(target_locations)

        for i, item_data in enumerate(items_data):
            item_data.pop('id', None)
            PlaylistItem.objects.create(playlist=playlist, order=item_data.pop('order', i), **item_data)

        return playlist

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        target_players = validated_data.pop('target_players', None)
        target_groups = validated_data.pop('target_groups', None)
        target_locations = validated_data.pop('target_locations', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if target_players is not None:
            instance.target_players.set(target_players)
        if target_groups is not None:
            instance.target_groups.set(target_groups)
        if target_locations is not None:
            instance.target_locations.set(target_locations)

        if items_data is not None:
            instance.items.all().delete()
            for i, item_data in enumerate(items_data):
                item_data.pop('id', None)
                PlaylistItem.objects.create(playlist=instance, order=item_data.pop('order', i), **item_data)

        return instance
