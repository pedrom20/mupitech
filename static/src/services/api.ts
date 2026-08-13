import type { Player, Group, Location, Playlist, PlayerInfo, PlayerAsset, DeployTask, MediaFile, MediaFolder, PlaybackLogResponse, PlaybackStatsResponse, CctvConfig, CecStatus, IrStatus, PlayerUpdateCheckResult, ProvisionTask, ServerTelemetry, TailscaleSettings, AlertSettings, RegistryMirrorSettings, RegistryMirrorSyncStatus, User, AuditLogResponse, BulkProvisionTask, ScheduledDeployment } from '@/types'

const BASE_URL = '/api'

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  return match ? match[1] : ''
}

/** Thrown by apiRequest on a non-OK response. Backends that have been
 * wired up for translated errors (see e.g. players/migrate_image.py's
 * MigrationError) also send error_code/error_params, which `code`/
 * `params` carry through so a call site can look up a translated
 * string (translateApiError below) instead of showing the raw
 * (always-English) `message` straight from the server. Older/other
 * endpoints that only send `error` still work exactly as before —
 * `code` is simply undefined and callers fall back to `message`. */
export class ApiError extends Error {
  code?: string
  params?: Record<string, unknown>

  constructor(message: string, code?: string, params?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.params = params
  }
}

async function apiRequest<T = unknown>(
  method: string,
  url: string,
  data?: Record<string, unknown> | FormData,
): Promise<T> {
  const headers: Record<string, string> = {
    'X-CSRFToken': getCsrfToken(),
  }

  const config: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
  }

  if (data) {
    if (data instanceof FormData) {
      config.body = data
    } else {
      headers['Content-Type'] = 'application/json'
      config.body = JSON.stringify(data)
    }
  }

  const response = await fetch(`${BASE_URL}${url}`, config)

  if (!response.ok) {
    if (response.status === 403 && !url.startsWith('/auth/')) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
      throw new Error('Authentication required')
    }
    let errorMessage = `HTTP ${response.status}`
    let errorCode: string | undefined
    let errorParams: Record<string, unknown> | undefined
    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorData.detail || errorData.message || JSON.stringify(errorData)
      errorCode = errorData.error_code
      errorParams = errorData.error_params
    } catch {
      errorMessage = response.statusText || errorMessage
    }
    throw new ApiError(errorMessage, errorCode, errorParams)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export const players = {
  list(): Promise<Player[]> {
    return apiRequest<Player[]>('GET', '/players/')
  },

  get(id: string): Promise<Player> {
    return apiRequest<Player>('GET', `/players/${id}/`)
  },

  create(data: Partial<Player> & { password?: string }): Promise<Player> {
    return apiRequest<Player>('POST', '/players/', data)
  },

  update(id: string, data: Partial<Player> & { password?: string }): Promise<Player> {
    return apiRequest<Player>('PUT', `/players/${id}/`, data)
  },

  partialUpdate(id: string, data: Partial<Player>): Promise<Player> {
    return apiRequest<Player>('PATCH', `/players/${id}/`, data)
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/players/${id}/`)
  },

  testConnection(id: string): Promise<{ success: boolean; message: string }> {
    return apiRequest('POST', `/players/${id}/test-connection/`)
  },

  getInfo(id: string): Promise<PlayerInfo> {
    return apiRequest<PlayerInfo>('GET', `/players/${id}/info/`)
  },

  getAssets(id: string): Promise<PlayerAsset[]> {
    return apiRequest<PlayerAsset[]>('GET', `/players/${id}/assets/`)
  },

  updateAsset(playerId: string, assetId: string, data: Partial<PlayerAsset>): Promise<PlayerAsset> {
    return apiRequest('PATCH', `/players/${playerId}/asset-update/`, { asset_id: assetId, ...data })
  },

  deleteAsset(playerId: string, assetId: string): Promise<{ success: boolean }> {
    return apiRequest('POST', `/players/${playerId}/asset-delete/`, { asset_id: assetId })
  },

  createAsset(playerId: string, data: Record<string, unknown>): Promise<PlayerAsset> {
    return apiRequest('POST', `/players/${playerId}/asset-create/`, data)
  },

  deployContent(playerId: string, mediaFileId: string, overrides?: Record<string, unknown>): Promise<PlayerAsset> {
    return apiRequest('POST', `/players/${playerId}/asset-upload/`, { media_file_id: mediaFileId, ...overrides })
  },

  getSettings(id: string): Promise<Record<string, unknown>> {
    return apiRequest('GET', `/players/${id}/device-settings/`)
  },

  saveSettings(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return apiRequest('PATCH', `/players/${id}/device-settings/`, data)
  },

  playbackControl(id: string, command: 'next' | 'previous'): Promise<{ success: boolean }> {
    return apiRequest('POST', `/players/${id}/playback-control/`, { command })
  },

  nowPlaying(id: string): Promise<{ asset_id: string; asset_name: string; mimetype: string; started_at: string } | null> {
    return apiRequest('GET', `/players/${id}/now-playing/`)
  },

  reboot(id: string): Promise<{ success: boolean }> {
    return apiRequest('POST', `/players/${id}/reboot/`)
  },

  shutdown(id: string): Promise<{ success: boolean }> {
    return apiRequest('POST', `/players/${id}/shutdown/`)
  },

  backup(id: string): Promise<Blob> {
    return fetch(`${BASE_URL}/players/${id}/backup/`, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCsrfToken() },
      credentials: 'same-origin',
    }).then((res) => {
      if (!res.ok) throw new Error('Backup failed')
      return res.blob()
    })
  },

  async getScreenshot(id: string): Promise<string> {
    // A hung viewer-side reply (see the Redis reply-collector in
    // mupitech-player's ScreenshotViewV2, 10s server-side timeout) or a
    // proxy silently sitting on the connection would otherwise leave
    // this fetch() pending forever — plain fetch has no default
    // timeout — which reads as the screenshot button being stuck
    // rather than failed. Abort after a generous margin past the
    // server's own timeout so the UI always resolves to a clean error.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 40_000)
    let res: Response
    try {
      res = await fetch(`${BASE_URL}/players/${id}/screenshot/`, {
        credentials: 'same-origin',
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Screenshot request timed out')
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
    if (!res.ok) {
      let message = 'Screenshot failed'
      let notSupported = false
      try {
        const errorData = await res.json()
        message = errorData.error || errorData.detail || message
        notSupported = errorData.code === 'not_supported'
      } catch {
        // response wasn't JSON, keep generic message
      }
      const err = new Error(message) as Error & { notSupported?: boolean }
      err.notSupported = notSupported
      throw err
    }
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },

  async captureScreenshotSidecar(id: string, sshUser: string, sshPassword: string, sshPort: number, saveCredentials = false): Promise<string> {
    const res = await fetch(`${BASE_URL}/players/${id}/screenshot-sidecar/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
      body: JSON.stringify({
        ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
        save_credentials: saveCredentials,
      }),
    })
    if (!res.ok) {
      let message = 'Screenshot failed'
      try {
        const errorData = await res.json()
        message = errorData.error || errorData.detail || message
      } catch {
        // response wasn't JSON, keep generic message
      }
      throw new Error(message)
    }
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },

  updateCheck(id: string): Promise<PlayerUpdateCheckResult> {
    return apiRequest<PlayerUpdateCheckResult>('GET', `/players/${id}/update-check/`)
  },

  pushBranding(id: string, sshUser: string, sshPassword: string, sshPort: number, pushLogo: boolean, pushStandby: boolean, pushTheme: boolean, saveCredentials = false): Promise<{ success: boolean }> {
    return apiRequest('POST', `/players/${id}/push-branding/`, {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
      push_logo: pushLogo, push_standby: pushStandby, push_theme: pushTheme,
      save_credentials: saveCredentials,
    })
  },

  getImageSource(id: string, sshUser: string, sshPassword: string, sshPort: number): Promise<{
    source: 'mupitech' | 'official' | 'fork' | 'unknown'; image: string; can_migrate: boolean; has_backup: boolean
  }> {
    return apiRequest('POST', `/players/${id}/image-source/`, {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
    })
  },

  migrateImage(id: string, sshUser: string, sshPassword: string, sshPort: number, saveCredentials = false, preserveContent = false, target: 'mupitech' | 'official' = 'mupitech'): Promise<{
    success: boolean; action: 'updated' | 'migrated'; previous_source: string
    previous_image: string; backup_path: string | null
    content_restored?: number | null; content_restore_failed?: string[] | null; content_restore_error?: string | null
    branding_pushed?: string[] | null; branding_failed?: { name: string; error: string }[] | null
  }> {
    return apiRequest('POST', `/players/${id}/migrate-image/`, {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
      save_credentials: saveCredentials, preserve_content: preserveContent, target,
    })
  },

  restoreImage(id: string, sshUser: string, sshPassword: string, sshPort: number): Promise<{
    success: boolean; backup_path: string
  }> {
    return apiRequest('POST', `/players/${id}/restore-image/`, {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
    })
  },

  cloneContent(targetId: string, sourcePlayerId: string): Promise<{
    success: boolean; restored: number; failed: string[]
  }> {
    return apiRequest('POST', `/players/${targetId}/clone-content/`, {
      source_player_id: sourcePlayerId,
    })
  },

  saveSshCredentials(id: string, sshUser: string, sshPassword: string, sshPort: number): Promise<{ success: boolean; has_ssh_credentials: boolean; ssh_username: string; ssh_port: number }> {
    return apiRequest('POST', `/players/${id}/ssh-credentials/`, {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
    })
  },

  deleteSshCredentials(id: string): Promise<void> {
    return apiRequest('DELETE', `/players/${id}/ssh-credentials/`)
  },

  uploadLogo(id: string, file: File): Promise<{ success: boolean; logo_url: string }> {
    const data = new FormData()
    data.append('logo', file)
    return apiRequest('POST', `/players/${id}/logo/`, data)
  },

  deleteLogo(id: string): Promise<void> {
    return apiRequest('DELETE', `/players/${id}/logo/`)
  },

  uploadStandby(id: string, file: File): Promise<{ success: boolean; standby_url: string }> {
    const data = new FormData()
    data.append('standby', file)
    return apiRequest('POST', `/players/${id}/standby/`, data)
  },

  deleteStandby(id: string): Promise<void> {
    return apiRequest('DELETE', `/players/${id}/standby/`)
  },

  triggerUpdate(id: string): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>('POST', `/players/${id}/update/`)
  },

  getCecStatus(id: string): Promise<CecStatus> {
    return apiRequest<CecStatus>('GET', `/players/${id}/cec-status/`)
  },

  cecStandby(id: string): Promise<CecStatus> {
    return apiRequest<CecStatus>('POST', `/players/${id}/cec-standby/`)
  },

  cecWake(id: string): Promise<CecStatus> {
    return apiRequest<CecStatus>('POST', `/players/${id}/cec-wake/`)
  },

  getIrStatus(id: string): Promise<IrStatus> {
    return apiRequest<IrStatus>('GET', `/players/${id}/ir-status/`)
  },

  irTest(id: string, protocol: string, scancode: string): Promise<{ success: boolean; error?: string }> {
    return apiRequest<{ success: boolean; error?: string }>('POST', `/players/${id}/ir-test/`, { protocol, scancode })
  },
}

export const groups = {
  list(): Promise<Group[]> {
    return apiRequest<Group[]>('GET', '/groups/')
  },

  get(id: string): Promise<Group> {
    return apiRequest<Group>('GET', `/groups/${id}/`)
  },

  create(data: Partial<Group>): Promise<Group> {
    return apiRequest<Group>('POST', '/groups/', data)
  },

  update(id: string, data: Partial<Group>): Promise<Group> {
    return apiRequest<Group>('PUT', `/groups/${id}/`, data)
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/groups/${id}/`)
  },

  applyRotation(id: string, screenRotation: 0 | 90 | 180 | 270): Promise<{
    success: boolean
    rotation: number
    results: Record<string, { name: string; success: boolean; error?: string }>
  }> {
    return apiRequest('POST', `/groups/${id}/apply-rotation/`, { screen_rotation: screenRotation })
  },

  pushBranding(id: string, sshUser: string, sshPassword: string, sshPort: number, pushLogo: boolean, pushStandby: boolean, pushTheme: boolean): Promise<{
    success: boolean
    results: Record<string, { name: string; success: boolean; error?: string }>
  }> {
    return apiRequest('POST', `/groups/${id}/push-branding/`, {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
      push_logo: pushLogo, push_standby: pushStandby, push_theme: pushTheme,
    })
  },

  uploadLogo(id: string, file: File): Promise<{ success: boolean; logo_url: string }> {
    const data = new FormData()
    data.append('logo', file)
    return apiRequest('POST', `/groups/${id}/logo/`, data)
  },

  deleteLogo(id: string): Promise<void> {
    return apiRequest('DELETE', `/groups/${id}/logo/`)
  },

  uploadStandby(id: string, file: File): Promise<{ success: boolean; standby_url: string }> {
    const data = new FormData()
    data.append('standby', file)
    return apiRequest('POST', `/groups/${id}/standby/`, data)
  },

  deleteStandby(id: string): Promise<void> {
    return apiRequest('DELETE', `/groups/${id}/standby/`)
  },
}

export const locations = {
  list(): Promise<Location[]> {
    return apiRequest<Location[]>('GET', '/locations/')
  },

  get(id: string): Promise<Location> {
    return apiRequest<Location>('GET', `/locations/${id}/`)
  },

  create(data: Partial<Location>): Promise<Location> {
    return apiRequest<Location>('POST', '/locations/', data)
  },

  update(id: string, data: Partial<Location>): Promise<Location> {
    return apiRequest<Location>('PUT', `/locations/${id}/`, data)
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/locations/${id}/`)
  },

  uploadLogo(id: string, file: File): Promise<{ success: boolean; logo_url: string }> {
    const data = new FormData()
    data.append('logo', file)
    return apiRequest('POST', `/locations/${id}/logo/`, data)
  },

  deleteLogo(id: string): Promise<void> {
    return apiRequest('DELETE', `/locations/${id}/logo/`)
  },

  uploadStandby(id: string, file: File): Promise<{ success: boolean; standby_url: string }> {
    const data = new FormData()
    data.append('standby', file)
    return apiRequest('POST', `/locations/${id}/standby/`, data)
  },

  deleteStandby(id: string): Promise<void> {
    return apiRequest('DELETE', `/locations/${id}/standby/`)
  },
}

export const playlists = {
  list(): Promise<Playlist[]> {
    return apiRequest<Playlist[]>('GET', '/playlists/')
  },

  get(id: string): Promise<Playlist> {
    return apiRequest<Playlist>('GET', `/playlists/${id}/`)
  },

  create(data: Partial<Playlist>): Promise<Playlist> {
    return apiRequest<Playlist>('POST', '/playlists/', data)
  },

  update(id: string, data: Partial<Playlist>): Promise<Playlist> {
    // PATCH, not PUT — the "apply to" flow sends only target_players/
    // target_groups/target_locations, and PUT would fail DRF's
    // full-payload validation (or worse, wipe other fields) for a
    // partial body.
    return apiRequest<Playlist>('PATCH', `/playlists/${id}/`, data)
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/playlists/${id}/`)
  },

  deploy(id: string): Promise<{ success: boolean; target_count: number }> {
    return apiRequest('POST', `/playlists/${id}/deploy/`)
  },
}

export const media = {
  async list(): Promise<MediaFile[]> {
    const data = await apiRequest<{ results: MediaFile[] } | MediaFile[]>('GET', '/media/?page_size=10000')
    return Array.isArray(data) ? data : data.results
  },

  upload(file: File, name?: string, onProgress?: (pct: number) => void): Promise<MediaFile> {
    return new Promise((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', file)
      if (name) formData.append('name', name)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE_URL}/media/`)
      xhr.setRequestHeader('X-CSRFToken', getCsrfToken())
      xhr.withCredentials = true

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100))
          }
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          let msg = `Upload failed: HTTP ${xhr.status}`
          try {
            const data = JSON.parse(xhr.responseText)
            if (data.name) msg = Array.isArray(data.name) ? data.name[0] : data.name
            else if (data.detail) msg = data.detail
            else if (data.message) msg = data.message
          } catch { /* ignore */ }
          reject(new Error(msg))
        }
      }
      xhr.onerror = () => reject(new Error('Upload failed: network error'))
      xhr.send(formData)
    })
  },

  addUrl(sourceUrl: string, name?: string): Promise<MediaFile> {
    return apiRequest<MediaFile>('POST', '/media/', {
      source_url: sourceUrl,
      name: name || sourceUrl,
    })
  },

  rename(id: string, name: string): Promise<MediaFile> {
    return apiRequest<MediaFile>('PATCH', `/media/${id}/`, { name })
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/media/${id}/`)
  },

  async listDeleted(): Promise<MediaFile[]> {
    const data = await apiRequest<{ results: MediaFile[] } | MediaFile[]>('GET', '/media/?deleted=1&page_size=10000')
    return Array.isArray(data) ? data : data.results
  },

  restore(id: string): Promise<MediaFile> {
    return apiRequest<MediaFile>('POST', `/media/${id}/restore/`)
  },

  purge(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/media/${id}/purge/`)
  },

  moveToFolder(id: string, folderId: string | null): Promise<MediaFile> {
    return apiRequest<MediaFile>('PATCH', `/media/${id}/`, { folder: folderId })
  },

  schedule(id: string, data: {
    target_player_ids: string[]; target_group_ids: string[]; target_location_ids: string[]
    duration?: number; start_date?: string | null; end_date?: string | null
  }): Promise<{ success: boolean; results: Record<string, { name: string; success: boolean; error?: string }> }> {
    return apiRequest('POST', `/media/${id}/schedule/`, data)
  },
}

export const schedules = {
  async list(): Promise<ScheduledDeployment[]> {
    const data = await apiRequest<{ results: ScheduledDeployment[] } | ScheduledDeployment[]>('GET', '/schedules/?page_size=10000')
    return Array.isArray(data) ? data : data.results
  },

  create(data: {
    media_file?: string; playlist?: string
    target_players?: string[]; target_groups?: string[]; target_locations?: string[]
    duration?: number | null; start_date?: string | null; end_date?: string | null
  }): Promise<ScheduledDeployment> {
    return apiRequest('POST', '/schedules/', data)
  },

  cancel(id: string): Promise<void> {
    return apiRequest('DELETE', `/schedules/${id}/`)
  },
}

export const folders = {
  async list(): Promise<MediaFolder[]> {
    const data = await apiRequest<{ results: MediaFolder[] } | MediaFolder[]>('GET', '/folders/')
    return Array.isArray(data) ? data : data.results
  },

  create(name: string): Promise<MediaFolder> {
    return apiRequest<MediaFolder>('POST', '/folders/', { name })
  },

  update(id: string, name: string): Promise<MediaFolder> {
    return apiRequest<MediaFolder>('PATCH', `/folders/${id}/`, { name })
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/folders/${id}/`)
  },
}

export const deploy = {
  async list(): Promise<DeployTask[]> {
    const data = await apiRequest<{ results: DeployTask[] } | DeployTask[]>('GET', '/deploy/')
    return Array.isArray(data) ? data : data.results
  },

  get(id: string): Promise<DeployTask> {
    return apiRequest<DeployTask>('GET', `/deploy/${id}/`)
  },

  create(data: Partial<DeployTask>): Promise<DeployTask> {
    return apiRequest<DeployTask>('POST', '/deploy/', data)
  },
}

export const playbackLog = {
  list(params: { player?: string; date_from?: string; date_to?: string; content?: string; page?: number; page_size?: number } = {}): Promise<PlaybackLogResponse> {
    const searchParams = new URLSearchParams()
    if (params.player) searchParams.set('player', params.player)
    if (params.date_from) searchParams.set('date_from', params.date_from)
    if (params.date_to) searchParams.set('date_to', params.date_to)
    if (params.content) searchParams.set('content', params.content)
    if (params.page) searchParams.set('page', String(params.page))
    if (params.page_size) searchParams.set('page_size', String(params.page_size))
    const qs = searchParams.toString()
    return apiRequest<PlaybackLogResponse>('GET', `/playback-log/${qs ? '?' + qs : ''}`)
  },

  stats(): Promise<PlaybackStatsResponse> {
    return apiRequest<PlaybackStatsResponse>('GET', '/playback-stats/')
  },
}

export async function pushLanguageToPlayers(language: string) {
  try {
    const allPlayers = await players.list()
    await Promise.allSettled(
      allPlayers.map((p) =>
        players.saveSettings(p.id, { language }).catch(() => {}),
      ),
    )
  } catch {
    // fire-and-forget: offline players just skip
  }
}

export const bulk = {
  reboot(playerIds: string[]): Promise<{ success: boolean }> {
    return apiRequest('POST', '/bulk/reboot/', { player_ids: playerIds })
  },

  shutdown(playerIds: string[]): Promise<{ success: boolean }> {
    return apiRequest('POST', '/bulk/shutdown/', { player_ids: playerIds })
  },
}

export const cctv = {
  list(): Promise<CctvConfig[]> {
    return apiRequest<CctvConfig[]>('GET', '/cctv/')
  },

  get(id: string): Promise<CctvConfig> {
    return apiRequest<CctvConfig>('GET', `/cctv/${id}/`)
  },

  create(data: Record<string, unknown>): Promise<CctvConfig> {
    return apiRequest<CctvConfig>('POST', '/cctv/', data)
  },

  update(id: string, data: Record<string, unknown>): Promise<CctvConfig> {
    return apiRequest<CctvConfig>('PUT', `/cctv/${id}/`, data)
  },

  delete(id: string): Promise<void> {
    return apiRequest<void>('DELETE', `/cctv/${id}/`)
  },

  start(id: string): Promise<{ success: boolean; status: string }> {
    return apiRequest('POST', `/cctv/${id}/start/`)
  },

  stop(id: string): Promise<{ success: boolean; status: string }> {
    return apiRequest('POST', `/cctv/${id}/stop/`)
  },

  status(id: string): Promise<{ status: string; pids: number[] }> {
    return apiRequest('GET', `/cctv/${id}/status/`)
  },

  requestStart(id: string): Promise<{ success: boolean; status: string }> {
    return apiRequest('POST', `/cctv/${id}/request-start/`)
  },
}

export const provision = {
  create(data: { ip_address: string; ssh_user?: string; ssh_password: string; ssh_port?: number; player_name?: string }): Promise<ProvisionTask> {
    return apiRequest<ProvisionTask>('POST', '/provision/', data)
  },

  get(taskId: string): Promise<ProvisionTask> {
    return apiRequest<ProvisionTask>('GET', `/provision/${taskId}/`)
  },

  retry(taskId: string, sshPassword: string): Promise<ProvisionTask> {
    return apiRequest<ProvisionTask>('POST', `/provision/${taskId}/retry/`, { ssh_password: sshPassword })
  },
}

export const system = {
  getVersion(): Promise<{ version: string; build_date: string }> {
    return apiRequest('GET', '/system/version/')
  },

  getFeatures(): Promise<Record<string, boolean>> {
    return apiRequest('GET', '/system/features/')
  },

  checkForUpdate(force?: boolean): Promise<{
    current_version: string
    latest_version: string | null
    update_available: boolean
    release_url?: string
    published_at?: string
    error?: string
  }> {
    const qs = force ? '?force=1' : ''
    return apiRequest('GET', `/system/update-check/${qs}`)
  },

  triggerUpdate(): Promise<{ success: boolean; message: string }> {
    return apiRequest('POST', '/system/update/')
  },

  getSettings(): Promise<{ auto_update: boolean }> {
    return apiRequest('GET', '/system/settings/')
  },

  updateSettings(data: { auto_update: boolean }): Promise<{ auto_update: boolean }> {
    return apiRequest('PATCH', '/system/settings/', data)
  },

  getTailscale(): Promise<TailscaleSettings> {
    return apiRequest<TailscaleSettings>('GET', '/system/tailscale/')
  },

  updateTailscale(data: Record<string, unknown>): Promise<TailscaleSettings> {
    return apiRequest<TailscaleSettings>('PATCH', '/system/tailscale/', data)
  },

  getAlertSettings(): Promise<AlertSettings> {
    return apiRequest<AlertSettings>('GET', '/system/alerts/')
  },

  updateAlertSettings(data: Record<string, unknown>): Promise<AlertSettings> {
    return apiRequest<AlertSettings>('PATCH', '/system/alerts/', data)
  },

  sendTestAlertEmail(toEmail?: string): Promise<{ success: boolean; error?: string }> {
    return apiRequest('POST', '/system/alerts/test/', toEmail ? { to_email: toEmail } : {})
  },

  getRegistryMirror(): Promise<RegistryMirrorSettings> {
    return apiRequest<RegistryMirrorSettings>('GET', '/system/registry/')
  },

  updateRegistryMirror(data: { enabled?: boolean; host?: string }): Promise<RegistryMirrorSettings> {
    return apiRequest<RegistryMirrorSettings>('PATCH', '/system/registry/', data)
  },

  syncRegistryMirror(): Promise<{ success?: boolean; error?: string }> {
    return apiRequest('POST', '/system/registry/sync/')
  },

  getRegistryMirrorSyncStatus(): Promise<RegistryMirrorSyncStatus> {
    return apiRequest<RegistryMirrorSyncStatus>('GET', '/system/registry/sync-status/')
  },

  getTelemetry(): Promise<ServerTelemetry> {
    return apiRequest<ServerTelemetry>('GET', '/system/telemetry/')
  },

  getBranding(): Promise<{
    has_custom_logo: boolean
    logo_url: string | null
    has_standby_image: boolean
    standby_url: string | null
  }> {
    return apiRequest('GET', '/system/branding/')
  },

  uploadBrandingLogo(file: File): Promise<{ success: boolean; logo_url: string }> {
    const data = new FormData()
    data.append('logo', file)
    return apiRequest('POST', '/system/branding/logo/', data)
  },

  deleteBrandingLogo(): Promise<void> {
    return apiRequest('DELETE', '/system/branding/logo/delete/')
  },

  uploadBrandingStandby(file: File): Promise<{ success: boolean; standby_url: string }> {
    const data = new FormData()
    data.append('standby', file)
    return apiRequest('POST', '/system/branding/standby/', data)
  },

  deleteBrandingStandby(): Promise<void> {
    return apiRequest('DELETE', '/system/branding/standby/delete/')
  },

  pushBrandingToAll(sshUser: string, sshPassword: string, sshPort: number, pushLogo: boolean, pushStandby: boolean, pushTheme: boolean): Promise<{
    success: boolean
    results: Record<string, { name: string; success: boolean; error?: string }>
  }> {
    return apiRequest('POST', '/system/branding/push-all/', {
      ssh_user: sshUser, ssh_password: sshPassword, ssh_port: sshPort,
      push_logo: pushLogo, push_standby: pushStandby, push_theme: pushTheme,
    })
  },
}

export interface BrandingImage {
  id: string
  name: string
  kind: 'logo' | 'standby'
  file: string
  is_deleted?: boolean
  deleted_at?: string | null
  created_at: string
}

export const brandingLibrary = {
  list(kind: 'logo' | 'standby'): Promise<BrandingImage[]> {
    return apiRequest('GET', `/players/branding-library/?kind=${kind}`)
  },

  upload(kind: 'logo' | 'standby', file: File, name?: string): Promise<BrandingImage> {
    const data = new FormData()
    data.append('kind', kind)
    data.append('file', file)
    data.append('name', name || file.name)
    return apiRequest('POST', '/players/branding-library/', data)
  },

  delete(id: string): Promise<void> {
    return apiRequest('DELETE', `/players/branding-library/${id}/`)
  },

  listDeleted(): Promise<BrandingImage[]> {
    return apiRequest('GET', '/players/branding-library/?deleted=1')
  },

  restore(id: string): Promise<BrandingImage> {
    return apiRequest('POST', `/players/branding-library/${id}/restore/`)
  },

  purge(id: string): Promise<void> {
    return apiRequest('DELETE', `/players/branding-library/${id}/purge/`)
  },
}

export const auth = {
  logout(): Promise<{ success: boolean }> {
    return apiRequest('POST', '/auth/logout/')
  },
}

export const users = {
  list(): Promise<User[]> {
    return apiRequest<User[]>('GET', '/users/')
  },

  me(): Promise<User> {
    return apiRequest<User>('GET', '/users/me/')
  },

  create(data: {
    username: string; email?: string; password: string; role: string
    first_name?: string; last_name?: string
    location_ids?: string[]; group_ids?: string[]; player_ids?: string[]
    receive_offline_alerts?: boolean; can_delete_content?: boolean
  }): Promise<User> {
    return apiRequest<User>('POST', '/users/', data)
  },

  update(id: number, data: Partial<User> & {
    password?: string; role?: string
    location_ids?: string[]; group_ids?: string[]; player_ids?: string[]
    receive_offline_alerts?: boolean; can_delete_content?: boolean
  }): Promise<User> {
    return apiRequest<User>('PATCH', `/users/${id}/`, data)
  },

  delete(id: number): Promise<void> {
    return apiRequest<void>('DELETE', `/users/${id}/`)
  },
}

export const audit = {
  list(params: { user?: string; action?: string; target_type?: string; from?: string; to?: string; page?: number; page_size?: number } = {}): Promise<AuditLogResponse> {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== '') searchParams.set(key, String(val))
    })
    const qs = searchParams.toString()
    return apiRequest<AuditLogResponse>('GET', `/audit/${qs ? '?' + qs : ''}`)
  },
}

export const bulkProvision = {
  scan(data: { method: string; start_ip?: string; end_ip?: string; ips?: string[] }): Promise<{ method: string; discovered_ips: string[]; count: number }> {
    return apiRequest('POST', '/bulk-provision/scan/', data)
  },

  start(data: { ips: string[]; ssh_user?: string; ssh_password: string; scan_method?: string }): Promise<BulkProvisionTask> {
    return apiRequest<BulkProvisionTask>('POST', '/bulk-provision/start/', data)
  },

  get(taskId: string): Promise<BulkProvisionTask> {
    return apiRequest<BulkProvisionTask>('GET', `/bulk-provision/${taskId}/`)
  },

  list(): Promise<BulkProvisionTask[]> {
    return apiRequest<BulkProvisionTask[]>('GET', '/bulk-provision/')
  },
}
