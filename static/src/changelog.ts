export const APP_VERSION = '1.1.3.3'

export interface ChangelogEntry {
  version: string
  date: string
  changeKeys: string[]
}

export const changelog: ChangelogEntry[] = [
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
