package com.prism.inspector;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrismPermissionsPlugin.class);
        super.onCreate(savedInstanceState);

        // Clear WebView cache on every launch so ADB reinstalls always show latest code
        getBridge().getWebView().clearCache(true);

        // Allow HTTP API calls from the HTTPS WebView origin (androidScheme: 'https').
        // Without this, Android WebView blocks fetch() to http:// endpoints as mixed content.
        getBridge().getWebView().getSettings()
            .setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    }
}

