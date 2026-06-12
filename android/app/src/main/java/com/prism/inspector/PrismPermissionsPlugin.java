package com.prism.inspector;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "PrismPermissions",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = PrismPermissionsPlugin.CAMERA),
        @Permission(strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = PrismPermissionsPlugin.BACKGROUND_LOCATION)
    }
)
public class PrismPermissionsPlugin extends Plugin {
    static final String CAMERA = "camera";
    static final String BACKGROUND_LOCATION = "backgroundLocation";

    @PluginMethod
    public void checkCameraPermission(PluginCall call) {
        resolveCameraState(call);
    }

    @PluginMethod
    public void requestCameraPermission(PluginCall call) {
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            resolveCameraState(call);
            return;
        }
        requestPermissionForAlias(CAMERA, call, "cameraPermissionCallback");
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        resolveCameraState(call);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity not available");
            return;
        }
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }

    private void resolveCameraState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("camera", getPermissionState(CAMERA).toString());
        call.resolve(result);
    }

    // ── Always-on location support ───────────────────────────────────────────
    // "Allow all the time" (ACCESS_BACKGROUND_LOCATION) is never offered in the
    // runtime dialog on Android 11+ — the user must pick it on the app's
    // settings screen. These methods let JS detect the gap and route the user
    // to the right place, plus exempt the app from battery optimization so
    // Samsung/Doze doesn't kill the tracking service.

    @PluginMethod
    public void checkLocationStatus(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            result.put("backgroundLocation", getPermissionState(BACKGROUND_LOCATION).toString());
        } else {
            // Pre-Android 10: foreground permission already implies background.
            result.put("backgroundLocation", "granted");
        }
        result.put("batteryExempt", isBatteryExempt());
        call.resolve(result);
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || getPermissionState(BACKGROUND_LOCATION) == PermissionState.GRANTED) {
            resolveBackgroundLocationState(call);
            return;
        }
        // On Android 11+ this opens the app's location settings page where the
        // user can pick "Allow all the time"; on Android 10 it shows a dialog.
        requestPermissionForAlias(BACKGROUND_LOCATION, call, "backgroundLocationCallback");
    }

    @PermissionCallback
    private void backgroundLocationCallback(PluginCall call) {
        resolveBackgroundLocationState(call);
    }

    private void resolveBackgroundLocationState(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            result.put("backgroundLocation", getPermissionState(BACKGROUND_LOCATION).toString());
        } else {
            result.put("backgroundLocation", "granted");
        }
        call.resolve(result);
    }

    private boolean isBatteryExempt() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        JSObject result = new JSObject();
        if (isBatteryExempt()) {
            result.put("batteryExempt", true);
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            result.put("batteryExempt", false);
            result.put("requested", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not open battery optimization dialog: " + e.getMessage());
        }
    }
}
