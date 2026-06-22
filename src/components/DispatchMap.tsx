// Live navigation map for the dump-truck OUI: the truck's GPS position
// (heading-aware), the "road ahead" route line along the haul network to its
// NEXT destination (loading point when empty, dump when full) with a geofence
// circle. When a route is present the map enters NAV mode — it follows the
// truck at street zoom (the road in front), like Google Maps driving view.
// No assignment → it just shows the current position. Satellite basemap (Esri
// World Imagery, public). Vanilla Leaflet, divIcons only (no marker images).
import { useEffect, useRef, memo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface ZoneRing {
  radiusM: number
  color: string
  label?: string
  dashed?: boolean
}

export interface DispatchMapProps {
  truck: { lat: number; lng: number; course?: number | null } | null
  dest: { lat: number; lng: number } | null
  // The FIXED assigned loading area (its own named-location coordinates), shown
  // as a static labelled flag ALONGSIDE the live shovel `dest` on the empty leg.
  // The shovel (`dest`) is the real moving load point; this is the planned area.
  // Null when unassigned, on the full leg, or when the location has no coords.
  loadingDest?: { lat: number; lng: number } | null
  loadingLabel?: string | null
  geofenceM?: number | null
  lane: 'full' | 'empty'
  destKind?: 'loading' | 'dump'
  stateColor?: string
  // Dumping-scenario: when the truck is Arrived at Dump (state==dumping) the
  // vehicle marker becomes a tilting-truck-bed "dumping" glyph instead of the
  // plain heading arrow, so the dispatcher/driver sees the discharge at a glance.
  dumping?: boolean
  route?: [number, number][] | null          // [lat,lng] along the haul roads (fallback line)
  routeSegments?: { lane: string; coordinates: [number, number][] }[] | null  // [lng,lat] loaded/empty
  roads?: GeoJSON.FeatureCollection | null    // optional empty/full lane overlay
  // Concentric MOVING geofence rings around the destination (the excavator when
  // empty/inbound): e.g. Discovery 100m / Waiting 20m / Loading 10m. When set
  // these replace the single `geofenceM` circle so the driver sees the colour-
  // coded zones that follow the shovel. Innermost should be LAST (drawn on top).
  rings?: ZoneRing[] | null
  height?: number | string
  visible?: boolean
}

const NAV_ZOOM = 16

// Tilting-truck-bed "DUMPING" glyph (raised bed pivoting at the cab, with falling
// material) used while the truck is Arrived at Dump. Drawn upright (not heading-
// rotated) so the tipping motion reads clearly. `color` follows the cycle state.
export function dumpBedSvg(color: string, size = 34): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 34 34" fill="none" ` +
    `style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.75));">` +
    // chassis + wheels
    `<rect x="4" y="22" width="24" height="4" rx="1.4" fill="${color}"/>` +
    `<circle cx="10" cy="28" r="2.6" fill="#111827" stroke="${color}" stroke-width="1.4"/>` +
    `<circle cx="22" cy="28" r="2.6" fill="#111827" stroke="${color}" stroke-width="1.4"/>` +
    // cab
    `<rect x="22" y="15" width="6" height="7" rx="1.2" fill="${color}"/>` +
    // raised (tilting) bed — pivoted at the rear, tipping its load out the back
    `<path d="M5 21 L25 21 L13 9 L3 12 Z" fill="${color}" stroke="#0a0e14" stroke-width="0.8"/>` +
    // falling material
    `<circle cx="4.5" cy="16" r="1.1" fill="#fbbf24"/>` +
    `<circle cx="3" cy="19.5" r="1.0" fill="#fbbf24"/>` +
    `<circle cx="6" cy="20" r="0.9" fill="#fbbf24"/>` +
    `</svg>`
  )
}

function DispatchMap({
  truck, dest, loadingDest, loadingLabel, geofenceM, lane, destKind = 'dump', stateColor = '#38BDF8', dumping = false, route, roads, rings, height = 260, visible,
}: DispatchMapProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layers = useRef<{ truck?: L.Marker; dest?: L.Marker; loadDest?: L.Marker; geo?: L.Circle; rings?: L.Circle[]; line?: L.Polyline; nav?: L.LayerGroup; roads?: L.GeoJSON }>({})
  const fittedKey = useRef<string>('')

  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, {
      zoomControl: false, attributionControl: false, center: [0.6510, 128.0208], zoom: 14,
      // locked: no finger pan/zoom — the camera follows the truck programmatically only
      dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false,
    })
    // No global satellite basemap — this Leaflet path is only the WebGL fallback;
    // it shows the haul roads / route / markers on a dark backdrop (the primary
    // MapLibre NavMap drapes our own site ortho imagery). Matches the cab look.
    map.getContainer().style.background = '#0a0e14'
    mapRef.current = map
    const t = setTimeout(() => map.invalidateSize(), 250)
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layers.current = {} }
  }, [])

  // If the map was hidden (opacity 0) and is shown again, force a resize.
  const wasVisible = useRef(true)
  useEffect(() => {
    const now = visible !== false
    if (now && !wasVisible.current && mapRef.current) {
      try { mapRef.current.invalidateSize() } catch { /* */ }
    }
    wasVisible.current = now
  }, [visible])

  // roads overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (layers.current.roads) { layers.current.roads.remove(); layers.current.roads = undefined }
    if (roads && roads.features?.length) {
      layers.current.roads = L.geoJSON(roads, {
        style: (f) => {
          const side = (f?.properties as Record<string, unknown> | undefined)?.loaded_side
          const loaded = side === 'left' || side === 'right'
          return { color: loaded ? '#38BDF8' : '#94A3B8', weight: 2, opacity: 0.45 }
        },
      }).addTo(map)
    }
  }, [roads])

  // route ("road ahead") line
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (layers.current.nav) { layers.current.nav.remove(); layers.current.nav = undefined }
    if (route && route.length >= 2) {
      // casing + bright line for a clean "navigation" look
      const grp = L.layerGroup()
      L.polyline(route as L.LatLngExpression[], { color: '#1D4ED8', weight: 7, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(grp)
      L.polyline(route as L.LatLngExpression[], { color: '#60A5FA', weight: 3.5, opacity: 1 }).addTo(grp)
      grp.addTo(map)
      layers.current.nav = grp
    }
  }, [route])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const ls = layers.current

    if (truck && isFinite(truck.lat) && isFinite(truck.lng)) {
      // While Arrived at Dump, show the tilting-truck-bed dumping glyph (upright,
      // not heading-rotated). Otherwise the heading-aware arrow.
      const html = dumping
        ? `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;">${dumpBedSvg(stateColor)}</div>`
        : `<div style="transform:rotate(${truck.course ?? 0}deg);width:30px;height:30px;display:flex;align-items:center;justify-content:center;">` +
          `<div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;` +
          `border-bottom:22px solid ${stateColor};filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));"></div></div>`
      const sz: [number, number] = dumping ? [34, 34] : [30, 30]
      const icon = L.divIcon({ html, className: '', iconSize: sz, iconAnchor: [sz[0] / 2, sz[1] / 2] })
      if (ls.truck) ls.truck.setLatLng([truck.lat, truck.lng]).setIcon(icon)
      else ls.truck = L.marker([truck.lat, truck.lng], { icon, zIndexOffset: 1000 }).addTo(map)
    } else if (ls.truck) { ls.truck.remove(); ls.truck = undefined }

    const destColor = destKind === 'loading' ? '#22C55E' : '#A16207'
    if (dest && isFinite(dest.lat) && isFinite(dest.lng)) {
      const dhtml = `<div style="width:16px;height:16px;border-radius:50%;background:${destColor};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6)"></div>`
      const dicon = L.divIcon({ html: dhtml, className: '', iconSize: [16, 16], iconAnchor: [8, 8] })
      if (ls.dest) ls.dest.setLatLng([dest.lat, dest.lng]).setIcon(dicon)
      else ls.dest = L.marker([dest.lat, dest.lng], { icon: dicon }).addTo(map)

      // MOVING geofence rings (Discovery/Waiting/Loading) — colour-coded circles
      // that follow the shovel. When provided they REPLACE the single geofence.
      if (rings && rings.length) {
        if (ls.geo) { ls.geo.remove(); ls.geo = undefined }
        // reconcile circle layers with the ring list (reuse to avoid flicker)
        const prev = ls.rings || []
        rings.forEach((r, i) => {
          const opts: L.CircleMarkerOptions = {
            radius: r.radiusM, color: r.color, weight: 2, opacity: 0.9,
            fillColor: r.color, fillOpacity: 0.06, dashArray: r.dashed ? '6 6' : undefined,
          }
          if (prev[i]) prev[i].setLatLng([dest.lat, dest.lng]).setRadius(r.radiusM).setStyle(opts)
          else prev[i] = L.circle([dest.lat, dest.lng], { ...opts, radius: r.radiusM }).addTo(map)
        })
        // drop any extra circles from a previous longer ring list
        for (let i = rings.length; i < prev.length; i++) prev[i].remove()
        ls.rings = prev.slice(0, rings.length)
      } else {
        if (ls.rings) { ls.rings.forEach((c) => c.remove()); ls.rings = undefined }
        if (geofenceM && geofenceM > 0) {
          if (ls.geo) ls.geo.setLatLng([dest.lat, dest.lng]).setRadius(geofenceM).setStyle({ color: destColor, fillColor: destColor })
          else ls.geo = L.circle([dest.lat, dest.lng], { radius: geofenceM, color: destColor, weight: 2, fillColor: destColor, fillOpacity: 0.12 }).addTo(map)
        } else if (ls.geo) { ls.geo.remove(); ls.geo = undefined }
      }
    } else {
      if (ls.dest) { ls.dest.remove(); ls.dest = undefined }
      if (ls.geo) { ls.geo.remove(); ls.geo = undefined }
      if (ls.rings) { ls.rings.forEach((c) => c.remove()); ls.rings = undefined }
    }

    // FIXED loading-area flag — the planned named loading location, drawn as a
    // static green flag with its label, separate from the live shovel `dest`.
    // Only on the empty leg (destKind 'loading'); hidden when full or unassigned.
    if (loadingDest && destKind === 'loading' && isFinite(loadingDest.lat) && isFinite(loadingDest.lng)) {
      const lbl = (loadingLabel || 'Loading').replace(/</g, '&lt;')
      const lhtml = `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-50%)">` +
        `<div style="background:#15803D;color:#fff;font:700 10px/1 -apple-system,sans-serif;padding:3px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.6);border:1px solid #22C55E">${lbl}</div>` +
        `<div style="width:2px;height:14px;background:#22C55E"></div>` +
        `<div style="width:12px;height:12px;border-radius:50%;background:#22C55E;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6);margin-top:-1px"></div></div>`
      const licon = L.divIcon({ html: lhtml, className: '', iconSize: [80, 40], iconAnchor: [40, 40] })
      if (ls.loadDest) ls.loadDest.setLatLng([loadingDest.lat, loadingDest.lng]).setIcon(licon)
      else ls.loadDest = L.marker([loadingDest.lat, loadingDest.lng], { icon: licon, zIndexOffset: 500 }).addTo(map)
    } else if (ls.loadDest) { ls.loadDest.remove(); ls.loadDest = undefined }

    // straight fallback line only when there's no road route
    if (truck && dest && !(route && route.length >= 2)) {
      const lineColor = lane === 'full' ? '#38BDF8' : '#CBD5E1'
      const pts: L.LatLngExpression[] = [[truck.lat, truck.lng], [dest.lat, dest.lng]]
      if (ls.line) ls.line.setLatLngs(pts).setStyle({ color: lineColor })
      else ls.line = L.polyline(pts, { color: lineColor, weight: 3, dashArray: '6 8', opacity: 0.9 }).addTo(map)
    } else if (ls.line) { ls.line.remove(); ls.line = undefined }

    // NAV mode (route present): follow the truck at street zoom — the road in
    // front. Otherwise fit truck+dest once per destination.
    const navMode = !!(route && route.length >= 2 && truck)
    if (navMode && truck) {
      map.setView([truck.lat, truck.lng], Math.max(map.getZoom(), NAV_ZOOM), { animate: true })
    } else {
      const key = dest ? `${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}` : (truck ? 't' : '')
      if (key && key !== fittedKey.current) {
        fittedKey.current = key
        if (truck && dest) {
          const b = L.latLngBounds([[truck.lat, truck.lng], [dest.lat, dest.lng]])
          if (loadingDest && destKind === 'loading') b.extend([loadingDest.lat, loadingDest.lng])
          map.fitBounds(b.pad(0.45), { maxZoom: 16 })
        } else if (truck) map.setView([truck.lat, truck.lng], 15)
      }
    }
  }, [truck?.lat, truck?.lng, truck?.course, dest?.lat, dest?.lng, loadingDest?.lat, loadingDest?.lng, loadingLabel, geofenceM, lane, destKind, stateColor, dumping, route, rings])

  return (
    <div
      ref={elRef}
      style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#0b0f17', border: '1px solid #2a2a2a' }}
    />
  )
}

const MemoDispatchMap = memo(DispatchMap)
export { MemoDispatchMap as DispatchMap }
export default MemoDispatchMap
