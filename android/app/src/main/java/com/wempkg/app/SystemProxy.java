package com.wempkg.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.ProxyInfo;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.Charset;

/**
 * 把「系统网络状态」同步给本地 Node 服务。
 *
 * 为什么不直接把 7890 写进配置：每个人的代理软件不一样（Clash / v2rayNG / sing-box …），
 * 端口和模式都不固定，写死端口等于把用户绑死在一个软件的一种配置上。这里改成问系统要：
 *  - VPN 模式下（TUN）所有 TCP 都由系统路由进 VPN，应用不需要知道代理存在，直连即可；
 *  - 「系统代理 / 允许局域网」模式下，代理软件会通过 LinkProperties.setHttpProxy() 把地址告诉系统
 *    （Wi-Fi 静态代理同理），这里读出来交给 Node 用。
 * 结果写到 .cache/net.json，Node 每次请求时按 mtime 读取，所以切换 VPN、开关代理都能立刻生效。
 */
public final class SystemProxy {

    private static final String TAG = "wempkg";
    private static final String FILE_NAME = "net.json";
    private static volatile boolean watching = false;
    private static volatile String lastJson = "";

    private SystemProxy() {}

    /** 开始监听默认网络（VPN 连上/断开、换 Wi-Fi 都会回调），并立刻写一次 */
    public static void watch(final Context ctx) {
        final Context app = ctx.getApplicationContext();
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            if (!watching) {
                watching = true;
                cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onCapabilitiesChanged(Network n, NetworkCapabilities c) {
                        sample(app, cm, n);
                    }

                    @Override
                    public void onLinkPropertiesChanged(Network n, LinkProperties lp) {
                        sample(app, cm, n);
                    }

                    @Override
                    public void onLost(Network n) {
                        // 默认网络断了：先按「无系统代理」写，Node 那边直连会自己失败/重试
                        sample(app, cm, null);
                    }
                });
            }
            sample(app, cm, cm.getActiveNetwork());
        } catch (Throwable t) {
            Log.w(TAG, "system proxy watch failed: " + t.getMessage());
        }
    }

    /** 立刻重新采样并落盘（解包完成、启动 Node 之前调用，保证读到的是最新的） */
    public static void writeNow(Context ctx) {
        try {
            Context app = ctx.getApplicationContext();
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            sample(app, cm, cm.getActiveNetwork());
        } catch (Throwable t) {
            Log.w(TAG, "system proxy write failed: " + t.getMessage());
        }
    }

    private static void sample(Context app, ConnectivityManager cm, Network net) {
        String proxy = "";
        boolean vpn = false;
        String transport = "";
        try {
            if (net != null) {
                NetworkCapabilities cap = cm.getNetworkCapabilities(net);
                if (cap != null) {
                    vpn = cap.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
                    if (cap.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transport = "vpn";
                    else if (cap.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "wifi";
                    else if (cap.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "cellular";
                    else if (cap.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "ethernet";
                }
                LinkProperties lp = cm.getLinkProperties(net);
                if (lp != null) proxy = httpProxyOf(lp.getHttpProxy());
            }
        } catch (Throwable t) {
            Log.w(TAG, "sample system proxy failed: " + t.getMessage());
        }
        write(app, proxy, vpn, transport);
    }

    /** ProxyInfo → "http://host:port"；PAC 脚本没法在 Node 里执行，只记类型 */
    private static String httpProxyOf(ProxyInfo pi) {
        if (pi == null) return "";
        try {
            String host = pi.getHost();
            int port = pi.getPort();
            if (host != null && !host.isEmpty()) {
                if (port <= 0) port = 80;
                return "http://" + host + ":" + port;
            }
        } catch (Throwable ignored) { /* 老系统上 getHost 可能抛，按「无代理」处理 */ }
        return "";
    }

    private static void write(Context app, String proxy, boolean vpn, String transport) {
        String json = "{\"at\":" + System.currentTimeMillis()
                + ",\"proxy\":\"" + proxy + "\""
                + ",\"vpn\":" + (vpn ? "true" : "false")
                + ",\"transport\":\"" + transport + "\""
                + ",\"ver\":" + Build.VERSION.SDK_INT + "}";
        if (json.equals(lastJson)) return; // 没变化不重复写盘
        try {
            File dir = new File(NodeRunner.projectDir(app), ".cache");
            if (!dir.exists() && !dir.mkdirs()) return;
            File f = new File(dir, FILE_NAME);
            File tmp = new File(f.getAbsolutePath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(json.getBytes(Charset.forName("UTF-8")));
            }
            if (!tmp.renameTo(f)) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                if (!tmp.renameTo(f)) return;
            }
            lastJson = json;
            Log.i(TAG, "system proxy: proxy='" + (proxy.isEmpty() ? "-" : proxy)
                    + "' vpn=" + vpn + " transport=" + (transport.isEmpty() ? "?" : transport));
        } catch (Throwable t) {
            Log.w(TAG, "write net.json failed: " + t.getMessage());
        }
    }
}
