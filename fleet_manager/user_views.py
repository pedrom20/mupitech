import logging

from django.contrib.auth.models import User
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from .permissions import IsAdmin, _user_role
from .serializers import CreateUserSerializer, UpdateUserSerializer, UserSerializer

logger = logging.getLogger(__name__)


class UserViewSet(viewsets.ModelViewSet):
    """Admin-only user management."""
    queryset = User.objects.all().order_by('-date_joined')
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_serializer_class(self):
        if self.action == 'create':
            return CreateUserSerializer
        if self.action in ('update', 'partial_update'):
            return UpdateUserSerializer
        return UserSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = UserSerializer(queryset, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        from history.logging import log_action
        user = serializer.save()
        log_action(self.request, 'create', 'user', target_id=user.id,
                   target_name=user.username, details={'role': serializer.validated_data.get('role')})

    def perform_update(self, serializer):
        from history.logging import log_action
        user = serializer.save()
        log_action(self.request, 'update', 'user', target_id=user.id,
                   target_name=user.username)

    def destroy(self, request, *args, **kwargs):
        from history.logging import log_action
        user = self.get_object()
        if user == request.user:
            return Response(
                {'error': 'Cannot deactivate yourself'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if _user_role(user) == 'superadmin' and _user_role(request.user) != 'superadmin':
            return Response(
                {'error': 'Only a superadmin can deactivate another superadmin'},
                status=status.HTTP_403_FORBIDDEN,
            )
        user.is_active = False
        user.save(update_fields=['is_active'])
        log_action(request, 'deactivate', 'user', target_id=user.id, target_name=user.username)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='reset-mfa')
    def reset_mfa(self, request, pk=None):
        """Admin-triggered MFA reset — the Fase 1 recovery path for a user
        who lost their authenticator (no backup codes yet). Forces the
        user back through enrolment on next login."""
        from history.logging import log_action
        from mfa.models import TOTPDevice

        user = self.get_object()
        if user == request.user:
            return Response(
                {'error': 'Use your own account settings to disable your own MFA.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if _user_role(user) == 'superadmin' and _user_role(request.user) != 'superadmin':
            return Response(
                {'error': 'Only a superadmin can reset another superadmin\'s MFA.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        deleted, _ = TOTPDevice.objects.filter(user=user).delete()
        log_action(request, 'mfa_reset', 'user', target_id=user.id, target_name=user.username)
        return Response({'success': True, 'had_mfa': bool(deleted)})

    @action(detail=False, methods=['get'], url_path='me', permission_classes=[])
    def me(self, request):
        """Return current user info + role. Available to any authenticated user."""
        if not request.user.is_authenticated:
            return Response({'authenticated': False}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='me/change-password', permission_classes=[])
    def change_own_password(self, request):
        """Self-service password change — the only path a non-admin user
        has to change their own password (the rest of this viewset is
        admin-only). Also the mechanism that clears the onboarding
        must_change_password flag set at user creation."""
        from django.contrib.auth import update_session_auth_hash

        from access.models import UserAccessScope
        from history.logging import log_action

        if not request.user.is_authenticated:
            return Response({'authenticated': False}, status=status.HTTP_401_UNAUTHORIZED)

        current_password = request.data.get('current_password', '')
        new_password = request.data.get('new_password', '')
        if not request.user.check_password(current_password):
            return Response({'error': 'Incorrect current password.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(new_password) < 6:
            return Response(
                {'error': 'New password must be at least 6 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])
        # Changing your own password normally invalidates the session hash —
        # keep the current session alive so onboarding can continue past this step.
        update_session_auth_hash(request, request.user)
        UserAccessScope.objects.filter(user=request.user, must_change_password=True).update(
            must_change_password=False,
        )
        log_action(request, 'change_password', 'user', target_id=request.user.id,
                   target_name=request.user.username)
        return Response({'success': True})
