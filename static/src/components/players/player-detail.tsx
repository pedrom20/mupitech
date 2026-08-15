import React, { useEffect, useState, useCallback, useRef, useContext } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  FaArrowLeft,
  FaSyncAlt,
  FaDesktop,
  FaMemory,
  FaHdd,
  FaClock,
  FaTerminal as FaTerminalIcon,
  FaMicrochip,
  FaNetworkWired,
  FaCamera,
  FaCog,
  FaExpand,
  FaGlobe,
  FaVideo,
  FaImage,
  FaPlay,
  FaFile,
  FaEdit,
  FaTrash,
  FaPlus,
  FaToggleOn,
  FaToggleOff,
  FaExternalLinkAlt,
  FaChevronDown,
  FaChevronRight,
  FaBackward,
  FaForward,
  FaSortUp,
  FaSortDown,
  FaSort,
  FaFolder,
  FaFolderOpen,
  FaThermometerHalf,
  FaTachometerAlt,
  FaBolt,
  FaExclamationTriangle,
  FaDownload,
  FaCheckCircle,
  FaShieldAlt,
  FaPowerOff,
  FaListUl,
  FaCloudUploadAlt,
  FaMapMarkerAlt,
  FaLayerGroup,
  FaExchangeAlt,
  FaEye,
} from 'react-icons/fa'
import Swal from 'sweetalert2'
import { players as playersApi, media as mediaApi, folders as foldersApi, cctv as cctvApi, system as systemApi, groups as groupsApi, locations as locationsApi, ApiError } from '@/services/api'
import { translateApiError } from '@/utils/translateError'
import { showToast } from '@/utils/toast'
import { isVideoUrl } from '@/utils/media'
import BrandingLibraryPicker from '@/components/shared/branding-library-picker'
import type { Player, PlayerInfo, PlayerAsset, MediaFile, MediaFolder, PlayerUpdateCheckResult, CecStatus, IrStatus, Group, Location } from '@/types'
import PlayerTerminal from './player-terminal'
import { RoleContext, isAdminRole } from '@/components/app'

const getAssetTypeIcon = (mimetype: string) => {
  if (!mimetype) return <FaFile />
  const mt = mimetype.toLowerCase()
  if (mt === 'webpage' || mt === 'web') return <FaGlobe />
  if (mt === 'video') return <FaVideo />
  if (mt === 'image') return <FaImage />
  if (mt === 'streaming' || mt === 'youtube_asset' || mt === 'youtube') return <FaPlay />
  return <FaFile />
}

const formatAssetDate = (iso: string) => {
  if (!iso || iso === '' || iso === '0') return '--'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return iso
  }
}

const formatDuration = (val: number | string, t: (key: string) => string) => {
  const sec = typeof val === 'string' ? parseFloat(val) : val
  if (!sec && sec !== 0) return '--'
  if (sec === 0) return `0 ${t('assets.seconds')}`
  if (sec < 60) return `${sec} ${t('assets.seconds')}`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return remSec > 0
    ? `${min} ${t('assets.minutes')} ${remSec} ${t('assets.seconds')}`
    : `${min} ${t('assets.minutes')}`
}

const IR_PRESETS: Record<string, { protocol: string; scancode: string }> = {
  samsung: { protocol: 'samsung36', scancode: '0x0707E01F' },
  lg: { protocol: 'nec', scancode: '0x20DF10EF' },
  sony: { protocol: 'sony15', scancode: '0x0A90' },
  panasonic: { protocol: 'panasonic', scancode: '0x400401BC' },
  philips: { protocol: 'rc6_mce', scancode: '0x800F040C' },
  sharp: { protocol: 'necx', scancode: '0x007F0A' },
}

const toDatePart = (iso: string) => {
  if (!iso || iso === '' || iso === '0') return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return ''
  }
}

const toTimePart = (iso: string) => {
  if (!iso || iso === '' || iso === '0') return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

const combineDatetime = (datePart: string, timePart: string): string => {
  if (!datePart) return ''
  const time = timePart || '00:00'
  return new Date(`${datePart}T${time}`).toISOString()
}

const getMimetypeLabel = (mimetype: string): string => {
  if (!mimetype) return 'other'
  const mt = mimetype.toLowerCase()
  if (mt === 'webpage' || mt === 'web') return 'webpage'
  if (mt === 'video') return 'video'
  if (mt === 'image') return 'image'
  if (mt === 'streaming' || mt === 'youtube_asset' || mt === 'youtube') return 'streaming'
  return mimetype
}

const computeEndDate = (startDate: string, startTime: string, playFor: string): { date: string; time: string } => {
  if (!startDate || playFor === 'manual') return { date: '', time: '' }
  const start = new Date(`${startDate}T${startTime || '00:00'}`)
  if (isNaN(start.getTime())) return { date: '', time: '' }
  const end = new Date(start)
  switch (playFor) {
    case 'day': end.setDate(end.getDate() + 1); break
    case 'week': end.setDate(end.getDate() + 7); break
    case 'month': end.setMonth(end.getMonth() + 1); break
    case 'year': end.setFullYear(end.getFullYear() + 1); break
    case 'forever': end.setFullYear(9999, 0, 1); end.setHours(0, 0, 0, 0); break
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    time: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
  }
}

type SortField = 'name' | 'duration' | 'mimetype' | 'start_date' | 'end_date'
type SortDir = 'asc' | 'desc'

const PlayerDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const role = useContext(RoleContext)

  const [player, setPlayer] = useState<Player | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [info, setInfo] = useState<PlayerInfo | null>(null)
  const [assets, setAssets] = useState<PlayerAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [infoLoading, setInfoLoading] = useState(false)
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [togglingAssetId, setTogglingAssetId] = useState<string | null>(null)
  const [expandedPlaylistGroups, setExpandedPlaylistGroups] = useState<Set<string>>(new Set())
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [screenshotFullscreen, setScreenshotFullscreen] = useState(false)
  const [screenshotUnsupported, setScreenshotUnsupported] = useState(false)

  // Push branding (splash logo + standby image) — now the "branding" tab
  // of the unified settings modal (showSettingsModal/settingsActiveTab).
  const [pushLogoSshUser, setPushLogoSshUser] = useState('pi')
  const [pushLogoSshPassword, setPushLogoSshPassword] = useState('')
  const [pushLogoSshPort, setPushLogoSshPort] = useState(22)
  const [pushingLogo, setPushingLogo] = useState(false)
  const [pushTargetLogo, setPushTargetLogo] = useState(true)
  const [pushTargetStandby, setPushTargetStandby] = useState(false)
  const [brandingHasStandby, setBrandingHasStandby] = useState(false)
  const [saveSshCredentials, setSaveSshCredentials] = useState(false)
  const [uploadingDeviceLogo, setUploadingDeviceLogo] = useState(false)
  const [uploadingDeviceStandby, setUploadingDeviceStandby] = useState(false)
  const deviceLogoInputRef = useRef<HTMLInputElement>(null)
  const deviceStandbyInputRef = useRef<HTMLInputElement>(null)
  const [showDeviceLogoPicker, setShowDeviceLogoPicker] = useState(false)
  const [showDeviceStandbyPicker, setShowDeviceStandbyPicker] = useState(false)

  // Migrate to MupiTech Anthias image (x86 only for now) — lives in the
  // Settings modal's "image" tab (settingsActiveTab), see handleOpenSettings.
  const [checkingImageSource, setCheckingImageSource] = useState(false)
  const [imageSourceResult, setImageSourceResult] = useState<{ source: string; image: string; can_migrate: boolean; has_backup: boolean } | null>(null)
  const [restoringImage, setRestoringImage] = useState(false)
  const [imageSourceError, setImageSourceError] = useState('')
  const [migratingImage, setMigratingImage] = useState(false)
  const [migrateProgressText, setMigrateProgressText] = useState('')
  const [preserveContent, setPreserveContent] = useState(true)
  const [migrateTarget, setMigrateTarget] = useState<'mupitech' | 'official'>('mupitech')
  const [rebuildingImage, setRebuildingImage] = useState(false)

  // CCTV live view state
  const [cctvConfigId, setCctvConfigId] = useState<string | null>(null)
  const [liveViewEnabled, setLiveViewEnabled] = useState(false)
  const [liveSnapshotUrl, setLiveSnapshotUrl] = useState<string>('')

  // Edit modal state
  const [editAsset, setEditAsset] = useState<PlayerAsset | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    uri: '',
    mimetype: '',
    startDateDate: '',
    startDateTime: '',
    endDateDate: '',
    endDateTime: '',
    duration: '',
    nocache: false,
    playFor: 'manual',
    playDays: [1, 2, 3, 4, 5, 6, 7] as number[],
    playTimeFrom: '',
    playTimeTo: '',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Content picker modal state
  const [showContentModal, setShowContentModal] = useState(false)
  const [contentFiles, setContentFiles] = useState<MediaFile[]>([])
  const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(new Set())
  const [deployingSelected, setDeployingSelected] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [deployingId, setDeployingId] = useState<string | null>(null)
  const [contentFolders, setContentFolders] = useState<MediaFolder[]>([])
  const [contentFilterType, setContentFilterType] = useState<'all' | 'video' | 'image' | 'web'>('all')
  const [contentFilterFolder, setContentFilterFolder] = useState<string | null>(null)

  // Clone content from another device
  const [showCloneModal, setShowCloneModal] = useState(false)
  const [otherPlayers, setOtherPlayers] = useState<Player[]>([])
  const [cloneSourceId, setCloneSourceId] = useState('')
  const [cloningContent, setCloningContent] = useState(false)

  // Replace this device with another (hardware swap) — copies group,
  // location and content onto the replacement; the old device is left
  // as-is for the operator to remove/deactivate manually afterwards.
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [replaceCandidates, setReplaceCandidates] = useState<Player[]>([])
  const [replaceTargetId, setReplaceTargetId] = useState('')
  const [replacingDevice, setReplacingDevice] = useState(false)

  // Asset preview state
  const [previewAsset, setPreviewAsset] = useState<PlayerAsset | null>(null)
  const [hoveredAsset, setHoveredAsset] = useState<PlayerAsset | null>(null)
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Capability detection for standard Anthias players
  const [hasScreenshot, setHasScreenshot] = useState<boolean | null>(null)
  const [hasPlaybackControl, setHasPlaybackControl] = useState(true)

  // Player update state
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null)
  const [latestSha, setLatestSha] = useState('')
  const [updating, setUpdating] = useState(false)

  // CEC monitor control
  const [cecStatus, setCecStatus] = useState<CecStatus | null>(null)
  const [cecLoading, setCecLoading] = useState(false)

  // Player settings modal state — unified with the branding push modal
  // (splash logo/standby/theme) as tabs of the same dialog.
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsActiveTab, setSettingsActiveTab] = useState<'general' | 'location' | 'branding' | 'image' | 'access'>('general')
  const [_deviceSettings, setDeviceSettings] = useState<Record<string, unknown> | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  // General settings (audio/duration/schedule/etc.) live on the device
  // itself, fetched over its API — unavailable while offline. The
  // Location tab below doesn't need this: group/location are plain
  // Fleet Manager fields, so they stay editable even offline.
  const [generalSettingsError, setGeneralSettingsError] = useState(false)
  const [allGroups, setAllGroups] = useState<Group[]>([])
  const [allLocations, setAllLocations] = useState<Location[]>([])
  const [locationForm, setLocationForm] = useState({ group: '', location: '' })
  const [savingLocation, setSavingLocation] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    player_name: '',
    default_duration: '',
    default_streaming_duration: '',
    audio_output: 'hdmi',
    date_format: 'mm/dd/yyyy',
    resolution: '',
    screen_rotation: '0',
    show_splash: true,
    default_assets: false,
    shuffle_playlist: false,
    use_24_hour_clock: false,
    debug_logging: false,
  })
  const [displaySchedule, setDisplaySchedule] = useState<{
    enabled: boolean
    days: Record<string, { on: string; off: string } | null>
  }>({
    enabled: false,
    days: { '1': { on: '08:00', off: '22:00' }, '2': { on: '08:00', off: '22:00' }, '3': { on: '08:00', off: '22:00' }, '4': { on: '08:00', off: '22:00' }, '5': { on: '08:00', off: '22:00' }, '6': null, '7': null },
  })

  // IR fallback state
  const [irStatus, setIrStatus] = useState<IrStatus | null>(null)
  const [irEnabled, setIrEnabled] = useState(false)
  const [irPreset, setIrPreset] = useState('custom')
  const [irProtocol, setIrProtocol] = useState('')
  const [irScancode, setIrScancode] = useState('')
  const [irTesting, setIrTesting] = useState(false)

  // Sorting
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sortAssets = (list: PlayerAsset[]): PlayerAsset[] => {
    if (!sortField) return list
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '')
          break
        case 'duration': {
          const da = typeof a.duration === 'string' ? parseFloat(a.duration) || 0 : (a.duration || 0)
          const db = typeof b.duration === 'string' ? parseFloat(b.duration) || 0 : (b.duration || 0)
          cmp = da - db
          break
        }
        case 'mimetype':
          cmp = (a.mimetype || '').localeCompare(b.mimetype || '')
          break
        case 'start_date':
          cmp = (a.start_date || '').localeCompare(b.start_date || '')
          break
        case 'end_date':
          cmp = (a.end_date || '').localeCompare(b.end_date || '')
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <FaSort className="ms-1 opacity-25" style={{ fontSize: '0.7em' }} />
    return sortDir === 'asc'
      ? <FaSortUp className="ms-1" style={{ fontSize: '0.7em' }} />
      : <FaSortDown className="ms-1" style={{ fontSize: '0.7em' }} />
  }

  // Media library (loaded once for thumbnail matching)
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])

  const findMediaFile = useCallback((asset: PlayerAsset): MediaFile | null => {
    if (!mediaFiles.length) return null
    return mediaFiles.find(f => f.name === asset.name) || null
  }, [mediaFiles])

  const getAssetPreviewUrl = useCallback((asset: PlayerAsset): string | null => {
    if (asset.mimetype === 'webpage') return asset.uri
    const mf = findMediaFile(asset)
    if (mf && mf.url) return mf.url
    return null
  }, [findMediaFile])

  const renderAssetThumbnail = (asset: PlayerAsset) => {
    const mf = findMediaFile(asset)
    const mt = (asset.mimetype || '').toLowerCase()
    const thumbStyle: React.CSSProperties = { width: 64, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 4, display: 'block' }

    if (mt === 'image' && mf?.url) {
      return <img src={mf.url} alt="" style={thumbStyle} />
    }
    if (mt === 'video' && mf?.url) {
      return <video src={mf.url} muted playsInline preload="metadata" style={{ ...thumbStyle, background: '#000' }} />
    }
    if (mf?.thumbnail_url) {
      return <img src={mf.thumbnail_url} alt="" style={thumbStyle} />
    }
    return (
      <div
        className="d-flex align-items-center justify-content-center text-muted"
        style={{ ...thumbStyle, background: 'var(--bs-tertiary-bg, #f0f0f0)', fontSize: '0.9rem' }}
      >
        {getAssetTypeIcon(asset.mimetype)}
      </div>
    )
  }

  const loadAssets = useCallback(async () => {
    if (!id) return
    setAssetsLoading(true)
    try {
      const assetsData = await playersApi.getAssets(id)
      setAssets(Array.isArray(assetsData) ? assetsData : [])
    } catch {
      // Assets may not be available if player is offline
    } finally {
      setAssetsLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    const loadPlayer = async () => {
      setLoading(true)
      try {
        const playerData = await playersApi.get(id)
        setPlayer(playerData)
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: t('common.error'),
          text: String(error),
        })
      } finally {
        setLoading(false)
      }
    }
    loadPlayer()
  }, [id, t])

  useEffect(() => {
    groupsApi.list().then(setAllGroups).catch(() => {})
    locationsApi.list().then(setAllLocations).catch(() => {})
  }, [])

  useEffect(() => {
    if (!id || !player) return
    const loadInfo = async () => {
      setInfoLoading(true)
      try {
        const infoData = await playersApi.getInfo(id)
        setInfo(infoData)
      } catch {
        // Info may not be available if player is offline
      } finally {
        setInfoLoading(false)
      }
    }
    loadInfo()
    loadAssets()
    // Load display power schedule + IR settings on page init
    if (player.is_online) {
      playersApi.getSettings(id).then((data) => {
        const raw = data as Record<string, unknown>
        if (raw.display_power_schedule && typeof raw.display_power_schedule === 'object') {
          const dps = raw.display_power_schedule as Record<string, unknown>
          setDisplaySchedule({
            enabled: !!dps.enabled,
            days: (dps.days as Record<string, { on: string; off: string } | null>) || {
              '1': { on: '08:00', off: '22:00' }, '2': { on: '08:00', off: '22:00' },
              '3': { on: '08:00', off: '22:00' }, '4': { on: '08:00', off: '22:00' },
              '5': { on: '08:00', off: '22:00' }, '6': null, '7': null,
            },
          })
        }
        // IR settings for button visibility
        const irEn = !!raw.ir_enabled
        const irProto = String(raw.ir_protocol || '')
        const irScan = String(raw.ir_power_scancode || '')
        setIrEnabled(irEn)
        setIrProtocol(irProto)
        setIrScancode(irScan)
        const matchedPreset = Object.entries(IR_PRESETS).find(
          ([, v]) => v.protocol === irProto && v.scancode === irScan
        )
        setIrPreset(matchedPreset ? matchedPreset[0] : 'custom')
      }).catch(() => {})
      playersApi.getIrStatus(id).then(setIrStatus).catch(() => setIrStatus(null))
    }
    // Load CEC status (silent fail if not supported)
    if (player.is_online) {
      playersApi.getCecStatus(id).then(setCecStatus).catch(() => setCecStatus(null))
    }
    // Auto-request screenshot on page load
    if (player.is_online && !screenshotUnsupported) {
      const loadScreenshot = async () => {
        setScreenshotLoading(true)
        try {
          const url = await playersApi.getScreenshot(id)
          setScreenshotUrl(url)
          setHasScreenshot(true)
        } catch (err) {
          setHasScreenshot(false)
          if (err instanceof Error && (err as Error & { notSupported?: boolean }).notSupported) {
            setScreenshotUnsupported(true)
          }
        } finally {
          setScreenshotLoading(false)
        }
      }
      loadScreenshot()
    }
    // Cleanup blob URL on unmount or re-render
    return () => {
      setScreenshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return ''
      })
    }
  }, [id, player, loadAssets])

  // Load media library for thumbnails
  useEffect(() => {
    mediaApi.list().then(files => setMediaFiles(files)).catch(() => {})
  }, [])


  // Detect CCTV: only show live view if the player is CURRENTLY showing a CCTV asset
  useEffect(() => {
    if (!id || !player?.is_online) return

    const checkNowPlaying = () => {
      playersApi.nowPlaying(id!).then(np => {
        if (!np) { setCctvConfigId(null); setLiveViewEnabled(false); return }
        // Find the asset in the player's library to get its URI
        const asset = assets.find(a => a.asset_id === np.asset_id)
        const uri = asset?.uri || ''
        if (uri.includes('/cctv/')) {
          const match = uri.match(/\/cctv\/([a-f0-9-]+)/)
          if (match) {
            const configId = match[1]
            setCctvConfigId(configId)
            cctvApi.status(configId).then(res => {
              setLiveViewEnabled(res.status === 'running')
            }).catch(() => setLiveViewEnabled(false))
            return
          }
        }
        setCctvConfigId(null)
        setLiveViewEnabled(false)
      }).catch(() => {
        setCctvConfigId(null)
        setLiveViewEnabled(false)
      })
    }

    checkNowPlaying()
    const intervalId = setInterval(checkNowPlaying, 15000)
    return () => clearInterval(intervalId)
  }, [id, player?.is_online, assets])

  // CCTV snapshot auto-refresh (every 2s) — try snapshot.jpg, fallback to cam_0.jpg
  useEffect(() => {
    if (!cctvConfigId || !liveViewEnabled) {
      setLiveSnapshotUrl('')
      return
    }
    const ts = () => Date.now()
    const snapshotUrl = `/media/cctv/${cctvConfigId}/snapshot.jpg`
    const cam0Url = `/media/cctv/${cctvConfigId}/cam_0.jpg`

    const updateSnapshot = () => {
      // Try snapshot.jpg first (mosaic or stitched grid), fallback to cam_0.jpg
      const img = new Image()
      img.onload = () => setLiveSnapshotUrl(`${snapshotUrl}?t=${ts()}`)
      img.onerror = () => setLiveSnapshotUrl(`${cam0Url}?t=${ts()}`)
      img.src = `${snapshotUrl}?t=${ts()}`
    }
    updateSnapshot()
    const intervalId = setInterval(updateSnapshot, 2000)
    return () => clearInterval(intervalId)
  }, [cctvConfigId, liveViewEnabled])

  // CCTV keepalive (ping request-start every 60s)
  useEffect(() => {
    if (!cctvConfigId || !liveViewEnabled) return
    cctvApi.requestStart(cctvConfigId).catch(() => {})
    const intervalId = setInterval(() => {
      cctvApi.requestStart(cctvConfigId).catch(() => {})
    }, 60000)
    return () => clearInterval(intervalId)
  }, [cctvConfigId, liveViewEnabled])

  // Close preview modal on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewAsset) setPreviewAsset(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewAsset])

  const handleForget = async () => {
    const result = await Swal.fire({
      title: t('players.forgetTitle'),
      text: t('players.forgetConfirm'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      confirmButtonText: t('players.forget'),
      cancelButtonText: t('common.cancel'),
    })
    if (result.isConfirmed && id) {
      try {
        await playersApi.delete(id)
        showToast('success', t('players.forgotten'))
        navigate('/')
      } catch (error) {
        Swal.fire({ icon: 'error', title: t('common.error'), text: String(error) })
      }
    }
  }

  const handleBack = () => {
    if (location.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/players')
    }
  }

  const handleReboot = async () => {
    if (!id) return
    const result = await Swal.fire({
      title: t('players.reboot'),
      text: `${t('common.confirm')}: ${player?.name}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('players.reboot'),
      cancelButtonText: t('common.cancel'),
    })
    if (result.isConfirmed) {
      try {
        await playersApi.reboot(id)
        showToast('success', t('common.success'))
      } catch {
        Swal.fire({ icon: 'error', title: t('common.error') })
      }
    }
  }


  const handleSsoLogin = async () => {
    if (!id) return
    try {
      const res = await playersApi.ssoLogin(id)
      window.open(res.url, '_blank', 'noopener,noreferrer')
      return
    } catch (error) {
      if (!(error instanceof ApiError) || error.message.indexOf('SSO has not been set up') === -1) {
        Swal.fire({ icon: 'error', title: t('common.error'), text: error instanceof ApiError ? error.message : String(error) })
        return
      }
    }

    // Not provisioned yet — offer to set it up now, using the saved SSH
    // credential if there is one (same convention as branding pushes).
    const confirmed = await Swal.fire({
      icon: 'question',
      title: t('players.ssoNotSetUp'),
      text: t('players.ssoSetUpPrompt'),
      showCancelButton: true,
      confirmButtonText: t('players.ssoSetUpButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!confirmed.isConfirmed) return

    let sshUser = player?.ssh_username || 'pi'
    let sshPassword = ''
    let sshPort = player?.ssh_port || 22
    if (!player?.has_ssh_credentials) {
      const { value: formValues } = await Swal.fire({
        title: t('players.sshCredentialsTitle'),
        html:
          `<input id="swal-ssh-user" class="swal2-input" placeholder="${t('branding.sshUser')}" value="pi">` +
          `<input id="swal-ssh-password" type="password" class="swal2-input" placeholder="${t('branding.sshPassword')}">`,
        confirmButtonText: t('common.confirm'),
        showCancelButton: true,
        cancelButtonText: t('common.cancel'),
        preConfirm: () => {
          const user = (document.getElementById('swal-ssh-user') as HTMLInputElement)?.value
          const password = (document.getElementById('swal-ssh-password') as HTMLInputElement)?.value
          if (!password) {
            Swal.showValidationMessage(t('branding.sshPassword'))
            return false
          }
          return { user, password }
        },
      })
      if (!formValues) return
      sshUser = formValues.user || 'pi'
      sshPassword = formValues.password
    }

    try {
      await playersApi.pushSsoSecret(id, sshUser, sshPassword, sshPort)
      const res = await playersApi.ssoLogin(id)
      window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: error instanceof ApiError ? error.message : String(error) })
    }
  }

  const handleToggleSso = async () => {
    if (!id || !player) return
    const nextEnabled = !player.sso_enabled
    try {
      await playersApi.update(id, { sso_enabled: nextEnabled })
      setPlayer({ ...player, sso_enabled: nextEnabled })
      showToast('success', nextEnabled ? t('players.ssoEnabledToast') : t('players.ssoDisabledToast'))
    } catch (error) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: error instanceof ApiError ? error.message : String(error) })
    }
  }

  const handleRevealCredentials = async () => {
    if (!id) return
    const { value: adminPassword } = await Swal.fire({
      title: t('players.revealCredentialsPrompt'),
      input: 'password',
      inputPlaceholder: t('players.yourPassword'),
      showCancelButton: true,
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputValidator: (value) => (value ? undefined : t('players.yourPassword')),
    })
    if (!adminPassword) return

    try {
      const result = await playersApi.revealCredentials(id, adminPassword)
      Swal.fire({
        icon: 'info',
        title: t('players.password'),
        html: `<div class="text-start"><strong>${t('players.username')}:</strong> `
          + `<code>${result.username}</code><br><strong>${t('players.password')}:</strong> `
          + `<code style="user-select: all">${result.password}</code></div>`,
      })
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: t('common.error'),
        text: error instanceof ApiError ? error.message : String(error),
      })
    }
  }

  const handleForgetSshCredentials = async () => {
    if (!id || !player) return
    try {
      await playersApi.deleteSshCredentials(id)
      setPlayer({ ...player, has_ssh_credentials: false, ssh_username: '', ssh_port: 22 })
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const uploadDeviceLogoFile = async (file: File) => {
    if (!id || !player) return
    setUploadingDeviceLogo(true)
    try {
      const res = await playersApi.uploadLogo(id, file)
      setPlayer({ ...player, splash_logo: res.logo_url })
      setShowDeviceLogoPicker(false)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingDeviceLogo(false)
    }
  }

  const handleDeviceLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadDeviceLogoFile(file)
    if (deviceLogoInputRef.current) deviceLogoInputRef.current.value = ''
  }

  const handleDeviceLogoDelete = async () => {
    if (!id || !player) return
    try {
      await playersApi.deleteLogo(id)
      setPlayer({ ...player, splash_logo: null })
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const uploadDeviceStandbyFile = async (file: File) => {
    if (!id || !player) return
    setUploadingDeviceStandby(true)
    try {
      const res = await playersApi.uploadStandby(id, file)
      setPlayer({ ...player, standby_image: res.standby_url })
      setShowDeviceStandbyPicker(false)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setUploadingDeviceStandby(false)
    }
  }

  const handleDeviceStandbyChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadDeviceStandbyFile(file)
    if (deviceStandbyInputRef.current) deviceStandbyInputRef.current.value = ''
  }

  const handleDeviceStandbyDelete = async () => {
    if (!id || !player) return
    try {
      await playersApi.deleteStandby(id)
      setPlayer({ ...player, standby_image: null })
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    }
  }

  const handlePushBranding = async () => {
    const canUseSavedPassword = !!player?.has_ssh_credentials && !pushLogoSshPassword
    if (!id || (!pushLogoSshPassword && !canUseSavedPassword) || (!pushTargetLogo && !pushTargetStandby)) return
    setPushingLogo(true)
    try {
      await playersApi.pushBranding(id, pushLogoSshUser, pushLogoSshPassword, pushLogoSshPort, pushTargetLogo, pushTargetStandby, saveSshCredentials)
      showToast('success', t('branding.pushed'))
      setShowSettingsModal(false)
      if (saveSshCredentials && player && pushLogoSshPassword) {
        setPlayer({ ...player, has_ssh_credentials: true, ssh_username: pushLogoSshUser, ssh_port: pushLogoSshPort })
      }
      setPushLogoSshPassword('')
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('branding.pushFailed'), text: String(err) })
    } finally {
      setPushingLogo(false)
    }
  }

  // players/migrate_image.py's MigrationError carries a stable code+params
  // (see ApiError in @/services/api) — prefer that precise translation,
  // and only fall back to the generic message-pattern-matching
  // translateApiError util when the error has no code (e.g. a network
  // failure that never reached the backend).
  const resolveMigrateImageError = (err: unknown): string => {
    if (err instanceof ApiError && err.code) {
      const translated = t(`migrateImage.errors.${err.code}`, { ...err.params, defaultValue: '' })
      if (translated) return translated
    }
    return translateApiError(err instanceof Error ? err.message : String(err), t)
  }

  const handleCheckImageSource = async () => {
    const canUseSavedPassword = !!player?.has_ssh_credentials && !pushLogoSshPassword
    if (!id || (!pushLogoSshPassword && !canUseSavedPassword)) return
    setCheckingImageSource(true)
    setImageSourceError('')
    try {
      const result = await playersApi.getImageSource(id, pushLogoSshUser, pushLogoSshPassword, pushLogoSshPort)
      setImageSourceResult(result)
    } catch (err) {
      setImageSourceError(resolveMigrateImageError(err))
    } finally {
      setCheckingImageSource(false)
    }
  }

  const handleMigrateImage = async () => {
    const canUseSavedPassword = !!player?.has_ssh_credentials && !pushLogoSshPassword
    if (!id || (!pushLogoSshPassword && !canUseSavedPassword)) return
    const result = await Swal.fire({
      icon: 'warning',
      title: t('migrateImage.confirmTitle', { target: t(migrateTarget === 'mupitech' ? 'migrateImage.targetMupitech' : 'migrateImage.targetOfficial') }),
      text: t('migrateImage.confirmText'),
      showCancelButton: true,
      confirmButtonText: t('migrateImage.confirmButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    setMigratingImage(true)
    // The migrate/update call is one long synchronous request (SSH connect,
    // docker pull + up, then re-applying the MupiTech branding) — the server
    // has no way to stream progress back mid-request, so this is a timed
    // narration of what's *likely* happening, not a real progress bar. Still
    // much better than a bare spinner sitting for a minute+ with zero
    // feedback, which reads as "stuck" (see the exact complaint this was
    // added for). Cleared in the finally block below regardless of outcome.
    setMigrateProgressText(t('migrateImage.progressConnecting'))
    const progressTimers = [
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressPulling')), 4_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressRestarting')), 30_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressBranding')), 45_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressSlow')), 90_000),
    ]
    try {
      const migrateResult = await playersApi.migrateImage(
        id, pushLogoSshUser, pushLogoSshPassword, pushLogoSshPort, saveSshCredentials, preserveContent, migrateTarget,
      )
      const baseMsg = migrateResult.action === 'migrated' ? t('migrateImage.migrated') : t('migrateImage.updated')
      const brandingFailedCount = migrateResult.branding_failed?.length || 0
      const brandingNote = brandingFailedCount > 0
        ? t('migrateImage.brandingPushedWithFailures', { pushed: migrateResult.branding_pushed?.length || 0, failed: brandingFailedCount })
        : ''
      if (preserveContent && migrateResult.content_restored != null) {
        const failedCount = migrateResult.content_restore_failed?.length || 0
        showToast(
          failedCount > 0 || brandingFailedCount > 0 ? 'warning' : 'success',
          baseMsg,
          [
            failedCount > 0
              ? t('migrateImage.contentRestoredSummaryWithFailures', { restored: migrateResult.content_restored, failed: failedCount })
              : t('migrateImage.contentRestoredSummary', { restored: migrateResult.content_restored }),
            brandingNote,
          ].filter(Boolean).join(' '),
        )
      } else if (preserveContent && migrateResult.content_restore_error) {
        showToast('warning', baseMsg, [migrateResult.content_restore_error, brandingNote].filter(Boolean).join(' '))
      } else if (brandingNote) {
        showToast('warning', baseMsg, brandingNote)
      } else {
        showToast('success', baseMsg)
      }
      if (saveSshCredentials && player && pushLogoSshPassword) {
        setPlayer({ ...player, has_ssh_credentials: true, ssh_username: pushLogoSshUser, ssh_port: pushLogoSshPort })
      }
      setPushLogoSshPassword('')
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('migrateImage.failed'), text: resolveMigrateImageError(err) })
    } finally {
      progressTimers.forEach(clearTimeout)
      setMigrateProgressText('')
      setMigratingImage(false)
    }
  }

  const handleRestoreImage = async () => {
    const canUseSavedPassword = !!player?.has_ssh_credentials && !pushLogoSshPassword
    if (!id || (!pushLogoSshPassword && !canUseSavedPassword)) return
    const result = await Swal.fire({
      icon: 'warning',
      title: t('migrateImage.restoreConfirmTitle'),
      text: t('migrateImage.restoreConfirmText'),
      showCancelButton: true,
      confirmButtonText: t('migrateImage.restoreConfirmButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    setRestoringImage(true)
    try {
      await playersApi.restoreImage(id, pushLogoSshUser, pushLogoSshPassword, pushLogoSshPort)
      showToast('success', t('migrateImage.restored'))
      setImageSourceResult(null)
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('migrateImage.restoreFailed'), text: resolveMigrateImageError(err) })
    } finally {
      setRestoringImage(false)
    }
  }

  const handleRebuildImage = async () => {
    const canUseSavedPassword = !!player?.has_ssh_credentials && !pushLogoSshPassword
    if (!id || (!pushLogoSshPassword && !canUseSavedPassword)) return
    const result = await Swal.fire({
      icon: 'error',
      title: t('migrateImage.rebuildConfirmTitle'),
      text: t('migrateImage.rebuildConfirmText'),
      showCancelButton: true,
      confirmButtonText: t('migrateImage.rebuildConfirmButton'),
      cancelButtonText: t('common.cancel'),
      confirmButtonColor: '#dc3545',
    })
    if (!result.isConfirmed) return
    setRebuildingImage(true)
    setMigrateProgressText(t('migrateImage.progressConnecting'))
    const progressTimers = [
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressWiping')), 4_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressPulling')), 20_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressRestarting')), 45_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressBranding')), 60_000),
      setTimeout(() => setMigrateProgressText(t('migrateImage.progressSlow')), 100_000),
    ]
    try {
      const rebuildResult = await playersApi.rebuildImage(
        id, pushLogoSshUser, pushLogoSshPassword, pushLogoSshPort, saveSshCredentials, preserveContent,
      )
      const brandingFailedCount = rebuildResult.branding_failed?.length || 0
      const brandingNote = brandingFailedCount > 0
        ? t('migrateImage.brandingPushedWithFailures', { pushed: rebuildResult.branding_pushed?.length || 0, failed: brandingFailedCount })
        : ''
      if (preserveContent && rebuildResult.content_restored != null) {
        const failedCount = rebuildResult.content_restore_failed?.length || 0
        showToast(
          failedCount > 0 || brandingFailedCount > 0 ? 'warning' : 'success',
          t('migrateImage.rebuilt'),
          [
            failedCount > 0
              ? t('migrateImage.contentRestoredSummaryWithFailures', { restored: rebuildResult.content_restored, failed: failedCount })
              : t('migrateImage.contentRestoredSummary', { restored: rebuildResult.content_restored }),
            brandingNote,
          ].filter(Boolean).join(' '),
        )
      } else if (preserveContent && rebuildResult.content_restore_error) {
        showToast('warning', t('migrateImage.rebuilt'), [rebuildResult.content_restore_error, brandingNote].filter(Boolean).join(' '))
      } else if (brandingNote) {
        showToast('warning', t('migrateImage.rebuilt'), brandingNote)
      } else {
        showToast('success', t('migrateImage.rebuilt'))
      }
      if (saveSshCredentials && player && pushLogoSshPassword) {
        setPlayer({ ...player, has_ssh_credentials: true, ssh_username: pushLogoSshUser, ssh_port: pushLogoSshPort })
      }
      setPushLogoSshPassword('')
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('migrateImage.rebuildFailed'), text: resolveMigrateImageError(err) })
    } finally {
      progressTimers.forEach(clearTimeout)
      setMigrateProgressText('')
      setRebuildingImage(false)
    }
  }

  const handleUpdateCheck = useCallback(async (silent = false) => {
    if (!id) return
    setUpdateChecking(true)
    try {
      const result = await playersApi.updateCheck(id)
      setUpdateAvailable(result.update_available)
      setLatestSha(result.latest_sha)
    } catch {
      if (!silent) {
        setUpdateAvailable(null)
      }
    } finally {
      setUpdateChecking(false)
    }
  }, [id])

  // Auto-check for updates when player info is loaded and player is online
  useEffect(() => {
    if (info?.anthias_version && player?.is_online) {
      handleUpdateCheck(true)
    }
  }, [info?.anthias_version, player?.is_online, handleUpdateCheck])

  const handleUpdate = async () => {
    if (!id) return
    const confirm = await Swal.fire({
      icon: 'question',
      title: t('players.updatePlayer'),
      text: t('players.updateConfirm'),
      showCancelButton: true,
      confirmButtonText: t('players.updatePlayer'),
      cancelButtonText: t('common.cancel'),
    })
    if (!confirm.isConfirmed) return
    setUpdating(true)
    try {
      const result = await playersApi.triggerUpdate(id)
      if (result.success) {
        setUpdateAvailable(false)
        showToast('success', t('players.updatePlayer'), t('players.updateTriggered'))
      } else {
        Swal.fire({ icon: 'error', title: t('players.updateFailed'), text: t('players.updateFailed') })
      }
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('players.updateFailed'), text: String(err) })
    } finally {
      setUpdating(false)
    }
  }

  const handleScreenshot = async () => {
    if (!id) return
    setScreenshotLoading(true)
    try {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl)
      const url = await playersApi.getScreenshot(id)
      setScreenshotUrl(url)
      setHasScreenshot(true)
    } catch (err) {
      setHasScreenshot(false)
      const notSupported = err instanceof Error && (err as Error & { notSupported?: boolean }).notSupported
      if (notSupported) {
        setScreenshotUnsupported(true)
      } else if (hasScreenshot !== null) {
        const message = err instanceof Error ? err.message : undefined
        Swal.fire({ icon: 'error', title: t('common.error'), text: translateApiError(message, t) })
      }
    } finally {
      setScreenshotLoading(false)
    }
  }

  const handleSidecarScreenshot = async () => {
    if (!id || !player) return

    let sshUser = player.ssh_username || 'pi'
    let sshPassword = ''
    let sshPort = player.ssh_port || 22
    let saveCredentials = false

    if (!player.has_ssh_credentials) {
      const result = await Swal.fire({
        title: t('players.sidecarPromptTitle'),
        html:
          `<input id="swal-ssh-user" class="swal2-input" placeholder="${t('branding.sshUser')}" value="pi">` +
          `<input id="swal-ssh-password" type="password" class="swal2-input" placeholder="${t('branding.sshPassword')}">` +
          `<input id="swal-ssh-port" type="number" class="swal2-input" placeholder="${t('branding.sshPort')}" value="22">`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: t('players.sidecarCapture'),
        cancelButtonText: t('common.cancel'),
        preConfirm: () => {
          const userInput = (document.getElementById('swal-ssh-user') as HTMLInputElement).value
          const passwordInput = (document.getElementById('swal-ssh-password') as HTMLInputElement).value
          const portInput = Number((document.getElementById('swal-ssh-port') as HTMLInputElement).value) || 22
          if (!passwordInput) {
            Swal.showValidationMessage(t('branding.sshPassword'))
            return false
          }
          return { user: userInput, password: passwordInput, port: portInput }
        },
      })
      if (!result.isConfirmed || !result.value) return
      sshUser = result.value.user
      sshPassword = result.value.password
      sshPort = result.value.port
      saveCredentials = true
    }

    setScreenshotLoading(true)
    try {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl)
      const url = await playersApi.captureScreenshotSidecar(id, sshUser, sshPassword, sshPort, saveCredentials)
      setScreenshotUrl(url)
      setHasScreenshot(true)
      if (saveCredentials) {
        setPlayer({ ...player, has_ssh_credentials: true, ssh_username: sshUser, ssh_port: sshPort })
      }
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setScreenshotLoading(false)
    }
  }

  // Asset toggle enabled/disabled (optimistic UI like Anthias Player)
  const handleToggleAsset = async (asset: PlayerAsset) => {
    if (!id || togglingAssetId) return
    const newEnabled = asset.is_enabled ? 0 : 1
    const newActive = !!newEnabled
    setTogglingAssetId(asset.asset_id)
    // Optimistic update: toggle is_enabled + is_active immediately
    setAssets(prev => prev.map(a =>
      a.asset_id === asset.asset_id ? { ...a, is_enabled: newEnabled, is_active: newActive } : a
    ))
    try {
      await playersApi.updateAsset(id, asset.asset_id, { is_enabled: newEnabled })
      // Silent refresh — update from server without showing spinner
      const freshAssets = await playersApi.getAssets(id)
      setAssets(Array.isArray(freshAssets) ? freshAssets : [])
    } catch {
      // Revert on error
      setAssets(prev => prev.map(a =>
        a.asset_id === asset.asset_id ? { ...a, is_enabled: asset.is_enabled, is_active: asset.is_active } : a
      ))
      Swal.fire({ icon: 'error', title: t('assets.updateFailed') })
    } finally {
      setTogglingAssetId(null)
    }
  }

  // Asset delete
  const toggleAssetSelection = (assetId: string) => {
    setSelectedAssetIds(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const handleBulkDeleteAssets = async (assetIds: string[]) => {
    if (!id || assetIds.length === 0) return
    const result = await Swal.fire({
      title: t('assets.deleteAsset'),
      text: t('assets.confirmBulkDelete', { count: assetIds.length }),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    try {
      await Promise.all(assetIds.map(assetId => playersApi.deleteAsset(id, assetId)))
      setAssets(prev => prev.filter(a => !assetIds.includes(a.asset_id)))
      setSelectedAssetIds(prev => {
        const next = new Set(prev)
        assetIds.forEach(assetId => next.delete(assetId))
        return next
      })
      showToast('success', t('assets.deleted'))
    } catch {
      Swal.fire({ icon: 'error', title: t('assets.deleteFailed') })
    }
  }

  const handleDeleteAsset = async (asset: PlayerAsset) => {
    if (!id) return

    const result = await Swal.fire({
      title: t('assets.deleteAsset'),
      text: t('assets.confirmDelete'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    })
    if (result.isConfirmed) {
      try {
        await playersApi.deleteAsset(id, asset.asset_id)
        showToast('success', t('assets.deleted'))
        setAssets(prev => prev.filter(a => a.asset_id !== asset.asset_id))
      } catch {
        Swal.fire({ icon: 'error', title: t('assets.deleteFailed') })
      }
    }
  }

  // Open edit modal
  const handleOpenEdit = (asset: PlayerAsset) => {
    setEditAsset(asset)
    setEditForm({
      name: asset.name || '',
      uri: asset.uri || '',
      mimetype: asset.mimetype || '',
      startDateDate: toDatePart(asset.start_date),
      startDateTime: toTimePart(asset.start_date),
      endDateDate: toDatePart(asset.end_date),
      endDateTime: toTimePart(asset.end_date),
      duration: String(typeof asset.duration === 'number' ? asset.duration : 0),
      nocache: !!asset.nocache,
      playFor: 'manual',
      playDays: asset.play_days && asset.play_days.length > 0 ? asset.play_days : [1, 2, 3, 4, 5, 6, 7],
      playTimeFrom: (asset.play_time_from || '').slice(0, 5),
      playTimeTo: (asset.play_time_to || '').slice(0, 5),
    })
    setShowAdvanced(false)
  }

  // Handle playFor change
  const handlePlayForChange = (value: string) => {
    const newForm = { ...editForm, playFor: value }
    if (value !== 'manual') {
      const end = computeEndDate(newForm.startDateDate, newForm.startDateTime, value)
      newForm.endDateDate = end.date
      newForm.endDateTime = end.time
    }
    setEditForm(newForm)
  }

  // Save edit
  const handleSaveEdit = async () => {
    if (!id || !editAsset) return
    const updateData: Record<string, string | number | boolean | number[] | null> = {
      name: editForm.name,
      nocache: editForm.nocache ? 1 : 0,
    }
    if (editForm.startDateDate) {
      updateData.start_date = combineDatetime(editForm.startDateDate, editForm.startDateTime)
    }
    if (editForm.endDateDate) {
      updateData.end_date = combineDatetime(editForm.endDateDate, editForm.endDateTime)
    }
    const sec = parseInt(editForm.duration, 10)
    if (!isNaN(sec)) {
      updateData.duration = sec
    }
    // Recurring weekly schedule — play_days must be non-empty (the
    // player's own API rejects an empty list), and the time window is
    // only applied when both endpoints are set.
    updateData.play_days = editForm.playDays.length > 0 ? editForm.playDays : [1, 2, 3, 4, 5, 6, 7]
    if (editForm.playTimeFrom && editForm.playTimeTo) {
      updateData.play_time_from = editForm.playTimeFrom
      updateData.play_time_to = editForm.playTimeTo
    } else {
      updateData.play_time_from = null
      updateData.play_time_to = null
    }
    try {
      await playersApi.updateAsset(id, editAsset.asset_id, updateData as Partial<PlayerAsset>)
      showToast('success', t('assets.updated'))
      setEditAsset(null)
      loadAssets()
    } catch {
      Swal.fire({ icon: 'error', title: t('assets.updateFailed') })
    }
  }

  // Playback control (next/previous) — refresh screenshot after delay
  const handlePlaybackControl = async (command: 'next' | 'previous') => {
    if (!id) return
    try {
      await playersApi.playbackControl(id, command)
      // Give the player a few seconds to switch, then refresh screenshot
      setTimeout(() => {
        handleScreenshot()
      }, 3000)
    } catch (err: unknown) {
      const msg = String(err instanceof Error ? err.message : '')
      if (msg.includes('404') || msg.includes('502') || msg.includes('Not Found')) {
        setHasPlaybackControl(false)
        Swal.fire({ icon: 'info', title: t('players.featureNotSupported'), timer: 2000, showConfirmButton: false })
      } else {
        Swal.fire({ icon: 'error', title: t('common.error'), text: translateApiError(msg, t) })
      }
    }
  }

  // Open player settings modal
  const handleOpenSettings = async (tab: 'general' | 'location' | 'branding' | 'image' | 'access' = 'general') => {
    if (!id) return
    setShowSettingsModal(true)
    setSettingsActiveTab(tab)
    setSettingsLoading(true)
    setGeneralSettingsError(false)
    setLocationForm({
      group: player?.group_detail?.id || '',
      location: player?.location_detail?.id || player?.location || '',
    })
    // Branding/Image tab state — initialized alongside the general tab
    // (not only when clicked) since they all now live in one modal.
    setSaveSshCredentials(false)
    setImageSourceResult(null)
    setImageSourceError('')
    if (player?.has_ssh_credentials) {
      setPushLogoSshUser(player.ssh_username || 'pi')
      setPushLogoSshPort(player.ssh_port || 22)
    }
    systemApi.getBranding().then((res) => setBrandingHasStandby(res.has_standby_image)).catch(() => {})
    try {
      const data = await playersApi.getSettings(id) as Record<string, string | number | boolean | object>
      setDeviceSettings(data)
      setSettingsForm({
        player_name: player?.name || String(data.player_name || ''),
        default_duration: String(data.default_duration ?? ''),
        default_streaming_duration: String(data.default_streaming_duration ?? ''),
        audio_output: String(data.audio_output || 'hdmi'),
        date_format: String(data.date_format || 'mm/dd/yyyy'),
        resolution: String(data.resolution || ''),
        screen_rotation: String(data.screen_rotation ?? '0'),
        show_splash: !!data.show_splash,
        default_assets: !!data.default_assets,
        shuffle_playlist: !!data.shuffle_playlist,
        use_24_hour_clock: !!data.use_24_hour_clock,
        debug_logging: !!data.debug_logging,
      })
      // Load display power schedule
      if (data.display_power_schedule && typeof data.display_power_schedule === 'object') {
        const dps = data.display_power_schedule as Record<string, unknown>
        setDisplaySchedule({
          enabled: !!dps.enabled,
          days: (dps.days as Record<string, { on: string; off: string } | null>) || {
            '1': { on: '08:00', off: '22:00' }, '2': { on: '08:00', off: '22:00' },
            '3': { on: '08:00', off: '22:00' }, '4': { on: '08:00', off: '22:00' },
            '5': { on: '08:00', off: '22:00' }, '6': null, '7': null,
          },
        })
      } else {
        setDisplaySchedule({
          enabled: false,
          days: {
            '1': { on: '08:00', off: '22:00' }, '2': { on: '08:00', off: '22:00' },
            '3': { on: '08:00', off: '22:00' }, '4': { on: '08:00', off: '22:00' },
            '5': { on: '08:00', off: '22:00' }, '6': null, '7': null,
          },
        })
      }
      // Load IR fallback settings
      const irEn = !!data.ir_enabled
      const irProto = String(data.ir_protocol || '')
      const irScan = String(data.ir_power_scancode || '')
      setIrEnabled(irEn)
      setIrProtocol(irProto)
      setIrScancode(irScan)
      // Detect preset from protocol+scancode
      const matchedPreset = Object.entries(IR_PRESETS).find(
        ([, v]) => v.protocol === irProto && v.scancode === irScan
      )
      setIrPreset(matchedPreset ? matchedPreset[0] : 'custom')
      // Fetch IR hardware status
      playersApi.getIrStatus(id).then(setIrStatus).catch(() => setIrStatus(null))
    } catch {
      // Live device settings need the device to answer over its own API —
      // unavailable while offline. Don't close the whole modal for that:
      // the Location tab (group/location) is a Fleet Manager-only field
      // and stays usable regardless. Just flag the General tab as unavailable.
      setGeneralSettingsError(true)
    } finally {
      setSettingsLoading(false)
    }
  }

  // Auto-open the Settings modal when arriving via ?settings=1 — the
  // player list's own Edit button routes here now instead of opening
  // its old, more limited edit form (see player-list.tsx::handleEdit).
  // Strips the param right after so a refresh/back-nav doesn't reopen it.
  useEffect(() => {
    if (!player) return
    if (new URLSearchParams(location.search).get('settings') !== '1') return
    handleOpenSettings(player.is_online ? 'general' : 'location')
    navigate(`/players/${player.id}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player])

  // Save player settings
  const handleSaveSettings = async () => {
    if (!id) return
    setSettingsSaving(true)
    try {
      const payload: Record<string, unknown> = {
        player_name: settingsForm.player_name,
        default_duration: settingsForm.default_duration ? parseInt(settingsForm.default_duration, 10) : 0,
        default_streaming_duration: settingsForm.default_streaming_duration ? parseInt(settingsForm.default_streaming_duration, 10) : 0,
        audio_output: settingsForm.audio_output,
        date_format: settingsForm.date_format,
        resolution: settingsForm.resolution,
        screen_rotation: parseInt(settingsForm.screen_rotation, 10),
        show_splash: settingsForm.show_splash,
        default_assets: settingsForm.default_assets,
        shuffle_playlist: settingsForm.shuffle_playlist,
        use_24_hour_clock: settingsForm.use_24_hour_clock,
        debug_logging: settingsForm.debug_logging,
        display_power_schedule: displaySchedule,
        ir_enabled: irEnabled,
        ir_protocol: irProtocol,
        ir_power_scancode: irScancode,
      }
      // Save to player device
      await playersApi.saveSettings(id, payload)
      // Sync player name to fleet manager if changed
      if (settingsForm.player_name && settingsForm.player_name !== player?.name) {
        try {
          const updated = await playersApi.partialUpdate(id, { name: settingsForm.player_name })
          setPlayer(updated)
        } catch {
          // Non-fatal: device settings saved, fleet manager name sync failed
        }
      }
      setShowSettingsModal(false)
      showToast('success', t('playerSettings.saveSuccess'))
    } catch {
      Swal.fire({ icon: 'error', title: t('playerSettings.saveError') })
    } finally {
      setSettingsSaving(false)
    }
  }

  // Save group/location assignment — a plain Fleet Manager field, not a
  // device-side setting, so it works even while the player is offline.
  const handleSaveLocation = async () => {
    if (!id) return
    setSavingLocation(true)
    try {
      const updated = await playersApi.partialUpdate(id, {
        group: locationForm.group || null,
        location: locationForm.location || null,
      } as unknown as Partial<Player>)
      setPlayer(updated)
      setShowSettingsModal(false)
      showToast('success', t('playerSettings.saveSuccess'))
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: translateApiError(String(err), t) })
    } finally {
      setSavingLocation(false)
    }
  }

  const handleOpenCloneModal = async () => {
    setShowCloneModal(true)
    setCloneSourceId('')
    try {
      const all = await playersApi.list()
      setOtherPlayers(all.filter((p) => p.id !== id))
    } catch {
      setOtherPlayers([])
    }
  }

  const handleCloneContent = async () => {
    if (!id || !cloneSourceId) return
    const sourceName = otherPlayers.find((p) => p.id === cloneSourceId)?.name || ''
    const result = await Swal.fire({
      icon: 'warning',
      title: t('assets.cloneConfirmTitle'),
      text: t('assets.cloneConfirmText', { name: sourceName }),
      showCancelButton: true,
      confirmButtonText: t('assets.cloneButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    setCloningContent(true)
    try {
      const cloneResult = await playersApi.cloneContent(id, cloneSourceId)
      if (cloneResult.failed.length > 0) {
        showToast('warning', t('assets.cloneResultWithFailures', { restored: cloneResult.restored, failed: cloneResult.failed.length }))
      } else {
        showToast('success', t('assets.cloneResult', { restored: cloneResult.restored }))
      }
      setShowCloneModal(false)
      loadAssets()
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setCloningContent(false)
    }
  }

  const handleOpenReplaceModal = async () => {
    setShowReplaceModal(true)
    setReplaceTargetId('')
    try {
      const all = await playersApi.list()
      setReplaceCandidates(all.filter((p) => p.id !== id))
    } catch {
      setReplaceCandidates([])
    }
  }

  const handleReplaceDevice = async () => {
    if (!id || !player || !replaceTargetId) return
    const targetName = replaceCandidates.find((p) => p.id === replaceTargetId)?.name || ''
    const result = await Swal.fire({
      icon: 'warning',
      title: t('players.replaceConfirmTitle'),
      text: t('players.replaceConfirmText', { name: targetName }),
      showCancelButton: true,
      confirmButtonText: t('players.replaceButton'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return
    setReplacingDevice(true)
    try {
      await playersApi.partialUpdate(replaceTargetId, {
        group: player.group_detail?.id || player.group?.id || null,
        location: player.location_detail?.id || player.location || null,
      } as unknown as Partial<Player>)
      const cloneResult = await playersApi.cloneContent(replaceTargetId, id)
      setShowReplaceModal(false)
      if (cloneResult.failed.length > 0) {
        showToast('warning', t('players.replaceResultWithFailures', { name: targetName, restored: cloneResult.restored, failed: cloneResult.failed.length }))
      } else {
        showToast('success', t('players.replaceResult', { name: targetName, restored: cloneResult.restored }))
      }
    } catch (err) {
      Swal.fire({ icon: 'error', title: t('common.error'), text: String(err) })
    } finally {
      setReplacingDevice(false)
    }
  }

  // Open content picker
  const handleOpenContentPicker = async () => {
    setShowContentModal(true)
    setContentLoading(true)
    setContentFilterType('all')
    setContentFilterFolder(null)
    setSelectedContentIds(new Set())
    try {
      const [files, flds] = await Promise.all([mediaApi.list(), foldersApi.list()])
      setContentFiles(files)
      setContentFolders(flds)
    } catch {
      setContentFiles([])
      setContentFolders([])
    } finally {
      setContentLoading(false)
    }
  }

  const filteredContentFiles = contentFiles.filter((f) => {
    if (contentFilterType !== 'all' && f.file_type !== contentFilterType) return false
    if (contentFilterFolder === 'none' && f.folder !== null) return false
    if (contentFilterFolder && contentFilterFolder !== 'none' && f.folder !== contentFilterFolder) return false
    return true
  })

  // Deploy content to player
  const isOrientationMismatch = (file: MediaFile): boolean => {
    if (!player || !file.width || !file.height) return false
    const contentPortrait = file.height > file.width
    const devicePortrait = player.screen_rotation === 90 || player.screen_rotation === 270
    return contentPortrait !== devicePortrait
  }

  const handleDeployContent = async (file: MediaFile) => {
    if (!id) return
    const mismatch = isOrientationMismatch(file)
    const result = await Swal.fire({
      title: mismatch ? t('assets.orientationMismatchTitle') : t('assets.selectContent'),
      text: mismatch ? t('assets.orientationMismatchText', { name: file.name }) : file.name,
      icon: mismatch ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: mismatch ? t('assets.deployAnyway') : t('common.confirm'),
      cancelButtonText: t('common.cancel'),
    })
    if (result.isConfirmed) {
      setDeployingId(file.id)
      setShowContentModal(false)
      Swal.fire({
        title: t('assets.deploying'),
        html: `<b>${file.name}</b>`,
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => { Swal.showLoading() },
      })
      try {
        await playersApi.deployContent(id, file.id)
        await loadAssets()
        showToast('success', t('assets.deployed'))
      } catch {
        Swal.fire({ icon: 'error', title: t('assets.deployFailed') })
      } finally {
        setDeployingId(null)
      }
    }
  }

  const toggleContentSelection = (fileId: string) => {
    setSelectedContentIds(prev => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  const handleDeploySelectedContent = async () => {
    if (!id || selectedContentIds.size === 0) return
    const fileIds = Array.from(selectedContentIds)
    const mismatchCount = contentFiles.filter((f) => selectedContentIds.has(f.id) && isOrientationMismatch(f)).length
    const result = await Swal.fire({
      title: mismatchCount > 0 ? t('assets.orientationMismatchTitle') : t('assets.selectContent'),
      text: mismatchCount > 0
        ? t('assets.orientationMismatchBulkText', { count: mismatchCount, total: fileIds.length })
        : t('assets.confirmBulkDeploy', { count: fileIds.length }),
      icon: mismatchCount > 0 ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: mismatchCount > 0 ? t('assets.deployAnyway') : t('common.confirm'),
      cancelButtonText: t('common.cancel'),
    })
    if (!result.isConfirmed) return

    setDeployingSelected(true)
    setShowContentModal(false)
    Swal.fire({
      title: t('assets.deploying'),
      html: t('assets.deployingCount', { count: fileIds.length }),
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => { Swal.showLoading() },
    })
    let failed = 0
    for (const fileId of fileIds) {
      try {
        await playersApi.deployContent(id, fileId)
      } catch {
        failed += 1
      }
    }
    await loadAssets()
    setSelectedContentIds(new Set())
    setDeployingSelected(false)
    if (failed === 0) {
      showToast('success', t('assets.deployed'))
    } else {
      Swal.fire({ icon: 'warning', title: t('assets.deployFailed'), text: t('assets.deployPartialFailed', { failed, total: fileIds.length }) })
    }
  }

  if (loading) {
    return (
      <div className="fm-loading">
        <div className="spinner" />
      </div>
    )
  }

  if (!player) {
    return (
      <div className="fm-empty-state">
        <div className="empty-icon">
          <FaDesktop />
        </div>
        <h3 className="empty-title">{t('common.error')}</h3>
      </div>
    )
  }

  const group = player.group_detail || player.group
  const playerLocation = player.effective_location_detail
  const activeAssets = assets.filter(a => a.is_active)
  const inactiveAssets = assets.filter(a => !a.is_active)

  const formatMemory = (mib: number) => {
    if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`
    return `${mib} MB`
  }

  const getContentIcon = (fileType: string) => {
    if (fileType === 'image') return <FaImage className="me-2 text-success" />
    if (fileType === 'video') return <FaVideo className="me-2 text-primary" />
    if (fileType === 'web') return <FaGlobe className="me-2 text-info" />
    return <FaFile className="me-2 text-secondary" />
  }

  const renderAssetRow = (asset: PlayerAsset) => (
    <tr key={asset.asset_id}>
      <td>
        <input
          type="checkbox"
          className="form-check-input"
          checked={selectedAssetIds.has(asset.asset_id)}
          onChange={() => toggleAssetSelection(asset.asset_id)}
        />
      </td>
      <td>{renderAssetThumbnail(asset)}</td>
      <td>
        <div
          style={{ overflow: 'hidden', cursor: 'pointer' }}
          onClick={() => setPreviewAsset(asset)}
          onMouseEnter={(e) => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
            setHoveredAsset(asset)
            setHoverRect(e.currentTarget.getBoundingClientRect())
          }}
          onMouseLeave={() => {
            hoverTimeoutRef.current = setTimeout(() => setHoveredAsset(null), 200)
          }}
        >
          <span
            className="fw-semibold text-truncate"
            style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px' }}
          >
            {asset.name || 'Untitled'}
          </span>
        </div>
      </td>
      <td className="text-nowrap"><small>{formatAssetDate(asset.start_date)}</small></td>
      <td className="text-nowrap"><small>{formatAssetDate(asset.end_date)}</small></td>
      <td className="text-nowrap"><small>{formatDuration(asset.duration, t)}</small></td>
      <td>
        <button
          className="btn btn-sm p-0 border-0"
          onClick={() => handleToggleAsset(asset)}
          disabled={togglingAssetId === asset.asset_id}
          title={asset.is_enabled ? t('assets.enabled') : t('assets.disabled')}
          style={{ fontSize: '22px', background: 'none', opacity: togglingAssetId === asset.asset_id ? 0.5 : 1 }}
        >
          {asset.is_enabled ? (
            <FaToggleOn className="text-success" />
          ) : (
            <FaToggleOff className="text-secondary" />
          )}
        </button>
      </td>
      <td>
        <div className="d-flex gap-1">
          <button
            className="fm-btn-outline fm-btn-sm"
            onClick={() => handleOpenEdit(asset)}
            title={t('assets.editAsset')}
          >
            <FaEdit />
          </button>
          <button
            className="fm-btn-danger fm-btn-sm"
            onClick={() => handleDeleteAsset(asset)}
            title={t('assets.deleteAsset')}
          >
            <FaTrash />
          </button>
        </div>
      </td>
    </tr>
  )

  const togglePlaylistGroup = (playlistId: string) => {
    setExpandedPlaylistGroups((prev) => {
      const next = new Set(prev)
      if (next.has(playlistId)) next.delete(playlistId)
      else next.add(playlistId)
      return next
    })
  }

  const renderAssetsTable = (assetList: PlayerAsset[], title: string) => {
    const sorted = sortAssets(assetList)
    const listAssetIds = assetList.map(a => a.asset_id)
    const selectedInList = listAssetIds.filter(aid => selectedAssetIds.has(aid))
    const allSelectedInList = listAssetIds.length > 0 && selectedInList.length === listAssetIds.length
    const toggleSelectAllInList = () => {
      setSelectedAssetIds(prev => {
        const next = new Set(prev)
        if (allSelectedInList) {
          listAssetIds.forEach(aid => next.delete(aid))
        } else {
          listAssetIds.forEach(aid => next.add(aid))
        }
        return next
      })
    }
    return (
    <div className="fm-card fm-card-accent-purple mb-3">
      <div className="fm-card-header d-flex justify-content-between align-items-center">
        <h5 className="card-title mb-0">
          {title}
          <span className="badge bg-secondary ms-2">{assetList.length}</span>
        </h5>
        <div className="d-flex align-items-center gap-2">
          {selectedInList.length > 0 && (
            <button
              className="fm-btn-danger fm-btn-sm"
              onClick={() => handleBulkDeleteAssets(selectedInList)}
            >
              <FaTrash className="me-1" />
              {t('assets.deleteSelected', { count: selectedInList.length })}
            </button>
          )}
          {title === t('assets.activeAssets') && (
            <button
              className="fm-btn-outline fm-btn-sm"
              onClick={handleOpenCloneModal}
              disabled={!player.is_online}
              title={t('assets.cloneFromDevice')}
            >
              <FaCloudUploadAlt className="me-1" />
              {t('assets.cloneFromDevice')}
            </button>
          )}
          {title === t('assets.activeAssets') && (
            <button
              className="fm-btn-primary fm-btn-sm"
              onClick={handleOpenContentPicker}
              disabled={!player.is_online}
            >
              <FaPlus className="me-1" />
              {t('assets.addFromContent')}
            </button>
          )}
        </div>
      </div>
      <div className="fm-card-body p-0">
        {assetList.length > 0 ? (
          <div className="table-responsive">
          <table className="fm-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '32px' }} />
              <col style={{ width: '72px' }} />
              <col />
              <col style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={allSelectedInList}
                    onChange={toggleSelectAllInList}
                  />
                </th>
                <th></th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('name')}>{t('assets.name')}<SortIcon field="name" /></th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('start_date')}>{t('assets.startDate')}<SortIcon field="start_date" /></th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('end_date')}>{t('assets.endDate')}<SortIcon field="end_date" /></th>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('duration')}>{t('assets.duration')}<SortIcon field="duration" /></th>
                <th>{t('assets.activity')}</th>
                <th>{t('assets.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const seenPlaylists = new Set<string>()
                const rows: React.ReactNode[] = []
                sorted.forEach((asset) => {
                  if (!asset.playlist) {
                    rows.push(renderAssetRow(asset))
                    return
                  }
                  const playlistId = asset.playlist.id
                  if (seenPlaylists.has(playlistId)) return
                  seenPlaylists.add(playlistId)
                  const playlistName = asset.playlist.name
                  const groupAssets = sorted.filter((a) => a.playlist?.id === playlistId)
                  const groupAssetIds = groupAssets.map(a => a.asset_id)
                  const groupAllSelected = groupAssetIds.length > 0 && groupAssetIds.every(aid => selectedAssetIds.has(aid))
                  const isExpanded = expandedPlaylistGroups.has(playlistId)
                  rows.push(
                    <tr
                      key={`playlist-group-${playlistId}`}
                      style={{ cursor: 'pointer', background: 'var(--bs-tertiary-bg, #f8f9fa)' }}
                      onClick={() => togglePlaylistGroup(playlistId)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={groupAllSelected}
                          onChange={() => {
                            setSelectedAssetIds(prev => {
                              const next = new Set(prev)
                              if (groupAllSelected) {
                                groupAssetIds.forEach(aid => next.delete(aid))
                              } else {
                                groupAssetIds.forEach(aid => next.add(aid))
                              }
                              return next
                            })
                          }}
                        />
                      </td>
                      <td colSpan={7}>
                        <div className="d-flex align-items-center gap-2">
                          {isExpanded ? <FaChevronDown style={{ fontSize: '0.75rem' }} /> : <FaChevronRight style={{ fontSize: '0.75rem' }} />}
                          <FaListUl className="text-info" />
                          <span className="fw-semibold">{playlistName}</span>
                          <span className="badge bg-secondary">{groupAssets.length} {t('playlists.items')}</span>
                          <button
                            type="button"
                            className="btn btn-sm btn-link p-0 ms-auto"
                            style={{ fontSize: '0.78rem' }}
                            onClick={(e) => { e.stopPropagation(); navigate(`/playlists?edit=${playlistId}`) }}
                          >
                            {t('players.editPlaylistLink')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                  if (isExpanded) {
                    groupAssets.forEach((a) => rows.push(renderAssetRow(a)))
                  }
                })
                return rows
              })()}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="p-4 text-center text-muted">
            {t('common.noResults')}
          </div>
        )}
      </div>
    </div>
  )
  }

  return (
    <div>
      <div className="fm-page-header">
        <div>
          <button
            className="fm-btn-outline fm-btn-sm me-3"
            onClick={handleBack}
          >
            <FaArrowLeft />
          </button>
          <h1 className="page-title d-inline-flex align-items-center gap-2">
            <FaDesktop className="page-icon" />
            {player.name}
            <span
              className={
                player.is_online ? 'fm-badge-online' : 'fm-badge-offline'
              }
            >
              {player.is_online ? t('players.online') : t('players.offline')}
            </span>
          </h1>
          {(playerLocation || group) && (
            <div className="player-location-chip d-inline-flex align-items-center gap-2 mt-1">
              {playerLocation && (
                <span className="player-location-chip__item">
                  <FaMapMarkerAlt />
                  {playerLocation.name}
                </span>
              )}
              {playerLocation && group && (
                <span className="player-location-chip__sep" aria-hidden="true">/</span>
              )}
              {group && (
                <span className="player-location-chip__item">
                  <FaLayerGroup />
                  {group.name}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="page-actions">
        </div>
      </div>

      {/* System Info + Screenshot */}
      <div className="fm-card fm-card-accent">
        <div className="fm-card-header d-flex justify-content-between align-items-center">
          <h5 className="card-title mb-0">{t('players.info')}</h5>
          <div className="d-flex gap-2">
            <button
              className="fm-btn-outline fm-btn-sm"
              onClick={() => handleOpenSettings(player.is_online ? 'general' : 'location')}
              title={t('playerSettings.title')}
            >
              <FaCog />
            </button>
            <button
              className="fm-btn-accent fm-btn-sm"
              onClick={handleReboot}
              disabled={!player.is_online}
              title={t('players.reboot')}
            >
              <FaSyncAlt />
            </button>
            {isAdminRole(role) && player.device_type !== 'pi4' && player.device_type !== 'pi5' && (
              <button
                className="fm-btn-outline fm-btn-sm"
                onClick={() => handleOpenSettings('image')}
                title={t('migrateImage.title')}
              >
                <FaCloudUploadAlt />
              </button>
            )}
            {isAdminRole(role) && player.is_online && (
              <button
                className="fm-btn-outline fm-btn-sm"
                onClick={() => setShowTerminal(!showTerminal)}
                title={t('terminal.title')}
              >
                <FaTerminalIcon />
              </button>
            )}
            <button
              className="fm-btn-sm"
              style={{ background: '#dc3545', color: '#fff', border: 'none' }}
              onClick={handleForget}
              title={t('players.forget')}
            >
              <FaTrash />
            </button>
          </div>
        </div>
        <div className="fm-card-body">
          <div className="row g-3">
            {/* Screenshot / CCTV live column */}
            {(() => {
              const isPortraitDevice = player.screen_rotation === 90 || player.screen_rotation === 270
              return (
            <div className="col-lg-5 col-md-6">
              {liveViewEnabled && liveSnapshotUrl ? (
                <div style={{ position: 'relative' }}>
                  <img
                    src={liveSnapshotUrl}
                    alt="CCTV live"
                    style={{
                      width: '100%',
                      maxHeight: '260px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                    onClick={() => setScreenshotFullscreen(true)}
                  />
                  <span className="fm-live-badge">{t('players.liveBadge')}</span>
                  <div
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: '6px',
                      padding: '4px 6px',
                      cursor: 'pointer',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    onClick={() => setScreenshotFullscreen(true)}
                  >
                    <FaExpand />
                  </div>
                </div>
              ) : screenshotUrl ? (
                <div style={{ position: 'relative', textAlign: isPortraitDevice ? 'center' : undefined }}>
                  <img
                    src={screenshotUrl}
                    alt="Player screenshot"
                    style={isPortraitDevice ? {
                      height: '260px',
                      maxWidth: '100%',
                      width: 'auto',
                      objectFit: 'contain',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    } : {
                      width: '100%',
                      maxHeight: '260px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                    onClick={() => setScreenshotFullscreen(true)}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: '6px',
                      padding: '4px 6px',
                      cursor: 'pointer',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    onClick={() => setScreenshotFullscreen(true)}
                  >
                    <FaExpand />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    height: '260px',
                    width: isPortraitDevice ? '146px' : '100%',
                    maxWidth: '100%',
                    margin: isPortraitDevice ? '0 auto' : undefined,
                    borderRadius: '8px',
                    background: 'var(--bs-tertiary-bg, #f0f0f0)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    color: 'var(--bs-secondary-color, #6c757d)',
                  }}
                >
                  <FaCamera style={{ fontSize: '2rem', opacity: 0.4 }} />
                  <small>
                    {screenshotUnsupported
                      ? t('players.screenshotNotSupported')
                      : player.is_online
                        ? t('players.screenshotUnavailable')
                        : t('players.offline')}
                  </small>
                </div>
              )}
              {/* Playback controls under screenshot */}
              <div className="d-flex justify-content-center gap-2 mt-2">
                {hasPlaybackControl && (
                  <button
                    className="fm-btn-accent fm-btn-sm"
                    onClick={() => handlePlaybackControl('previous')}
                    disabled={!player.is_online}
                    title={t('assets.previous')}
                  >
                    <FaBackward className="me-1" />
                    {t('assets.previous')}
                  </button>
                )}
                <button
                  className="fm-btn-primary fm-btn-sm"
                  onClick={screenshotUnsupported ? handleSidecarScreenshot : handleScreenshot}
                  disabled={screenshotLoading || !player.is_online}
                  title={screenshotUnsupported ? t('players.sidecarCapture') : t('players.takeScreenshot')}
                >
                  {screenshotLoading ? (
                    <span className="spinner-border spinner-border-sm me-1" />
                  ) : (
                    <FaCamera className="me-1" />
                  )}
                  {screenshotUnsupported ? t('players.sidecarCapture') : t('players.takeScreenshot')}
                </button>
                {hasPlaybackControl && (
                  <button
                    className="fm-btn-accent fm-btn-sm"
                    onClick={() => handlePlaybackControl('next')}
                    disabled={!player.is_online}
                    title={t('assets.next')}
                  >
                    <FaForward className="me-1" />
                    {t('assets.next')}
                  </button>
                )}
              </div>
            </div>
              )
            })()}

            {/* Info column */}
            <div className="col-lg-7 col-md-6 d-flex flex-column">
              {infoLoading ? (
                <div className="fm-loading">
                  <div className="spinner" />
                </div>
              ) : info ? (
                <div className="row flex-grow-1 align-content-center" style={{ fontSize: '0.9rem', rowGap: '14px' }}>
                  {info.anthias_version && (() => {
                    const ver = info.anthias_version
                    const parts = ver.split('@')
                    const label = parts[0] // "v1.0.0" or "main"
                    const sha = parts[1] || ''
                    const isRelease = label.startsWith('v')
                    return (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2">
                        <FaDesktop className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">Version:</span>
                        {isRelease ? (
                          <span className="badge bg-primary" title={sha ? `SHA: ${sha}` : undefined}>{label}</span>
                        ) : (
                          <span className="text-muted text-truncate" style={{ maxWidth: '120px' }}>{ver}</span>
                        )}
                        {updateAvailable === true && (
                          <button
                            className="btn btn-sm btn-warning d-inline-flex align-items-center gap-1 py-0 px-2"
                            style={{ fontSize: '0.75rem' }}
                            onClick={handleUpdate}
                            disabled={updating}
                          >
                            {updating ? (
                              <span className="spinner-border spinner-border-sm" style={{ width: '0.7rem', height: '0.7rem' }} />
                            ) : (
                              <FaDownload style={{ fontSize: '0.65rem' }} />
                            )}
                            {updating ? t('players.updating') : t('players.updatePlayer')}
                          </button>
                        )}
                        {updateAvailable === false && (
                          <FaCheckCircle className="text-success" style={{ fontSize: '12px' }} title={t('players.upToDate')} />
                        )}
                        {updateAvailable === null && player?.is_online && updateChecking && (
                          <span className="spinner-border spinner-border-sm text-muted" style={{ width: '0.7rem', height: '0.7rem' }} />
                        )}
                      </div>
                    </div>
                    )})()}

                  {info.device_model && (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2">
                        <FaMicrochip className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">Device:</span>
                        <span className="text-muted text-truncate">{info.device_model}</span>
                      </div>
                    </div>
                  )}

                  {info.uptime && (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2">
                        <FaClock className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">Uptime:</span>
                        <span className="text-muted">{info.uptime.days}d {info.uptime.hours}h</span>
                      </div>
                    </div>
                  )}

                  <div className="col-sm-6">
                    <div className="d-flex align-items-center gap-2">
                      <FaThermometerHalf
                        style={{
                          fontSize: '14px', flexShrink: 0,
                          color: info.cpu_temp != null && info.cpu_temp >= 80 ? '#dc3545'
                            : info.cpu_temp != null && info.cpu_temp >= 70 ? '#fd7e14'
                            : '#8819c7',
                        }}
                      />
                      <span className="fw-semibold">{t('players.cpu')}:</span>
                      <span className="text-muted">
                        {info.cpu_temp != null ? `${info.cpu_temp}°C` : '—'}
                        {' · '}
                        {info.cpu_usage != null ? `${info.cpu_usage.toFixed(0)}%` : '—'}
                        {info.cpu_freq && <>{' · '}{(info.cpu_freq.current / 1000).toFixed(1)} GHz</>}
                      </span>
                    </div>
                  </div>

                  {info.memory && (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <FaMemory className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">RAM:</span>
                        <span className="text-muted">
                          {formatMemory(info.memory.used)} / {formatMemory(info.memory.total)}
                        </span>
                      </div>
                      <div className="progress" style={{ height: '4px' }}>
                        <div
                          className="progress-bar"
                          style={{ width: `${(info.memory.used / info.memory.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="col-sm-6">
                    {info.disk_usage ? (
                      <>
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <FaHdd className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                          <span className="fw-semibold">{t('players.disk')}:</span>
                          <span className="text-muted">
                            {info.disk_usage.used_gb} / {info.disk_usage.total_gb} GB
                          </span>
                        </div>
                        <div className="progress" style={{ height: '4px' }}>
                          <div
                            className="progress-bar"
                            style={{ width: `${info.disk_usage.percent}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="d-flex align-items-center gap-2">
                        <FaHdd className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">{t('players.disk')}:</span>
                        <span className="text-muted">{info.free_space} free</span>
                      </div>
                    )}
                  </div>

                  <div className="col-sm-6">
                    <div className="d-flex align-items-center gap-2">
                      <FaTachometerAlt className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                      <span className="fw-semibold">Load:</span>
                      <span className="text-muted">{info.loadavg.toFixed(2)}</span>
                    </div>
                  </div>

                  {isAdminRole(role) && info.ip_addresses && info.ip_addresses.length > 0 && (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2">
                        <FaNetworkWired className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">IP:</span>
                        <span className="text-muted text-truncate">
                          {info.ip_addresses.map(ip => ip.replace(/^https?:\/\//, '')).join(', ')}
                        </span>
                      </div>
                    </div>
                  )}

                  {isAdminRole(role) && (player.mac_address || info.mac_address) && (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2">
                        <FaNetworkWired className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">{t('players.macAddress')}:</span>
                        <span className="text-muted">{player.mac_address || info.mac_address}</span>
                      </div>
                    </div>
                  )}

                  {isAdminRole(role) && player.tailscale_ip && (
                    <div className="col-sm-6">
                      <div className="d-flex align-items-center gap-2">
                        <FaShieldAlt className="text-purple" style={{ fontSize: '14px', flexShrink: 0 }} />
                        <span className="fw-semibold">Tailscale:</span>
                        <span className="text-muted">{player.tailscale_ip}</span>
                        {player.tailscale_enabled && (
                          <span className="badge bg-info" style={{ fontSize: '0.65rem' }}>VPN</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Row 4 (conditional): Throttle warnings */}
                  {info.throttle_state != null && info.throttle_state !== 0 && (() => {
                    const state = info.throttle_state!
                    const currentBits = state & 0xF
                    const pastBits = (state >> 16) & 0xF
                    const warnings: React.ReactNode[] = []

                    if (currentBits & 0x1) warnings.push(
                      <span key="uv" className="badge bg-danger me-1">
                        <FaBolt className="me-1" />{t('players.throttleUnderVoltage')}
                      </span>
                    )
                    if (currentBits & 0x4) warnings.push(
                      <span key="th" className="badge bg-danger me-1">
                        <FaExclamationTriangle className="me-1" />{t('players.throttleThrottled')}
                      </span>
                    )
                    if (currentBits & 0x2) warnings.push(
                      <span key="fc" className="badge bg-danger me-1">{t('players.throttleFreqCap')}</span>
                    )
                    if (!currentBits && pastBits & 0x1) warnings.push(
                      <span key="puv" className="badge bg-warning text-dark me-1">
                        <FaBolt className="me-1" />{t('players.throttleUnderVoltage')} ({t('players.throttlePastIssue')})
                      </span>
                    )
                    if (!currentBits && pastBits & 0x4) warnings.push(
                      <span key="pth" className="badge bg-warning text-dark me-1">
                        {t('players.throttleThrottled')} ({t('players.throttlePastIssue')})
                      </span>
                    )
                    if (!currentBits && pastBits & 0x2) warnings.push(
                      <span key="pfc" className="badge bg-warning text-dark me-1">
                        {t('players.throttleFreqCap')} ({t('players.throttlePastIssue')})
                      </span>
                    )

                    return warnings.length > 0 ? (
                      <div className="col-12">
                        <div>{warnings}</div>
                      </div>
                    ) : null
                  })()}

                  {/* CEC Monitor Control */}
                  {cecStatus && (
                    <div className="col-12 d-flex align-items-center gap-2 mt-1">
                      <FaDesktop className="text-muted" />
                      <small className="text-muted fw-semibold">{t('players.monitor')}:</small>
                      {cecStatus.cec_available ? (
                        cecStatus.tv_on ? (
                          <span className="badge bg-success">{t('players.monitorOn')}</span>
                        ) : (
                          <span className="badge bg-danger">{t('players.monitorOff')}</span>
                        )
                      ) : (
                        <span className="badge bg-secondary">{t('players.cecNotAvailable')}</span>
                      )}
                      <button
                        className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1 py-0 px-2"
                        disabled={!cecStatus.cec_available || !player.is_online || cecLoading}
                        onClick={async () => {
                          setCecLoading(true)
                          try {
                            const result = await playersApi.cecStandby(id!)
                            setCecStatus(result)
                            showToast('success', t('players.monitorStandbySent'))
                          } catch { /* silent */ } finally { setCecLoading(false) }
                        }}
                      >
                        <FaPowerOff size={10} /> {t('players.monitorOff')}
                      </button>
                      <button
                        className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1 py-0 px-2"
                        disabled={!cecStatus.cec_available || !player.is_online || cecLoading}
                        onClick={async () => {
                          setCecLoading(true)
                          try {
                            const result = await playersApi.cecWake(id!)
                            setCecStatus(result)
                            showToast('success', t('players.monitorWakeSent'))
                          } catch { /* silent */ } finally { setCecLoading(false) }
                        }}
                      >
                        <FaDesktop size={10} /> {t('players.monitorOn')}
                      </button>
                      {irStatus?.ir_available && irEnabled && irProtocol && irScancode && (
                        <>
                          <span className="text-muted mx-1">|</span>
                          <button
                            className="btn btn-sm btn-outline-warning d-inline-flex align-items-center gap-1 py-0 px-2"
                            disabled={!player.is_online || irTesting}
                            onClick={async () => {
                              setIrTesting(true)
                              try {
                                const result = await playersApi.irTest(id!, irProtocol, irScancode)
                                if (result.success) {
                                  showToast('success', 'IR Power')
                                }
                              } catch { /* silent */ } finally { setIrTesting(false) }
                            }}
                          >
                            {irTesting ? <span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10 }} /> : <FaPowerOff size={10} />}
                            {' '}IR
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted mb-0">
                  {player.is_online
                    ? t('common.loading')
                    : t('players.offline')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen screenshot / CCTV modal */}
      {screenshotFullscreen && (liveViewEnabled ? liveSnapshotUrl : screenshotUrl) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          onClick={() => setScreenshotFullscreen(false)}
        >
          {liveViewEnabled && liveSnapshotUrl && (
            <span className="fm-live-badge" style={{ position: 'fixed', top: '16px', left: '16px' }}>
              {t('players.liveBadge')}
            </span>
          )}
          <img
            src={liveViewEnabled ? liveSnapshotUrl : screenshotUrl!}
            alt={liveViewEnabled ? 'CCTV live fullscreen' : 'Player screenshot fullscreen'}
            style={{
              maxWidth: '95vw',
              maxHeight: '95vh',
              borderRadius: '4px',
            }}
          />
        </div>
      )}

      {/* Terminal — admin only */}
      {showTerminal && id && (
        <PlayerTerminal playerId={id} onClose={() => setShowTerminal(false)} />
      )}

      {/* Assets */}
      {assetsLoading ? (
        <div className="fm-card fm-card-accent-purple">
          <div className="fm-card-header">
            <h5 className="card-title">{t('players.assets')}</h5>
          </div>
          <div className="fm-card-body">
            <div className="fm-loading">
              <div className="spinner" />
            </div>
          </div>
        </div>
      ) : (
        <>
          {renderAssetsTable(activeAssets, t('assets.activeAssets'))}
          {renderAssetsTable(inactiveAssets, t('assets.inactiveAssets'))}
        </>
      )}

      {/* Edit Asset Modal */}
      {editAsset && (
        <div
          className="modal d-block"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setEditAsset(null)}
        >
          <div className="modal-dialog" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title d-flex align-items-center gap-2">
                  <span className="text-muted">{getAssetTypeIcon(editForm.mimetype)}</span>
                  {t('assets.editAsset')}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setEditAsset(null)}
                />
              </div>
              <div className="modal-body">
                {/* Name */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">{t('assets.name')}</label>
                  <input
                    type="text"
                    className="form-control"
                    value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>

                {/* Location (readonly) */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">{t('assets.assetLocation')}</label>
                  <input
                    type="text"
                    className="form-control"
                    value={editForm.uri}
                    readOnly
                    style={{ backgroundColor: 'var(--bs-tertiary-bg, #f8f9fa)', cursor: 'default' }}
                  />
                </div>

                {/* Type (readonly select) */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">{t('assets.assetType')}</label>
                  <select className="form-select" disabled value={getMimetypeLabel(editForm.mimetype)}>
                    <option value="webpage">{t('assets.webpage')}</option>
                    <option value="image">{t('assets.image')}</option>
                    <option value="video">{t('assets.video')}</option>
                    <option value="streaming">{t('assets.streaming')}</option>
                  </select>
                </div>

                {/* Play For */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">{t('assets.playFor')}</label>
                  <select
                    className="form-select"
                    value={editForm.playFor}
                    onChange={e => handlePlayForChange(e.target.value)}
                  >
                    <option value="day">{t('assets.1day')}</option>
                    <option value="week">{t('assets.1week')}</option>
                    <option value="month">{t('assets.1month')}</option>
                    <option value="year">{t('assets.1year')}</option>
                    <option value="forever">{t('assets.forever')}</option>
                    <option value="manual">{t('assets.manual')}</option>
                  </select>
                </div>

                {/* Start Date + Start Time */}
                <div className="row mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">{t('assets.startDate')}</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editForm.startDateDate}
                      onChange={e => {
                        const newForm = { ...editForm, startDateDate: e.target.value }
                        if (newForm.playFor !== 'manual') {
                          const end = computeEndDate(e.target.value, newForm.startDateTime, newForm.playFor)
                          newForm.endDateDate = end.date
                          newForm.endDateTime = end.time
                        }
                        setEditForm(newForm)
                      }}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">{t('assets.startTime')}</label>
                    <input
                      type="time"
                      className="form-control"
                      value={editForm.startDateTime}
                      onChange={e => {
                        const newForm = { ...editForm, startDateTime: e.target.value }
                        if (newForm.playFor !== 'manual') {
                          const end = computeEndDate(newForm.startDateDate, e.target.value, newForm.playFor)
                          newForm.endDateDate = end.date
                          newForm.endDateTime = end.time
                        }
                        setEditForm(newForm)
                      }}
                    />
                  </div>
                </div>

                {/* End Date + End Time */}
                <div className="row mb-3">
                  <div className="col-6">
                    <label className="form-label fw-semibold">{t('assets.endDate')}</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editForm.endDateDate}
                      disabled={editForm.playFor !== 'manual'}
                      onChange={e => setEditForm({ ...editForm, endDateDate: e.target.value })}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label fw-semibold">{t('assets.endTime')}</label>
                    <input
                      type="time"
                      className="form-control"
                      value={editForm.endDateTime}
                      disabled={editForm.playFor !== 'manual'}
                      onChange={e => setEditForm({ ...editForm, endDateTime: e.target.value })}
                    />
                  </div>
                </div>

                {/* Duration */}
                <div className="mb-3">
                  <label className="form-label fw-semibold">
                    {t('assets.duration')} ({t('assets.seconds')})
                  </label>
                  <input
                    type="number"
                    className="form-control"
                    min="0"
                    value={editForm.duration}
                    disabled={editForm.mimetype.toLowerCase().includes('video')}
                    onChange={e => setEditForm({ ...editForm, duration: e.target.value })}
                  />
                </div>

                {/* Recurring weekly schedule */}
                <div className="mb-3">
                  <label className="form-label fw-semibold mb-1">{t('assets.schedule')}</label>
                  <p className="text-muted mb-2" style={{ fontSize: '0.78rem' }}>{t('assets.scheduleHint')}</p>
                  <div className="d-flex gap-1 mb-2">
                    {[1, 2, 3, 4, 5, 6, 7].map(day => (
                      <button
                        key={day}
                        type="button"
                        className={`btn btn-sm ${editForm.playDays.includes(day) ? 'btn-primary' : 'btn-outline-secondary'}`}
                        style={{ width: '38px', padding: '4px 0', fontSize: '0.75rem' }}
                        onClick={() => {
                          const next = editForm.playDays.includes(day)
                            ? editForm.playDays.filter(d => d !== day)
                            : [...editForm.playDays, day].sort()
                          setEditForm({ ...editForm, playDays: next })
                        }}
                      >
                        {t(`schedule.days.${day}`)}
                      </button>
                    ))}
                  </div>
                  <div className="row g-2">
                    <div className="col-6">
                      <label className="form-label mb-1" style={{ fontSize: '0.8rem' }}>{t('assets.scheduleTimeFrom')}</label>
                      <input
                        type="time"
                        className="form-control form-control-sm"
                        value={editForm.playTimeFrom}
                        onChange={e => setEditForm({ ...editForm, playTimeFrom: e.target.value })}
                      />
                    </div>
                    <div className="col-6">
                      <label className="form-label mb-1" style={{ fontSize: '0.8rem' }}>{t('assets.scheduleTimeTo')}</label>
                      <input
                        type="time"
                        className="form-control form-control-sm"
                        value={editForm.playTimeTo}
                        onChange={e => setEditForm({ ...editForm, playTimeTo: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Advanced (collapsible) */}
                <div className="border rounded">
                  <button
                    type="button"
                    className="btn w-100 text-start d-flex align-items-center gap-2 py-2 px-3"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{ background: 'none', border: 'none' }}
                  >
                    {showAdvanced ? <FaChevronDown style={{ fontSize: '0.7rem' }} /> : <FaChevronRight style={{ fontSize: '0.7rem' }} />}
                    <span className="fw-semibold">{t('assets.advanced')}</span>
                  </button>
                  {showAdvanced && (
                    <div className="px-3 pb-3">
                      <div className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id="nocache-check"
                          checked={editForm.nocache}
                          onChange={e => setEditForm({ ...editForm, nocache: e.target.checked })}
                        />
                        <label className="form-check-label" htmlFor="nocache-check">
                          {t('assets.nocache')}
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditAsset(null)}
                >
                  {t('common.cancel')}
                </button>
                <button className="btn btn-primary" onClick={handleSaveEdit}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clone content from another device */}
      {showCloneModal && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowCloneModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">{t('assets.cloneFromDevice')}</h5>
                <button type="button" className="btn-close" onClick={() => setShowCloneModal(false)} aria-label={t('common.close')} />
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('assets.cloneDesc')}</p>
                <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('assets.cloneSourceDevice')}</label>
                <select className="form-select form-select-sm" value={cloneSourceId} onChange={e => setCloneSourceId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {otherPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCloneModal(false)}>{t('common.cancel')}</button>
                <button type="button" className="fm-btn-primary" onClick={handleCloneContent} disabled={!cloneSourceId || cloningContent}>
                  {cloningContent ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                  {cloningContent ? t('common.loading') : t('assets.cloneButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Replace this device with another */}
      {showReplaceModal && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowReplaceModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title fw-bold text-purple-dark">{t('players.replaceDevice')}</h5>
                <button type="button" className="btn-close" onClick={() => setShowReplaceModal(false)} aria-label={t('common.close')} />
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('players.replaceDesc')}</p>
                <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('players.replaceTargetDevice')}</label>
                <select className="form-select form-select-sm" value={replaceTargetId} onChange={e => setReplaceTargetId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {replaceCandidates.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowReplaceModal(false)}>{t('common.cancel')}</button>
                <button type="button" className="fm-btn-primary" onClick={handleReplaceDevice} disabled={!replaceTargetId || replacingDevice}>
                  {replacingDevice ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                  {replacingDevice ? t('common.loading') : t('players.replaceButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content Picker Modal */}
      {showContentModal && (
        <div
          className="modal d-block"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowContentModal(false)}
        >
          <div
            className="modal-dialog modal-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('assets.selectContent')}</h5>
                <div className="d-flex align-items-center gap-2 ms-auto me-2">
                  {selectedContentIds.size > 0 && (
                    <button
                      type="button"
                      className="fm-btn-primary fm-btn-sm"
                      onClick={handleDeploySelectedContent}
                      disabled={deployingSelected}
                    >
                      <FaPlus className="me-1" />
                      {t('assets.deploySelected', { count: selectedContentIds.size })}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowContentModal(false)}
                />
              </div>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {/* Type filters */}
                <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                  {([['all', null, t('content.filterAll')], ['video', <FaVideo key="v" />, t('content.filterVideo')], ['image', <FaImage key="i" />, t('content.filterImage')], ['web', <FaGlobe key="w" />, t('content.filterWeb')]] as [string, React.ReactNode, string][]).map(([key, icon, label]) => (
                    <button
                      key={key}
                      className={`btn btn-sm ${contentFilterType === key ? 'btn-primary' : 'btn-outline-secondary'}`}
                      style={{ borderRadius: '20px', fontSize: '0.78rem', padding: '3px 12px' }}
                      onClick={() => setContentFilterType(key as 'all' | 'video' | 'image' | 'web')}
                    >
                      {icon && <span className="me-1">{icon}</span>}
                      {label}
                    </button>
                  ))}
                  {contentFilterFolder && (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      style={{ borderRadius: '20px', fontSize: '0.78rem', padding: '3px 12px' }}
                      onClick={() => setContentFilterFolder(null)}
                    >
                      <FaFolder className="me-1" style={{ fontSize: '0.65rem' }} />
                      {contentFilterFolder === 'none' ? t('content.noFolder') : contentFolders.find(f => f.id === contentFilterFolder)?.name}
                      <span className="ms-1">&times;</span>
                    </button>
                  )}
                </div>

                {/* Folders */}
                {contentFolders.length > 0 && (
                  <div className="mb-3">
                    <div className="d-flex flex-wrap gap-3 align-items-start">
                      {contentFolders.map((folder) => (
                        <div
                          key={folder.id}
                          className="text-center"
                          style={{
                            width: '80px',
                            cursor: 'pointer',
                            padding: '6px 4px',
                            borderRadius: '8px',
                            border: contentFilterFolder === folder.id ? '2px solid var(--bs-primary)' : '2px solid transparent',
                            background: contentFilterFolder === folder.id ? 'var(--bs-primary-bg-subtle)' : 'transparent',
                            transition: 'all 0.15s',
                          }}
                          onClick={() => setContentFilterFolder(contentFilterFolder === folder.id ? null : folder.id)}
                          title={`${folder.name} (${folder.file_count})`}
                        >
                          {contentFilterFolder === folder.id ? (
                            <FaFolderOpen style={{ fontSize: '2rem', color: '#ffc107' }} />
                          ) : (
                            <FaFolder style={{ fontSize: '2rem', color: '#ffc107' }} />
                          )}
                          <div className="mt-1" style={{ fontSize: '0.7rem', lineHeight: '1.2', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {folder.name}
                          </div>
                          <small className="text-muted" style={{ fontSize: '0.58rem' }}>{folder.file_count}</small>
                        </div>
                      ))}
                    </div>
                    <hr className="my-3" />
                  </div>
                )}

                {contentLoading ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" />
                  </div>
                ) : filteredContentFiles.length > 0 ? (
                  <div className="row g-3">
                    {filteredContentFiles.map(file => (
                      <div key={file.id} className="col-6 col-md-4 col-lg-3" style={{ position: 'relative' }}>
                        <div
                          onClick={(e) => { e.stopPropagation(); toggleContentSelection(file.id) }}
                          style={{
                            position: 'absolute',
                            top: '6px',
                            left: '6px',
                            zIndex: 2,
                            background: 'rgba(0,0,0,0.5)',
                            borderRadius: '4px',
                            padding: '3px 5px',
                            display: 'flex',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            className="form-check-input m-0"
                            checked={selectedContentIds.has(file.id)}
                            onChange={() => toggleContentSelection(file.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div
                          className="card h-100"
                          style={{
                            cursor: deployingId === file.id ? 'wait' : 'pointer',
                            transition: 'all 0.15s',
                            opacity: deployingId === file.id ? 0.6 : 1,
                          }}
                          onClick={() => {
                            if (deployingId !== file.id) handleDeployContent(file)
                          }}
                          onMouseEnter={(e) => {
                            const card = e.currentTarget
                            card.style.transform = 'translateY(-2px)'
                            card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
                            const video = card.querySelector<HTMLVideoElement>('.content-video-thumb')
                            if (video) {
                              video.play().catch(() => {})
                              const icon = card.querySelector<HTMLElement>('.content-play-icon')
                              if (icon) icon.style.opacity = '0'
                            }
                          }}
                          onMouseLeave={(e) => {
                            const card = e.currentTarget
                            card.style.transform = ''
                            card.style.boxShadow = ''
                            const video = card.querySelector<HTMLVideoElement>('.content-video-thumb')
                            if (video) {
                              video.pause()
                              video.currentTime = 0
                              const icon = card.querySelector<HTMLElement>('.content-play-icon')
                              if (icon) icon.style.opacity = '1'
                            }
                          }}
                        >
                          {/* Thumbnail area */}
                          {file.file_type === 'video' && file.url ? (
                            <div style={{ position: 'relative' }}>
                              <video
                                src={file.url}
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                className="content-video-thumb"
                                style={{
                                  width: '100%',
                                  height: '120px',
                                  objectFit: 'cover',
                                  borderRadius: '6px 6px 0 0',
                                  background: '#000',
                                }}
                              />
                              <div
                                className="content-play-icon"
                                style={{
                                  position: 'absolute',
                                  top: '50%',
                                  left: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  background: 'rgba(0,0,0,0.5)',
                                  borderRadius: '50%',
                                  width: '32px',
                                  height: '32px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  pointerEvents: 'none',
                                  transition: 'opacity 0.2s',
                                }}
                              >
                                <FaPlay style={{ color: '#fff', fontSize: '0.7rem', marginLeft: '2px' }} />
                              </div>
                            </div>
                          ) : file.file_type === 'image' && file.url ? (
                            <img
                              src={file.url}
                              alt={file.name}
                              style={{
                                width: '100%',
                                height: '120px',
                                objectFit: 'cover',
                                borderRadius: '6px 6px 0 0',
                              }}
                            />
                          ) : file.thumbnail_url ? (
                            <img
                              src={file.thumbnail_url}
                              alt={file.name}
                              style={{
                                width: '100%',
                                height: '120px',
                                objectFit: 'cover',
                                borderRadius: '6px 6px 0 0',
                              }}
                            />
                          ) : (
                            <div
                              className="d-flex flex-column align-items-center justify-content-center"
                              style={{
                                width: '100%',
                                height: '120px',
                                backgroundColor: 'var(--bs-gray-200, #e9ecef)',
                                borderRadius: '6px 6px 0 0',
                                fontSize: '2rem',
                                color: 'var(--bs-gray-500, #adb5bd)',
                              }}
                            >
                              {getContentIcon(file.file_type)}
                            </div>
                          )}
                          <div className="card-body p-2">
                            <div
                              className="fw-medium text-truncate"
                              style={{ fontSize: '0.8rem' }}
                              title={file.name}
                            >
                              {file.name}
                            </div>
                            <div className="d-flex align-items-center justify-content-between mt-1">
                              <small className="text-muted" style={{ fontSize: '0.7rem' }}>
                                {file.file_type}
                                {file.file_size > 0 && ` · ${(file.file_size / 1024 / 1024).toFixed(1)} MB`}
                              </small>
                              {deployingId === file.id ? (
                                <span className="spinner-border spinner-border-sm text-primary" />
                              ) : (
                                <FaPlus className="text-primary" style={{ fontSize: '0.8rem' }} />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted py-4">
                    {t('assets.noContent')}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowContentModal(false)}
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Player Settings Modal */}
      {showSettingsModal && (
        <div
          className="modal d-block"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowSettingsModal(false)}
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '900px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title d-flex align-items-center gap-2 mb-0">
                  <FaCog className="text-muted" />
                  {t('playerSettings.title')}
                </h6>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowSettingsModal(false)}
                />
              </div>
              <ul className="nav nav-tabs px-3 pt-2">
                <li className="nav-item">
                  <button
                    type="button"
                    className={`nav-link ${settingsActiveTab === 'general' ? 'active' : ''}`}
                    onClick={() => setSettingsActiveTab('general')}
                  >
                    <FaCog className="me-1" />
                    {t('playerSettings.tabGeneral')}
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    type="button"
                    className={`nav-link ${settingsActiveTab === 'location' ? 'active' : ''}`}
                    onClick={() => setSettingsActiveTab('location')}
                  >
                    <FaMapMarkerAlt className="me-1" />
                    {t('playerSettings.tabLocation')}
                  </button>
                </li>
                {isAdminRole(role) && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className={`nav-link ${settingsActiveTab === 'branding' ? 'active' : ''}`}
                      onClick={() => setSettingsActiveTab('branding')}
                    >
                      <FaImage className="me-1" />
                      {t('playerSettings.tabBranding')}
                    </button>
                  </li>
                )}
                {isAdminRole(role) && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className={`nav-link ${settingsActiveTab === 'image' ? 'active' : ''}`}
                      onClick={() => setSettingsActiveTab('image')}
                    >
                      <FaCloudUploadAlt className="me-1" />
                      {t('playerSettings.tabImage')}
                    </button>
                  </li>
                )}
                {isAdminRole(role) && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className={`nav-link ${settingsActiveTab === 'access' ? 'active' : ''}`}
                      onClick={() => setSettingsActiveTab('access')}
                    >
                      <FaShieldAlt className="me-1" />
                      {t('playerSettings.tabAccess')}
                    </button>
                  </li>
                )}
              </ul>
              <div className="modal-body py-2" style={{ height: '560px', maxHeight: '78vh', overflowY: 'auto', fontSize: '0.9rem' }}>
                {settingsLoading ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" />
                  </div>
                ) : settingsActiveTab === 'general' ? (
                  generalSettingsError ? (
                    <div className="alert alert-warning py-2 px-2 mb-0" style={{ fontSize: '0.85rem' }}>
                      {t('playerSettings.offlineError')}
                    </div>
                  ) : (
                  <div className="row g-4">
                  <div className="col-lg-6">
                    {/* Player Name */}
                    <div className="mb-2">
                      <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.playerName')}</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={settingsForm.player_name}
                        onChange={e => setSettingsForm({ ...settingsForm, player_name: e.target.value })}
                      />
                    </div>

                    {/* Durations — equal columns with short labels */}
                    <div className="row g-2 mb-2">
                      <div className="col-6">
                        <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.defaultDuration')}</label>
                        <div className="input-group input-group-sm">
                          <input
                            type="number"
                            className="form-control"
                            min="0"
                            value={settingsForm.default_duration}
                            onChange={e => setSettingsForm({ ...settingsForm, default_duration: e.target.value })}
                          />
                          <span className="input-group-text">{t('assets.seconds')}</span>
                        </div>
                      </div>
                      <div className="col-6">
                        <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.defaultStreamingDuration')}</label>
                        <div className="input-group input-group-sm">
                          <input
                            type="number"
                            className="form-control"
                            min="0"
                            value={settingsForm.default_streaming_duration}
                            onChange={e => setSettingsForm({ ...settingsForm, default_streaming_duration: e.target.value })}
                          />
                          <span className="input-group-text">{t('assets.seconds')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Audio + Date Format row */}
                    <div className="row g-2 mb-2">
                      <div className="col-6">
                        <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.audioOutput')}</label>
                        <select
                          className="form-select form-select-sm"
                          value={settingsForm.audio_output}
                          onChange={e => setSettingsForm({ ...settingsForm, audio_output: e.target.value })}
                        >
                          <option value="hdmi">{t('playerSettings.hdmi')}</option>
                          <option value="local">{t('playerSettings.jack35mm')}</option>
                        </select>
                      </div>
                      <div className="col-6">
                        <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.dateFormat')}</label>
                        <select
                          className="form-select form-select-sm"
                          value={settingsForm.date_format}
                          onChange={e => setSettingsForm({ ...settingsForm, date_format: e.target.value })}
                        >
                          <option value="mm/dd/yyyy">mm/dd/yyyy</option>
                          <option value="dd/mm/yyyy">dd/mm/yyyy</option>
                          <option value="yyyy-mm-dd">yyyy-mm-dd</option>
                          <option value="mm/dd/yyyy hh:mm:ss a">mm/dd/yyyy hh:mm:ss a</option>
                          <option value="dd/mm/yyyy hh:mm:ss a">dd/mm/yyyy hh:mm:ss a</option>
                          <option value="yyyy-mm-dd HH:mm:ss">yyyy-mm-dd HH:mm:ss</option>
                          <option value="dd.mm.yyyy">dd.mm.yyyy</option>
                          <option value="dd.mm.yyyy HH:mm:ss">dd.mm.yyyy HH:mm:ss</option>
                          <option value="dd MMM yyyy">dd MMM yyyy</option>
                        </select>
                      </div>
                    </div>

                    {/* Resolution */}
                    <div className="mb-2">
                      <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.resolution')}</label>
                      <select
                        className="form-select form-select-sm"
                        value={settingsForm.resolution}
                        onChange={e => setSettingsForm({ ...settingsForm, resolution: e.target.value })}
                      >
                        <option value="">Auto</option>
                        <option value="1920x1080">1920x1080 (Full HD)</option>
                        <option value="1280x720">1280x720 (HD)</option>
                        <option value="1024x768">1024x768 (XGA)</option>
                        <option value="800x480">800x480 (WVGA)</option>
                        <option value="720x480">720x480 (NTSC)</option>
                        <option value="3840x2160">3840x2160 (4K)</option>
                      </select>
                    </div>

                    {/* Screen rotation */}
                    <div className="mb-2">
                      <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('playerSettings.screenRotation')}</label>
                      <select
                        className="form-select form-select-sm"
                        value={settingsForm.screen_rotation}
                        onChange={e => setSettingsForm({ ...settingsForm, screen_rotation: e.target.value })}
                      >
                        <option value="0">{t('playerSettings.rotation0')}</option>
                        <option value="90">{t('playerSettings.rotation90')}</option>
                        <option value="180">{t('playerSettings.rotation180')}</option>
                        <option value="270">{t('playerSettings.rotation270')}</option>
                      </select>
                    </div>

                    {/* Toggle switches */}
                    <div className="border rounded px-3 py-2">
                      {([
                        ['show_splash', 'showSplash'],
                        ['default_assets', 'defaultAssets'],
                        ['shuffle_playlist', 'shufflePlaylist'],
                        ['use_24_hour_clock', 'use24HourClock'],
                        ['debug_logging', 'debugLogging'],
                      ] as const).map(([key, labelKey]) => (
                        <div key={key} className="form-check form-switch mb-1">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`settings-${key}`}
                            checked={settingsForm[key as keyof typeof settingsForm] as boolean}
                            onChange={e => setSettingsForm({ ...settingsForm, [key]: e.target.checked })}
                          />
                          <label className="form-check-label" htmlFor={`settings-${key}`} style={{ fontSize: '0.85rem' }}>
                            {t(`playerSettings.${labelKey}`)}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="col-lg-6">
                    {/* Display Power Schedule (CEC) */}
                    <div className="border rounded px-3 py-2">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <div>
                          <span className="fw-semibold" style={{ fontSize: '0.85rem' }}>
                            {t('playerSettings.displaySchedule')}
                          </span>
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                            {t('playerSettings.displayScheduleDesc')}
                          </div>
                        </div>
                        <div className="form-check form-switch mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="display-schedule-enabled"
                            checked={displaySchedule.enabled}
                            onChange={e => setDisplaySchedule({ ...displaySchedule, enabled: e.target.checked })}
                          />
                          <label className="form-check-label" htmlFor="display-schedule-enabled" style={{ fontSize: '0.8rem' }}>
                            {t('playerSettings.scheduleEnabled')}
                          </label>
                        </div>
                      </div>

                      {displaySchedule.enabled && (
                        <>
                          {/* Quick-apply buttons */}
                          <div className="d-flex gap-1 mb-2">
                            {([
                              ['all', 'applyToAll', ['1','2','3','4','5','6','7']],
                              ['weekdays', 'applyWeekdays', ['1','2','3','4','5']],
                              ['weekend', 'applyWeekend', ['6','7']],
                            ] as [string, string, string[]][]).map(([key, labelKey, dayKeys]) => (
                              <button
                                key={key}
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                style={{ fontSize: '0.72rem', padding: '1px 8px', borderRadius: '12px' }}
                                onClick={() => {
                                  const newDays = { ...displaySchedule.days }
                                  dayKeys.forEach(dk => { newDays[dk] = { on: '08:00', off: '22:00' } })
                                  setDisplaySchedule({ ...displaySchedule, days: newDays })
                                }}
                              >
                                {t(`playerSettings.${labelKey}`)}
                              </button>
                            ))}
                          </div>

                          {/* 7 day rows */}
                          {['1','2','3','4','5','6','7'].map(dk => {
                            const dayCfg = displaySchedule.days[dk]
                            const dayEnabled = dayCfg !== null
                            const dayLabel = t(`schedule.days.${dk}`)
                            return (
                              <div key={dk} className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: '0.82rem' }}>
                                <div className="form-check form-switch mb-0" style={{ minWidth: '28px' }}>
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={dayEnabled}
                                    onChange={e => {
                                      const newDays = { ...displaySchedule.days }
                                      newDays[dk] = e.target.checked ? { on: '08:00', off: '22:00' } : null
                                      setDisplaySchedule({ ...displaySchedule, days: newDays })
                                    }}
                                  />
                                </div>
                                <span className="fw-semibold" style={{ width: '24px' }}>{dayLabel}</span>
                                {dayEnabled ? (
                                  <>
                                    <input
                                      type="time"
                                      className="form-control form-control-sm"
                                      style={{ width: '110px', fontSize: '0.8rem' }}
                                      value={dayCfg!.on}
                                      onChange={e => {
                                        const newDays = { ...displaySchedule.days }
                                        newDays[dk] = { ...dayCfg!, on: e.target.value }
                                        setDisplaySchedule({ ...displaySchedule, days: newDays })
                                      }}
                                    />
                                    <span className="text-muted">—</span>
                                    <input
                                      type="time"
                                      className="form-control form-control-sm"
                                      style={{ width: '110px', fontSize: '0.8rem' }}
                                      value={dayCfg!.off}
                                      onChange={e => {
                                        const newDays = { ...displaySchedule.days }
                                        newDays[dk] = { ...dayCfg!, off: e.target.value }
                                        setDisplaySchedule({ ...displaySchedule, days: newDays })
                                      }}
                                    />
                                  </>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: '0.78rem' }}>
                                    {t('playerSettings.screenOffAllDay')}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </>
                      )}
                    </div>

                    {/* IR Fallback */}
                    <div className="border rounded px-3 py-2 mt-2">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <div>
                          <span className="fw-semibold" style={{ fontSize: '0.85rem' }}>
                            {t('playerSettings.irFallback')}
                          </span>
                          {irStatus && (
                            <span className={`badge ms-2 ${irStatus.ir_available ? 'bg-success' : 'bg-secondary'}`} style={{ fontSize: '0.65rem' }}>
                              {irStatus.ir_available ? t('playerSettings.irHardwareOk') : t('playerSettings.irHardwareNA')}
                            </span>
                          )}
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                            {t('playerSettings.irFallbackDesc')}
                          </div>
                        </div>
                        <div className="form-check form-switch mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="ir-enabled"
                            checked={irEnabled}
                            onChange={e => setIrEnabled(e.target.checked)}
                          />
                        </div>
                      </div>

                      {irEnabled && (
                        <>
                          <div className="mb-2">
                            <label className="form-label mb-0" style={{ fontSize: '0.8rem' }}>{t('playerSettings.irPreset')}</label>
                            <select
                              className="form-select form-select-sm"
                              value={irPreset}
                              onChange={e => {
                                const key = e.target.value
                                setIrPreset(key)
                                if (key !== 'custom' && IR_PRESETS[key]) {
                                  setIrProtocol(IR_PRESETS[key].protocol)
                                  setIrScancode(IR_PRESETS[key].scancode)
                                }
                              }}
                            >
                              <option value="samsung">Samsung</option>
                              <option value="lg">LG</option>
                              <option value="sony">Sony</option>
                              <option value="panasonic">Panasonic</option>
                              <option value="philips">Philips</option>
                              <option value="custom">Custom</option>
                            </select>
                          </div>
                          <div className="row g-2 mb-2">
                            <div className="col-6">
                              <label className="form-label mb-0" style={{ fontSize: '0.8rem' }}>{t('playerSettings.irProtocol')}</label>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={irProtocol}
                                onChange={e => {
                                  setIrProtocol(e.target.value)
                                  setIrPreset('custom')
                                }}
                              />
                            </div>
                            <div className="col-6">
                              <label className="form-label mb-0" style={{ fontSize: '0.8rem' }}>{t('playerSettings.irScancode')}</label>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={irScancode}
                                onChange={e => {
                                  setIrScancode(e.target.value)
                                  setIrPreset('custom')
                                }}
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            disabled={irTesting || !irProtocol || !irScancode || !player?.is_online}
                            onClick={async () => {
                              if (!id) return
                              setIrTesting(true)
                              try {
                                const result = await playersApi.irTest(id, irProtocol, irScancode)
                                if (result.success) {
                                  showToast('success', t('playerSettings.irTestSent'))
                                } else {
                                  Swal.fire({ icon: 'error', title: t('playerSettings.irTestFailed'), text: result.error || '' })
                                }
                              } catch {
                                Swal.fire({ icon: 'error', title: t('playerSettings.irTestFailed') })
                              } finally {
                                setIrTesting(false)
                              }
                            }}
                          >
                            {irTesting ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                            {t('playerSettings.irTestButton')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  </div>
                  )
                ) : settingsActiveTab === 'location' ? (
                  <div>
                    <p className="text-muted mb-3" style={{ fontSize: '0.85rem' }}>
                      {t('playerSettings.locationHint')}
                    </p>
                    <div className="mb-3">
                      <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                        <FaLayerGroup className="me-1" />
                        {t('players.group')}
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={locationForm.group}
                        onChange={e => setLocationForm({ ...locationForm, group: e.target.value })}
                      >
                        <option value="">{t('players.noGroup')}</option>
                        {allGroups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-2">
                      <label className="form-label fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>
                        <FaMapMarkerAlt className="me-1" />
                        {t('players.location')}
                      </label>
                      <select
                        className="form-select form-select-sm"
                        value={locationForm.location}
                        onChange={e => setLocationForm({ ...locationForm, location: e.target.value })}
                        disabled={!!allGroups.find(g => g.id === locationForm.group)?.location}
                      >
                        <option value="">{t('players.noLocation')}</option>
                        {allLocations.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                      {!!allGroups.find(g => g.id === locationForm.group)?.location && (
                        <small className="text-muted">{t('players.locationFromGroupHint')}</small>
                      )}
                    </div>
                  </div>
                ) : settingsActiveTab === 'branding' ? (
                  <div>
                <div className="border rounded p-2 mb-3">
                  <p className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>
                    <FaImage className="me-1" />
                    {t('branding.deviceOverrideTitle')}
                  </p>
                  <div className="row g-2">
                    <div className="col-6">
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="border rounded d-flex align-items-center justify-content-center p-1"
                          style={{ width: '70px', height: '44px', background: 'var(--bs-tertiary-bg, #f5f5f5)', flexShrink: 0 }}
                        >
                          {player?.splash_logo && (
                            <img src={player.splash_logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <input ref={deviceLogoInputRef} type="file" accept=".svg,.png,.jpg,.jpeg" className="d-none" onChange={handleDeviceLogoChange} />
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => deviceLogoInputRef.current?.click()} disabled={uploadingDeviceLogo} style={{ fontSize: '0.72rem' }}>
                            {t('branding.logoLabel')}
                          </button>
                          <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setShowDeviceLogoPicker(true)} style={{ fontSize: '0.72rem' }}>
                            {t('brandingLibrary.chooseButton')}
                          </button>
                          {player?.splash_logo && (
                            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={handleDeviceLogoDelete} style={{ fontSize: '0.72rem' }}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="col-6">
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="border rounded d-flex align-items-center justify-content-center p-1"
                          style={{ width: '70px', height: '44px', background: '#000', flexShrink: 0 }}
                        >
                          {player?.standby_image && (
                            isVideoUrl(player.standby_image) ? (
                              <video src={player.standby_image} autoPlay muted loop playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} />
                            ) : (
                              <img src={player.standby_image} alt="Standby" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                            )
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          <input ref={deviceStandbyInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.mp4,.webm" className="d-none" onChange={handleDeviceStandbyChange} />
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => deviceStandbyInputRef.current?.click()} disabled={uploadingDeviceStandby} style={{ fontSize: '0.72rem' }}>
                            {t('branding.standbyLabel')}
                          </button>
                          <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setShowDeviceStandbyPicker(true)} style={{ fontSize: '0.72rem' }}>
                            {t('brandingLibrary.chooseButton')}
                          </button>
                          {player?.standby_image && (
                            <button type="button" className="btn btn-sm btn-link p-0 text-danger" onClick={handleDeviceStandbyDelete} style={{ fontSize: '0.72rem' }}>
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('branding.pushDesc')}</p>
                <div className="mb-3">
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="push-target-logo"
                      checked={pushTargetLogo}
                      onChange={e => setPushTargetLogo(e.target.checked)}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="push-target-logo">
                      {t('branding.logoLabel')}
                    </label>
                  </div>
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="push-target-standby"
                      checked={pushTargetStandby}
                      onChange={e => setPushTargetStandby(e.target.checked)}
                      disabled={!brandingHasStandby}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="push-target-standby">
                      {t('branding.standbyLabel')}
                      {!brandingHasStandby && (
                        <span className="text-muted"> ({t('branding.notSet')})</span>
                      )}
                    </label>
                  </div>
                </div>
                {player?.has_ssh_credentials && (
                  <div className="alert alert-secondary py-2 px-2 d-flex justify-content-between align-items-center" style={{ fontSize: '0.78rem' }}>
                    <span>{t('branding.sshCredentialsSaved', { user: player.ssh_username })}</span>
                    <button type="button" className="btn btn-link btn-sm p-0 text-danger" onClick={handleForgetSshCredentials}>
                      {t('branding.sshForget')}
                    </button>
                  </div>
                )}
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshUser')}</label>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={pushLogoSshUser}
                    onChange={e => setPushLogoSshUser(e.target.value)}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>
                    {t('branding.sshPassword')}
                    {player?.has_ssh_credentials && (
                      <span className="text-muted fw-normal"> ({t('branding.sshUseSaved')})</span>
                    )}
                  </label>
                  <input
                    type="password"
                    className="form-control form-control-sm"
                    value={pushLogoSshPassword}
                    onChange={e => setPushLogoSshPassword(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshPort')}</label>
                  <input
                    type="number"
                    className="form-control form-control-sm"
                    value={pushLogoSshPort}
                    onChange={e => setPushLogoSshPort(Number(e.target.value))}
                    min={1}
                    max={65535}
                    style={{ maxWidth: '120px' }}
                  />
                </div>
                {pushLogoSshPassword && (
                  <div className="form-check mb-2">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id="save-ssh-credentials"
                      checked={saveSshCredentials}
                      onChange={e => setSaveSshCredentials(e.target.checked)}
                    />
                    <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="save-ssh-credentials">
                      {t('branding.sshSaveHint')}
                    </label>
                  </div>
                )}
                  </div>
                ) : settingsActiveTab === 'image' ? (
                  <div>
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('migrateImage.desc')}</p>

                    {player?.has_ssh_credentials && (
                      <div className="alert alert-secondary py-2 px-2 d-flex justify-content-between align-items-center" style={{ fontSize: '0.78rem' }}>
                        <span>{t('branding.sshCredentialsSaved', { user: player.ssh_username })}</span>
                        <button type="button" className="btn btn-link btn-sm p-0 text-danger" onClick={handleForgetSshCredentials}>
                          {t('branding.sshForget')}
                        </button>
                      </div>
                    )}
                    <div className="mb-2">
                      <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshUser')}</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={pushLogoSshUser}
                        onChange={e => { setPushLogoSshUser(e.target.value); setImageSourceResult(null) }}
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>
                        {t('branding.sshPassword')}
                        {player?.has_ssh_credentials && (
                          <span className="text-muted fw-normal"> ({t('branding.sshUseSaved')})</span>
                        )}
                      </label>
                      <input
                        type="password"
                        className="form-control form-control-sm"
                        value={pushLogoSshPassword}
                        onChange={e => { setPushLogoSshPassword(e.target.value); setImageSourceResult(null) }}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('branding.sshPort')}</label>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={pushLogoSshPort}
                        onChange={e => { setPushLogoSshPort(Number(e.target.value)); setImageSourceResult(null) }}
                        min={1}
                        max={65535}
                        style={{ maxWidth: '120px' }}
                      />
                    </div>

                    <div className="mb-3">
                      <label className="form-label mb-1 fw-semibold" style={{ fontSize: '0.85rem' }}>{t('migrateImage.targetLabel')}</label>
                      <div className="btn-group w-100" role="group">
                        <button
                          type="button"
                          className={`btn btn-sm ${migrateTarget === 'mupitech' ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => setMigrateTarget('mupitech')}
                        >
                          {t('migrateImage.targetMupitech')}
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${migrateTarget === 'official' ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => setMigrateTarget('official')}
                        >
                          {t('migrateImage.targetOfficial')}
                        </button>
                      </div>
                      <div className="form-text" style={{ fontSize: '0.75rem' }}>
                        {t(migrateTarget === 'mupitech' ? 'migrateImage.targetMupitechHint' : 'migrateImage.targetOfficialHint')}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary mb-3"
                      disabled={checkingImageSource || (!pushLogoSshPassword && !player?.has_ssh_credentials)}
                      onClick={handleCheckImageSource}
                    >
                      {checkingImageSource ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                      {t('migrateImage.checkButton')}
                    </button>

                    {imageSourceError && (
                      <div className="alert alert-danger py-2 px-2" style={{ fontSize: '0.8rem' }}>{imageSourceError}</div>
                    )}
                    {imageSourceResult && (
                      <div className={`alert py-2 px-2 ${imageSourceResult.source === migrateTarget ? 'alert-success' : 'alert-info'}`} style={{ fontSize: '0.8rem' }}>
                        <div><strong>{t('migrateImage.currentSource')}:</strong> {t(`migrateImage.source.${imageSourceResult.source}`)}</div>
                        <div className="text-muted" style={{ wordBreak: 'break-all' }}>{imageSourceResult.image}</div>
                      </div>
                    )}
                    {imageSourceResult?.has_backup && (
                      <div className="alert alert-warning py-2 px-2 d-flex justify-content-between align-items-center" style={{ fontSize: '0.8rem' }}>
                        <span>{t('migrateImage.backupAvailable')}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-dark"
                          onClick={handleRestoreImage}
                          disabled={restoringImage}
                        >
                          {restoringImage ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                          {t('migrateImage.restoreButton')}
                        </button>
                      </div>
                    )}

                    {imageSourceResult?.can_migrate && imageSourceResult.source !== migrateTarget && (
                      <div className="form-check mb-2">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id="migrate-preserve-content"
                          checked={preserveContent}
                          onChange={e => setPreserveContent(e.target.checked)}
                        />
                        <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="migrate-preserve-content">
                          {t('migrateImage.preserveContent')}
                        </label>
                        <div className="form-text" style={{ fontSize: '0.75rem' }}>
                          {t(preserveContent ? 'migrateImage.preserveContentHintOn' : 'migrateImage.preserveContentHintOff')}
                        </div>
                      </div>
                    )}

                    {pushLogoSshPassword && (
                      <div className="form-check mb-2">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id="migrate-save-ssh-credentials"
                          checked={saveSshCredentials}
                          onChange={e => setSaveSshCredentials(e.target.checked)}
                        />
                        <label className="form-check-label" style={{ fontSize: '0.85rem' }} htmlFor="migrate-save-ssh-credentials">
                          {t('branding.sshSaveHint')}
                        </label>
                      </div>
                    )}

                    {(migratingImage || rebuildingImage) && (
                      <div className={`alert py-2 px-2 d-flex align-items-center gap-2 mb-0 ${rebuildingImage ? 'alert-danger' : 'alert-info'}`} style={{ fontSize: '0.8rem' }}>
                        <span className="spinner-border spinner-border-sm" />
                        <span>{migrateProgressText || t('migrateImage.progressConnecting')}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    <div>
                      <h6 className="fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('players.reveal')}</h6>
                      <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>{t('playerSettings.accessCredentialsHint')}</p>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={handleRevealCredentials}
                      >
                        <FaEye className="me-1" />
                        {t('players.reveal')}
                      </button>
                    </div>

                    <hr className="my-0" />

                    <div>
                      <h6 className="fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('players.openLocalDashboard')}</h6>
                      <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>{t('playerSettings.accessSsoHint')}</p>
                      <div className="d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={handleSsoLogin}
                          disabled={!player.is_online || player.sso_enabled === false}
                        >
                          <FaExternalLinkAlt className="me-1" />
                          {t('players.openLocalDashboard')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={handleToggleSso}
                        >
                          {player.sso_enabled === false ? <FaToggleOff className="me-1" /> : <FaToggleOn className="me-1" />}
                          {player.sso_enabled === false ? t('players.ssoEnable') : t('players.ssoDisable')}
                        </button>
                      </div>
                      {player.sso_enabled === false && (
                        <div className="form-text" style={{ fontSize: '0.75rem' }}>{t('players.ssoDisabledHint')}</div>
                      )}
                    </div>

                    <hr className="my-0" />

                    <div>
                      <h6 className="fw-semibold mb-1" style={{ fontSize: '0.85rem' }}>{t('players.replaceDevice')}</h6>
                      <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>{t('playerSettings.accessReplaceHint')}</p>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={handleOpenReplaceModal}
                      >
                        <FaExchangeAlt className="me-1" />
                        {t('players.replaceDevice')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer py-2">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowSettingsModal(false)}
                >
                  {t('playerSettings.cancel')}
                </button>
                {settingsActiveTab === 'general' ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveSettings}
                    disabled={settingsSaving || settingsLoading || generalSettingsError}
                  >
                    {settingsSaving ? (
                      <span className="spinner-border spinner-border-sm me-1" />
                    ) : null}
                    {t('playerSettings.save')}
                  </button>
                ) : settingsActiveTab === 'location' ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveLocation}
                    disabled={savingLocation}
                  >
                    {savingLocation ? (
                      <span className="spinner-border spinner-border-sm me-1" />
                    ) : null}
                    {t('playerSettings.save')}
                  </button>
                ) : settingsActiveTab === 'branding' ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handlePushBranding}
                    disabled={pushingLogo || (!pushLogoSshPassword && !player?.has_ssh_credentials) || (!pushTargetLogo && !pushTargetStandby)}
                  >
                    {pushingLogo ? (
                      <span className="spinner-border spinner-border-sm me-1" />
                    ) : null}
                    {t('branding.push')}
                  </button>
                ) : settingsActiveTab === 'image' ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={handleRebuildImage}
                      disabled={
                        rebuildingImage
                        || migratingImage
                        || (!pushLogoSshPassword && !player?.has_ssh_credentials)
                        || (imageSourceResult ? !imageSourceResult.can_migrate : false)
                      }
                      title={t('migrateImage.rebuildHint')}
                    >
                      {rebuildingImage ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                      {t('migrateImage.rebuildButton')}
                    </button>
                    <button
                      type="button"
                      className="fm-btn-primary"
                      onClick={handleMigrateImage}
                      disabled={
                        migratingImage
                        || rebuildingImage
                        || (!pushLogoSshPassword && !player?.has_ssh_credentials)
                        || (imageSourceResult ? !imageSourceResult.can_migrate : false)
                      }
                    >
                      {migratingImage ? t('common.loading') : t('migrateImage.migrateButton')}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Asset hover tooltip */}
      {hoveredAsset && hoverRect && (() => {
        const previewUrl = getAssetPreviewUrl(hoveredAsset)
        const mf = findMediaFile(hoveredAsset)
        return (
          <div
            style={{
              position: 'fixed',
              left: Math.min(hoverRect.left, window.innerWidth - 320),
              top: hoverRect.bottom + 8 + 170 + 60 > window.innerHeight
                ? hoverRect.top - 8 - 240
                : hoverRect.bottom + 8,
              zIndex: 10000,
              width: '300px',
              pointerEvents: 'none',
            }}
          >
            <div
              className="shadow-lg"
              style={{
                background: 'var(--bs-body-bg, #fff)',
                border: '1px solid var(--bs-border-color, #dee2e6)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {/* Thumbnail from server or placeholder */}
              {hoveredAsset.mimetype === 'video' && previewUrl ? (
                <video
                  src={previewUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  style={{ width: '100%', height: '170px', objectFit: 'cover', display: 'block', background: '#000' }}
                />
              ) : hoveredAsset.mimetype === 'image' && previewUrl ? (
                <img
                  src={previewUrl}
                  alt={hoveredAsset.name}
                  style={{ width: '100%', height: '170px', objectFit: 'cover', display: 'block', background: '#000' }}
                />
              ) : hoveredAsset.mimetype === 'webpage' ? (
                <div
                  style={{
                    width: '100%',
                    height: '170px',
                    background: 'linear-gradient(135deg, #e8f4fd 0%, #d0e8f7 100%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {mf && mf.thumbnail_url ? (
                    <img src={mf.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <>
                      <FaGlobe style={{ fontSize: '2rem', color: '#0d6efd', marginBottom: '8px' }} />
                      <small className="text-muted px-3 text-center" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                        {hoveredAsset.uri}
                      </small>
                    </>
                  )}
                </div>
              ) : (
                <div
                  className="d-flex flex-column align-items-center justify-content-center"
                  style={{
                    width: '100%',
                    height: '170px',
                    background: 'var(--bs-gray-200, #e9ecef)',
                    color: 'var(--bs-gray-500, #adb5bd)',
                    fontSize: '2.5rem',
                  }}
                >
                  {getAssetTypeIcon(hoveredAsset.mimetype)}
                  <small className="mt-2" style={{ fontSize: '0.7rem' }}>
                    {t('content.noPreview')}
                  </small>
                </div>
              )}
              {/* Info */}
              <div className="p-2">
                <div className="fw-semibold mb-1" style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
                  {hoveredAsset.name}
                </div>
                <div className="d-flex gap-3 text-muted" style={{ fontSize: '0.75rem' }}>
                  <span>{hoveredAsset.mimetype}</span>
                  <span>{formatDuration(hoveredAsset.duration, t)}</span>
                  <span>{hoveredAsset.is_enabled ? t('assets.enabled') : t('assets.disabled')}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Asset preview modal */}
      {previewAsset && (() => {
        const previewUrl = getAssetPreviewUrl(previewAsset)
        const mf = findMediaFile(previewAsset)
        return (
        <div
          className="modal d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 10001 }}
          onClick={() => setPreviewAsset(null)}
        >
          <div
            className="modal-dialog modal-lg modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content" style={{ borderRadius: '12px', overflow: 'hidden' }}>
              <div className="modal-header py-2 px-3">
                <h6 className="modal-title d-flex align-items-center gap-2 mb-0">
                  <span className="text-muted">{getAssetTypeIcon(previewAsset.mimetype)}</span>
                  <span className="text-truncate" style={{ maxWidth: '400px' }}>
                    {previewAsset.name}
                  </span>
                </h6>
                <div className="d-flex align-items-center gap-2">
                  {previewAsset.mimetype === 'webpage' && (
                    <a
                      href={previewAsset.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline-primary py-0"
                      title={t('content.openUrl')}
                    >
                      <FaExternalLinkAlt style={{ fontSize: '0.7rem' }} />
                    </a>
                  )}
                  <button type="button" className="btn-close" onClick={() => setPreviewAsset(null)} />
                </div>
              </div>
              <div
                className="modal-body p-0 d-flex align-items-center justify-content-center"
                style={{ minHeight: '300px', maxHeight: '75vh', backgroundColor: '#1a1a1a' }}
              >
                {previewAsset.mimetype === 'image' && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={previewAsset.name}
                    style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
                  />
                ) : previewAsset.mimetype === 'video' && previewUrl ? (
                  <video
                    src={previewUrl}
                    controls
                    autoPlay
                    style={{ maxWidth: '100%', maxHeight: '75vh' }}
                  />
                ) : previewAsset.mimetype === 'webpage' ? (
                  <iframe
                    src={previewAsset.uri}
                    title={previewAsset.name}
                    style={{ width: '100%', height: '75vh', border: 'none', backgroundColor: '#fff' }}
                  />
                ) : (
                  <div className="text-center text-white p-5">
                    <div style={{ fontSize: '4rem', opacity: 0.5, marginBottom: '1rem' }}>
                      {getAssetTypeIcon(previewAsset.mimetype)}
                    </div>
                    <p>{mf ? t('content.noPreview') : t('content.noPreview')}</p>
                    <small className="text-muted">{t('content.noPreview')}</small>
                  </div>
                )}
              </div>
              <div className="modal-footer py-2 px-3">
                <small className="text-muted me-auto">
                  {previewAsset.mimetype.toUpperCase()}
                  {' · '}
                  {formatDuration(previewAsset.duration, t)}
                  {' · '}
                  {formatAssetDate(previewAsset.start_date)} — {formatAssetDate(previewAsset.end_date)}
                </small>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setPreviewAsset(null)}
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
        )
      })()}

      <BrandingLibraryPicker
        kind="logo"
        show={showDeviceLogoPicker}
        onClose={() => setShowDeviceLogoPicker(false)}
        onPick={uploadDeviceLogoFile}
      />
      <BrandingLibraryPicker
        kind="standby"
        show={showDeviceStandbyPicker}
        onClose={() => setShowDeviceStandbyPicker(false)}
        onPick={uploadDeviceStandbyFile}
      />
    </div>
  )
}

export default PlayerDetail
