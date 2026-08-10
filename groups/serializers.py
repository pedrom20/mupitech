from rest_framework import serializers

from locations.serializers import LocationSerializer

from .models import Group


class GroupSerializer(serializers.ModelSerializer):
    location_detail = LocationSerializer(source='location', read_only=True)

    class Meta:
        model = Group
        fields = '__all__'
        read_only_fields = ['id', 'created_at']
