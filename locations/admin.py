from django.contrib import admin

from .models import Location


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'created_at']
    search_fields = ['name']
    readonly_fields = ['id', 'created_at']
