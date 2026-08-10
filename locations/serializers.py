from rest_framework import serializers

from .models import Location


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = '__all__'
        read_only_fields = ['id', 'created_at']
