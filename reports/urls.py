from django.urls import path

from .views import content, sla, users

urlpatterns = [
    path('sla/', sla, name='reports-sla'),
    path('content/', content, name='reports-content'),
    path('users/', users, name='reports-users'),
]
