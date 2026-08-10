from django.urls import path

from .views import audit_list, playback_log, playback_stats

urlpatterns = [
    path('audit/', audit_list, name='audit-list'),
    path('playback-log/', playback_log, name='playback-log'),
    path('playback-stats/', playback_stats, name='playback-stats'),
]
