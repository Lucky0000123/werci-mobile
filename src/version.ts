/**
 * Single source of truth for the PRISM mobile app version.
 *
 * Bump on EVERY new APK build:
 *  - feature batch  → minor (2.3.0 → 2.4.0)
 *  - small fix      → patch (2.3.0 → 2.3.1)
 * Keep android/app/build.gradle in sync: versionName = this string,
 * versionCode = numeric (e.g. 2.3.0 → 230).
 *
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
export const APP_VERSION = '2.6.0'
