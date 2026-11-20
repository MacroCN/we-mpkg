package com.wempkg.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.Base64;

import java.io.File;
import java.io.FileNotFoundException;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/**
 * 把本应用产出的 .mpkg 以 content:// 形式临时授权给壁纸引擎读取。
 *
 * 为什么需要它：targetSdk 34 下直接传 file:// 会抛 FileUriExposedException；
 * 而纸飞机式地拷到公共目录再传 file:// 也不行 —— 壁纸引擎没有存储权限，
 * 会静默忽略这份 uri（实测：intent 到了 BrowseActivity，但没有导入界面）。
 * 用自己的 provider + FLAG_GRANT_READ_URI_PERMISSION，接收方就能直接读到字节流。
 *
 * uri 形如 content://com.wempkg.app.mpkg/<base64url(绝对路径)>，
 * 只允许读下载目录/输出目录/应用私有目录里的文件。
 */
public class MpkgProvider extends ContentProvider {

    public static final String AUTHORITY = "com.wempkg.app.mpkg";
    private static final String MIME = "application/vnd.mpkg";
    private static final Charset UTF8 = Charset.forName("UTF-8");

    public static Uri uriFor(File f) {
        String token = Base64.encodeToString(f.getAbsolutePath().getBytes(UTF8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return Uri.parse("content://" + AUTHORITY + "/" + token);
    }

    /** 只放开这几个目录，避免变成任意文件读取器 */
    private List<File> allowedRoots() {
        List<File> roots = new ArrayList<>();
        try {
            File dl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            roots.add(dl);
        } catch (Throwable ignored) { }
        File ext = getContext().getExternalFilesDir(null);
        if (ext != null) roots.add(ext);
        roots.add(getContext().getFilesDir());
        roots.add(getContext().getCacheDir());
        return roots;
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        String token = uri.getLastPathSegment();
        if (token == null) throw new FileNotFoundException(uri.toString());
        byte[] raw;
        try {
            raw = Base64.decode(token, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (IllegalArgumentException e) {
            throw new FileNotFoundException(uri.toString());
        }
        File f;
        try {
            f = new File(new String(raw, UTF8)).getCanonicalFile();
        } catch (java.io.IOException e) {
            throw new FileNotFoundException(uri.toString());
        }
        boolean inside = false;
        for (File root : allowedRoots()) {
            try {
                String rootPath = root.getCanonicalPath();
                if (f.getPath().equals(rootPath) || f.getPath().startsWith(rootPath + File.separator)) {
                    inside = true;
                    break;
                }
            } catch (java.io.IOException ignored) { }
        }
        if (!inside) throw new FileNotFoundException("不在允许的目录内: " + f);
        if (!f.isFile()) throw new FileNotFoundException(uri.toString());
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return MIME;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = resolve(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
