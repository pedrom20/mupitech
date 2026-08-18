def compute_message_map_for_players(player_ids):
    """{str(player_id): [ordered active message texts]} for the given ids.

    Iterates active FooterMessage rows in ``order`` and appends each
    one's text to every player it targets, so a player's list already
    comes out in the right ticker order without a separate sort step.
    """
    from .models import FooterMessage

    result = {str(pid): [] for pid in player_ids}
    messages = FooterMessage.objects.filter(is_active=True).order_by('order', 'created_at')
    for message in messages:
        for player in message.resolve_target_players():
            key = str(player.id)
            if key in result:
                result[key].append(message.text)
    return result
