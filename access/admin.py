from django.contrib import admin

from .models import UserAccessScope


@admin.register(UserAccessScope)
class UserAccessScopeAdmin(admin.ModelAdmin):
    list_display = ['user']
    search_fields = ['user__username']
    filter_horizontal = ['locations', 'groups', 'players']
