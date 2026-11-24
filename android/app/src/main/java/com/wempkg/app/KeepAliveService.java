package com.wempkg.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * 前台服务：让系统知道「这个 App 正在后台干活」，降低切后台后被 LMK 杀掉的概率。
 *
 * 实际干活的 libnode 仍然跑在本进程的 native 线程里（见 NodeRunner），
 * 所以这里不做任何下载逻辑，只负责挂通知 + 常驻优先级。
 *
 * 通知上的「停止」= 调 Node 的 /api/shutdown 再结束进程，等同于界面里的「退出」。
 */
public class KeepAliveService extends Service {

    private static final String TAG = "wempkg";
    private static final String CHANNEL_ID = "wempkg-keepalive";
    private static final int NOTIFICATION_ID = 1001;
    private static final String ACTION_STOP = "com.wempkg.app.STOP_KEEPALIVE";
    private static final int PORT = 3090;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, KeepAliveService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Throwable t) {
            Log.w(TAG, "keepalive start failed: " + t.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Throwable t) {
            Log.w(TAG, "startForeground failed: " + t.getMessage());
        }
        Log.i(TAG, "keepalive service started");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.i(TAG, "stop requested from notification");
            NodeRunner.shutdownAndExit(getApplicationContext(), PORT);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY; // 进程被杀后不自动拉起：没有 Node 时服务没有意义
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "后台运行", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("下载 / 打包任务进行中，保持应用不被系统清理");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, KeepAliveService.class).setAction(ACTION_STOP);
        PendingIntent spi = PendingIntent.getService(this, 1, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle("we-mpkg 后台运行中")
                .setContentText("下载 / 打包任务进行中，别在系统里清理后台")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentIntent(pi)
                .setOngoing(true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止", spi);
        return b.build();
    }
}
