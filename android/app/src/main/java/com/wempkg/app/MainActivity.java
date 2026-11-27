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
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
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
    private EditText editRemoteToken;
    private View onboardPanel;
    private TextView onboardPermText;
    private TextView onboardDirText;
    /** 首启向导里正在选输出目录：选完结果留在启动页，不往网页回填 */
    private boolean onboardMode = false;
    /** 是否已完成首启向导（存 prefs，装一次只走一次） */
    private boolean onboarded = false;

    /** 当前 WebView 允许加载/调用原生桥的 origin（本地 127.0.0.1 或用户配置的远程主机） */
    private Uri trustedOrigin;
    /** 当前页面地址：JS 桥在后台线程调用，不能直接读 WebView 的 UI 状态 */
    private volatile String currentPageUrl = "";

    /** 下载中心浮层是否展开（返回键先收浮层，不跳页、不重载） */
    private boolean downloadsOpen = false;
    /** 只有用户明确点「退出」才关掉本地 Node；返回/退到后台都保留 */
    private boolean quitRequested = false;
    /** 安全区（状态栏/导航栏）以 dp 下发给网页的 CSS 变量，避免重复注入 */
    private int safeTopPx = 0;
    private int safeBottomPx = 0;
    private int sentTopDp = -1;
    private int sentBottomDp = -1;
    /** 启动页（原生 View）原始 padding，insets 时在它基础上叠加 */
    private int setupPadLeft, setupPadTop, setupPadRight, setupPadBottom;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 启动窗口底色沿用上次网页实际用的主题：主题固定成 Light，靠资源没法自动跟系统，
        // 用 SharedPreferences 记住网页报上来的明暗，冷启动就不会闪一下反色。
        boolean lastDark = getPreferences(MODE_PRIVATE).getBoolean("lastDarkTheme", true);
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(
                lastDark ? 0xFF0F1720 : 0xFFF4F6F9));
        setContentView(R.layout.activity_main);

        // 沉浸式状态栏：透明底 + 浅色图标。ROM 默认主题经常给状态栏刷白色，
        // 这里显式清掉浅色图标标记，让状态栏跟着深色页面走
        android.view.Window win = getWindow();
        win.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        win.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            win.setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController c = win.getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            win.getDecorView().setSystemUiVisibility(0);
        }
        requestNotifPermission();
        // 进页面就开始准备 JS 工程（首次/升级要解包 zip），等用户点「本地模式」时通常已经就绪
        NodeRunner.prepareInBackground(getApplicationContext());
        // 系统代理/VPN 状态同步给 Node（不写死端口：VPN 走系统路由，系统代理读 LinkProperties）
        SystemProxy.watch(getApplicationContext());

        web = findViewById(R.id.web);
        setupPanel = findViewById(R.id.setupPanel);
        // 启动页是原生 View（不在网页里），沉浸式之后它会被状态栏压住，需要自己吃安全区
        setupPadLeft = setupPanel.getPaddingLeft();
        setupPadTop = setupPanel.getPaddingTop();
        setupPadRight = setupPanel.getPaddingRight();
        setupPadBottom = setupPanel.getPaddingBottom();
        txtStatus = findViewById(R.id.txtStatus);
        editRemote = findViewById(R.id.editRemote);
        editRemoteToken = findViewById(R.id.editRemoteToken);

        // 首启向导：只读一次 prefs，后面决定是否自动进本地模式
        // 老用户（用过本地/远程模式）升级上来不该再走一遍向导：有 mode 记录就算已引导
        onboarded = getPreferences(MODE_PRIVATE).getBoolean("onboarded", false)
                || !getPreferences(MODE_PRIVATE).getString("mode", "").isEmpty();
        onboardPanel = findViewById(R.id.onboardPanel);
        onboardPermText = findViewById(R.id.onboardPermText);
        onboardDirText = findViewById(R.id.onboardDirText);
        if (onboardPanel != null) onboardPanel.setVisibility(onboarded ? View.GONE : View.VISIBLE);
        if (!onboarded) refreshOnboardState();
        Button btnOnboardStorage = findViewById(R.id.btnOnboardStorage);
        if (btnOnboardStorage != null) {
            btnOnboardStorage.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { requestStorage(); }
            });
        }
        Button btnOnboardDir = findViewById(R.id.btnOnboardDir);
        if (btnOnboardDir != null) {
            btnOnboardDir.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { onboardMode = true; openTreePicker(); }
            });
        }
        Button btnOnboardDone = findViewById(R.id.btnOnboardDone);
        if (btnOnboardDone != null) {
            btnOnboardDone.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    onboarded = true;
                    getPreferences(MODE_PRIVATE).edit().putBoolean("onboarded", true).apply();
                    if (onboardPanel != null) onboardPanel.setVisibility(View.GONE);
                    startLocal();
                }
            });
        }

        WebSettings s = web.getSettings();        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                currentPageUrl = url == null ? "" : url;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // 每次导航后样式表是新的，需要重新注入一次安全区
                sentTopDp = -1;
                sentBottomDp = -1;
                pushSafeAreaToWeb(safeTopPx, safeBottomPx);
                pushOnboardOutput();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });
        web.setBackgroundColor(0xFF0F1720);

        // targetSdk 36 默认启用预测性返回，onBackPressed 不再被调用，必须注册 OnBackInvokedCallback，
        // 否则返回键会直接交给系统 finish 掉 Activity（页面内返回失效）
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new android.window.OnBackInvokedCallback() {
                        @Override public void onBackInvoked() { handleBack(); }
                    });
        }

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
                // 沉浸式：不再给原生 View 加 padding（那样状态栏只是被刷成一条深色边），
                // 而是把安全区以 CSS 变量交给网页，页面自己排布，内容可以一直铺到屏幕顶部
                safeTopPx = top;
                safeBottomPx = bottom;
                pushSafeAreaToWeb(top, bottom);
                // 启动页内容整体下移：避让状态栏和底部手势条
                if (setupPanel != null) {
                    setupPanel.setPadding(setupPadLeft, setupPadTop + top,
                            setupPadRight, setupPadBottom + bottom);
                }
                return insets;
            }
        });

        // 给网页用的原生能力：跳外部链接（Steam 登录确认）
        web.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void openExternal(String url) {
                if (!canUseBridge()) return;
                try {
                    Uri uri = Uri.parse(String.valueOf(url));
                    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                    // 只允许浏览器能安全处理的网页链接，拒绝 file:// / intent:// 等本机协议
                    if (!"http".equals(scheme) && !"https".equals(scheme)) {
                        status("✘ 只允许打开 http/https 链接");
                        return;
                    }
                    Intent it = new Intent(Intent.ACTION_VIEW, uri);
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(it);
                } catch (Exception e) {
                    status("✘ 打不开链接: " + e.getMessage());
                }
            }

            /** 调起系统目录选择器，结果在 onActivityResult 里回填网页 */
            @android.webkit.JavascriptInterface
            public void pickFolder() {
                if (!canUseBridge()) return;
                runOnUiThread(new Runnable() {
                    @Override public void run() { openTreePicker(); }
                });
            }

            /** 把刚做好的 mpkg 直接交给壁纸引擎导入（返回一行给网页日志用的提示） */
            @android.webkit.JavascriptInterface
            public String openMpkg(String path) {
                if (!canUseBridge()) return "✘ 页面来源未授权";
                if (path == null || path.trim().isEmpty()) return "✘ 没有拿到 mpkg 路径";
                File f = new File(path.trim());
                if (!MpkgProvider.isAllowedFile(MainActivity.this, f)) {
                    return "✘ 只允许导入产出目录里的 .mpkg";
                }
                return sendToWallpaperEngine(f.getAbsolutePath());
            }

            /** 用系统默认应用打开产出的文件（原始资源包是 zip，交给文件管理器/解压工具） */
            @android.webkit.JavascriptInterface
            public String openFile(String path) {
                if (!canUseBridge()) return "✘ 页面来源未授权";
                if (path == null || path.trim().isEmpty()) return "✘ 没有拿到文件路径";
                File f = new File(path.trim());
                if (!MpkgProvider.isAllowedExportFile(MainActivity.this, f)) {
                    return "✘ 只允许打开产出目录里的文件";
                }
                Uri uri = MpkgProvider.uriFor(f);
                String mime = MpkgProvider.mimeOf(f.getName());
                try {
                    Intent it = new Intent(Intent.ACTION_VIEW);
                    it.setDataAndType(uri, mime);
                    it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(it);
                    return "已请求系统打开：" + f.getName();
                } catch (ActivityNotFoundException e) {
                    // 没有能直接打开的应用时，退回分享面板让用户自己选
                    return shareFile(f.getAbsolutePath());
                } catch (Exception e) {
                    return "✘ 打开失败: " + e.getMessage();
                }
            }

            /** 把刚导出的离线网页包（zip）分享出去：微信 / QQ / 文件管理器都能收 */
            @android.webkit.JavascriptInterface
            public String shareFile(String path) {
                if (!canUseBridge()) return "✘ 页面来源未授权";
                if (path == null || path.trim().isEmpty()) return "✘ 没有拿到文件路径";
                File f = new File(path.trim());
                if (!MpkgProvider.isAllowedExportFile(MainActivity.this, f)) {
                    return "✘ 只允许分享产出目录里的 .zip / .mpkg";
                }
                try {
                    Uri uri = MpkgProvider.uriFor(f);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(MpkgProvider.mimeOf(f.getName()));
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent chooser = Intent.createChooser(send, getString(R.string.app_name) + " · " + f.getName());
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(chooser);
                    return "已打开分享面板（" + f.getName() + "）";
                } catch (Exception e) {
                    return "✘ 分享失败: " + e.getMessage();
                }
            }

            /** 下载中心浮层开关：返回键据此决定「先收浮层」还是「退到后台」 */
            @android.webkit.JavascriptInterface
            public void setDownloadsOpen(boolean open) {
                if (!canUseBridge()) return;
                downloadsOpen = open;
            }

            /**
             * 网页切深浅色：同步状态栏/导航栏图标的明暗与 WebView 底色。
             * 不接这一步的话，浅色主题下白色状态栏图标会看不见。
             */
            @android.webkit.JavascriptInterface
            public void setTheme(final boolean dark) {
                if (!canUseBridge()) return;
                // 记下网页当前的明暗，下次冷启动的窗口底色照着来（避免闪一下反色）
                try {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("lastDarkTheme", dark).apply();
                } catch (Throwable ignore) { /* 存储失败不影响本次切换 */ }
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (web != null) web.setBackgroundColor(dark ? 0xFF0F1720 : 0xFFF4F6F9);
                        android.view.Window win = getWindow();
                        if (android.os.Build.VERSION.SDK_INT >= 30) {
                            android.view.WindowInsetsController c = win.getInsetsController();
                            if (c != null) {
                                int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                        | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                                // 浅色背景要「深色图标」→ 打开 LIGHT_* 标记；深色背景则清掉
                                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
                            }
                        } else {
                            int flags = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                            if (android.os.Build.VERSION.SDK_INT >= 26) {
                                flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                            }
                            win.getDecorView().setSystemUiVisibility(dark ? 0 : flags);
                        }
                    }
                });
            }

            /**
             * 系统当前是不是夜间模式。
             * 应用的 windowBackground / 主题是固定的深色，WebView 里 prefers-color-scheme
             * 会一直报浅色，所以「跟随系统」这条必须由原生把真实 uiMode 告诉网页。
             */
            @android.webkit.JavascriptInterface
            public boolean isNightMode() {
                return isSystemNight();
            }

            /** 从网页里回到启动页（本地/远程切换、导入凭据、退出），不销毁 WebView */
            @android.webkit.JavascriptInterface
            public void openSetup() {
                if (!canUseBridge()) return;
                showSetupPanel();
            }
        }, "Android");

        editRemote.setText(getPreferences(MODE_PRIVATE).getString("remote", ""));
        editRemoteToken.setText(getPreferences(MODE_PRIVATE).getString("remoteToken", ""));

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
        // 向导里已经有「授予文件访问权限」，旧按钮先藏起来，免得同一件事出现两次
        if (btnStorage != null) btnStorage.setVisibility(onboarded ? View.VISIBLE : View.GONE);
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
        // 但如果是系统重建（旋屏/被系统回收后回来），先恢复 WebView 现场，绝不重新加载
        if (savedInstanceState != null && restoreWebState(savedInstanceState)) {
            if (!portOpen()) startLocal();     // 进程被杀过：页面是旧的，重新起服务
            return;
        }
        if (!onboarded) {
            status("首次使用：授予权限、选好输出目录后，点「开始使用」进入本地模式");
            return;
        }
        String mode = getPreferences(MODE_PRIVATE).getString("mode", "");
        if (!"remote".equals(mode)) startLocal();
    }

    private static final String WEB_STATE_KEY = "webViewState";

    private boolean restoreWebState(Bundle saved) {
        Bundle ws = saved.getBundle(WEB_STATE_KEY);
        if (ws == null) return false;
        if (web.restoreState(ws) == null) return false;
        setupPanel.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        loadedUrl = web.getUrl();     // 回来时按当前地址认，避免重复加载
        currentPageUrl = loadedUrl == null ? "" : loadedUrl;
        trustedOrigin = originOf(Uri.parse(currentPageUrl));
        return true;
    }

    /** 切到启动页：隐藏 WebView 但不销毁，回来不重载 */
    private void showSetupPanel() {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                setupPanel.setVisibility(View.VISIBLE);
                web.setVisibility(View.GONE);
                status("启动页：本地 / 远程 / 导入凭据 / 退出都在这里");
            }
        });
    }

    private void startLocal() {
        // 服务已经在跑就不要再起一次：libnode 只能 Start 一遍，重复调用会让进程直接退出
        if (portOpen()) {
            getPreferences(MODE_PRIVATE).edit().putString("mode", "local").apply();
            showWeb("http://127.0.0.1:" + PORT + "/");
            return;
        }
        status("正在启动本地 Node…（首次安装要解压资源，之后秒开）");
        KeepAliveService.start(getApplicationContext());
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
            onboardMode = false;
            callJsPick(null);
            return;
        }
        Uri tree = data.getData();
        String path = treeToPath(tree);
        if (path == null) {
            status("✘ 这个位置拿不到真实路径，请换「内部存储」下的目录");
            onboardMode = false;
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
        if (onboardMode) {
            onboardMode = false;
            getPreferences(MODE_PRIVATE).edit()
                    .putString("outputDir", path)
                    .putBoolean("onboarded", true)
                    .apply();
            onboarded = true;
            refreshOnboardState();
            pushOnboardOutput();
            status("✔ 输出目录已设为 " + path + "，点「开始使用」进入本地模式");
            return;
        }
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
                // SD 卡/U 盘：volume 是卷 UUID，真实挂载路径由 StorageManager 给（不要拼 /storage/<uuid>）
                root = storageVolumePath(volume);
                if (root == null) return null;
            }
            return rel.isEmpty() ? root : root + "/" + rel;
        } catch (Exception e) {
            return null;
        }
    }

    /** 用 StorageManager 把卷 UUID 换成真实挂载目录（可移动存储的路径不是固定的） */
    private String storageVolumePath(String volumeId) {
        try {
            android.os.storage.StorageManager sm =
                    (android.os.storage.StorageManager) getSystemService(STORAGE_SERVICE);
            if (sm == null) return null;
            for (android.os.storage.StorageVolume vol : sm.getStorageVolumes()) {
                if (volumeId.equalsIgnoreCase(vol.getUuid())) {
                    java.io.File d = vol.getDirectory();
                    if (d != null) return d.getAbsolutePath();
                }
            }
        } catch (Throwable ignored) { }
        return null;
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

    private Uri originOf(Uri u) {
        if (u == null) return null;
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        String host = u.getHost();
        if (host == null || host.isEmpty()) return null;
        Uri.Builder b = new Uri.Builder().scheme(scheme);
        int port = effectivePort(u, scheme);
        b.encodedAuthority(port > 0 ? host + ":" + port : host);
        return b.build();
    }

    private int effectivePort(Uri u, String scheme) {
        int port = u.getPort();
        if (port > 0) return port;
        if ("https".equals(scheme)) return 443;
        if ("http".equals(scheme)) return 80;
        return -1;
    }

    private boolean isSameOrigin(Uri a, Uri b) {
        if (a == null || b == null) return false;
        String as = a.getScheme() == null ? "" : a.getScheme().toLowerCase();
        String bs = b.getScheme() == null ? "" : b.getScheme().toLowerCase();
        return as.equals(bs)
                && String.valueOf(a.getHost()).equalsIgnoreCase(String.valueOf(b.getHost()))
                && effectivePort(a, as) == effectivePort(b, bs);
    }

    /** 原生桥只对当前配置的页面 origin 开放，防止 WebView 跳到第三方页面后继续调用 */
    private boolean canUseBridge() {
        if (trustedOrigin == null) return false;
        return isSameOrigin(Uri.parse(currentPageUrl == null ? "" : currentPageUrl), trustedOrigin);
    }

    /** 站内页面留在 WebView；站外 http/https 交给系统浏览器；其它协议直接拒绝 */
    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if ("about".equals(scheme)) return false;
        if (!"http".equals(scheme) && !"https".equals(scheme)) return true;
        if (isSameOrigin(uri, trustedOrigin)) return false;
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, uri);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(it);
        } catch (Exception e) {
            status("✘ 打不开外部链接: " + e.getMessage());
        }
        return true;
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
        String raw = editRemote.getText().toString().trim();
        if (raw.isEmpty()) {
            status("先填电脑地址，例如 192.168.1.10:3090");
            return;
        }
        // Android 16 起「本地网络保护」逐步收紧，连 192.168.x.x 属于本地网络访问；
        // 先按需申请附近设备权限，拒绝也不拦着（当前版本未强制，连不上时再提示）
        requestNearbyIfNeeded();
        if (!raw.matches("(?i)https?://.*")) raw = "http://" + raw;
        Uri base;
        try {
            base = Uri.parse(raw);
        } catch (Exception e) {
            status("✘ 地址格式不对: " + e.getMessage());
            return;
        }
        String scheme = base.getScheme() == null ? "" : base.getScheme().toLowerCase();
        if ((!"http".equals(scheme) && !"https".equals(scheme)) || base.getHost() == null) {
            status("✘ 只支持 http/https 的电脑地址");
            return;
        }
        Uri.Builder builder = base.buildUpon();
        if (base.getPath() == null || base.getPath().isEmpty()) builder.path("/");
        String token = editRemoteToken.getText().toString().trim();
        if (!token.isEmpty() && base.getQueryParameter("token") == null) {
            builder.appendQueryParameter("token", token);
        }
        Uri target = builder.build();
        getPreferences(MODE_PRIVATE).edit()
                .putString("remote", editRemote.getText().toString().trim())
                .putString("remoteToken", token)
                .putString("mode", "remote")
                .apply();
        showWeb(target.toString());
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

    /** 当前 WebView 已加载的地址：同地址再「切回网页」时只显示，不重新加载 */
    private String loadedUrl = null;

    private void showWeb(final String url) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setupPanel.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
                // 从启动页/设置页切回来时不要 reload：页面状态（列表、滚动位置）原样保留
                if (url.equals(loadedUrl)) {
                    status("已回到: " + url);
                    return;
                }
                trustedOrigin = originOf(Uri.parse(url));
                currentPageUrl = url;
                web.loadUrl(url);
                loadedUrl = url;
                status("已连接: " + url);
            }
        });
    }

    /** 把状态栏/导航栏高度按 dp 写进网页的 CSS 变量（1 CSS px ≈ 1dp，viewport 是 device-width） */
    private void pushSafeAreaToWeb(int topPx, int bottomPx) {
        if (web == null) return;
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        int top = Math.round(topPx / density);
        int bottom = Math.round(bottomPx / density);
        if (top == sentTopDp && bottom == sentBottomDp) return;   // 没变化就别反复执行 JS
        sentTopDp = top;
        sentBottomDp = bottom;
        final String js = "document.documentElement.style.setProperty('--sat','" + top + "px');"
                + "document.documentElement.style.setProperty('--sab','" + bottom + "px');";
        runOnUiThread(new Runnable() {
            @Override public void run() { web.evaluateJavascript(js, null); }
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
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            Bundle ws = new Bundle();
            web.saveState(ws);
            outState.putBundle(WEB_STATE_KEY, ws);
        }
    }

    /**
     * 返回键走安卓习惯：浮层 → 抽屉/弹窗（由网页自己消费）→ 退到后台。
     * 不再「隐藏网页回到启动页」、也不再顺手杀进程；页面状态原样保留，不会重新加载。
     */
    @Override
    public void onBackPressed() {
        // API 33+ 已注册 OnBackInvokedCallback，系统不会再调用这里；保留是给旧版本兜底
        handleBack();
    }

    private void handleBack() {
        if (downloadsOpen) {
            web.evaluateJavascript("window.WE_DLC && window.WE_DLC.close()", null);
            downloadsOpen = false;
            return;
        }
        if (web != null && web.getVisibility() == View.VISIBLE) {
            web.evaluateJavascript(
                "(function(){try{return !!(window.__androidBack && window.__androidBack());}catch(e){return false;}})()",
                new android.webkit.ValueCallback<String>() {
                    @Override public void onReceiveValue(String consumed) {
                        if ("true".equals(consumed)) return;   // 网页自己关掉了抽屉/弹窗
                        if (web.canGoBack()) web.goBack();
                        else showSetupPanel();               // 回启动页（可导入凭据 / 切本地远程）
                    }
                });
            return;
        }
        moveTaskToBack(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 从系统授权页回来：刷新向导里的权限状态
        if (!onboarded && onboardPanel != null && onboardPanel.getVisibility() == View.VISIBLE) refreshOnboardState();
    }

    /** 系统是否夜间模式：网页里 prefers-color-scheme 不可靠，以原生 uiMode 为准 */
    private boolean isSystemNight() {
        return (getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // 系统切深浅色 / 改字号时 Activity 不重建（见 manifest 的 configChanges），
        // 这里主动通知网页重算一次主题，否则「跟随系统」要等下次冷启动才变
        final WebView w = web;
        if (w == null) return;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    w.evaluateJavascript(
                        "(function(){var a=window.WE_APP;if(a&&a.onSystemThemeChange)a.onSystemThemeChange();})()",
                        null);
                } catch (Throwable ignore) { /* 页面还没起来时忽略 */ }
            }
        });
    }

    /** 首启向导：把向导里选的输出目录同步给网页（网页落盘到 settings.json） */
    private void pushOnboardOutput() {
        final String dir = getPreferences(MODE_PRIVATE).getString("outputDir", "");
        if (dir == null || dir.isEmpty() || web == null) return;
        final String arg = "'" + dir.replace("\\", "\\\\").replace("'", "\\'") + "'";
        runOnUiThread(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript(
                    "window.__weOnboardDir=" + arg + ";" +
                    "window.WE_SET_OUTPUT && window.WE_SET_OUTPUT(" + arg + ")", null);
            }
        });
    }

    /** 首启向导：刷新「权限 / 目录」两个勾选项 */
    private void refreshOnboardState() {
        boolean allFiles = android.os.Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager();
        if (onboardPermText != null) {
            onboardPermText.setText(allFiles
                    ? "① 文件访问权限 ✔ 已授予"
                    : "① 文件访问权限：未授予，mpkg 只能存到应用私有目录");
            onboardPermText.setTextColor(allFiles ? 0xFF7EE7B8 : 0xFFF0B060);
        }
        String dir = getPreferences(MODE_PRIVATE).getString("outputDir", "");
        if (onboardDirText != null) {
            onboardDirText.setText(dir == null || dir.isEmpty()
                    ? "② 输出目录：默认 下载/mpkg，可改到别的文件夹"
                    : "② 输出目录 ✔ " + dir);
            onboardDirText.setTextColor(dir == null || dir.isEmpty() ? 0xFF8FA3B8 : 0xFF7EE7B8);
        }
    }

    /**
     * 远程模式要访问 192.168.x.x 这类地址，属于「本地网络」。Android 16 的本地网络保护
     * 目前是 opt-in（后续版本会强制），届时需要附近设备权限；这里先按需申请，拒绝不阻塞。
     */
    private void requestNearbyIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT < 33) return;
        try {
            String perm = "android.permission.NEARBY_WIFI_DEVICES";
            if (checkSelfPermission(perm) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{perm}, 1002);
            }
        } catch (Throwable ignored) { }
    }

    /** Android 13+ 前台服务通知需要运行时授权；拒绝也不影响下载，只是通知不显示 */
    private void requestNotifPermission() {        if (android.os.Build.VERSION.SDK_INT < 33) return;
        try {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1001);
            }
        } catch (Throwable ignored) { }
    }

    /** 退出应用：关掉本地 Node 服务并结束进程，避免后台残留占内存/占端口 */
    private void quitApp() {
        quitRequested = true;
        status("正在退出，关闭本地服务…");
        NodeRunner.shutdownAndExit(getApplicationContext(), PORT);
    }

    @Override
    protected void onDestroy() {
        // 只有用户明确点「退出」才把 Node 带走；
        // 返回键/退到后台/系统回收都保留进程，下载与打包继续跑
        if (quitRequested && isFinishing()) {
            NodeRunner.shutdownAndExit(getApplicationContext(), PORT);
        }
        super.onDestroy();
    }
}
