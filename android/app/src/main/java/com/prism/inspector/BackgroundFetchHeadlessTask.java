package com.prism.inspector;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.transistorsoft.tsbackgroundfetch.BGTask;
import com.transistorsoft.tsbackgroundfetch.BackgroundFetch;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Headless background-fetch task (runs even after the app is swiped away,
 * thanks to stopOnTerminate:false + enableHeadless:true in backgroundSync.ts).
 *
 * Every OS-scheduled tick (~15 min minimum) it:
 *   1. reads the PRISM session token from Capacitor Preferences storage,
 *   2. grabs the device's last known location,
 *   3. POSTs it to /api/mobile/location (keeping the "last known" marker on
 *      the safety map fresh even with the app closed),
 *   4. raises a high-priority notification for any emergency-zone alert in
 *      the response that this phone has not alerted on yet (the seen-set is
 *      shared with the JS side through the same Preferences key).
 */
public class BackgroundFetchHeadlessTask {
    private static final String TAG = "PrismHeadlessFetch";
    private static final String CAP_PREFS = "CapacitorStorage";
    private static final String SESSION_KEY = "prism_session_v1";
    private static final String SEEN_KEY = "prism_seen_emergency_zones_v1";
    private static final String CHANNEL_ID = "prism_emergency";
    // Same priority order as connectionManager in the JS app: LAN, then cloud.
    private static final String[] BASE_URLS = {
        "http://10.40.20.184:8082",
        "https://api.werci.my.id"
    };

    public void onFetch(Context context, BGTask task) {
        String taskId = task.getTaskId();
        if (task.getTimedOut()) {
            BackgroundFetch.getInstance(context).finish(taskId);
            return;
        }
        new Thread(() -> {
            try {
                run(context);
            } catch (Exception e) {
                Log.w(TAG, "headless tick failed: " + e.getMessage());
            } finally {
                BackgroundFetch.getInstance(context).finish(taskId);
            }
        }).start();
    }

    private void run(Context context) throws Exception {
        String token = readToken(context);
        if (token == null) {
            Log.d(TAG, "no session token — skipping");
            return;
        }
        Location loc = lastKnownLocation(context);
        if (loc == null) {
            Log.d(TAG, "no last known location — skipping");
            return;
        }

        JSONObject body = new JSONObject();
        body.put("lat", loc.getLatitude());
        body.put("lng", loc.getLongitude());
        body.put("accuracy", (double) loc.getAccuracy());
        body.put("ts", System.currentTimeMillis() / 1000);

        JSONObject response = postJson(token, "/api/mobile/location", body);
        if (response == null) return;

        JSONArray alerts = response.optJSONArray("alerts");
        if (alerts == null || alerts.length() == 0) return;

        SharedPreferences prefs = context.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
        Set<String> seen = readSeen(prefs);
        List<JSONObject> fresh = new ArrayList<>();
        for (int i = 0; i < alerts.length(); i++) {
            JSONObject alert = alerts.optJSONObject(i);
            if (alert == null) continue;
            String id = alert.optString("id", "");
            if (!id.isEmpty() && !seen.contains(id)) {
                fresh.add(alert);
                seen.add(id);
            }
        }
        if (fresh.isEmpty()) return;
        writeSeen(prefs, seen);

        for (JSONObject alert : fresh) {
            notifyEmergency(context, alert.optString("message", "Emergency alert"),
                    alert.optString("id", String.valueOf(System.currentTimeMillis())));
        }
    }

    // ── PRISM session token (written by the JS side via Capacitor Preferences) ──
    private String readToken(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
            String raw = prefs.getString(SESSION_KEY, null);
            if (raw == null) return null;
            String token = new JSONObject(raw).optString("token", "");
            return token.isEmpty() ? null : token;
        } catch (Exception e) {
            return null;
        }
    }

    private Set<String> readSeen(SharedPreferences prefs) {
        Set<String> seen = new HashSet<>();
        try {
            String raw = prefs.getString(SEEN_KEY, null);
            if (raw != null) {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) seen.add(arr.optString(i));
            }
        } catch (Exception ignored) {
        }
        return seen;
    }

    private void writeSeen(SharedPreferences prefs, Set<String> seen) {
        try {
            JSONArray arr = new JSONArray();
            for (String id : seen) arr.put(id);
            prefs.edit().putString(SEEN_KEY, arr.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private Location lastKnownLocation(Context context) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            return null;
        }
        try {
            LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location best = null;
            for (String provider : lm.getAllProviders()) {
                try {
                    Location l = lm.getLastKnownLocation(provider);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException ignored) {
                }
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject postJson(String token, String path, JSONObject body) {
        for (String base : BASE_URLS) {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(base + path).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setDoOutput(true);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    try (InputStream is = conn.getInputStream();
                         BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line);
                        return new JSONObject(sb.toString());
                    }
                }
                Log.d(TAG, base + path + " -> HTTP " + code);
            } catch (Exception e) {
                Log.d(TAG, base + " unreachable: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        return null;
    }

    private void notifyEmergency(Context context, String message, String alertId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Emergency Alerts", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Site emergency zone alerts");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 600, 200, 600, 200, 600});
            Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarm != null) {
                channel.setSound(alarm, new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            }
            nm.createNotificationChannel(channel);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(context.getApplicationInfo().icon)
                .setContentTitle("🚨 EMERGENCY ALERT")
                .setContentText(message)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true);

        nm.notify(alertId.hashCode(), builder.build());
        Log.i(TAG, "emergency notification raised: " + message);
    }
}
