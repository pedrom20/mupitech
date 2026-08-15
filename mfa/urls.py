from django.urls import path

from . import views

urlpatterns = [
    path('mfa/status/', views.mfa_status),
    path('mfa/enroll/', views.mfa_enroll),
    path('mfa/confirm/', views.mfa_confirm),
    path('mfa/disable/', views.mfa_disable),
    path('mfa/duo/status/', views.duo_status),
    path('mfa/duo/enroll/', views.duo_enroll),
    path('mfa/duo/confirm/', views.duo_confirm),
    path('mfa/duo/disable/', views.duo_disable),
    path('mfa/privacyidea/status/', views.privacyidea_status),
    path('mfa/privacyidea/enroll/', views.privacyidea_enroll),
    path('mfa/privacyidea/confirm/', views.privacyidea_confirm),
    path('mfa/privacyidea/disable/', views.privacyidea_disable),
    path('mfa/provider-config/', views.provider_config_status),
    path('mfa/provider-config/<str:provider>/', views.provider_config_save),
    path('mfa/dual/status/', views.dual_mfa_status),
    path('mfa/dual/self-toggle/', views.dual_mfa_self_toggle),
    path('mfa/dual/policy/', views.dual_mfa_policy_save),
]
