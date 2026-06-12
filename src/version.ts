/**
 * Single source of truth for the PRISM mobile app version.
 *
 * Bump on EVERY new APK build:
 *  - feature batch  → minor (2.3.0 → 2.4.0)
 *  - small fix      → patch (2.3.0 → 2.3.1)
 * Keep android/app/build.gradle in sync: versionName = this string,
 * versionCode = numeric (e.g. 2.3.0 → 230).
 *
 * 2.4.0 — KIMPER-gated pairing flow (auto-opens on QR scan, details-first,
 *          vehicle autocomplete, paired banner + unpair).
 * 2.3.0 — driver↔vehicle pairing with KIMPER gate, trucks on live map,
 *          keep-out zones, muster roll-call (I'M SAFE / NEED HELP),
 *          user-group alert targeting, always-on tracking hardening.
 */
export const APP_VERSION = '2.4.0'
