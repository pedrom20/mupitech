// Ported from mupitech-player's static/src/apps/catalog.ts — fetch the
// signage-app store catalog entirely in the operator's browser: the
// pointers-only index, then each app's self-hosted manifest. Both send
// Access-Control-Allow-Origin: *, so this works the same from the
// Fleet Manager's own origin as it does from a device's.

import type { AppManifest, CatalogApp, StoreIndex } from './types'

export const DEFAULT_APP_STORE_INDEX_URL = 'https://signage-apps.com/manifest.json'

function isUsableManifest(m: unknown): m is AppManifest {
  if (!m || typeof m !== 'object') return false
  const manifest = m as Partial<AppManifest>
  return Boolean(
    manifest.manifestVersion &&
      manifest.id &&
      manifest.name &&
      manifest.description &&
      manifest.launch &&
      manifest.launch.baseUrl,
  )
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, credentials: 'omit' })
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`)
  }
  return res.json()
}

export async function fetchManifest(url: string, signal?: AbortSignal): Promise<AppManifest> {
  const manifest = await fetchJson(url, signal)
  if (!isUsableManifest(manifest)) {
    throw new Error('Manifest is missing required fields')
  }
  return manifest
}

export async function loadCatalog(
  indexUrl: string = DEFAULT_APP_STORE_INDEX_URL,
  signal?: AbortSignal,
): Promise<CatalogApp[]> {
  const index = (await fetchJson(indexUrl, signal)) as StoreIndex
  if (!index || !Array.isArray(index.apps)) {
    throw new Error('Store index is missing an apps list')
  }

  const settled = await Promise.allSettled(
    index.apps.map(async (entry): Promise<CatalogApp> => {
      const manifest = await fetchJson(entry.manifest, signal)
      if (!isUsableManifest(manifest)) {
        throw new Error(`Manifest for ${entry.id} is missing required fields`)
      }
      return { id: entry.id, manifestUrl: entry.manifest, manifest }
    }),
  )

  const apps: CatalogApp[] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      apps.push(result.value)
    } else {
      const reason = result.reason
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        console.warn(`Skipping app "${index.apps[i]?.id}": ${String(reason)}`)
      }
    }
  })
  return apps
}
