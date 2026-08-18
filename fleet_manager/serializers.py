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


def _apply_scope_updates(user, *, location_ids=None, group_ids=None, player_ids=None,
                          receive_offline_alerts=None, can_delete_content=None,
                          must_change_password=None, force_mfa_enroll=None):
    """Create/update the user's access scope from a batch of optional fields
    (None = leave that field unchanged). Deliberately a single get_or_create
    + save, rather than one per field: chaining separate get_or_create calls
    each fetches its own fresh UserAccessScope instance, and Django's
    reverse-relation cache on `user` only reflects whichever one happened
    to be assigned last — meaning every earlier field silently vanished
    from the very serializer.data response returned right after, even
    though each write actually landed in the database correctly."""
    all_none = (
        location_ids is None and group_ids is None and player_ids is None
        and receive_offline_alerts is None and can_delete_content is None
        and must_change_password is None and force_mfa_enroll is None
    )
    if all_none:
        return

    scope, _ = UserAccessScope.objects.get_or_create(user=user)
    if location_ids is not None:
        scope.locations.set(location_ids)
    if group_ids is not None:
        scope.groups.set(group_ids)
    if player_ids is not None:
        scope.players.set(player_ids)

    update_fields = []
    if receive_offline_alerts is not None:
        scope.receive_offline_alerts = receive_offline_alerts
        update_fields.append('receive_offline_alerts')
    if can_delete_content is not None:
        scope.can_delete_content = can_delete_content
        update_fields.append('can_delete_content')
    if must_change_password is not None:
        scope.must_change_password = must_change_password
        update_fields.append('must_change_password')
    if force_mfa_enroll is not None:
        scope.force_mfa_enroll = force_mfa_enroll
        update_fields.append('force_mfa_enroll')
    if update_fields:
        scope.save(update_fields=update_fields)

    # Keep `user`'s reverse-relation cache in sync with what was just
    # written, so a get_role_property()-style read via `user.access_scope`
    # later in the same request (e.g. serializing the response) sees the
    # up-to-date object instead of triggering a stale/duplicate fetch.
    user.access_scope = scope


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()
    receive_offline_alerts = serializers.SerializerMethodField()
    can_delete_content = serializers.SerializerMethodField()
    mfa_enabled = serializers.SerializerMethodField()
    must_change_password = serializers.SerializerMethodField()
    force_mfa_enroll = serializers.SerializerMethodField()
    editor_capabilities = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name',
                  'is_active', 'role', 'scope', 'receive_offline_alerts', 'can_delete_content',
                  'mfa_enabled', 'must_change_password', 'force_mfa_enroll', 'editor_capabilities',
                  'last_login', 'date_joined']
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

    def get_can_delete_content(self, obj):
        scope = getattr(obj, 'access_scope', None)
        return scope.can_delete_content if scope else True

    def get_mfa_enabled(self, obj):
        device = getattr(obj, 'totp_device', None)
        return bool(device and device.confirmed)

    def get_must_change_password(self, obj):
        scope = getattr(obj, 'access_scope', None)
        return bool(scope and scope.must_change_password)

    def get_force_mfa_enroll(self, obj):
        scope = getattr(obj, 'access_scope', None)
        return bool(scope and scope.force_mfa_enroll)

    def get_editor_capabilities(self, obj):
        """Which device-management capability groups this user's role has
        (see players/editor_capabilities.py) — {} for anyone but an
        editor, since the frontend only needs this to decide whether to
        show admin-gated device buttons to an editor specifically."""
        if _user_role(obj) != 'editor':
            return {}
        from players.editor_capabilities import get_editor_capabilities
        return get_editor_capabilities()


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
    can_delete_content = serializers.BooleanField(required=False, write_only=True)
    must_change_password = serializers.BooleanField(required=False, write_only=True)
    force_mfa_enroll = serializers.BooleanField(required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password', 'role',
                  'location_ids', 'group_ids', 'player_ids', 'receive_offline_alerts', 'can_delete_content',
                  'must_change_password', 'force_mfa_enroll']

    def validate_role(self, value):
        _validate_role_escalation(value, self.context)
        return value

    def to_representation(self, instance):
        # `role` isn't a real User attribute (it's derived — see
        # _user_role) so the default ModelSerializer representation
        # crashes trying to read it back off the saved instance. Delegate
        # to the read serializer instead, which already knows how to
        # compute it (and gives a response shaped like list()/retrieve()).
        return UserSerializer(instance, context=self.context).data

    def create(self, validated_data):
        role = validated_data.pop('role')
        password = validated_data.pop('password')
        location_ids = validated_data.pop('location_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        player_ids = validated_data.pop('player_ids', None)
        receive_offline_alerts = validated_data.pop('receive_offline_alerts', None)
        can_delete_content = validated_data.pop('can_delete_content', None)
        must_change_password = validated_data.pop('must_change_password', None)
        force_mfa_enroll = validated_data.pop('force_mfa_enroll', None)
        user = User.objects.create_user(**validated_data, password=password)
        _assign_role(user, role)
        _apply_scope_updates(
            user, location_ids=location_ids, group_ids=group_ids, player_ids=player_ids,
            receive_offline_alerts=receive_offline_alerts, can_delete_content=can_delete_content,
            must_change_password=must_change_password, force_mfa_enroll=force_mfa_enroll,
        )
        return user


class UpdateUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=6)
    role = serializers.ChoiceField(choices=['viewer', 'editor', 'admin', 'superadmin'], required=False)
    location_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    group_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    player_ids = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True)
    receive_offline_alerts = serializers.BooleanField(required=False, write_only=True)
    can_delete_content = serializers.BooleanField(required=False, write_only=True)
    must_change_password = serializers.BooleanField(required=False, write_only=True)
    force_mfa_enroll = serializers.BooleanField(required=False, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password',
                  'role', 'is_active', 'location_ids', 'group_ids', 'player_ids',
                  'receive_offline_alerts', 'can_delete_content',
                  'must_change_password', 'force_mfa_enroll']

    def validate_role(self, value):
        _validate_role_escalation(value, self.context)
        if self.instance and _user_role(self.instance) == 'superadmin':
            request = self.context.get('request')
            if not request or _user_role(request.user) != 'superadmin':
                raise serializers.ValidationError("Only a superadmin can change another superadmin's role.")
            # Covers both self-demotion and one superadmin demoting another —
            # either way, dropping the last is_superuser=True account would
            # lock everyone out of superadmin-only areas (e.g. Tailscale)
            # with no one left able to promote a replacement.
            if value != 'superadmin':
                remaining = User.objects.filter(is_superuser=True).exclude(pk=self.instance.pk).count()
                if remaining == 0:
                    raise serializers.ValidationError(
                        'Cannot demote the last superadmin — promote another user first.',
                    )
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

    def to_representation(self, instance):
        # Same reasoning as CreateUserSerializer.to_representation above —
        # `role` isn't a real User attribute.
        return UserSerializer(instance, context=self.context).data

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
        can_delete_content = validated_data.pop('can_delete_content', None)
        must_change_password = validated_data.pop('must_change_password', None)
        force_mfa_enroll = validated_data.pop('force_mfa_enroll', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        if role:
            _assign_role(instance, role)

        _apply_scope_updates(
            instance, location_ids=location_ids, group_ids=group_ids, player_ids=player_ids,
            receive_offline_alerts=receive_offline_alerts, can_delete_content=can_delete_content,
            must_change_password=must_change_password, force_mfa_enroll=force_mfa_enroll,
        )

        return instance
