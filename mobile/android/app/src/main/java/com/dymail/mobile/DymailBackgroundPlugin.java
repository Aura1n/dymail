package com.dymail.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The page's handle on background mail: turn the foreground service on/off, and the permissions and
 * system settings it depends on. The service itself (MailSyncService) talks to the Node core directly,
 * so it keeps working while the WebView is frozen.
 */
@CapacitorPlugin(
    name = "DymailBackground",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class DymailBackgroundPlugin extends Plugin {
    private static final String PREFS = "dymail_background";
    private static final String KEY_ENABLED = "enabled";

    private static volatile int startedActivities = 0;
    private static boolean lifecycleRegistered = false;

    /** True while an activity of this app is on screen; the service then skips notifications the user can already see. */
    public static boolean isAppVisible() {
        return startedActivities > 0;
    }

    @Override
    public void load() {
        synchronized (DymailBackgroundPlugin.class) {
            if (lifecycleRegistered) return;
            lifecycleRegistered = true;
        }
        Application app = getActivity().getApplication();
        app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity activity, Bundle savedInstanceState) { }
            @Override public void onActivityStarted(Activity activity) { startedActivities++; }
            @Override public void onActivityResumed(Activity activity) { }
            @Override public void onActivityPaused(Activity activity) { }
            @Override public void onActivityStopped(Activity activity) { if (startedActivities > 0) startedActivities--; }
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle outState) { }
            @Override public void onActivityDestroyed(Activity activity) { }
        });
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSObject buildStatus() {
        Context context = getContext();
        JSObject status = new JSObject();
        status.put("enabled", prefs().getBoolean(KEY_ENABLED, false));
        status.put("running", MailSyncService.isRunning());
        status.put("connected", MailSyncService.isConnected());
        status.put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled());
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        status.put("batteryExempt", power != null && power.isIgnoringBatteryOptimizations(context.getPackageName()));
        status.put("sdk", Build.VERSION.SDK_INT);
        status.put("manufacturer", Build.MANUFACTURER);
        return status;
    }

    private boolean startService(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");
        Integer interval = call.getInt("intervalMin", 10);
        // The core only ever listens on the loopback address; refuse anything else.
        if (url == null || token == null || !url.startsWith("http://127.0.0.1:") || token.isEmpty()) {
            call.reject("本地邮件服务地址无效");
            return false;
        }
        try {
            MailSyncService.start(getContext(), url, token, interval == null ? 10 : interval);
            return true;
        } catch (Exception e) {
            call.reject("无法启动后台服务：" + e.getMessage());
            return false;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(buildStatus());
    }

    /** Turn background mail on and start the service. */
    @PluginMethod
    public void enable(PluginCall call) {
        if (!startService(call)) return;
        prefs().edit().putBoolean(KEY_ENABLED, true).apply();
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void disable(PluginCall call) {
        prefs().edit().putBoolean(KEY_ENABLED, false).apply();
        MailSyncService.stop(getContext());
        call.resolve(buildStatus());
    }

    /**
     * Called every time the app opens: the core has a fresh port and token, so a service that was
     * enabled earlier is (re)started with them. Does nothing if background mail is off.
     */
    @PluginMethod
    public void sync(PluginCall call) {
        if (!prefs().getBoolean(KEY_ENABLED, false)) {
            call.resolve(buildStatus());
            return;
        }
        if (!startService(call)) return;
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(buildStatus());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        call.resolve(buildStatus());
    }

    /** Asks the system to exempt the app from battery optimisation (a system dialog; the answer shows up in status()). */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
        } catch (Exception first) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
                // Some vendor builds hide both screens; the page tells the user to use the app settings instead.
            }
        }
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开通知设置");
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开应用设置");
        }
    }
}
