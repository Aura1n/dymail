package com.dymail.mobile;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Keeps the app process alive (a foreground service) and turns the Node core's "notify" commands into
 * system notifications. It deliberately does not go through the WebView, which Android freezes in the
 * background:
 *   - a worker thread holds the core's event stream open (GET /events) and shows each "notify" command;
 *   - an alarm wakes the phone every few minutes and asks the core to re-check every mailbox
 *     (POST /rpc mobile:poll), the safety net for connections the network dropped without telling us.
 * The core itself (IMAP IDLE, filters, "what is new") runs inside this process, in the Node runtime.
 */
public class MailSyncService extends Service {
    private static final String TAG = "DymailSync";
    private static final String CH_SYNC = "dymail_sync";
    private static final String CH_MAIL = "dymail_mail";
    private static final int ONGOING_ID = 1001;
    private static final int INTERRUPTED_ID = 1002;
    private static final int MAIL_ID = 2001;

    static final String EXTRA_URL = "url";
    static final String EXTRA_TOKEN = "token";
    static final String EXTRA_INTERVAL = "intervalMin";

    private static volatile boolean running = false;
    private static volatile boolean connected = false;

    private volatile int generation = 0;
    private volatile String baseUrl = "";
    private volatile String token = "";
    private volatile long intervalMs = 10 * 60 * 1000L;
    private volatile HttpURLConnection current = null;
    private boolean receiverRegistered = false;
    private int beatFailures = 0;
    private Boolean shownHealthy = null;

    public static boolean isRunning() {
        return running;
    }

    public static boolean isConnected() {
        return connected;
    }

    static void start(Context context, String url, String token, int intervalMin) {
        Intent intent = new Intent(context, MailSyncService.class);
        intent.putExtra(EXTRA_URL, url);
        intent.putExtra(EXTRA_TOKEN, token);
        intent.putExtra(EXTRA_INTERVAL, intervalMin);
        ContextCompat.startForegroundService(context, intent);
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, MailSyncService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannels();

        if (intent == null || intent.getStringExtra(EXTRA_URL) == null) {
            // The system restarted us after killing the process. The Node core died with it and only the
            // app can start it again, so say so instead of silently doing nothing.
            try {
                startForegroundCompat(buildOngoing(false));
            } catch (Exception ignored) {
                // Not allowed to promote from the background: the notification below still tells the story.
            }
            postInterrupted();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            startForegroundCompat(buildOngoing(true));
        } catch (Exception e) {
            Log.w(TAG, "cannot start in the foreground", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManagerCompat.from(this).cancel(INTERRUPTED_ID);
        shownHealthy = Boolean.TRUE;

        int minutes = Math.max(5, Math.min(60, intent.getIntExtra(EXTRA_INTERVAL, 10)));
        baseUrl = intent.getStringExtra(EXTRA_URL);
        token = intent.getStringExtra(EXTRA_TOKEN);
        intervalMs = minutes * 60 * 1000L;
        beatFailures = 0;
        running = true;
        connected = false;

        final int myGeneration = ++generation;
        closeCurrent();
        registerBeatReceiver();
        scheduleBeat();

        Thread worker = new Thread(new Runnable() {
            @Override
            public void run() {
                streamLoop(myGeneration);
            }
        }, "dymail-events");
        worker.setDaemon(true);
        worker.start();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        connected = false;
        generation++;
        closeCurrent();
        cancelBeat();
        if (receiverRegistered) {
            try {
                unregisterReceiver(beatReceiver);
            } catch (Exception ignored) {
                // already gone
            }
            receiverRegistered = false;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- the core's event stream

    private void streamLoop(int myGeneration) {
        long backoff = 2000;
        int failures = 0;
        while (running && myGeneration == generation) {
            try {
                runStream(myGeneration);
                failures = 0;
                backoff = 2000;
            } catch (Exception e) {
                failures++;
                Log.w(TAG, "event stream: " + e.getMessage());
                if (failures == 3) updateOngoing(false);
            }
            connected = false;
            if (!running || myGeneration != generation) return;
            try {
                Thread.sleep(backoff);
            } catch (InterruptedException e) {
                return;
            }
            backoff = Math.min(backoff * 2, 30000);
        }
    }

    private void runStream(int myGeneration) throws IOException {
        URL url = new URL(baseUrl + "/events?token=" + URLEncoder.encode(token, "UTF-8"));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        current = connection;
        connection.setConnectTimeout(8000);
        // The core sends a comment line every 20 seconds, so 75 seconds of silence means the link is dead.
        connection.setReadTimeout(75000);
        connection.setRequestProperty("Accept", "text/event-stream");
        try {
            int code = connection.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            connected = true;
            beatFailures = 0;
            updateOngoing(true);

            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
            String event = null;
            StringBuilder data = new StringBuilder();
            String line;
            while (running && myGeneration == generation && (line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    if ("native".equals(event) && data.length() > 0) handleNative(data.toString());
                    event = null;
                    data.setLength(0);
                } else if (line.startsWith(":")) {
                    // keep-alive comment
                } else if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    data.append(line.substring(5).trim());
                }
            }
        } finally {
            connected = false;
            connection.disconnect();
            if (current == connection) current = null;
        }
    }

    private void closeCurrent() {
        HttpURLConnection connection = current;
        current = null;
        if (connection != null) {
            try {
                connection.disconnect();
            } catch (Exception ignored) {
                // already closed
            }
        }
    }

    private void handleNative(String json) {
        try {
            JSONObject command = new JSONObject(json);
            if ("notify".equals(command.optString("type"))) postMail(command);
        } catch (Exception e) {
            Log.w(TAG, "bad command: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------- heartbeat

    private final BroadcastReceiver beatReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!running) return;
            runBeat();
            scheduleBeat();
        }
    };

    private String beatAction() {
        return getPackageName() + ".DYMAIL_BEAT";
    }

    private PendingIntent beatIntent() {
        Intent intent = new Intent(beatAction()).setPackage(getPackageName());
        return PendingIntent.getBroadcast(this, 7, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void registerBeatReceiver() {
        if (receiverRegistered) return;
        ContextCompat.registerReceiver(this, beatReceiver, new IntentFilter(beatAction()), ContextCompat.RECEIVER_NOT_EXPORTED);
        receiverRegistered = true;
    }

    private void scheduleBeat() {
        AlarmManager alarms = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        // Inexact on purpose: exact alarms need a special permission, and a few minutes of slack is fine here.
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + intervalMs, beatIntent());
    }

    private void cancelBeat() {
        AlarmManager alarms = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(beatIntent());
    }

    private void runBeat() {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        final PowerManager.WakeLock lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dymail:beat");
        lock.setReferenceCounted(false);
        lock.acquire(60 * 1000L); // only for the check itself; never held while idle
        final String url = baseUrl;
        final String secret = token;
        final int myGeneration = generation;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    poll(url, secret);
                    if (myGeneration == generation) {
                        beatFailures = 0;
                        updateOngoing(true);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "heartbeat: " + e.getMessage());
                    if (myGeneration == generation && ++beatFailures >= 2) updateOngoing(false);
                } finally {
                    if (lock.isHeld()) lock.release();
                }
            }
        }, "dymail-beat").start();
    }

    private void poll(String url, String secret) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url + "/rpc").openConnection();
        try {
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(50000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("X-Dymail-Token", secret);
            byte[] body = "{\"channel\":\"mobile:poll\",\"payload\":{}}".getBytes(StandardCharsets.UTF_8);
            OutputStream out = connection.getOutputStream();
            out.write(body);
            out.close();
            int code = connection.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
            while (reader.readLine() != null) {
                // drain
            }
        } finally {
            connection.disconnect();
        }
    }

    // ---------------------------------------------------------------- notifications

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel sync = new NotificationChannel(CH_SYNC, "后台同步", NotificationManager.IMPORTANCE_LOW);
        sync.setDescription("保持与邮箱的连接，以便及时收到新邮件");
        sync.setShowBadge(false);
        NotificationChannel mail = new NotificationChannel(CH_MAIL, "新邮件", NotificationManager.IMPORTANCE_HIGH);
        mail.setDescription("收到新邮件时的提醒");
        mail.enableVibration(true);
        manager.createNotificationChannel(sync);
        manager.createNotificationChannel(mail);
    }

    private PendingIntent openAppIntent() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) launch = new Intent();
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildOngoing(boolean healthy) {
        return new NotificationCompat.Builder(this, CH_SYNC)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Dymail")
            .setContentText(healthy ? "后台收信已开启" : "后台同步已中断，点按打开应用")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openAppIntent())
            .build();
    }

    private void updateOngoing(boolean healthy) {
        if (shownHealthy != null && shownHealthy == healthy) return;
        shownHealthy = healthy;
        try {
            NotificationManagerCompat.from(this).notify(ONGOING_ID, buildOngoing(healthy));
        } catch (SecurityException ignored) {
            // notifications are not allowed; nothing to update
        }
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ONGOING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ONGOING_ID, notification);
        }
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat() {
        stopForeground(true);
    }

    private boolean canNotify() {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return true;
    }

    private void postMail(JSONObject command) {
        // If the user is looking at the app the list already shows it; a banner on top would only be noise.
        if (DymailBackgroundPlugin.isAppVisible() || !canNotify()) return;
        String title = command.optString("title", "Dymail");
        String body = command.optString("body", "收到新邮件");
        String tag = command.optString("tag", "mail");
        int count = Math.max(1, command.optInt("count", 1));
        Notification notification = new NotificationCompat.Builder(this, CH_MAIL)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setNumber(count)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_EMAIL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openAppIntent())
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .build();
        try {
            NotificationManagerCompat.from(this).notify(tag, MAIL_ID, notification);
        } catch (SecurityException e) {
            Log.w(TAG, "notification refused: " + e.getMessage());
        }
    }

    private void postInterrupted() {
        if (!canNotify()) return;
        Notification notification = new NotificationCompat.Builder(this, CH_MAIL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Dymail 后台收信已中断")
            .setContentText("系统结束了应用的后台进程。点按打开 Dymail 即可恢复。")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(openAppIntent())
            .build();
        try {
            NotificationManagerCompat.from(this).notify(INTERRUPTED_ID, notification);
        } catch (SecurityException ignored) {
            // nothing more to do
        }
    }
}
