// Driver-view navigation map (MapLibre GL) for the dump-truck OUI. Same props
// as DispatchMap so it drops straight into the OUI. When a route is present it
// enters NAV mode — the camera follows the truck, pitched ~60° and rotated to
// the heading (heading-up, road-in-front, like Google Maps driving view).
// Draws: the "road ahead" route line, the haul lanes (loaded/empty), the
// destination geofence + marker, and the heading-aware vehicle marker, over a
// satellite raster basemap. Falls back to the Leaflet DispatchMap if WebGL is
// unavailable.
import { useEffect, useRef, useState, memo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import DispatchMap from './DispatchMap'
import type { DispatchMapProps } from './DispatchMap'
import connectionManager from '../services/connectionManager'
import { getStoredToken } from '../services/api'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
// Our OWN high-detail site ortho-imagery, draped on top of the global satellite
// basemap — the SAME tiles the FMS site map uses, but served through the cab's
// mobile-auth route (/api/dispatch/site-tile). MapLibre fills {z}/{x}/{y}; the
// backend cache (Docker volume) is shared with the manager web map. Where there
// is no ortho tile (outside the imaged area / above z18) the satellite shows
// through, exactly like the FMS map. The {base} placeholder is swapped for the
// active endpoint at map-init; the Bearer token is attached via transformRequest.
const SITE_TILE_PATH = '/api/dispatch/site-tile/{z}/{x}_{y}.webp'
const SITE_TILES_MINZOOM = 12
const SITE_TILES_MAXZOOM = 18

type FC = GeoJSON.FeatureCollection
const EMPTY: FC = { type: 'FeatureCollection', features: [] }

function circlePolygon(lng: number, lat: number, radiusM: number, n = 48): FC {
  const ring: [number, number][] = []
  const dLat = radiusM / 111320
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)])
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] }
}

function vehicleEl(color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'width:30px;height:30px;display:flex;align-items:center;justify-content:center;'
  el.innerHTML = `<i style="display:block;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;` +
    `border-bottom:22px solid ${color};filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));"></i>`
  return el
}
function destEl(color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6);`
  return el
}

function NavMap(props: DispatchMapProps) {
  const { height = 260 } = props
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehRef = useRef<maplibregl.Marker | null>(null)
  const destMkRef = useRef<maplibregl.Marker | null>(null)
  const propsRef = useRef(props); propsRef.current = props
  const fittedRef = useRef('')
  const [ready, setReady] = useState(false)
  const [glFailed, setGlFailed] = useState(false)

  // init once
  useEffect(() => {
    if (!elRef.current || mapRef.current || glFailed) return
    // Resolve the active backend once at init: the ortho site tiles are served
    // by OUR server (cab mobile-auth), so the tile URL must point at whichever
    // endpoint Diagnostics picked (LAN or cloud tunnel). transformRequest then
    // attaches the Bearer token to every site-tile fetch (raster sources can't
    // carry an Authorization header on their own).
    const apiBase = (connectionManager.getActiveEndpoint() || '').replace(/\/$/, '')
    const siteTilesUrl = apiBase ? apiBase + SITE_TILE_PATH : ''
    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: elRef.current,
        style: {
          version: 8,
          sources: { sat: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19 } },
          layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
        },
        center: [128.0208, 0.6510], zoom: 14, pitch: 0, bearing: 0,
        attributionControl: false,
        interactive: false,   // locked: no finger pan/zoom/rotate — camera follows the truck only
        transformRequest: (url) => {
          // Only our own site-tile route needs the auth header; leave the public
          // Esri/terrain CDNs untouched (a stray header there can break caching).
          if (siteTilesUrl && url.indexOf('/api/dispatch/site-tile/') !== -1) {
            const token = getStoredToken()
            return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url }
          }
          return { url }
        },
      })
    } catch {
      setGlFailed(true); return
    }
    mapRef.current = map
    map.on('error', () => { /* swallow tile/style errors — keep the map alive */ })
    map.on('load', () => {
      // Our OWN site ortho imagery, draped directly over the satellite basemap
      // (added FIRST so the haul lanes / route / markers below all draw on top of
      // it). Same look as the FMS site map. Only added when we have an endpoint;
      // missing tiles 404 quietly (transformRequest + the map 'error' swallow) and
      // the satellite shows through. Visibility is toggled by the siteImagery prop.
      if (siteTilesUrl) {
        try {
          map.addSource('ortho', {
            type: 'raster', tiles: [siteTilesUrl], tileSize: 256,
            minzoom: SITE_TILES_MINZOOM, maxzoom: SITE_TILES_MAXZOOM,
          } as maplibregl.RasterSourceSpecification)
          map.addLayer({
            id: 'ortho', type: 'raster', source: 'ortho',
            layout: { visibility: (propsRef.current.siteImagery !== false) ? 'visible' : 'none' },
            paint: { 'raster-opacity': 1 },
          })
        } catch { /* raster overlay unsupported — stays on plain satellite */ }
      }
      map.addSource('lanes', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'lanes-line', type: 'line', source: 'lanes',
        paint: { 'line-color': ['match', ['get', 'loaded_side'], 'left', '#38BDF8', 'right', '#38BDF8', '#94A3B8'], 'line-width': 2, 'line-opacity': 0.5 } })
      map.addSource('geo', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'geo-fill', type: 'fill', source: 'geo', paint: { 'fill-color': '#A16207', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'geo-line', type: 'line', source: 'geo', paint: { 'line-color': '#A16207', 'line-width': 2 } })
      map.addSource('route', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'route-cap', type: 'line', source: 'route', paint: { 'line-color': '#0b1220', 'line-width': 9, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': ['match', ['get', 'lane'], 'empty', '#15803d', 'loaded', '#c2410c', 'route', '#f59e0b', '#c2410c'], 'line-width': 5.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      setReady(true)
      setTimeout(() => { try { map.resize() } catch { /* */ } }, 200)
    })
    return () => { try { map.remove() } catch { /* */ }; mapRef.current = null; setReady(false) }
  }, [glFailed])

  // Notify parent when visibility changes so the map can resize if it was hidden.
  const wasVisible = useRef(true)
  useEffect(() => {
    const visible = (props.visible !== false)
    if (visible && !wasVisible.current && mapRef.current) {
      try { mapRef.current.resize() } catch { /* */ }
    }
    wasVisible.current = visible
  }, [props.visible])

  // keep the canvas sized to its (flex) container
  useEffect(() => {
    if (!ready || !mapRef.current || !elRef.current) return
    const ro = new ResizeObserver(() => { try { mapRef.current?.resize() } catch { /* */ } })
    ro.observe(elRef.current)
    return () => ro.disconnect()
  }, [ready])

  // push data + drive the camera whenever inputs change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const { truck, dest, geofenceM, route, routeSegments, roads, destKind = 'dump', stateColor = '#38BDF8', siteImagery = true } = propsRef.current

    // Site ortho imagery: show/hide our own high-detail tiles over the satellite
    // basemap (the FMS-site-map look). Toggled live without re-creating the map.
    try {
      if (map.getLayer('ortho')) {
        map.setLayoutProperty('ortho', 'visibility', siteImagery ? 'visible' : 'none')
      }
    } catch { /* ortho layer absent (no endpoint / GPU) — ignore */ }

    // Route source: prefer the curated loaded/empty LANE segments (each tagged
    // `lane` → coloured by the line layer); else the plain fallback line.
    const routeData: FC | GeoJSON.Feature = (routeSegments && routeSegments.length)
      ? { type: 'FeatureCollection', features: routeSegments.filter((s) => (s.coordinates || []).length >= 2)
          .map((s) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.coordinates }, properties: { lane: s.lane } } as GeoJSON.Feature)) }
      : (route && route.length >= 2
          ? { type: 'Feature', geometry: { type: 'LineString', coordinates: route.map((p) => [p[1], p[0]]) }, properties: {} } as GeoJSON.Feature
          : EMPTY)
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(routeData)
    ;(map.getSource('lanes') as maplibregl.GeoJSONSource | undefined)?.setData((roads as FC) || EMPTY)
    ;(map.getSource('geo') as maplibregl.GeoJSONSource | undefined)?.setData(
      dest && geofenceM ? circlePolygon(dest.lng, dest.lat, geofenceM) : EMPTY)

    const dc = destKind === 'loading' ? '#22C55E' : '#A16207'
    if (map.getLayer('geo-fill')) map.setPaintProperty('geo-fill', 'fill-color', dc)
    if (map.getLayer('geo-line')) map.setPaintProperty('geo-line', 'line-color', dc)

    // vehicle marker (heading-aware)
    if (truck && isFinite(truck.lat) && isFinite(truck.lng)) {
      if (!vehRef.current) vehRef.current = new maplibregl.Marker({ element: vehicleEl(stateColor), rotationAlignment: 'map' }).setLngLat([truck.lng, truck.lat]).addTo(map)
      else {
        vehRef.current.setLngLat([truck.lng, truck.lat])
        const tri = vehRef.current.getElement().querySelector('i') as HTMLElement | null
        if (tri) tri.style.borderBottomColor = stateColor
      }
      vehRef.current.setRotation(truck.course ?? 0)
    } else if (vehRef.current) { vehRef.current.remove(); vehRef.current = null }

    // destination marker
    if (dest && isFinite(dest.lat) && isFinite(dest.lng)) {
      if (!destMkRef.current) destMkRef.current = new maplibregl.Marker({ element: destEl(dc) }).setLngLat([dest.lng, dest.lat]).addTo(map)
      else { destMkRef.current.setLngLat([dest.lng, dest.lat]); (destMkRef.current.getElement() as HTMLElement).style.background = dc }
    } else if (destMkRef.current) { destMkRef.current.remove(); destMkRef.current = null }

    // camera: NAV mode follows the truck (pitched + heading-up, road-in-front);
    // otherwise fit once to show the truck + destination overview (flat).
    const navMode = !!(((routeSegments && routeSegments.length) || (route && route.length >= 2)) && truck)
    if (navMode && truck) {
      map.easeTo({ center: [truck.lng, truck.lat], bearing: truck.course ?? map.getBearing(),
        pitch: 60, zoom: Math.max(map.getZoom(), 16.5), duration: 800, essential: true })
    } else {
      const key = (dest ? `${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}` : (truck ? 't' : ''))
      if (key && key !== fittedRef.current) {
        fittedRef.current = key
        if (truck && dest) {
          const b = new maplibregl.LngLatBounds([truck.lng, truck.lat], [truck.lng, truck.lat])
          b.extend([dest.lng, dest.lat])
          map.fitBounds(b, { padding: 60, pitch: 0, bearing: 0, maxZoom: 16, duration: 600 })
        } else if (truck) {
          map.easeTo({ center: [truck.lng, truck.lat], zoom: 15, pitch: 0, bearing: 0, duration: 600 })
        }
      }
    }
  }, [ready, props.truck?.lat, props.truck?.lng, props.truck?.course, props.dest?.lat, props.dest?.lng,
      props.geofenceM, props.destKind, props.stateColor, props.route, props.routeSegments, props.roads, props.siteImagery])

  if (glFailed) return <DispatchMap {...props} />

  return (
    <div ref={elRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#0b0f17', border: '1px solid #2a2a2a' }} />
  )
}

const MemoNavMap = memo(NavMap)
export { MemoNavMap as NavMap }
export default MemoNavMap
