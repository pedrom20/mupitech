from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from history.logging import log_action
from players.services import PlayerConnectionError, format_player_error


class ScheduleActionsMixin:
    """DRF viewset mixin exposing schedule-slot proxy actions on a Player.

    Composed into players.views.PlayerViewSet so the schedule-slot business
    logic lives here while the URLs (/api/players/<id>/schedule-*/) stay
    unchanged — this is a code-ownership move only, not a routing change.
    Requires the host viewset to provide `get_object()` and `_get_client()`.
    """

    @action(detail=True, methods=['get'], url_path='schedule-slots')
    def schedule_slots(self, request, pk=None):
        """Proxy to the player's schedule slots list."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            data = client.get_schedule_slots()
            return Response(data)
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['get'], url_path='schedule-status')
    def schedule_status(self, request, pk=None):
        """Proxy to the player's schedule status."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            data = client.get_schedule_status()
            return Response(data)
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['post'], url_path='schedule-slot-create')
    def schedule_slot_create(self, request, pk=None):
        """Create a schedule slot on the player."""
        player = self.get_object()
        client = self._get_client(player)
        try:
            data = client.create_schedule_slot(request.data)
            log_action(request, 'create', 'schedule_slot', target_id=data.get('id', ''), target_name=f"{player.name}: {request.data.get('name', '')}")
            return Response({'success': True, 'slot': data}, status=status.HTTP_201_CREATED)
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['put', 'patch'], url_path='schedule-slot-update')
    def schedule_slot_update(self, request, pk=None):
        """Update a schedule slot on the player."""
        player = self.get_object()
        client = self._get_client(player)
        slot_id = request.data.get('slot_id')
        if not slot_id:
            return Response(
                {'error': 'slot_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        update_data = {k: v for k, v in request.data.items() if k != 'slot_id'}
        try:
            data = client.update_schedule_slot(slot_id, update_data)
            log_action(request, 'update', 'schedule_slot', target_id=slot_id, target_name=player.name, details=update_data)
            return Response({'success': True, 'slot': data})
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['post'], url_path='schedule-slot-delete')
    def schedule_slot_delete(self, request, pk=None):
        """Delete a schedule slot on the player."""
        player = self.get_object()
        client = self._get_client(player)
        slot_id = request.data.get('slot_id')
        if not slot_id:
            return Response(
                {'error': 'slot_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            client.delete_schedule_slot(slot_id)
            log_action(request, 'delete', 'schedule_slot', target_id=slot_id, target_name=player.name)
            return Response({'success': True})
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['post'], url_path='schedule-slot-item-add')
    def schedule_slot_item_add(self, request, pk=None):
        """Add an asset to a schedule slot on the player.

        Automatically enables the asset (is_enabled=True) so it can be
        played by the scheduler.  Anthias requires assets to be enabled
        even when they are part of a schedule slot.
        """
        player = self.get_object()
        client = self._get_client(player)
        slot_id = request.data.get('slot_id')
        if not slot_id:
            return Response(
                {'error': 'slot_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        item_data = {k: v for k, v in request.data.items() if k != 'slot_id'}
        try:
            # Ensure the asset is enabled so the scheduler can play it
            asset_id = item_data.get('asset_id')
            if asset_id:
                try:
                    client.update_asset(asset_id, {'is_enabled': True})
                except PlayerConnectionError:
                    pass  # non-fatal: slot item will still be added

            data = client.add_slot_item(slot_id, item_data)
            log_action(request, 'add_item', 'schedule_slot', target_id=slot_id, target_name=player.name, details={'asset_id': item_data.get('asset_id', '')})
            return Response({'success': True, 'item': data}, status=status.HTTP_201_CREATED)
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['post'], url_path='schedule-slot-item-remove')
    def schedule_slot_item_remove(self, request, pk=None):
        """Remove an asset from a schedule slot on the player."""
        player = self.get_object()
        client = self._get_client(player)
        slot_id = request.data.get('slot_id')
        item_id = request.data.get('item_id')
        if not slot_id or not item_id:
            return Response(
                {'error': 'slot_id and item_id are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            client.delete_slot_item(slot_id, item_id)
            log_action(request, 'remove_item', 'schedule_slot', target_id=slot_id, target_name=player.name, details={'item_id': item_id})
            return Response({'success': True})
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['put', 'patch'], url_path='schedule-slot-item-update')
    def schedule_slot_item_update(self, request, pk=None):
        """Update a slot item on the player (e.g. duration_override)."""
        player = self.get_object()
        client = self._get_client(player)
        slot_id = request.data.get('slot_id')
        item_id = request.data.get('item_id')
        if not slot_id or not item_id:
            return Response(
                {'error': 'slot_id and item_id are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        update_data = {
            k: v for k, v in request.data.items()
            if k not in ('slot_id', 'item_id')
        }
        try:
            data = client.update_slot_item(slot_id, item_id, update_data)
            log_action(request, 'update_item', 'schedule_slot', target_id=slot_id, target_name=player.name, details={'item_id': item_id, **update_data})
            return Response({'success': True, 'item': data})
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)

    @action(detail=True, methods=['post'], url_path='schedule-slot-items-reorder')
    def schedule_slot_items_reorder(self, request, pk=None):
        """Reorder items in a schedule slot."""
        player = self.get_object()
        client = self._get_client(player)
        slot_id = request.data.get('slot_id')
        ids = request.data.get('ids', [])
        if not slot_id:
            return Response(
                {'error': 'slot_id is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            data = client.reorder_slot_items(slot_id, ids)
            return Response(data)
        except PlayerConnectionError as exc:
            msg, code = format_player_error(exc)
            return Response({'error': msg}, status=code)
