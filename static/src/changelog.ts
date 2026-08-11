export const APP_VERSION = '1.0.1'

export interface ChangelogEntry {
  version: string
  date: string
  changeKeys: string[]
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.0.1',
    date: '2026-08-11',
    changeKeys: [
      'customAnthiasImage',
      'migrateToMupitechImage',
      'officialSchedulingModel',
      'userPrivilegeGuards',
      'retroDosEasterEggs',
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
