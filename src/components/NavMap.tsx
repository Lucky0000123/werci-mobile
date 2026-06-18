// Driver-view navigation map (MapLibre GL) for the dump-truck OUI. Same props
// as DispatchMap so it drops straight into the OUI. When a route is present it
// enters NAV mode — the camera follows the truck, pitched ~60° and rotated to
// the heading (heading-up, road-in-front, like Google Maps driving view).
// Draws: the "road ahead" route line, the haul lanes (loaded/empty), the
// destination geofence + marker, and the heading-aware vehicle marker, over a
// satellite raster basemap. Falls back to the Leaflet DispatchMap if WebGL is
// unavailable.
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import DispatchMap from './DispatchMap'
import type { DispatchMapProps } from './DispatchMap'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

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

export default function NavMap(props: DispatchMapProps) {
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
      })
    } catch {
      setGlFailed(true); return
    }
    mapRef.current = map
    map.on('error', () => { /* swallow tile/style errors — keep the map alive */ })
    map.on('load', () => {
      map.addSource('lanes', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'lanes-line', type: 'line', source: 'lanes',
        paint: { 'line-color': ['match', ['get', 'loaded_side'], 'left', '#38BDF8', 'right', '#38BDF8', '#94A3B8'], 'line-width': 2, 'line-opacity': 0.5 } })
      map.addSource('geo', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'geo-fill', type: 'fill', source: 'geo', paint: { 'fill-color': '#A16207', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'geo-line', type: 'line', source: 'geo', paint: { 'line-color': '#A16207', 'line-width': 2 } })
      map.addSource('route', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'route-cap', type: 'line', source: 'route', paint: { 'line-color': '#1f2937', 'line-width': 8, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': ['match', ['get', 'lane'], 'empty', '#22c55e', 'loaded', '#8b5cf6', 'route', '#eab308', '#8b5cf6'], 'line-width': 4.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      setReady(true)
      setTimeout(() => { try { map.resize() } catch { /* */ } }, 200)
    })
    return () => { try { map.remove() } catch { /* */ }; mapRef.current = null; setReady(false) }
  }, [glFailed])

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
    const { truck, dest, geofenceM, route, routeSegments, roads, destKind = 'dump', stateColor = '#38BDF8' } = propsRef.current

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

    // camera: NAV mode follows the truck (pitched + heading-up); otherwise fit once.
    const navMode = !!(((routeSegments && routeSegments.length) || (route && route.length >= 2)) && truck)
    if (navMode && truck) {
      map.easeTo({ center: [truck.lng, truck.lat], bearing: truck.course ?? map.getBearing(),
        pitch: 60, zoom: Math.max(map.getZoom(), 16.5), duration: 800, essential: true })
    } else {
      const key = dest ? `${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}` : (truck ? 't' : '')
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
      props.geofenceM, props.destKind, props.stateColor, props.route, props.routeSegments, props.roads])

  if (glFailed) return <DispatchMap {...props} />

  return (
    <div ref={elRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', background: '#0b0f17', border: '1px solid #2a2a2a' }} />
  )
}
