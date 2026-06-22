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

// Our OWN high-detail site ortho-imagery is the cab map's ONLY basemap — the
// SAME tiles the FMS site map uses, served through the cab's mobile-auth route
// (/api/dispatch/site-tile). MapLibre fills {z}/{x}/{y}; the backend cache
// (Docker volume) is shared with the manager web map. Where there is no ortho
// tile (outside the imaged area / above z18) the dark background shows through.
// The active endpoint is resolved at map-init; the Bearer token is attached
// via transformRequest.
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

// One FeatureCollection holding the concentric MOVING geofence rings (Discovery
// /Waiting/Loading) centred on the shovel, each tagged with its own colour so a
// single data-driven line/fill layer renders all of them. Largest first so the
// inner rings draw on top.
function ringsFC(lng: number, lat: number, rings: { radiusM: number; color: string }[]): FC {
  const sorted = [...rings].sort((a, b) => b.radiusM - a.radiusM)
  return {
    type: 'FeatureCollection',
    features: sorted.map((r) => {
      const poly = circlePolygon(lng, lat, r.radiusM)
      const f = poly.features[0] as GeoJSON.Feature
      f.properties = { color: r.color }
      return f
    }),
  }
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

// A small filled arrowhead pointing UP (north in image space). MapLibre's
// `symbol-placement:'line'` rotates it to the line's forward tangent, so on a
// lane/route line drawn in TRAVEL order it ends up pointing the mandated flow
// (arrow) direction. One icon per colour: loaded / empty / generic route / the
// faint background haul-lane arrow. Returned as ImageData for map.addImage().
function arrowIcon(color: string, size = 20): ImageData {
  const c = document.createElement('canvas'); c.width = size; c.height = size
  const x = c.getContext('2d') as CanvasRenderingContext2D
  x.clearRect(0, 0, size, size)
  x.fillStyle = color
  x.strokeStyle = 'rgba(0,0,0,0.55)'
  x.lineWidth = 1.6
  x.lineJoin = 'round'
  x.beginPath()
  x.moveTo(size / 2, 2)                 // tip (top centre = forward)
  x.lineTo(size - 3, size - 3)          // bottom-right barb
  x.lineTo(size / 2, size * 0.64)       // tail notch
  x.lineTo(3, size - 3)                 // bottom-left barb
  x.closePath()
  x.fill(); x.stroke()
  return x.getImageData(0, 0, size, size)
}

// A labelled flag for the FIXED assigned loading area (its own coordinates),
// shown next to the live shovel marker on the empty leg.
function loadFlagEl(label: string): HTMLDivElement {
  const el = document.createElement('div')
  const safe = label.replace(/</g, '&lt;')
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;'
  el.innerHTML =
    `<div style="background:#15803D;color:#fff;font:700 10px/1 -apple-system,sans-serif;padding:3px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.6);border:1px solid #22C55E">${safe}</div>` +
    `<div style="width:2px;height:14px;background:#22C55E"></div>` +
    `<div style="width:12px;height:12px;border-radius:50%;background:#22C55E;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.6);margin-top:-1px"></div>`
  return el
}

function NavMap(props: DispatchMapProps) {
  const { height = 260 } = props
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehRef = useRef<maplibregl.Marker | null>(null)
  const destMkRef = useRef<maplibregl.Marker | null>(null)
  const loadMkRef = useRef<maplibregl.Marker | null>(null)
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
          sources: {},
          // No global satellite basemap — the cab map shows ONLY our own site
          // ortho imagery (added on 'load' below) over a dark backdrop, matching
          // the FMS site map. Where there's no ortho tile the dark background
          // shows instead of generic Esri satellite.
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0e14' } }],
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
      // Our OWN site ortho imagery is the ONLY basemap (added FIRST so the haul
      // lanes / route / markers below all draw on top of it). Same look as the
      // FMS site map. Only added when we have an endpoint; missing tiles 404
      // quietly (transformRequest + the map 'error' swallow) and the dark
      // background shows through (no global satellite).
      if (siteTilesUrl) {
        try {
          map.addSource('ortho', {
            type: 'raster', tiles: [siteTilesUrl], tileSize: 256,
            minzoom: SITE_TILES_MINZOOM, maxzoom: SITE_TILES_MAXZOOM,
          } as maplibregl.RasterSourceSpecification)
          map.addLayer({
            id: 'ortho', type: 'raster', source: 'ortho',
            paint: { 'raster-opacity': 1 },
          })
        } catch { /* raster overlay unsupported — dark background only */ }
      }
      map.addSource('lanes', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'lanes-line', type: 'line', source: 'lanes',
        paint: { 'line-color': ['match', ['get', 'loaded_side'], 'left', '#38BDF8', 'right', '#38BDF8', '#94A3B8'], 'line-width': 2, 'line-opacity': 0.5 } })
      // Register the flow-direction arrowheads ONCE, then a symbol layer repeats
      // them along every haul lane. Lane features come from the server already
      // drawn in TRAVEL order, so `symbol-placement:'line'` points each arrow the
      // mandated flow (one-way arrow) direction — the driver always sees which way
      // a lane runs, never a wrong-way hint.
      try {
        if (!map.hasImage('arrow-lane')) map.addImage('arrow-lane', arrowIcon('#cbd5e1'), { pixelRatio: 2 })
        if (!map.hasImage('arrow-loaded')) map.addImage('arrow-loaded', arrowIcon('#fb923c'), { pixelRatio: 2 })
        if (!map.hasImage('arrow-empty')) map.addImage('arrow-empty', arrowIcon('#4ade80'), { pixelRatio: 2 })
        if (!map.hasImage('arrow-route')) map.addImage('arrow-route', arrowIcon('#ffffff'), { pixelRatio: 2 })
      } catch { /* addImage unsupported — lines still render without arrows */ }
      map.addLayer({ id: 'lanes-arrows', type: 'symbol', source: 'lanes',
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 90,
          'icon-image': 'arrow-lane', 'icon-size': 0.5,
          'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 0.55 } })
      map.addSource('geo', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'geo-fill', type: 'fill', source: 'geo', paint: { 'fill-color': '#A16207', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'geo-line', type: 'line', source: 'geo', paint: { 'line-color': '#A16207', 'line-width': 2 } })
      // Moving multi-ring geofences (Discovery/Waiting/Loading) — colour per
      // feature so one fill + one line layer renders all rings around the shovel.
      map.addSource('rings', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'rings-fill', type: 'fill', source: 'rings', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 } })
      map.addLayer({ id: 'rings-line', type: 'line', source: 'rings', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.9 } })
      map.addSource('route', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'route-cap', type: 'line', source: 'route', paint: { 'line-color': '#0b1220', 'line-width': 9, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': ['match', ['get', 'lane'], 'empty', '#15803d', 'loaded', '#c2410c', 'route', '#f59e0b', '#c2410c'], 'line-width': 5.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      // Direction arrows ALONG the active route — segments arrive in travel order
      // so the arrows confirm the driver is being sent the right way down each
      // (one-way) lane. Coloured per lane type to match the route line.
      map.addLayer({ id: 'route-arrows', type: 'symbol', source: 'route',
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 70,
          'icon-image': ['match', ['get', 'lane'], 'empty', 'arrow-empty', 'loaded', 'arrow-loaded', 'arrow-route'],
          'icon-size': 0.7, 'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 0.95 } })
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
    const { truck, dest, loadingDest, loadingLabel, geofenceM, route, routeSegments, roads, rings, destKind = 'dump', stateColor = '#38BDF8' } = propsRef.current

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
    // Moving geofence rings (Discovery/Waiting/Loading) follow the shovel. When
    // present they REPLACE the single dump/loading circle (geo source emptied).
    const haveRings = !!(rings && rings.length && dest)
    ;(map.getSource('rings') as maplibregl.GeoJSONSource | undefined)?.setData(
      haveRings ? ringsFC(dest!.lng, dest!.lat, rings!) : EMPTY)
    ;(map.getSource('geo') as maplibregl.GeoJSONSource | undefined)?.setData(
      (!haveRings && dest && geofenceM) ? circlePolygon(dest.lng, dest.lat, geofenceM) : EMPTY)

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

    // FIXED loading-area flag (planned named location), shown alongside the live
    // shovel `dest` on the empty leg only. Recreated when the label changes so
    // the flag text stays correct.
    if (loadingDest && destKind === 'loading' && isFinite(loadingDest.lat) && isFinite(loadingDest.lng)) {
      const lbl = loadingLabel || 'Loading'
      if (loadMkRef.current && loadMkRef.current.getElement().dataset.lbl !== lbl) {
        loadMkRef.current.remove(); loadMkRef.current = null
      }
      if (!loadMkRef.current) {
        const el = loadFlagEl(lbl); el.dataset.lbl = lbl
        loadMkRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([loadingDest.lng, loadingDest.lat]).addTo(map)
      } else {
        loadMkRef.current.setLngLat([loadingDest.lng, loadingDest.lat])
      }
    } else if (loadMkRef.current) { loadMkRef.current.remove(); loadMkRef.current = null }

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
          if (loadingDest && destKind === 'loading') b.extend([loadingDest.lng, loadingDest.lat])
          map.fitBounds(b, { padding: 60, pitch: 0, bearing: 0, maxZoom: 16, duration: 600 })
        } else if (truck) {
          map.easeTo({ center: [truck.lng, truck.lat], zoom: 15, pitch: 0, bearing: 0, duration: 600 })
        }
      }
    }
  }, [ready, props.truck?.lat, props.truck?.lng, props.truck?.course, props.dest?.lat, props.dest?.lng,
      props.loadingDest?.lat, props.loadingDest?.lng, props.loadingLabel,
      props.geofenceM, props.destKind, props.stateColor, props.route, props.routeSegments, props.roads, props.rings])

  if (glFailed) return <DispatchMap {...props} />

  return (
    <div ref={elRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#0b0f17', border: '1px solid #2a2a2a' }} />
  )
}

const MemoNavMap = memo(NavMap)
export { MemoNavMap as NavMap }
export default MemoNavMap
