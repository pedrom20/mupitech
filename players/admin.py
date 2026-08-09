from django.contrib import admin

from .models import Player


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ['name', 'url', 'group', 'is_online', 'last_seen']
    list_filter = ['is_online', 'group']
    search_fields = ['name', 'url']
    readonly_fields = ['id', 'is_online', 'last_seen', 'last_status', 'created_at']
