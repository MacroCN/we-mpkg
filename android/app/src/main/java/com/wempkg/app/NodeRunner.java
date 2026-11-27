package com.wempkg.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 把 assets/nodejs-project 解包到应用私有目录，并在线程里启动 libnode。
 * 注意：JNI 符号名必须与包名 + 类名一致（Java_com_wempkg_app_NodeRunner_startNode）。
 */
public final class NodeRunner {

    private static final String TAG = "wempkg";
    private static final java.util.concurrent.atomic.AtomicBoolean STARTED =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    private static final String ASSET_PROJECT = "nodejs-project";
    private static final String PROJECT_DIR = "nodejs-project";
    /** 打包进 assets 的单个 zip（由 tools/make-assets-bundle.js 生成） */
    private static final String ASSET_ZIP = "nodejs-project.zip";
    /** zip 的 buildId 清单，用来判断要不要重新解包 */
    private static final String ASSET_MANIFEST = "nodejs-build.json";
    /** 已经解好的 buildId 记在 filesDir 下 */
    private static final String STAMP_FILE = ".nodejs-stamp";
    private static final Object EXTRACT_LOCK = new Object();

    static {
        System.loadLibrary("node");
        System.loadLibrary("wempkg-node");
    }

    private static native int startNode(String[] args, String nodePath, String tmpDir, String homeDir,
                                         String logPath, String nativeLibDir, String publicDownloads);

    private NodeRunner() {}

    public static String projectDir(Context ctx) {
        return new File(ctx.getFilesDir(), PROJECT_DIR).getAbsolutePath();
    }

    public static String scriptPath(Context ctx) {
        return new File(projectDir(ctx), "bin/wempkg.js").getAbsolutePath();
    }

    public static java.io.File logFile(Context ctx) {
        return new File(ctx.getFilesDir(), "node.log");
    }

    /**
     * 下载缓存目录：放到外置储存的应用专属目录
     * (/storage/emulated/0/Android/data/com.wempkg.app/files/downloads)，
     * 不占应用私有空间、不需要「所有文件访问」权限，卸载时系统一并清理。
     * 外置储存没挂载时退回 cacheDir。
     */
    public static String downloadDir(Context ctx) {
        File ext = ctx.getExternalFilesDir(null);
        File base = ext != null ? ext : ctx.getCacheDir();
        File dir = new File(base, "downloads");
        if (!dir.exists()) dir.mkdirs();
        return dir.getAbsolutePath();
    }

    /** 启动前把 downloadDir 写进项目 .cache/settings.json（保留其它已有设置） */
    public static void prepareSettings(Context ctx) throws IOException {
        File cache = new File(projectDir(ctx), ".cache");
        if (!cache.exists() && !cache.mkdirs()) throw new IOException("无法创建 .cache 目录");
        File f = new File(cache, "settings.json");
        org.json.JSONObject o = new org.json.JSONObject();
        if (f.exists()) {
            try {
                o = new org.json.JSONObject(readText(f));
            } catch (Exception ignored) { /* 旧的坏了就直接重建 */ }
        }
        String dir = downloadDir(ctx);
        String json;
        try {
            o.put("downloadDir", dir);
            json = o.toString(2);
        } catch (org.json.JSONException e) {
            throw new IOException("写 settings.json 失败: " + e.getMessage());
        }
        try (java.io.FileWriter w = new java.io.FileWriter(f, false)) {
            w.write(json);
        }
        Log.i(TAG, "download cache dir = " + dir);
        // 解包完成、进程马上起 Node：确保 net.json 是当前系统代理状态
        SystemProxy.writeNow(ctx);
    }

    /**
     * 老版本把下载缓存放进了应用私有目录（filesDir/nodejs-project/downloads），
     * 每个条目会留下几百个文件。升级后这些已经用不到了，启动时清掉一次旧缓存。
     */
    public static void cleanLegacyDownloadCache(Context ctx) {
        File old = new File(projectDir(ctx), "downloads");
        if (!old.exists()) return;
        try {
            deleteRecursive(old);
            Log.i(TAG, "legacy download cache removed: " + old.getAbsolutePath());
        } catch (Exception e) {
            Log.w(TAG, "legacy cache clean failed: " + e.getMessage());
        }
    }

    private static void deleteRecursive(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static String readText(File f) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }

    /** 把电脑端 `steamjs token` 输出的 Base64 凭据写进项目的 .cache/steam-token.json */
    public static boolean importToken(Context ctx, String base64) throws IOException {
        String json = new String(android.util.Base64.decode(base64.trim(), android.util.Base64.DEFAULT), "UTF-8");
        org.json.JSONObject o;
        try {
            o = new org.json.JSONObject(json);
        } catch (org.json.JSONException e) {
            throw new IOException("凭据不是合法的 JSON: " + e.getMessage());
        }
        if (!o.has("refreshToken") || o.optString("refreshToken").isEmpty()) {
            throw new IOException("凭据里没有 refreshToken");
        }
        File dir = new File(projectDir(ctx), ".cache");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建 .cache 目录");
        File f = new File(dir, "steam-token.json");
        try (java.io.FileWriter w = new java.io.FileWriter(f, false)) {
            w.write(json);
        }
        Log.i(TAG, "token imported for " + o.optString("accountName", "?"));
        return true;
    }

    /**
     * 确保私有目录里的 JS 工程是最新的。
     *
     * assets 里现在是 `nodejs-project.zip` + `nodejs-build.json`（构建时生成）：
     * - 清单里的 buildId 和 filesDir/.nodejs-stamp 一致 → 什么都不做（平时冷启动零成本）
     * - 不一致（首次安装 / 升级换了内容）→ 清掉运行时目录再按 zip 顺序解包，保留 .cache 与 output
     *
     * 没有清单（例如直接用 Android Studio 编译出展开的 assets 目录）时退回逐文件复制。
     */
    public static void ensureProject(Context ctx) throws IOException {
        synchronized (EXTRACT_LOCK) {
            String want = assetBuildId(ctx);
            String key = want != null ? ("zip:" + want) : ("dir:" + versionCode(ctx));
            String have = readStamp(ctx);
            if (key.equals(have) && new File(scriptPath(ctx)).isFile()) return;

            Log.i(TAG, "prepare project dir: " + key + " (was " + have + ")");
            long t0 = System.currentTimeMillis();
            if (want != null) {
                cleanRuntimeDirs(ctx);
                extractZip(ctx, want);
            } else {
                copyAssetDir(ctx.getAssets(), ASSET_PROJECT, new File(projectDir(ctx)));
            }
            writeStamp(ctx, key);
            Log.i(TAG, "project dir ready in " + (System.currentTimeMillis() - t0) + "ms");
        }
    }

    /** 启动前预热（用户还在启动页选模式时就把解包跑掉），跟 ensureProject 共用一把锁 */
    public static void prepareInBackground(final Context ctx) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    ensureProject(ctx);
                } catch (Throwable t) {
                    Log.w(TAG, "prepare failed (稍后会重试): " + t.getMessage());
                }
            }
        }, "asset-prepare").start();
    }

    private static String assetBuildId(Context ctx) {
        try (InputStream in = ctx.getAssets().open(ASSET_MANIFEST)) {
            org.json.JSONObject o = new org.json.JSONObject(readAll(in));
            String id = o.optString("buildId", "");
            return id.isEmpty() ? null : id;
        } catch (Exception e) {
            Log.i(TAG, "no " + ASSET_MANIFEST + " in assets, fallback to dir copy");
            return null;
        }
    }

    private static long versionCode(Context ctx) {
        try {
            android.content.pm.PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return android.os.Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String readStamp(Context ctx) {
        File f = new File(ctx.getFilesDir(), STAMP_FILE);
        if (!f.exists()) return "";
        try {
            return readAll(new java.io.FileInputStream(f)).trim();
        } catch (Exception e) {
            return "";
        }
    }

    private static void writeStamp(Context ctx, String key) {
        File f = new File(ctx.getFilesDir(), STAMP_FILE);
        File tmp = new File(f.getAbsolutePath() + ".tmp");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
            out.write(key.getBytes("UTF-8"));
        } catch (Exception e) {
            Log.w(TAG, "write stamp failed: " + e.getMessage());
            return;
        }
        if (!tmp.renameTo(f)) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(f);
        }
    }

    private static String readAll(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.InputStreamReader(in, "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }

    /** 只清运行时目录，.cache（登录凭据 / 设置 / 续转断点）与 output 必须保留 */
    private static void cleanRuntimeDirs(Context ctx) {
        File root = new File(projectDir(ctx));
        File[] children = root.listFiles();
        if (children == null) return;
        for (java.io.File child : children) {
            String name = child.getName();
            if (name.equals(".cache") || name.equals("output") || name.equals("downloads")) continue;
            try {
                deleteRecursive(child);
            } catch (Exception e) {
                Log.w(TAG, "clean " + name + " failed: " + e.getMessage());
            }
        }
    }

    /** 按 zip 顺序解包：3478 次 asset open 变成 1 次 + 顺序读 */
    private static void extractZip(Context ctx, String buildId) throws IOException {
        File dest = new File(projectDir(ctx));
        if (!dest.exists() && !dest.mkdirs()) throw new IOException("mkdirs failed: " + dest);
        byte[] buf = new byte[65536];
        int count = 0;
        try (java.util.zip.ZipInputStream zin = new java.util.zip.ZipInputStream(ctx.getAssets().open(ASSET_ZIP))) {
            java.util.zip.ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                String name = e.getName();
                File out = new File(dest, name);
                // 防御 zip-slip：条目必须落在 dest 目录内（带分隔符比较，避免 prefix 兄弟目录被误放行）
                String destRoot = dest.getCanonicalPath() + File.separator;
                if (!out.getCanonicalPath().startsWith(destRoot)) {
                    throw new IOException("非法的 zip 条目: " + name);
                }
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                }
                try (OutputStream fo = new FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) != -1) fo.write(buf, 0, n);
                }
                count++;
            }
        }
        Log.i(TAG, "extracted " + count + " files from " + ASSET_ZIP + " (" + buildId + ")");
    }

    public static void extractAssets(Context ctx) throws IOException {
        ensureProject(ctx);
    }

    private static void copyAssetDir(AssetManager am, String path, File dest) throws IOException {
        String[] children = am.list(path);
        if (children == null || children.length == 0) {
            File parent = dest.getParentFile();
            if (parent != null) parent.mkdirs();
            try (InputStream in = am.open(path); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            }
        } else {
            if (!dest.exists() && !dest.mkdirs()) throw new IOException("mkdirs failed: " + dest);
            for (String c : children) copyAssetDir(am, path + "/" + c, new File(dest, c));
        }
    }

    public static void start(final Context ctx) {
        // libnode 的 node::Start 只能调一次：重复调用会直接把进程带走
        if (!STARTED.compareAndSet(false, true)) {
            Log.i(TAG, "node already started, skip");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean nativeEntered = false;
                try {
                    ensureProject(ctx);
                    cleanLegacyDownloadCache(ctx);
                    prepareSettings(ctx);
                    String dir = projectDir(ctx);
                    // HOME 放私有 files 目录（cacheDir 会被「清除缓存」清掉）
                    File home = new File(ctx.getFilesDir(), "home");
                    if (!home.exists()) home.mkdirs();
                    // 公共下载目录由系统给：不要写死 /storage/emulated/0（分身/工作资料会是别的 userId）
                    String publicDownloads = null;
                    try {
                        publicDownloads = android.os.Environment
                                .getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                                .getAbsolutePath();
                    } catch (Throwable ignored) { }
                    Log.i(TAG, "starting node, project=" + dir + ", home=" + home.getAbsolutePath()
                            + ", download=" + publicDownloads);
                    // 注意：必须带 serve 子命令，否则 CLI 只打印用法后退出
                    nativeEntered = true;
                    startNode(new String[]{"node", scriptPath(ctx), "serve"},
                              dir + ":" + dir + "/node_modules",
                              ctx.getCacheDir().getAbsolutePath(),
                              home.getAbsolutePath(),
                              logFile(ctx).getAbsolutePath(),
                              ctx.getApplicationInfo().nativeLibraryDir,
                              publicDownloads);
                } catch (Throwable t) {
                    // 解包/写设置等 Java 阶段失败还没进 native，允许下次重试；
                    // 一旦进了 node::Start 就不能再启动第二次，保持 STARTED=true
                    if (!nativeEntered) STARTED.set(false);
                    Log.e(TAG, "node start failed", t);
                }
            }
        }, "node-main").start();
    }

    /**
     * 退出应用：先让本地 Node 服务自杀（POST /api/shutdown），再干掉本进程。
     * libnode 跑在本进程的 native 线程里，没法从 Java 侧 join/stop，
     * 只有让进程整体结束才能真正释放端口和内存。
     */
    public static void shutdownAndExit(final Context ctx, final int port) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection)
                        new java.net.URL("http://127.0.0.1:" + port + "/api/shutdown").openConnection();
                    c.setRequestMethod("POST");
                    c.setConnectTimeout(1200);
                    c.setReadTimeout(1200);
                    c.getResponseCode();
                    c.disconnect();
                    Log.i(TAG, "shutdown request sent");
                } catch (Throwable t) {
                    Log.i(TAG, "shutdown request failed (可能没起服务): " + t.getMessage());
                }
                try { Thread.sleep(400); } catch (InterruptedException ignored) { }
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(0);
            }
        }, "node-exit").start();
    }
}
