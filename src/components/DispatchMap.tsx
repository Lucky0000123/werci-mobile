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

export interface DispatchMapProps {
  truck: { lat: number; lng: number; course?: number | null } | null
  dest: { lat: number; lng: number } | null
  geofenceM?: number | null
  lane: 'full' | 'empty'
  destKind?: 'loading' | 'dump'
  stateColor?: string
  route?: [number, number][] | null          // [lat,lng] along the haul roads (fallback line)
  routeSegments?: { lane: string; coordinates: [number, number][] }[] | null  // [lng,lat] loaded/empty
  roads?: GeoJSON.FeatureCollection | null    // optional empty/full lane overlay
  height?: number | string
  visible?: boolean
  // 3D twin mode (NavMap only): adds raster-DEM terrain + sky so the haul roads
  // drape over real elevation. Ignored by the Leaflet fallback (2D only).
  threeD?: boolean
  // Site ortho imagery overlay (NavMap only): drapes our OWN high-detail site
  // tiles (the FMS-site-map imagery) over the satellite basemap. Default on.
  siteImagery?: boolean
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const NAV_ZOOM = 16

function DispatchMap({
  truck, dest, geofenceM, lane, destKind = 'dump', stateColor = '#38BDF8', route, roads, height = 260, visible,
}: DispatchMapProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layers = useRef<{ truck?: L.Marker; dest?: L.Marker; geo?: L.Circle; line?: L.Polyline; nav?: L.LayerGroup; roads?: L.GeoJSON }>({})
  const fittedKey = useRef<string>('')

  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, {
      zoomControl: false, attributionControl: false, center: [0.6510, 128.0208], zoom: 14,
      // locked: no finger pan/zoom — the camera follows the truck programmatically only
      dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false,
    })
    L.tileLayer(ESRI, { maxZoom: 19 }).addTo(map)
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
      const html =
        `<div style="transform:rotate(${truck.course ?? 0}deg);width:30px;height:30px;display:flex;align-items:center;justify-content:center;">` +
        `<div style="width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;` +
        `border-bottom:22px solid ${stateColor};filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));"></div></div>`
      const icon = L.divIcon({ html, className: '', iconSize: [30, 30], iconAnchor: [15, 15] })
      if (ls.truck) ls.truck.setLatLng([truck.lat, truck.lng]).setIcon(icon)
      else ls.truck = L.marker([truck.lat, truck.lng], { icon, zIndexOffset: 1000 }).addTo(map)
    } else if (ls.truck) { ls.truck.remove(); ls.truck = undefined }

    const destColor = destKind === 'loading' ? '#22C55E' : '#A16207'
    if (dest && isFinite(dest.lat) && isFinite(dest.lng)) {
      const dhtml = `<div style="width:16px;height:16px;border-radius:50%;background:${destColor};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6)"></div>`
      const dicon = L.divIcon({ html: dhtml, className: '', iconSize: [16, 16], iconAnchor: [8, 8] })
      if (ls.dest) ls.dest.setLatLng([dest.lat, dest.lng]).setIcon(dicon)
      else ls.dest = L.marker([dest.lat, dest.lng], { icon: dicon }).addTo(map)
      if (geofenceM && geofenceM > 0) {
        if (ls.geo) ls.geo.setLatLng([dest.lat, dest.lng]).setRadius(geofenceM).setStyle({ color: destColor, fillColor: destColor })
        else ls.geo = L.circle([dest.lat, dest.lng], { radius: geofenceM, color: destColor, weight: 2, fillColor: destColor, fillOpacity: 0.12 }).addTo(map)
      } else if (ls.geo) { ls.geo.remove(); ls.geo = undefined }
    } else {
      if (ls.dest) { ls.dest.remove(); ls.dest = undefined }
      if (ls.geo) { ls.geo.remove(); ls.geo = undefined }
    }

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
        if (truck && dest) map.fitBounds(L.latLngBounds([[truck.lat, truck.lng], [dest.lat, dest.lng]]).pad(0.45), { maxZoom: 16 })
        else if (truck) map.setView([truck.lat, truck.lng], 15)
      }
    }
  }, [truck?.lat, truck?.lng, truck?.course, dest?.lat, dest?.lng, geofenceM, lane, destKind, stateColor, route])

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
