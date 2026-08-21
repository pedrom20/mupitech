export const APP_VERSION = '1.2.34.0'

export interface ChangelogEntry {
  version: string
  date: string
  changeKeys: string[]
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.2.34.0',
    date: '2026-08-22',
    changeKeys: [
      'playerUpdateCheckGhcrOrderingFix',
    ],
  },
  {
    version: '1.2.33.0',
    date: '2026-08-21',
    changeKeys: [
      'playerUpdateCheckFix',
    ],
  },
  {
    version: '1.2.32.0',
    date: '2026-08-21',
    changeKeys: [
      'repoRenameGhcrFix',
    ],
  },
  {
    version: '1.2.31.0',
    date: '2026-08-19',
    changeKeys: [
      'deviceUrlManualEdit',
    ],
  },
  {
    version: '1.2.30.0',
    date: '2026-08-19',
    changeKeys: [
      'footerMessagesFeature',
    ],
  },
  {
    version: '1.2.29.0',
    date: '2026-08-19',
    changeKeys: [
      'sidebarNavPersonalPreference',
    ],
  },
  {
    version: '1.2.28.0',
    date: '2026-08-18',
    changeKeys: [
      'provisionTimezoneScopingFix',
      'provisionWaitReadyTimeoutFix',
      'provisionHostAgentFix',
    ],
  },
  {
    version: '1.2.27.0',
    date: '2026-08-18',
    changeKeys: [
      'provisionMissingProjectDirFix',
    ],
  },
  {
    version: '1.2.26.0',
    date: '2026-08-18',
    changeKeys: [
      'migrateImageSudoFix',
    ],
  },
  {
    version: '1.2.25.0',
    date: '2026-08-18',
    changeKeys: [
      'phoneHomeInfoGuardFix',
    ],
  },
  {
    version: '1.2.24.0',
    date: '2026-08-18',
    changeKeys: [
      'playlistOrderFix',
      'migrateImageTimeoutFix',
      'playlistRemoveFromDevices',
      'screenshotCanvasFix',
    ],
  },
  {
    version: '1.2.23.0',
    date: '2026-08-18',
    changeKeys: [
      'editorSimplificadoRole',
      'playerDetailBackButtonLayout',
      'navbarLogoSpacingTighter',
    ],
  },
  {
    version: '1.2.22.0',
    date: '2026-08-18',
    changeKeys: [
      'playlistTargetRestriction',
      'playlistScheduleAdHocTargets',
      'sessionExpiryRedirectFix',
      'sidebarCollapsedWidthFix',
    ],
  },
  {
    version: '1.2.21.0',
    date: '2026-08-18',
    changeKeys: [
      'cecStatusFalsePositive',
      'navbarPartnerLogoPolish',
    ],
  },
  {
    version: '1.2.20.0',
    date: '2026-08-18',
    changeKeys: [
      'editorButtonsRespectCapabilities',
      'fleetOverviewMoveMode',
      'fleetOverviewChipContrast',
      'fleetOverviewButtonConsistency',
      'playerDetailInlineBadges',
      'contentRootVisibility',
      'scopedFoldersPanel',
    ],
  },
  {
    version: '1.2.19.0',
    date: '2026-08-18',
    changeKeys: [
      'editorGranularPermissions',
    ],
  },
  {
    version: '1.2.18.0',
    date: '2026-08-18',
    changeKeys: [
      'editorForcedToLoginFix',
      'playerDetailStatusChipAlignFix',
    ],
  },
  {
    version: '1.2.17.0',
    date: '2026-08-18',
    changeKeys: [
      'locationWithoutGroupFix',
    ],
  },
  {
    version: '1.2.16.0',
    date: '2026-08-17',
    changeKeys: [
      'editorContentOnly',
    ],
  },
  {
    version: '1.2.15.0',
    date: '2026-08-17',
    changeKeys: [
      'emailLogoOutlookFix',
    ],
  },
  {
    version: '1.2.14.0',
    date: '2026-08-17',
    changeKeys: [
      'folderCountFix',
      'brandedLogoBadgeFix',
    ],
  },
  {
    version: '1.2.13.0',
    date: '2026-08-17',
    changeKeys: [
      'emailViaGraph',
      'navbarLogoSpacing',
    ],
  },
  {
    version: '1.2.12.0',
    date: '2026-08-17',
    changeKeys: [
      'brandingLibraryUrlFix',
    ],
  },
  {
    version: '1.2.11.0',
    date: '2026-08-17',
    changeKeys: [
      'sidebarNavbarShorter',
    ],
  },
  {
    version: '1.2.10.0',
    date: '2026-08-17',
    changeKeys: [
      'bootSplashProvision',
      'standbyPushFix',
      'navbarSidebarFix',
    ],
  },
  {
    version: '1.2.9.0',
    date: '2026-08-17',
    changeKeys: [
      'migratePi4Pi5',
    ],
  },
  {
    version: '1.2.8.0',
    date: '2026-08-17',
    changeKeys: [
      'weatherWidget',
      'locationSearchField',
    ],
  },
  {
    version: '1.2.7.0',
    date: '2026-08-17',
    changeKeys: [
      'appsCatalog',
      'sidebarButtonFix',
    ],
  },
  {
    version: '1.2.6.0',
    date: '2026-08-17',
    changeKeys: [
      'contentLibraryScoping',
      'sidebarPolish',
      'fmManagedBadge',
      'duoIpFix',
    ],
  },
  {
    version: '1.2.5.0',
    date: '2026-08-17',
    changeKeys: [
      'sidebarNavLayout',
    ],
  },
  {
    version: '1.2.4.0',
    date: '2026-08-16',
    changeKeys: [
      'devicePairingFeature',
      'accountTabsRedesign',
      'mfaMethodTiles',
      'darkModeOutlineButtonFix',
    ],
  },
  {
    version: '1.2.3.0',
    date: '2026-08-16',
    changeKeys: [
      'emailOtpMfaFeature',
    ],
  },
  {
    version: '1.2.2.0',
    date: '2026-08-16',
    changeKeys: [
      'passwordResetFeature',
      'mfaCodeBoxesAndAnimations',
      'rateLimitGroupFix',
    ],
  },
  {
    version: '1.2.1.0',
    date: '2026-08-16',
    changeKeys: [
      'setupWizardFeature',
      'deviceLoginMfaFeature',
      'mobileNavbarFixes',
      'fleetManagerRebrand',
    ],
  },
  {
    version: '1.2.0.1',
    date: '2026-08-15',
    changeKeys: [
      'brandedAlertEmails',
    ],
  },
  {
    version: '1.2.0.0',
    date: '2026-08-15',
    changeKeys: [
      'dualMfaLogin',
      'lastSuperadminGuard',
      'offlineAlertPreview',
    ],
  },
  {
    version: '1.1.9.1',
    date: '2026-08-15',
    changeKeys: [
      'ssoTogglePatchFix',
      'phonehomeAuthEnabledFix',
    ],
  },
  {
    version: '1.1.9.0',
    date: '2026-08-15',
    changeKeys: [
      'provisionWizardPlatform',
      'mfaProviderIcons',
      'x86PhoneHomeFix',
    ],
  },
  {
    version: '1.1.8.1',
    date: '2026-08-15',
    changeKeys: [
      'mfaSwitchMethodFix',
    ],
  },
  {
    version: '1.1.8.0',
    date: '2026-08-15',
    changeKeys: [
      'scheduleTimelineRestored',
    ],
  },
  {
    version: '1.1.7.3',
    date: '2026-08-15',
    changeKeys: [
      'sessionCookieHttpFix',
    ],
  },
  {
    version: '1.1.7.2',
    date: '2026-08-15',
    changeKeys: [
      'mfaRateLimitFix',
    ],
  },
  {
    version: '1.1.7.1',
    date: '2026-08-15',
    changeKeys: [
      'privacyideaPushLoginFix',
    ],
  },
  {
    version: '1.1.7.0',
    date: '2026-08-15',
    changeKeys: [
      'privacyideaPushToken',
    ],
  },
  {
    version: '1.1.6.0',
    date: '2026-08-15',
    changeKeys: [
      'mfaProviderSettingsUI',
      'privacyideaAutoProvision',
      'playerDetailAccessHidden',
    ],
  },
  {
    version: '1.1.5.0',
    date: '2026-08-15',
    changeKeys: [
      'privacyIdeaProvider',
      'authpointProviderStub',
      'ldapLoginPrep',
    ],
  },
  {
    version: '1.1.4.0',
    date: '2026-08-15',
    changeKeys: [
      'profileSelfEdit',
      'deviceLoginWithFmAccount',
      'playerLocationChipPill',
    ],
  },
  {
    version: '1.1.3.5',
    date: '2026-08-15',
    changeKeys: [
      'playerAccessTab',
    ],
  },
  {
    version: '1.1.3.4',
    date: '2026-08-15',
    changeKeys: [
      'playerDetailLocationChip',
    ],
  },
  {
    version: '1.1.3.3',
    date: '2026-08-15',
    changeKeys: [
      'playerCardMobileCollapse',
    ],
  },
  {
    version: '1.1.3.2',
    date: '2026-08-15',
    changeKeys: [
      'playerListEditFix',
    ],
  },
  {
    version: '1.1.3.1',
    date: '2026-08-15',
    changeKeys: [
      'userModalTabs',
    ],
  },
  {
    version: '1.1.3.0',
    date: '2026-08-15',
    changeKeys: [
      'mfaMethodSwitch',
    ],
  },
  {
    version: '1.1.2.0',
    date: '2026-08-14',
    changeKeys: [
      'deviceVersionRoleSplit',
    ],
  },
  {
    version: '1.1.1.0',
    date: '2026-08-14',
    changeKeys: [
      'deviceSsoDisableToggle',
    ],
  },
  {
    version: '1.1.0.0',
    date: '2026-08-14',
    changeKeys: [
      'mfaTotp',
      'mfaDuoPush',
      'mfaCodeBoxes',
      'deviceRevealCredentials',
      'deviceSsoLogin',
      'standbyVideoSupport',
      'accountPage',
      'auditNavMove',
      'duplicateDeviceFix',
      'updateCheckReleaseFix',
      'onboardingWizard',
      'userCreateUpdateFix',
      'userScopeCacheFix',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-08-11',
    changeKeys: [
      'customAnthiasImage',
      'migrateToMupitechImage',
      'officialSchedulingModel',
      'userPrivilegeGuards',
      'logoRedesign',
      'standbyImageMargin',
      'screenshotSshRetake',
      'deviceCardLocationOrientation',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-10',
    changeKeys: [
      'mupitechRebrand',
      'modularArchitecture',
      'locationsFeature',
      'playlistsFeature',
      'authUxImprovements',
      'groupsNavFix',
    ],
  },
]
