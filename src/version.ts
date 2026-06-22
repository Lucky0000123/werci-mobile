/**
 * Single source of truth for the PRISM mobile app version.
 *
 * Bump on EVERY new APK build:
 *  - feature batch  → minor (2.3.0 → 2.4.0)
 *  - small fix      → patch (2.3.0 → 2.3.1)
 * Keep android/app/build.gradle in sync: versionName = this string,
 * versionCode = numeric (e.g. 2.3.0 → 230).
 *
 * 2.48.0 — Cab top-bar + map decluttered to ICONS, not sentences. (1) The
 *          connect advisories that used to spell out a full line each ("Not on
 *          KIMPER for this equipment", "Unit currently offline in GPS", ...) now
 *          collapse to ONE small colour-coded icon cluster (KIMPER licence 🪪,
 *          live-feed 📡, pairing 🔗, type mismatch ⚠) deduped by family; tap it
 *          to reveal the full wording in a compact popover. Red dominates amber.
 *          (2) New GPS-source map badge: a small glyph (not a text line) shows
 *          where the truck position comes from -- 📡 the unit's onboard
 *          equipment/TMS GPS, 📱 this tablet's own GPS, ⌛ a stale last-known fix
 *          -- tap to reveal the label (Equipment GPS / Tablet GPS, en/id/zh).
 * 2.47.0 — Connect reliability. The identify, resolve-unit and connect calls now
 *          use a 45s timeout (was the default 15s). During a concurrent server
 *          workforce sync (/people/delta) the connect can take ~30-40s; the old
 *          15s timeout aborted it and showed a false "could not reach the server"
 *          even though the pairing actually succeeded. These are one-time user
 *          actions, so waiting beats a false error.
 * 2.46.0 — App-only equipment polish + web visibility. (1) The connect dropdown
 *          now colour-codes each fleet family — excavator (teal), dump truck
 *          (blue), app-only ancillary gear (amber) — and the Equipment OUI header
 *          uses that family colour. (2) The manager web site map now badges OUI
 *          support equipment (🛠) and shows the operator's live manual status +
 *          reason in the marker popup (backend overlay now carries
 *          support_equipment + status + status_reason on the OUI feed row).
 * 2.45.0 — App-only equipment sign-on. Ancillary/support units (grader, dozer,
 *          compactor, loader, light vehicle, ...) have NO onboard TMS/GPS, so
 *          they only exist in the FMS while an operator is signed on through the
 *          OUI. The connect dropdown now offers these types and routes them to a
 *          new lightweight /api/dispatch/connect-equipment session; the operator
 *          gets a dedicated EQUIPMENT OUI whose whole job is to set/change the
 *          manual status (delay/standby/breakdown/maintenance) with an always-
 *          reachable "Return to Operating". The unit appears on the live map via
 *          the existing OUI GPS overlay. Status persists to the same
 *          PRISM_EQUIPMENT_STATUS_EVENTS used by trucks/excavators.
 *          Also in 2.45.0: the cab map shows the assigned loading-location flag
 *          beside the live shovel.
 * 2.44.0 — In-cab OUI speed pass. (1) MapLibre GL + Leaflet (~966 KB, ~92% of
 *          the dispatch screen's JS) are now LAZY-loaded only when a connected
 *          truck driver opens the MAP view — the FMS sign-on, employee card and
 *          excavator OUI (no map) no longer parse the map engines at all. The
 *          in-cab entry chunk drops from ~285 KB to ~18 KB gzip. (2) All in-cab
 *          polls (operator-view, GPS, outbox, telemetry, route, excavator queue)
 *          now PAUSE while the app is backgrounded and catch up on resume, so a
 *          parked/asleep cab tablet stops waking the radio/CPU every few seconds.
 *          (3) The dispatch translator is memoized so the hot panels stop
 *          re-rendering on every poll tick.
 * 2.43.0 — OUI field-test fixes. (1) Truck OUI: after a manual non-operating
 *          status (breakdown/standby/delay/maintenance) the only way back to the
 *          cycle was unreachable; added a direct "Return to Operating" button in
 *          the status banner. (2) Multi-tablet GPS: several cab tablets share one
 *          login account, so the in-cab now tags every GPS post with the
 *          CONNECTED employee_id + unit_no (locationShare.setConnectedScope) so
 *          each tablet keeps its own map position instead of colliding on one
 *          shared account slot (pairs with the web v29 employee-scoped position
 *          keying). Header reads "WBN FMS".
 * 2.42.0 — In-cab OUI header re-branded from "PRISM FMS" to "WBN FMS". (Pairs
 *          with the web v27 KIMPER licence gate: NO_KIMPER / EXPIRED / NO_DATE
 *          now hard-block a pairing server-side, so this APK already enforces it.)
 * 2.41.0 — In-cab OUI fits one frame + language on every OUI screen. (1) The
 *          in-cab top bar (shared by BOTH the excavator and truck OUI) now
 *          carries the 🇮🇩/🇬🇧/🇨🇳 language switcher, so language is changeable
 *          from every operator screen, not just sign-on. (2) Truck OUI no longer
 *          clips the Assignment grid: the in-cab wrapper respects the bottom
 *          safe-area inset (Android nav bar) and the Assignment tiles now shrink
 *          to fit (gridAutoRows minmax(0,1fr) + denser MiniTile), so all 8 tiles
 *          stay on one frame on the 1280×800 cab tablet. (3) Excavator "waiting"
 *          state reads "Waiting" (was "Ready / Operating").
 * 2.40.0 — Language selector on EVERY entry screen + Assignment polish. The
 *          Mode-selection AND Login screens now carry a language selector
 *          (Indonesia / English / 中文) — combined with the existing in-app
 *          header + Dispatch switchers, the language can be changed on any
 *          screen. The truck OUI Assignment grid is realigned into a clean,
 *          equal-height 4×2 tile layout (uniform MiniTile sizing) — no more
 *          mismatched/odd-row blocks.
 * 2.39.0 — Truck OUI polish. (1) Operator-action box accent now follows the
 *          CURRENT cycle-status colour. (2) Status change consolidated to one
 *          "Request Status Change" button (removed the duplicate Machine
 *          Availability box); the picker is redesigned — professional colour-
 *          coded status cards (status dot + coloured border + ✓), cleaner reason
 *          chips. (3) Assignment grid drops the Connection + Plan ID tiles.
 * 2.38.0 — Excavator OUI only shows trucks AT its bucket (waiting / spot /
 *          loading). A truck that departs after FULL·Kickout (full travel → dump
 *          → empty legs) disappears from the excavator screen — the operator no
 *          longer sees the DT's haul status (e.g. "Full Travel"); it reappears
 *          only when it returns to the queue. Excavator flips loading → waiting
 *          on FULL and back to loading on the next truck's First Bucket.
 * 2.37.0 — Truck OUI: removed the "Next State" readout (it added noise) — the
 *          wheel hub now shows CURRENT + → Location only, and the line under the
 *          map drops Next State, keeping Current State + Next Location.
 * 2.36.0 — Per-PERSON daily counters + wheel placeholders + smooth load timer.
 *          (1) Excavator OUI header now shows the OPERATOR's "Loaded Today" total
 *          and the Truck OUI shows the DRIVER's "Trips Today" — both keyed on the
 *          person's employee_id, so they AGGREGATE across every login that day and
 *          a different operator/driver on the same machine counts from 0 (the
 *          prior person's total stays theirs). (2) The loading timer now ticks
 *          smoothly every second from First Bucket (local-anchored to the server
 *          elapsed). (3) Haul-cycle wheel greys out Full/Empty Weighbridge +
 *          Sampling as RESERVED placeholders (no GPS yet) so the active cycle
 *          reads cleanly.
 * 2.35.0 — Truck Status wheel — clearer current-stage highlight. The active
 *          wedge is now filled with the STAGE's OWN colour (high opacity + bright
 *          stroke) instead of a faint static cyan, and the centre hub is filled
 *          solid with the current-status colour (auto-contrast black/white text)
 *          so the live haul stage reads at a glance on the in-cab tablet.
 * 2.34.0 — Excavator OUI redesign — sleek single-frame, no scroll. Compact
 *          header (small unit no + slim status pill), one "NOW LOADING" strip
 *          (current truck + live load timer), queue shown as tap-to-select truck
 *          number chips (longest-waiting ▸ highlighted, ★ = operator override),
 *          smaller FULL · KICKOUT DT button, and a non-scrolling plan-details
 *          grid for more breathing room. Loading timer runs from First Bucket.
 * 2.33.0 — Offline GPS trigger engine (the cab auto-tracks the haul cycle with
 *          no signal). When the truck loses signal, the in-cab driver screen now
 *          derives arrival/departure transitions from the DEVICE's own GPS
 *          (the always-on safety watcher's last fix — zero extra battery) instead
 *          of the server TMS feed: the map follows the phone, and a forward-only
 *          cycle engine (ported verbatim from dispatch_service.py: haversine_m,
 *          zone_for, the conservative auto_advance_cycle scope) fires the SAME
 *          transitions the server would — inbound "Reporting" at the discovery
 *          ring, arrival → Waiting, and the post-load dump-zone enter/exit
 *          (fullTravel1→dumping→emptyTravel1). Those transitions are enqueued to
 *          the offline outbox (Phase 2) and replayed idempotently on reconnect.
 *          AUTHORITY MODEL: the server is always authoritative when online (its
 *          operator-view tick overwrites local state every 5 s); the engine only
 *          drives while offline and is otherwise a dormant shadow. The MANUAL
 *          action button always overrides. spot↔loading + the weighbridge/
 *          sampling legs stay manual offline (the server never GPS-drives them
 *          either); a solo offline cab only ever claims "Waiting", never "spot"
 *          (the server re-arbitrates the queue on reconnect). New "Offline ·
 *          tracking on local GPS" badge. (Phase 3 — completes the offline-first
 *          cab.)
 * 2.32.0 — Dispatch workflow fixes (real-scenario hardening). (1) First Bucket
 *          now reflects on the EXCAVATOR screen instantly (2s poll) — it shows
 *          LOADING + a "FULL · KICKOUT DT" button the moment the driver confirms,
 *          instead of only updating on FULL. (2) Excavator operator can OVERRIDE
 *          the auto "longest-waiting next" pick: tap any queued truck to load it
 *          next (★ marks an override); tapping it again reverts to automatic. (3)
 *          The truck DRIVER now only taps First Bucket — the post-load legs
 *          (→ dump → return → re-queue) AUTO-ADVANCE by GPS (no more manual
 *          "Arrived" taps); a GPS-down manual fallback stays available. (4)
 *          Weighbridge + Sampling are reserved PLACEHOLDERS, skipped until those
 *          locations get GPS coords. (5) The Discovery/Waiting/Loading geofence
 *          rings are LOGIC-ONLY — removed from the dump-truck map (no rings/legend).
 * 2.31.0 — Offline action outbox (the cab keeps WORKING with no signal). Every
 *          in-cab driver/operator action — first-bucket, cycle advance, manual
 *          equipment status, disconnect — is now captured the instant it's
 *          tapped and replayed in order when signal returns, so nothing is lost
 *          when a truck drives into a no-coverage pit. New dispatchOutbox.ts
 *          (IndexedDB, per-truck FIFO) + submitDispatchAction()/syncPendingDispatch()
 *          in backgroundSync (drained on every reconnect / foreground /
 *          background-fetch tick alongside the other queues). Each action
 *          carries a client_event_id (UUID) + client_ts; the SERVER dedups
 *          replays against a new PRISM_DISPATCH_CLIENT_EVENTS ledger and stamps
 *          the real tap time, so a replay never creates a duplicate pairing /
 *          load-event / zone-event / status row. cycle-advance gains a
 *          FORWARD-ONLY guard: a stale queued advance that is behind the truck's
 *          GPS-advanced state returns 409 {stale} and is silently reconciled
 *          (dequeued) instead of dragging the truck backwards. The driver sees a
 *          "✓ Saved offline" confirmation and an "N pending sync" badge. All new
 *          request fields are optional, so the web dispatcher + older builds are
 *          unaffected. (Phase 2 of the offline-first cab work.)
 * 2.30.0 — Offline-first sign-on reliability + hourly refresh. Fixes the in-cab
 *          "no sync data" dead-end when a driver enters their Employee ID on a
 *          freshly-provisioned or just-rebooted cab whose offline operator cache
 *          never finished downloading. Changes: (1) the offline-data refresh
 *          cadence drops from 2 h to ~1 h, driven by a SINGLE shared
 *          FRESHNESS_TTL_MS so the auto-sync timer, the "data is fresh" gate and
 *          the isStale check can never drift apart again. (2) The auto-sync
 *          scheduler now fires an IMMEDIATE first attempt (no 30 s wait), uses the
 *          app's real connectivity probe instead of navigator.onLine, and
 *          SELF-HEALS a cold cache by retrying every ~45 s until the first sync
 *          lands. (3) backgroundSync no longer skips empty caches — a cold device
 *          force-runs its first chunked sync on the next reconnect / foreground /
 *          background-fetch tick. (4) A new app-level sync-on-reconnect listener
 *          pulls data the instant the cab regains signal. (5) identify() now shows
 *          a reassuring "Preparing offline data… syncing" message (and kicks a
 *          forced sync) when the cache is simply empty, instead of the
 *          "no signal / not in saved list" error. (6) The FMS cold-start sync is
 *          now visible + retried instead of silently swallowed.
 * 2.29.0 — Sign-on usability + site-only map. (1) The FMS sign-on header now has
 *          a LANGUAGE switcher (🇮🇩/🇬🇧/🇨🇳) and a SIGN OUT button, so an operator
 *          on a shared device — or a normal employee-card user who landed on the
 *          dispatch screen — can switch language or return to the login / mode
 *          picker (the in-cab session hides the app header + bottom nav, which
 *          previously left no way back). (2) The driver map drops the global Esri
 *          SATELLITE basemap entirely: it now shows ONLY our own high-detail SITE
 *          ortho imagery (the FMS-site-map tiles) over a dark backdrop, so the
 *          🛰 SITE/SAT toggle is gone — the cab map always matches the FMS site
 *          map. Where there's no ortho tile the dark background shows instead of
 *          generic satellite.
 * 2.28.0 — Moving loading zones (dynamic geofences) for the in-cab driver map.
 *          The shovel now carries three colour-coded rings that FOLLOW its live
 *          GPS, drawn on the empty/inbound leg: Discovery 100 m (cyan, dashed —
 *          the invisible handshake/approach ring), Waiting 20 m (yellow) and
 *          Loading 10 m (pink). A live legend highlights the truck's CURRENT
 *          zone, and an approach banner shows "Reporting" when the truck enters
 *          the discovery ring and "Loaded / Departed" when a loaded truck leaves
 *          the waiting ring. Server-authoritative: the bands + enter/exit events
 *          are computed from the excavator's live position every board poll
 *          (PRISM_ZONE_EVENTS, last_zone column) so the cab does zero extra GPS
 *          work. NavMap (MapLibre) + DispatchMap (Leaflet fallback) both render
 *          the rings; en/id/zh strings added.
 * 2.27.0 — Professional FMS sign-on redesign. The in-cab "Connect Unit"
 *          (employee ID + unit number) entry screen is rebuilt to look like a
 *          real FMS product instead of a plain light form: a dark shell with a
 *          PRISM FMS branded header band + ONLINE/OFFLINE status pill, a 2-step
 *          progress indicator (Identify operator → Select unit), gold-accent
 *          cards/buttons (matching the web _fms_shell.html palette), an operator
 *          avatar (initials) with KIMPER status pill, glowing live-unit dots in
 *          the unit dropdown, and a centred tablet-friendly column. Wiring
 *          (identify → KIMPER → unit autocomplete → connect) is unchanged.
 * 2.26.0 — Removed the 3D twin map from the truck OUI. The driver map is now
 *          a single flat 2D nav view (MAP / STATUS toggle only) — heading-up,
 *          follows the truck, with the SITE ortho imagery + haul lanes + route
 *          on top. The raster-DEM terrain/sky 3D mode (added in 2.24.0) is gone
 *          per ops feedback (not wanted in-cab); the 🛰 SITE / SAT basemap
 *          toggle stays.
 * 2.25.0 — In-cab SITE imagery basemap. The driver map can now drape our OWN
 *          high-detail site ortho-imagery (the same tiles the FMS site map uses)
 *          over the global satellite basemap, with the haul lanes / route / truck
 *          on top — so the cab map looks like the FMS site map, not generic Esri
 *          satellite. New 🛰 SITE / SAT toggle on the map (default SITE). Served
 *          through a cab-token route (/api/dispatch/site-tile) sharing the backend
 *          tile cache; where there's no ortho tile the satellite shows through.
 * 2.24.0 — In-cab OUI hardening + 3D twin map. (1) A driver is NEVER blocked
 *          from connecting to any excavator/dump truck — expired/again-missing
 *          KIMPER only raises a visible warning chip, never a dead-end. (2) The
 *          excavator screen's manual STATUS selector (breakdown/standby/…) is now
 *          always pinned & visible — the plan-details panel absorbs the squeeze
 *          instead of pushing it off-screen. (3) BOTH operator screens are locked
 *          to a fixed viewport (body.oui-locked: no overscroll/pan/bounce/scroll).
 *          (4) Truck haul-cycle now ENTERS at "Travelling Empty" the moment a
 *          truck is assigned, then follows queue→spot→loading→… with the active
 *          stage highlighted on the wheel (backend DISPATCH_CYCLE_V2 turned on in
 *          prod). (5) New 3D map mode on the truck OUI — a MAP / 3D / STATUS
 *          toggle; 3D drapes the satellite + haul roads over real terrain
 *          (raster-DEM + sky) on the same MapLibre instance.
 * 2.23.1 — Status view layout fix: the haul-cycle wheel was taking over the
 *          whole screen (the top bar AND the right data column were hidden in
 *          STATUS mode). Now STATUS only swaps the LEFT map box for the wheel —
 *          the top bar and the right column (Operator Action / Manual Status /
 *          Assignment) stay visible, so the wheel sits inside its box like the
 *          Map does and no longer hides the rest of the OUI.
 * 2.23.0 — Excavator OUI redesign (prototype ExcavatorOuiPanel): dark in-cab
 *          shell with summary tiles (current/next/queue), large amber FULL button,
 *          queue grid, plan details, and machine-availability modal. Replaces the
 *          inline ExcavatorOperatorWindow in DispatchPage.
 * 2.22.0 — Status view fit + bigger Waiting Event: the dump-truck Status view
 *          now renders the haul-cycle wheel as a TRUE square that fits INSIDE
 *          the same box the Map uses (measured, never stretched). The redundant
 *          bar over the map/status box is gone — the "Truck not in any active
 *          plan yet" notice moved into that space (slim, shown in both modes).
 *          The recovered room makes the OPERATOR ACTION / "Waiting Event" area
 *          larger: a per-state guidance line + a tall confirm button (e.g.
 *          "Loading Started"), matching the OUI prototype.
 * 2.21.1 — Status view polish: the haul-cycle wheel is now a full-width SQUARE
 *          that fills the window (right data column hidden in STATUS mode), the
 *          central hub text is smaller, the CURRENT/NEXT/NEXT-LOCATION chips
 *          collapse to one compact line, and the cab top bar is hidden while the
 *          wheel is shown — maximising the picture on the in-cab tablet.
 * 2.21.0 — Visual Haul-Cycle Wheel: The dump-truck Status view now shows the
 *          "Cycle_Update.png" wheel art with the current haul stage
 *          highlighted (QUEUE_SPOT → LOADING → ... → EMPTY_WEIGHBRIDGE).
 *          Includes a calibrated wedge overlay and a central info-hub for
 *          CURRENT/NEXT status. Falls back to a text-card if art fails.
 * 2.20.0 — Dispatch nav polish: the haul route now matches the web map — a
 *          dark shiny ORANGE loaded lane + GREEN empty lane over a dark casing
 *          (connector stays yellow). Rolls up the latest truck-OUI / NavMap
 *          refinements on top of 2.19.0.
 * 2.19.0 — Truck OUI fit pass: PRISM logo added to the top bar (left); the
 *          OPERATOR ACTION block compacted (smaller action/awaiting line, the
 *          Request Status Change + Report GPS Unavailable buttons sit right
 *          under it); CURRENT/NEXT/NEXT-LOCATION chips shrunk; assignment grid
 *          tightened (MiniTile) + fills remaining space so all data fits on one
 *          screen with no scroll.
 * 2.17.0 — Truck OUI tweaks: removed the duplicate operator-name header (name
 *          stays only in the parent top bar); map column trimmed to ~50% width
 *          (right 50% for the data); the nav map is now LOCKED — no finger
 *          pan/zoom/rotate (MapLibre interactive:false / Leaflet gestures off),
 *          it only follows the truck + shows the backend-defined road/route.
 * 2.16.0 — Truck OUI space cleanup. Dropped the top status bar (truck-number row
 *          + GPS/RFID/ONLINE pills) → slim one-line header (operator · shift).
 *          CURRENT / NEXT / NEXT-LOCATION chips moved UNDER the map; the right
 *          column is now dedicated to OPERATOR ACTION · EQUIPMENT STATUS ·
 *          ASSIGNMENT, with a compact assignment grid that fits with no scroll.
 * 2.15.0 — Driver-view NAV map (MapLibre GL) in the truck OUI. Replaces the
 *          Leaflet map: pitched (~60°), heading-up camera that FOLLOWS the truck
 *          (Google-Maps driving view); the "road ahead" route line over the haul
 *          roads (/api/dispatch/route), haul lanes (loaded/empty) + destination
 *          geofence + heading vehicle marker, on a satellite basemap. Falls back
 *          to the Leaflet DispatchMap if WebGL is unavailable. Drops into the
 *          2.14.0 layout's map slot (speed overlay + cycle stepper unchanged).
 * 2.14.0 — Truck OUI redesign (prototype tablet layout). The dump-truck operator
 *          screen is now: a TOP STATUS BAR (truck no · driver · GPS/RFID/ONLINE
 *          pills), a 12-state CYCLE STEPPER above a big NAV MAP (left), an
 *          OPERATOR ACTION card (state action + Request Status Change + Report
 *          GPS Unavailable) · EQUIPMENT STATUS · a full ASSIGNMENT grid (Truck,
 *          Excavator, Loading/Dump, Loaded/Empty Weighbridge, Sample House,
 *          Material, Plan, Shift/Date, Next Location) on the right, and a bottom
 *          CURRENT / NEXT / NEXT-LOCATION chip bar. Map replaces the prototype's
 *          circular cycle picture; speed shows as a map overlay. (Weighbridge/
 *          sample/material/shift wire from the dispatch plan next.)
 * 2.13.0 — Single-screen OUI (no page scroll) for BOTH truck & excavator —
 *          landscape 2-column layout that fills the viewport (queue scrolls
 *          internally only). Dump-truck map upgraded to NAV mode: the haul-road
 *          "road ahead" route line (/api/dispatch/route) to the destination,
 *          follow-truck at street zoom, geofence + heading marker. Manual status
 *          moved to a modal to reclaim space. Excavator stays map-less.
 * 2.12.0 — Dump-truck OUI (prototype-aligned). The truck operator window now
 *          shows a LIVE MAP (Leaflet + Esri satellite) to its next location —
 *          truck GPS heading marker, the destination (loading point when empty,
 *          dump when full) with a geofence circle, and a route line. A digital
 *          SPEEDOMETER (km/h), plus colour-coded CURRENT and NEXT state tiles +
 *          next-location read-out. Haul-road empty/full lanes overlay when the
 *          backend exposes them (/api/dispatch/roads — ships next deploy).
 *          Excavator window stays map-less.
 * 2.11.0 — Dispatch i18n + cab polish. The ModePicker + the whole Dispatch flow
 *          (connect, excavator & truck operator windows, manual status) now
 *          translate with the language switch (EN + Bahasa Indonesia, EN
 *          fallback for zh/es) via src/services/dispatchI18n.ts. Cab header reads
 *          "FMS Dispatch" (not the account name). Selecting FMS now auto-syncs
 *          the people roster to the on-device cache for offline identify.
 * 2.10.0 — Entry MODE PICKER. First screen (when logged out) asks User vs FMS.
 *          "User" → normal username/password login → full app (with a "← Back to
 *          mode selection"). "FMS" → silent in-cab service-account sign-in →
 *          Dispatch board ONLY (bottom nav hidden, all other routes bounce to
 *          /dispatch). Logout returns to the picker so an admin can switch in.
 *          FMS is detected by account role ('dispatch'); replaces the always-on
 *          auto cab login. (2.9.2/2.9.3 were the cab-mode bootstrap + password
 *          fixes that this supersedes.)
 * 2.9.1 — Cab / kiosk mode: the APK now skips the username/password screen,
 *          silently signs in as a dedicated low-privilege viewer service account
 *          (fms_cab) and opens straight to the Dispatch "Enter Employee ID"
 *          screen. Operators only type their employee ID. Falls back to the
 *          normal login screen if the silent sign-in fails. Configured via
 *          .env.production.local (VITE_CAB_MODE/USERNAME/PASSWORD).
 * 2.9.0 — Dispatch operator flow reworked to the WBN FMS prototype. No more
 *          "Connect Truck / Connect Excavator" choice: type the unit number →
 *          dropdown of matching excavator/dump-truck units (GET /api/dispatch/
 *          units) → tap one → the app auto-detects the equipment type and opens
 *          the correct OPERATOR WINDOW. Excavator window: current-loading +
 *          live clock, queue with the next truck, plan details, big FULL button.
 *          Truck window: one state-driven primary action button that walks the
 *          12-state cycle (Confirm Start Loading → … → Join Queue) with the exact
 *          prototype colours/labels, plus assignment details. Both windows have
 *          manual MACHINE AVAILABILITY status (delay/standby/breakdown/
 *          maintenance + reasons → /api/dispatch/equipment-status) that records
 *          without breaking the cycle. Scan button now matches the hero height.
 * 2.8.3 — Home: moved the "Scan QR" button up into the top hero box (the one
 *          showing "Last synced"), on the same row as the title; removed it from
 *          the Employee Card search row.
 * 2.8.1 — Home: QR scan consolidated into one "Scan QR" button next to the
 *          "Employee Card" header (opens the camera); removed the separate Scan
 *          bottom-nav tab (now Home · Dispatch · History · Settings).
 * 2.8.0 — Dispatch OFFLINE-FIRST (phase 0+1): IDENTIFY now resolves from the
 *          on-device cached roster FIRST (works with no signal — fixes the
 *          "network error" when entering an employee ID offline), then enriches
 *          from the server when reachable. Pure authorization helpers
 *          (classify_equipment/allowed_types/allowed_actions/kimper_status)
 *          ported to src/services/dispatchEngine.ts. Offline banner + a "from
 *          saved list · offline" indicator. (Connect/load still need signal —
 *          durable offline outbox lands in a later phase.)
 * 2.7.0 — Dispatch CYCLE v2: trucks now carry a 12-state cycle status,
 *          recoloured to the WBN FMS prototype palette (see
 *          docs/dispatch_cycle_spec.md). Two-phase load handshake — the TRUCK
 *          DRIVER taps "First Bucket" (Spotting→Loading) and the EXCAVATOR
 *          operator taps "Finish Loading" (Loading→Full Travel 1, auto-promotes
 *          the next waiting truck). New driver console: live coloured state
 *          chip + First Bucket / Confirm Dump Arrival / Depart-Complete Dumping.
 *          Excavator monitor recolours rows by state and replaces "Load" with
 *          "Finish Loading" (only the truck loading on this excavator).
 * 2.6.0 — Dispatch (in-cab): new Dispatch tab. Enter employee ID → Kimper
 *          identity + authorized equipment → enter the unit operated today →
 *          connect to a truck/excavator (authorization-gated). Position stays
 *          on the TMS feed; connection links person↔unit for the shift.
 *          Operator loading-zone monitor (assigned trucks by zone) + Load Truck
 *          button that records a load event when a truck is in the loading zone.
 * 2.5.1 — Dropped the in-progress offline Site Map tab (never released; bundled
 *          GeoJSON + leaflet removed). Bottom nav stays 4 tabs:
 *          Home · Scan · History · Settings.
 * 2.4.3 — Automatic data refresh: the cached people dataset now re-syncs by
 *          itself (~every 2 h) on background-fetch ticks, foreground return,
 *          and reconnect — no manual "sync" needed. Fast delta only; gated by
 *          the existing 2 h freshness check.
 * 2.4.2 — Offline-first QR scan (instant render from on-device cache + silent
 *          background refresh; network only when nothing is cached). Person
 *          page: "No KIMPER Available" empty state, professional training
 *          placeholders, KTP/NIK hidden.
 * 2.4.1 — Pairing auto-trigger limited to vehicle operators only (must have
 *          authorized units; KIMPER-only safety-card holders no longer trigger it).
 * 2.4.0 — KIMPER-gated pairing flow (auto-opens on QR scan, details-first,
 *          vehicle autocomplete, paired banner + unpair).
 * 2.3.0 — driver↔vehicle pairing with KIMPER gate, trucks on live map,
 *          keep-out zones, muster roll-call (I'M SAFE / NEED HELP),
 *          user-group alert targeting, always-on tracking hardening.
 */
export const APP_VERSION = '2.48.0'
