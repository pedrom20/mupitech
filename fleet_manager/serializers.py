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


def _set_receive_offline_alerts(user, value):
    """Set the user's offline-alert opt-in flag (None = leave unchanged)."""
    if value is None:
        return
    scope, _ = UserAccessScope.objects.get_or_create(user=user)
    scope.receive_offline_alerts = value
    scope.save(update_fields=['receive_offline_alerts'])


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()
    receive_offline_alerts = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name',
                  'is_active', 'role', 'scope', 'receive_offline_alerts', 'last_login', 'date_joined']
        read_only_fields = ['id', 'last_login', 'date_joined']

    def get_role(self, obj):
        return _user_role(obj)

    def get_scope(self, obj):
        scope = getattr(obj, 'access_scope', None)
        if not scope:
            return {'location_ids': [], 'group_ids': [], 'player_ids': []}
        return ScopeSerializer(scope).data

    def get_receive_offline_alerts(self, obj):
        scope = getattr(obj, 'access_scope', None)
        return scope.receive_offline_alerts if scope else True


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
    receive_offline_alerts = serializers.BooleanField(required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password', 'role',
                  'location_ids', 'group_ids', 'player_ids', 'receive_offline_alerts']

    def validate_role(self, value):
        _validate_role_escalation(value, self.context)
        return value

    def create(self, validated_data):
        role = validated_data.pop('role')
        password = validated_data.pop('password')
        location_ids = validated_data.pop('location_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        player_ids = validated_data.pop('player_ids', None)
        receive_offline_alerts = validated_data.pop('receive_offline_alerts', None)
        user = User.objects.create_user(**validated_data, password=password)
        _assign_role(user, role)
        _set_scope(user, location_ids, group_ids, player_ids)
        _set_receive_offline_alerts(user, receive_offline_alerts)
        return user


class UpdateUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=6)
    role = serializers.ChoiceField(choices=['viewer', 'editor', 'admin', 'superadmin'], required=False)
    location_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    group_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    player_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    receive_offline_alerts = serializers.BooleanField(required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password',
                  'role', 'is_active', 'location_ids', 'group_ids', 'player_ids', 'receive_offline_alerts']

    def validate_role(self, value):
        _validate_role_escalation(value, self.context)
        if self.instance and _user_role(self.instance) == 'superadmin':
            request = self.context.get('request')
            if not request or _user_role(request.user) != 'superadmin':
                raise serializers.ValidationError("Only a superadmin can change another superadmin's role.")
        if self.instance and value != _user_role(self.instance):
            self._reject_self_privilege_edit('role')
        return value

    def validate_location_ids(self, value):
        if self.instance and {str(v) for v in value} != self._current_scope_ids('locations'):
            self._reject_self_privilege_edit('access scope')
        return value

    def validate_group_ids(self, value):
        if self.instance and {str(v) for v in value} != self._current_scope_ids('groups'):
            self._reject_self_privilege_edit('access scope')
        return value

    def validate_player_ids(self, value):
        if self.instance and {str(v) for v in value} != self._current_scope_ids('players'):
            self._reject_self_privilege_edit('access scope')
        return value

    def _current_scope_ids(self, relation):
        scope = getattr(self.instance, 'access_scope', None)
        if not scope:
            return set()
        return {str(pk) for pk in getattr(scope, relation).values_list('id', flat=True)}

    def _reject_self_privilege_edit(self, field_label):
        """A user editing their own account cannot change their own role or
        access scope — otherwise they could self-escalate. Superadmins are
        exempt since they already have unrestricted access."""
        request = self.context.get('request')
        if not request or not self.instance or self.instance != request.user:
            return
        if _user_role(self.instance) == 'superadmin':
            return
        raise serializers.ValidationError(f'You cannot change your own {field_label}.')

    def update(self, instance, validated_data):
        role = validated_data.pop('role', None)
        password = validated_data.pop('password', None)
        location_ids = validated_data.pop('location_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        player_ids = validated_data.pop('player_ids', None)
        receive_offline_alerts = validated_data.pop('receive_offline_alerts', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        if role:
            _assign_role(instance, role)

        _set_scope(instance, location_ids, group_ids, player_ids)
        _set_receive_offline_alerts(instance, receive_offline_alerts)

        return instance
