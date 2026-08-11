from django.contrib.auth.models import User
from rest_framework import serializers

from access.models import UserAccessScope
from .permissions import _user_role


class ScopeSerializer(serializers.ModelSerializer):
    location_ids = serializers.PrimaryKeyRelatedField(source='locations', many=True, read_only=True)
    group_ids = serializers.PrimaryKeyRelatedField(source='groups', many=True, read_only=True)
    player_ids = serializers.PrimaryKeyRelatedField(source='players', many=True, read_only=True)

    class Meta:
        model = UserAccessScope
        fields = ['location_ids', 'group_ids', 'player_ids']


def _set_scope(user, location_ids=None, group_ids=None, player_ids=None):
    """Create/update/clear the user's access scope from lists of IDs (None = leave unchanged)."""
    if location_ids is None and group_ids is None and player_ids is None:
        return
    scope, _ = UserAccessScope.objects.get_or_create(user=user)
    if location_ids is not None:
        scope.locations.set(location_ids)
    if group_ids is not None:
        scope.groups.set(group_ids)
    if player_ids is not None:
        scope.players.set(player_ids)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name',
                  'is_active', 'role', 'scope', 'last_login', 'date_joined']
        read_only_fields = ['id', 'last_login', 'date_joined']

    def get_role(self, obj):
        return _user_role(obj)

    def get_scope(self, obj):
        scope = getattr(obj, 'access_scope', None)
        if not scope:
            return {'location_ids': [], 'group_ids': [], 'player_ids': []}
        return ScopeSerializer(scope).data


def _validate_role_escalation(role, context):
    """Only an existing superadmin may grant the superadmin role to anyone."""
    if role != 'superadmin':
        return
    request = context.get('request')
    if not request or _user_role(request.user) != 'superadmin':
        raise serializers.ValidationError('Only a superadmin can grant the superadmin role.')


def _assign_role(user, role):
    """Assign a role. Superadmin is backed by is_superuser/is_staff (full
    Django admin access too) rather than a plain Group — downgrading away
    from it clears both flags."""
    from django.contrib.auth.models import Group
    user.groups.clear()
    if role == 'superadmin':
        user.is_superuser = True
        user.is_staff = True
        user.save(update_fields=['is_superuser', 'is_staff'])
    elif user.is_superuser:
        user.is_superuser = False
        user.is_staff = False
        user.save(update_fields=['is_superuser', 'is_staff'])
    try:
        group = Group.objects.get(name=role)
        user.groups.add(group)
    except Group.DoesNotExist:
        pass


class CreateUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    role = serializers.ChoiceField(choices=['viewer', 'editor', 'admin', 'superadmin'])
    location_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    group_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    player_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password', 'role',
                  'location_ids', 'group_ids', 'player_ids']

    def validate_role(self, value):
        _validate_role_escalation(value, self.context)
        return value

    def create(self, validated_data):
        role = validated_data.pop('role')
        password = validated_data.pop('password')
        location_ids = validated_data.pop('location_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        player_ids = validated_data.pop('player_ids', None)
        user = User.objects.create_user(**validated_data, password=password)
        _assign_role(user, role)
        _set_scope(user, location_ids, group_ids, player_ids)
        return user


class UpdateUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=6)
    role = serializers.ChoiceField(choices=['viewer', 'editor', 'admin', 'superadmin'], required=False)
    location_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    group_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    player_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password',
                  'role', 'is_active', 'location_ids', 'group_ids', 'player_ids']

    def validate_role(self, value):
        _validate_role_escalation(value, self.context)
        return value

    def update(self, instance, validated_data):
        role = validated_data.pop('role', None)
        password = validated_data.pop('password', None)
        location_ids = validated_data.pop('location_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        player_ids = validated_data.pop('player_ids', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        if role:
            _assign_role(instance, role)

        _set_scope(instance, location_ids, group_ids, player_ids)

        return instance
