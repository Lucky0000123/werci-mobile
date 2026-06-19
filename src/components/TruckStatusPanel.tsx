// Status view for the dump-truck driver OUI.
// Shows the haul-cycle wheel art with the truck's CURRENT stage highlighted.
// Wheel image + wedge geometry are the FMS prototype's source of truth
// (Cycle_Update.png + cycleImageOverlay). Inline styles only; one bundled
// image, no heavy libraries. Falls back to a clean text card if the art
// can't load.
import { memo, useState, useRef, useLayoutEffect } from 'react'
import cycleImg from '../assets/Cycle_Update.png'

const D = {
  bg: '#0b0f17',
  panel: '#141414',
  panel2: '#101010',
  line: '#2a2a2a',
  line2: '#3a3a3a',
  ink: '#ffffff',
  sub: '#9ca3af',
  sub2: '#d6d6d6',
  accent: '#38BDF8',
}

export type Assignment = {
  truck_no: string
  driver_name?: string | null
  excavator_no?: string | null
  loading_location_name?: string | null
  dump_location_name?: string | null
  plan_id?: number | null
  shift?: string | null
  plan_date?: string | null
  next_location_name?: string | null
  connected?: boolean
  live?: boolean
  time_in_state_s?: number | null
}

export type StatusState = {
  state?: string | null
  state_label?: string | null
  state_color?: string | null
  next_state?: string | null
  next_label?: string | null
  next_color?: string | null
  manual_status?: { status: string; reason?: string; label?: string; color?: string } | null
}

type Props = {
  status: StatusState
  assignment: Assignment
}

// ── haul-cycle wheel: 8 segments (clockwise from top) on Cycle_Update.png ───
type Segment =
  | 'QUEUE_SPOT' | 'LOADING' | 'FULL_TRAVEL' | 'FULL_WEIGHBRIDGE'
  | 'SAMPLING' | 'DUMPING' | 'EMPTY_TRAVEL' | 'EMPTY_WEIGHBRIDGE'

const SEGMENT_LABEL: Record<Segment, string> = {
  QUEUE_SPOT: 'Queue / Spot',
  LOADING: 'Loading',
  FULL_TRAVEL: 'Full Travel',
  FULL_WEIGHBRIDGE: 'Full Weighbridge',
  SAMPLING: 'Sampling',
  DUMPING: 'Dumping',
  EMPTY_TRAVEL: 'Empty Travel',
  EMPTY_WEIGHBRIDGE: 'Empty Weighbridge',
}

type WedgeSpec = { startDeg: number; endDeg: number; innerR: number; outerR: number }

// Per-stage wedge angles (deg from top, clockwise), calibrated 1:1 to the art.
const OVERLAY: Record<Segment, WedgeSpec> = {
  QUEUE_SPOT:        { startDeg: -19.5, endDeg: 19.5,  innerR: 21.2, outerR: 45.7 },
  LOADING:           { startDeg: 25,    endDeg: 65,    innerR: 21.2, outerR: 45.8 },
  FULL_TRAVEL:       { startDeg: 70,    endDeg: 110.5, innerR: 21.2, outerR: 45.9 },
  FULL_WEIGHBRIDGE:  { startDeg: 115,   endDeg: 155.5, innerR: 21.2, outerR: 45.9 },
  SAMPLING:          { startDeg: 160,   endDeg: 200,   innerR: 21.2, outerR: 45.8 },
  DUMPING:           { startDeg: 204.5, endDeg: 245,   innerR: 21.2, outerR: 45.9 },
  EMPTY_TRAVEL:      { startDeg: 249.5, endDeg: 290.5, innerR: 21.2, outerR: 45.8 },
  EMPTY_WEIGHBRIDGE: { startDeg: 295,   endDeg: 335.5, innerR: 21.2, outerR: 45.8 },
}

const ACTIVE_OVERLAY_COLOR = '#7EC8FF'
const ACTIVE_OPACITY = 0.34
// Centre-hub diameter as % of image (matches the wheel's white inner hole).
const CENTER_PCT = 21.2 * 2 * 0.97

function polar(r: number, degFromTop: number) {
  const rad = ((degFromTop - 90) * Math.PI) / 180
  return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) }
}

function wedgePath(s: WedgeSpec): string {
  const o1 = polar(s.outerR, s.startDeg)
  const o2 = polar(s.outerR, s.endDeg)
  const i2 = polar(s.innerR, s.endDeg)
  const i1 = polar(s.innerR, s.startDeg)
  const large = s.endDeg - s.startDeg > 180 ? 1 : 0
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${s.outerR} ${s.outerR} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i2.x} ${i2.y}`,
    `A ${s.innerR} ${s.innerR} 0 ${large} 0 ${i1.x} ${i1.y}`,
    'Z',
  ].join(' ')
}

// Collapse the 12 operator cycle states onto the 8 wheel segments.
function stateToSegment(state?: string | null): Segment | null {
  switch (state) {
    case 'spot':
    case 'waiting': return 'QUEUE_SPOT'
    case 'loading': return 'LOADING'
    case 'fullTravel1':
    case 'fullTravel2':
    case 'fullTravel3': return 'FULL_TRAVEL'
    case 'fullWB': return 'FULL_WEIGHBRIDGE'
    case 'sampling': return 'SAMPLING'
    case 'dumping': return 'DUMPING'
    case 'emptyTravel1':
    case 'emptyTravel2': return 'EMPTY_TRAVEL'
    case 'emptyWB': return 'EMPTY_WEIGHBRIDGE'
    default: return null
  }
}

function colorWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return `rgba(56, 189, 248, ${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── main panel ─────────────────────────────────────────────────────────────
function TruckStatusPanelImpl({ status, assignment }: Props) {
  const [imgOk, setImgOk] = useState(true)
  // Measure the box so the wheel renders as a TRUE square that fits inside it
  // (the box the map uses is rarely square — never stretch the art).
  const boxRef = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState(0)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = (w: number, h: number) => setSide(Math.max(0, Math.floor(Math.min(w, h))))
    // Measure synchronously before first paint (no one-frame stretch).
    const r0 = el.getBoundingClientRect()
    measure(r0.width, r0.height)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) measure(r.width, r.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const segment = stateToSegment(status.state)
  const stateColor = status.state_color || D.accent
  const curLabel = status.state_label || (segment ? SEGMENT_LABEL[segment] : status.state) || '—'
  const nextLabel = status.next_label || status.next_state || '—'
  const nextLoc = assignment.next_location_name || '—'

  // Safe fallback: if the wheel art can't load, still show the current stage.
  if (!imgOk) {
    return (
      <div ref={boxRef} style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
        <div style={{ width: '100%', maxWidth: 360, background: D.panel, border: `1px solid ${stateColor}55`, borderRadius: 16, padding: 18, textAlign: 'center' }}>
          <div style={{ color: D.sub, fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em' }}>CURRENT STATE</div>
          <div style={{ color: stateColor, fontSize: '1.7rem', fontWeight: 900, lineHeight: 1.1, marginTop: 4 }}>{curLabel.toUpperCase()}</div>
          <div style={{ color: D.sub2, fontSize: '0.82rem', marginTop: 12 }}>Next: <b style={{ color: D.ink }}>{nextLabel.toUpperCase()}</b></div>
          <div style={{ color: D.sub, fontSize: '0.78rem', marginTop: 2 }}>→ {nextLoc}</div>
        </div>
      </div>
    )
  }

  return (
    <div ref={boxRef} style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: side ? side : '100%', height: side ? side : '100%', background: '#fff', borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
        <img
          src={cycleImg}
          alt="Haul cycle status"
          onError={() => setImgOk(false)}
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />

        {/* Active-stage highlight */}
        {segment && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
               style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden>
            <path d={wedgePath(OVERLAY[segment])} fill={ACTIVE_OVERLAY_COLOR} fillOpacity={ACTIVE_OPACITY} />
          </svg>
        )}

        {/* Centre hub — sits inside the wheel's white hole */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{
            width: `${CENTER_PCT}%`, height: `${CENTER_PCT}%`, borderRadius: '50%',
            background: colorWithAlpha(stateColor, 0.2), border: `1px solid ${colorWithAlpha(stateColor, 0.4)}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', padding: '5%', boxSizing: 'border-box', overflow: 'hidden',
          }}>
            <div style={{ fontSize: '0.4rem', fontWeight: 900, letterSpacing: '0.12em', color: '#2563EB' }}>CURRENT STATE</div>
            <div style={{ fontSize: '0.75rem', fontWeight: 900, lineHeight: 1.05, marginTop: 1, textTransform: 'uppercase', color: '#111827' }}>{curLabel}</div>
            <div style={{ width: '70%', height: 1, background: '#E5E7EB', margin: '4px 0' }} />
            <div style={{ fontSize: '0.36rem', fontWeight: 900, letterSpacing: '0.1em', color: '#6B7280' }}>NEXT STATE</div>
            <div style={{ fontSize: '0.48rem', fontWeight: 700, lineHeight: 1.05, color: '#374151', textTransform: 'uppercase' }}>{nextLabel}</div>
            <div style={{ fontSize: '0.36rem', fontWeight: 900, letterSpacing: '0.1em', color: '#6B7280', marginTop: 3 }}>NEXT LOCATION</div>
            <div style={{ fontSize: '0.54rem', fontWeight: 900, lineHeight: 1.05, color: '#111827', textTransform: 'uppercase' }}>{nextLoc}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const TruckStatusPanel = memo(TruckStatusPanelImpl)
export default TruckStatusPanel


