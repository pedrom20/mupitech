from django.urls import path

from . import views

urlpatterns = [
    path('mfa/status/', views.mfa_status),
    path('mfa/enroll/', views.mfa_enroll),
    path('mfa/confirm/', views.mfa_confirm),
    path('mfa/disable/', views.mfa_disable),
]
