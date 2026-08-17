import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaMapMarkerAlt, FaSearch } from 'react-icons/fa'

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
}

interface LocationSearchFieldProps {
  value: { lat?: number; lng?: number }
  onChange: (value: { lat?: number; lng?: number }) => void
}

/** Type-to-search location picker for the 'location-map' setting
 * widget — mupitech-player's own device-side Add → Apps tab uses a
 * draggable Leaflet map for this (see apps/location-map.ts); the FM
 * uses a plain address search against OpenStreetMap's free Nominatim
 * API instead, which needs no mapping library in the FM's own bundle
 * and is arguably quicker for picking a named place (city, address)
 * than dragging a map to find it. Same {lat, lng} value either way —
 * the numeric fields below stay for fine-tuning or a location the
 * search can't find. */
const LocationSearchField: React.FC<LocationSearchFieldProps> = ({ value, onChange }) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedName, setSelectedName] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSearching(true)
    setSearched(false)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
      const data: NominatimResult[] = res.ok ? await res.json() : []
      setResults(data)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }

  const handlePick = (result: NominatimResult) => {
    onChange({ lat: Number(result.lat), lng: Number(result.lon) })
    setSelectedName(result.display_name)
    setResults([])
  }

  return (
    <div>
      <form className="d-flex gap-2 mb-2" onSubmit={handleSearch}>
        <input
          type="text"
          className="form-control form-control-sm"
          placeholder={t('apps.locationSearchPlaceholder', 'Search for a place…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-sm btn-outline-secondary" disabled={searching || !query.trim()}>
          <FaSearch />
        </button>
      </form>

      {results.length > 0 && (
        <div className="list-group mb-2">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              className="list-group-item list-group-item-action py-1 px-2"
              style={{ fontSize: '0.78rem' }}
              onClick={() => handlePick(r)}
            >
              <FaMapMarkerAlt className="me-1 text-muted" />
              {r.display_name}
            </button>
          ))}
        </div>
      )}
      {searched && !searching && results.length === 0 && (
        <div className="form-text mb-2" style={{ fontSize: '0.72rem' }}>{t('apps.locationSearchNoResults', 'No matches found.')}</div>
      )}
      {selectedName && (
        <div className="form-text mb-2" style={{ fontSize: '0.72rem' }}>
          <FaMapMarkerAlt className="me-1" />
          {selectedName}
        </div>
      )}

      <div className="d-flex gap-2">
        <input
          type="number"
          step="any"
          className="form-control form-control-sm"
          placeholder="lat"
          value={value.lat ?? ''}
          onChange={(e) => onChange({ ...value, lat: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
        <input
          type="number"
          step="any"
          className="form-control form-control-sm"
          placeholder="lng"
          value={value.lng ?? ''}
          onChange={(e) => onChange({ ...value, lng: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      </div>
    </div>
  )
}

export default LocationSearchField
