package com.wempkg.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;

public class MainActivity extends Activity {

    private static final int PORT = 3090;
    private static final int REQ_PICK_TREE = 7001;

    private WebView web;
    private View setupPanel;
    private TextView txtStatus;
    private EditText editRemote;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        setupPanel = findViewById(R.id.setupPanel);
        txtStatus = findViewById(R.id.txtStatus);
        editRemote = findViewById(R.id.editRemote);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF0F1720);

        // WebView 不认 env(safe-area-inset-*)，用原生 insets 把页面挤到刘海/挖孔和底部手势区之内
        final View root = findViewById(android.R.id.content);
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public android.view.WindowInsets onApplyWindowInsets(View v, android.view.WindowInsets insets) {
                int top, bottom;
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                    top = bars.top;
                    bottom = bars.bottom;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                web.setPadding(0, top, 0, bottom);
                return insets;
            }
        });

        // 给网页用的原生能力：跳外部链接（Steam 登录确认）
        web.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void openExternal(String url) {
                try {
                    Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(it);
                } catch (Exception e) {
                    status("✘ 打不开链接: " + e.getMessage());
                }
            }

            /** 调起系统目录选择器，结果在 onActivityResult 里回填网页 */
            @android.webkit.JavascriptInterface
            public void pickFolder() {
                runOnUiThread(new Runnable() {
                    @Override public void run() { openTreePicker(); }
                });
            }

            /** 把刚做好的 mpkg 直接交给壁纸引擎导入（返回一行给网页日志用的提示） */
            @android.webkit.JavascriptInterface
            public String openMpkg(String path) {
                return sendToWallpaperEngine(path);
            }
        }, "Android");

        editRemote.setText(getPreferences(MODE_PRIVATE).getString("remote", ""));

        Button btnLocal = findViewById(R.id.btnLocal);
        Button btnRemote = findViewById(R.id.btnRemote);
        Button btnToken = findViewById(R.id.btnToken);
        final EditText editToken = findViewById(R.id.editToken);
        btnToken.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                try {
                    NodeRunner.importToken(getApplicationContext(), String.valueOf(editToken.getText()));
                    status("✔ 凭据已导入，本地模式可以直接下载了");
                    editToken.setText("");
                } catch (Exception e) {
                    status("✘ 导入失败: " + e.getMessage());
                }
            }
        });
        btnLocal.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startLocal(); }
        });
        btnRemote.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startRemote(); }
        });
        Button btnStorage = findViewById(R.id.btnStorage);
        btnStorage.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { requestStorage(); }
        });
        Button btnExit = findViewById(R.id.btnExit);
        if (btnExit != null) {
            btnExit.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { quitApp(); }
            });
        }

        // 默认直接进本地模式（首次启动也自动起 Node），上次选过远程就恢复远程
        String mode = getPreferences(MODE_PRIVATE).getString("mode", "");
        if (!"remote".equals(mode)) startLocal();
    }

    private void startLocal() {
        // 服务已经在跑就不要再起一次：libnode 只能 Start 一遍，重复调用会让进程直接退出
        if (portOpen()) {
            getPreferences(MODE_PRIVATE).edit().putString("mode", "local").apply();
            showWeb("http://127.0.0.1:" + PORT + "/");
            return;
        }
        status("正在启动本地 Node…首次启动要解包资源，约 5-10 秒");
        NodeRunner.start(getApplicationContext());
        new Thread(new Runnable() {
            @Override
            public void run() {
                for (int i = 0; i < 90; i++) {
                    if (portOpen()) {
                        getPreferences(MODE_PRIVATE).edit().putString("mode", "local").apply();
                        showWeb("http://127.0.0.1:" + PORT + "/");
                        return;
                    }
                    try { Thread.sleep(500); } catch (InterruptedException ignored) { }
                }
                status("本地服务没起来（3090 一直没监听）。最近日志:\n" + tailLog());
            }
        }, "port-probe").start();
    }

    /** 申请「所有文件访问」，让下载目录能设到 /storage/emulated/0/Download 这类位置 */
    private void requestStorage() {
        if (android.os.Build.VERSION.SDK_INT < 30) { // R
            status("当前系统版本无需单独授权，直接改下载目录即可");
            return;
        }
        if (Environment.isExternalStorageManager()) {
            status("✔ 已拥有全部文件访问权限，可在设置里改下载目录");
            return;
        }
        // HyperOS / MIUI 上带 package 的 MANAGE_ALL_FILES_ACCESS_PERMISSION 往往没有 Activity，
        // 逐个降级：应用级授权页 → 通用「所有文件访问」页 → 本应用详情页
        String[] actions = {
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION,
        };
        for (String action : actions) {
            try {
                Intent it = new Intent(action);
                if (Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION.equals(action)) {
                    it.setData(Uri.parse("package:" + getPackageName()));
                }
                if (it.resolveActivity(getPackageManager()) == null) continue;
                startActivity(it);
                status("已打开授权页：允许「所有文件访问」后返回，再在设置里改下载目录");
                return;
            } catch (Exception ignored) { /* 试下一个 */ }
        }
        // 兜底：直接进本应用的应用详情页
        try {
            Intent it = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            it.setData(Uri.parse("package:" + getPackageName()));
            startActivity(it);
            status("本机没有「所有文件访问」授权页，已打开应用详情：请在「权限」里手动开启存储权限");
        } catch (ActivityNotFoundException e) {
            status("✘ 打开授权页失败: " + e.getMessage());
        }
    }

    /** 系统目录选择器（SAF）：选完把 tree URI 还原成真实路径回填网页 */
    private void openTreePicker() {
        try {
            Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(it, REQ_PICK_TREE);
        } catch (Exception e) {
            status("✘ 打开目录选择器失败: " + e.getMessage());
            callJsPick(null);
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_PICK_TREE) return;
        if (result != RESULT_OK || data == null || data.getData() == null) {
            callJsPick(null);
            return;
        }
        Uri tree = data.getData();
        String path = treeToPath(tree);
        if (path == null) {
            status("✘ 这个位置拿不到真实路径，请换「内部存储」下的目录");
            callJsPick(null);
            return;
        }
        try {
            // 持久化授权，免得重启后访问不了
            getContentResolver().takePersistableUriPermission(
                    tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { }
        File f = new File(path);
        if (!f.exists()) f.mkdirs();
        callJsPick(path);
    }

    /** content://...documents/tree/primary%3ADownload%2Fmpkg → /storage/emulated/0/Download/mpkg */
    private String treeToPath(Uri tree) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(tree);
            String[] parts = docId.split(":");
            if (parts.length < 2) return null;
            String volume = parts[0];
            String rel = parts[1];
            String root;
            if ("primary".equalsIgnoreCase(volume)) {
                root = Environment.getExternalStorageDirectory().getAbsolutePath();
            } else if ("home".equalsIgnoreCase(volume)) {
                root = Environment.getExternalStorageDirectory().getAbsolutePath() + "/Documents";
            } else {
                root = "/storage/" + volume;      // SD 卡
            }
            return rel.isEmpty() ? root : root + "/" + rel;
        } catch (Exception e) {
            return null;
        }
    }

    private void callJsPick(String path) {
        final String arg = path == null ? "null" : "'" + path.replace("\\", "\\\\").replace("'", "\\'") + "'";
        runOnUiThread(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript("window.__folderPicked && window.__folderPicked(" + arg + ")", null);
            }
        });
    }

    /**
     * 直接拉起壁纸引擎导入刚生成的 mpkg。
     * 壁纸引擎（io.wallpaperengine.weclient）注册了 application/vnd.mpkg 的 VIEW 过滤器，
     * 但它没有存储权限，所以必须用我们自己的 content:// + 临时读权限，
     * 并且显式限定包名，否则系统会弹出「用哪个应用打开」的选择框。
     */
    private String sendToWallpaperEngine(final String path) {
        if (path == null || path.trim().isEmpty()) return "✘ 没有拿到 mpkg 路径";
        final File f = new File(path.trim());
        if (!f.isFile()) return "✘ 文件不存在：" + path;

        final android.content.pm.PackageManager pm = getPackageManager();
        final String pkg = "io.wallpaperengine.weclient";
        final boolean installed = isPackageInstalled(pm, pkg);

        runOnUiThread(new Runnable() {
            @Override public void run() {
                Uri uri = MpkgProvider.uriFor(f);
                Intent it = new Intent(Intent.ACTION_VIEW);
                it.setDataAndType(uri, "application/vnd.mpkg");
                it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_ACTIVITY_NEW_TASK);
                if (installed) {
                    // 显式组件最稳：壁纸引擎的入口固定是 .BrowseActivity，
                    // 走 setPackage/隐式解析在 Android 11+ 上可能被过滤成系统选择框
                    it.setComponent(new android.content.ComponentName(
                            "io.wallpaperengine.weclient", "io.wallpaperengine.weclient.BrowseActivity"));
                    try {
                        startActivity(it);
                        status("已把 " + f.getName() + " 交给壁纸引擎");
                        return;
                    } catch (Exception e) {
                        android.util.Log.w("wempkg", "WE 显式打开失败: " + e.getMessage());
                    }
                    // 再退一步：只限定包名，由系统在该包内解析
                    Intent byPkg = new Intent(Intent.ACTION_VIEW);
                    byPkg.setDataAndType(uri, "application/vnd.mpkg");
                    byPkg.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    byPkg.setPackage("io.wallpaperengine.weclient");
                    try {
                        startActivity(byPkg);
                        status("已把 " + f.getName() + " 交给壁纸引擎");
                        return;
                    } catch (Exception e) {
                        android.util.Log.w("wempkg", "WE 包名解析失败: " + e.getMessage());
                    }
                    // 直连失败（例如 MIUI 拦截/组件被禁用）→ 去掉包名让系统弹选择框
                    Intent relaxed = new Intent(Intent.ACTION_VIEW);
                    relaxed.setDataAndType(uri, "application/vnd.mpkg");
                    relaxed.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        startActivity(relaxed);
                        status("已打开「选择打开方式」，请选壁纸引擎");
                        return;
                    } catch (Exception ignored) { }
                }
                // 壁纸引擎没装（或打不开）：退回到系统选择器，让用户手动导入
                try {
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(uri, "application/vnd.mpkg");
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(view);
                    status("没找到可打开 mpkg 的应用，已在系统选择器里列出候选");
                } catch (Exception e) {
                    status("✘ 打不开 mpkg：" + e.getMessage());
                }
            }
        });
        if (!installed) return "没安装壁纸引擎，已交给系统选择打开方式";
        return "正在打开壁纸引擎导入…";
    }

    private boolean isPackageInstalled(android.content.pm.PackageManager pm, String pkg) {
        try {
            pm.getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean portOpen() {        Socket so = new Socket();
        try {
            so.connect(new InetSocketAddress("127.0.0.1", PORT), 1000);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            try { so.close(); } catch (Exception ignored) { }
        }
    }

    private void startRemote() {
        String host = editRemote.getText().toString().trim();
        if (host.isEmpty()) {
            status("先填电脑地址，例如 192.168.1.10:3090");
            return;
        }
        if (!host.startsWith("http")) host = "http://" + host;
        if (!host.endsWith("/")) host = host + "/";
        getPreferences(MODE_PRIVATE).edit()
                .putString("remote", editRemote.getText().toString().trim())
                .putString("mode", "remote")
                .apply();
        showWeb(host);
    }

    private String tailLog() {
        java.io.File f = NodeRunner.logFile(getApplicationContext());
        if (!f.exists()) return "（没有 node.log，说明 Node 根本没跑到写日志这一步）";
        StringBuilder sb = new StringBuilder();
        try (java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
                if (sb.length() > 2500) sb.delete(0, sb.length() - 2000);
            }
        } catch (Exception e) {
            return "读日志失败: " + e;
        }
        return sb.toString().trim();
    }

    private void showWeb(final String url) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setupPanel.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
                web.loadUrl(url);
                status("已连接: " + url);
            }
        });
    }

    private void status(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                txtStatus.setText(msg);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.getVisibility() == View.VISIBLE) {
            if (web.canGoBack()) {
                web.goBack();
                return;
            }
            setupPanel.setVisibility(View.VISIBLE);
            web.setVisibility(View.GONE);
            return;
        }
        // 在启动页按返回 = 退出应用（连带关掉后台的 Node 服务）
        quitApp();
    }

    /** 退出应用：关掉本地 Node 服务并结束进程，避免后台残留占内存/占端口 */
    private void quitApp() {
        status("正在退出，关闭本地服务…");
        NodeRunner.shutdownAndExit(getApplicationContext(), PORT);
    }

    @Override
    protected void onDestroy() {
        // 用户主动退出/划掉任务时也要把 Node 带走；仅配置变化（如旋屏）时不杀
        if (isFinishing()) {
            NodeRunner.shutdownAndExit(getApplicationContext(), PORT);
        }
        super.onDestroy();
    }
}
