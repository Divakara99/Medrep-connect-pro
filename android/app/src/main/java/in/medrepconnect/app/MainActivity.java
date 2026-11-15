package in.medrepconnect.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.widget.Toast;
import android.graphics.Color;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.activity.EdgeToEdge;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * MedRep Pro shell.
 *
 * Android 15+ (API 35, mandatory from 36) draws apps edge-to-edge, so the
 * WebView starts underneath the status bar — testers saw the clock sitting on
 * top of the header. Play Console additionally reported "Edge-to-edge may not
 * display for all users", which it raises for apps that never opt in and only
 * inherit the platform default. So:
 *
 *   1. EdgeToEdge.enable() opts in explicitly on EVERY API level (24+), with
 *      transparent bars and dark icons to match the white app background.
 *   2. The content view is padded by the real system-bar / cutout insets, so the
 *      WebView never sits under the clock or a camera hole.
 *
 * Opting out is not an option: Android 16 ignores the opt-out for apps targeting
 * 36. The bottom inset is left alone (see below).
 *
 * The BOTTOM inset is intentionally left at 0: the web app already reserves it
 * (BottomNav / AccountScreen use env(safe-area-inset-bottom)), and padding both
 * sides would show a double strip above the gesture bar.
 *
 * The bar ICONS are a separate matter from the bar SPACE. On a white background
 * the system defaults to white icons, which makes the clock, battery and signal
 * disappear entirely (reported from the phone: "top network bar not showing
 * network and battery time"). The theme's windowLightStatusBar is not enough —
 * AndroidX/Capacitor reset the appearance while the WebView starts — so it is
 * asserted again in onCreate and onPostResume.
 */
public class MainActivity extends BridgeActivity {

    private static final int DOWNLOAD_STORAGE_PERMISSION_REQUEST = 7406;
    private Runnable pendingDownloadAfterPermission;
    private PluginCall pendingDownloadCall;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Hand the activity over from the splash theme to the NoActionBar theme.
        // Without this call postSplashScreenTheme is never applied: the activity
        // keeps Theme.SplashScreen, which allows a title bar, and Android draws
        // the app label ("MedRep Pro") above the web header.
        SplashScreen.installSplashScreen(this);
        // Must run before super.onCreate(): BridgeActivity inflates its content
        // view there, and the window flags have to be in place first.
        enableEdgeToEdge();
        registerPlugin(NativeDownloadsPlugin.class);
        super.onCreate(savedInstanceState);
        // Belt and braces: a title bar would sit between the status bar and the
        // WebView, pushing the whole app down and eating the inset we reserve for
        // the clock. The themes are NoActionBar, so this should already be null.
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }
        applyEdgeToEdgeInsets();
        applySystemBarAppearance();
        installDownloadHandler();
    }

    @Override
    public void onPostResume() {
        super.onPostResume();
        // Re-assert once the activity is actually on screen: the startup path
        // resets the appearance flags after onCreate.
        applySystemBarAppearance();
    }

    /**
     * Android WebView ignores the HTML download attribute unless the host
     * Activity handles DownloadListener. Route remote/signed files through the
     * system DownloadManager, and copy bundled template assets into Downloads.
     */
    private void installDownloadHandler() {
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.trim().isEmpty()) {
                showDownloadMessage("This file could not be downloaded.");
                return;
            }
            String fileName = safeFileName(URLUtil.guessFileName(url, contentDisposition, mimeType));
            Uri uri = Uri.parse(url);
            if (isBundledTemplate(uri)) {
                String assetPath = uri.getPath();
                runWithLegacyStoragePermission(() -> saveBundledTemplate(assetPath, fileName, mimeType));
            } else if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                runWithLegacyStoragePermission(() -> enqueueDownload(url, userAgent, fileName, mimeType));
            } else {
                showDownloadMessage("This file type cannot be downloaded here.");
            }
        });
    }

    private boolean isBundledTemplate(Uri uri) {
        String host = uri.getHost();
        String path = uri.getPath();
        return ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host))
                && path != null
                && path.startsWith("/templates/")
                && !path.contains("..")
                && path.matches("/templates/[A-Za-z0-9._/-]+");
    }

    private String safeFileName(String candidate) {
        String value = candidate == null ? "download" : candidate.trim();
        value = value.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
        if (value.isEmpty() || ".".equals(value) || "..".equals(value)) return "download";
        return value;
    }

    private void runWithLegacyStoragePermission(Runnable action) {
        runWithLegacyStoragePermission(action, null);
    }

    private void runWithLegacyStoragePermission(Runnable action, PluginCall pluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                || ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED) {
            action.run();
            return;
        }
        pendingDownloadAfterPermission = action;
        pendingDownloadCall = pluginCall;
        ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE },
                DOWNLOAD_STORAGE_PERMISSION_REQUEST);
    }

    public void saveTemplateFromBridge(String assetPath, String fileName, String mimeType, PluginCall call) {
        if (assetPath == null || !(assetPath.equals("templates/vacancy-template.jpg")
                || assetPath.equals("templates/vacancy-template.docx")
                || assetPath.equals("templates/vacancy-bulk-template.csv"))) {
            call.reject("That template is not available for download.");
            return;
        }
        String safeName = safeFileName(fileName);
        runWithLegacyStoragePermission(() -> {
            if (!saveBundledTemplate("/" + assetPath, safeName, mimeType)) {
                call.reject("Could not save the template. Please try again.");
                return;
            }
            JSObject result = new JSObject();
            result.put("fileName", safeName);
            call.resolve(result);
        }, call);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != DOWNLOAD_STORAGE_PERMISSION_REQUEST) return;
        Runnable action = pendingDownloadAfterPermission;
        PluginCall pluginCall = pendingDownloadCall;
        pendingDownloadAfterPermission = null;
        pendingDownloadCall = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED && action != null) {
            action.run();
        } else {
            if (pluginCall != null) pluginCall.reject("Storage permission is needed to save this file.");
            showDownloadMessage("Storage permission is needed to save this file.");
        }
    }

    private boolean saveBundledTemplate(String assetPath, String fileName, String mimeType) {
        String assetName = "public" + assetPath;
        try (InputStream input = getAssets().open(assetName)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeFor(fileName, mimeType));
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (destination == null) throw new IllegalStateException("Downloads folder is unavailable.");
                try (OutputStream output = getContentResolver().openOutputStream(destination)) {
                    if (output == null) throw new IllegalStateException("Could not open the Downloads file.");
                    copy(input, output);
                } catch (Exception failure) {
                    getContentResolver().delete(destination, null, null);
                    throw failure;
                }
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(destination, completed, null, null);
            } else {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloads.exists() && !downloads.mkdirs()) throw new IllegalStateException("Downloads folder is unavailable.");
                File destination = new File(downloads, fileName);
                try (OutputStream output = new FileOutputStream(destination)) {
                    copy(input, output);
                }
            }
            showDownloadMessage("Saved to Downloads: " + fileName);
            return true;
        } catch (Exception failure) {
            showDownloadMessage("Could not save this template. Please try again.");
            return false;
        }
    }

    private void enqueueDownload(String url, String userAgent, String fileName, String mimeType) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(fileName)
                    .setDescription("Downloading MedRep Pro file")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            String resolvedMime = mimeTypeFor(fileName, mimeType);
            if (resolvedMime != null) request.setMimeType(resolvedMime);
            if (userAgent != null && !userAgent.isEmpty()) request.addRequestHeader("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) request.addRequestHeader("Cookie", cookie);
            manager.enqueue(request);
            showDownloadMessage("Download started: " + fileName);
        } catch (Exception failure) {
            showDownloadMessage("Could not start this download. Please try again.");
        }
    }

    private String mimeTypeFor(String fileName, String supplied) {
        if (supplied != null && !supplied.isEmpty() && !"application/octet-stream".equals(supplied)) return supplied;
        String extension = MimeTypeMap.getFileExtensionFromUrl(fileName);
        String mapped = extension == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(Locale.ROOT));
        return mapped == null ? "application/octet-stream" : mapped;
    }

    private void copy(InputStream input, OutputStream output) throws java.io.IOException {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }

    private void showDownloadMessage(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    /**
     * Opt in to edge-to-edge with transparent bars and dark icons.
     *
     * SystemBarStyle.light() means "light background, therefore dark icons" —
     * the naming is the opposite way round from what it reads like. Passing the
     * same style for both bars keeps the status and navigation bars consistent;
     * the transparent scrim leaves our own white window background visible
     * behind them.
     */
    private void enableEdgeToEdge() {
        EdgeToEdge.enable(
                this,
                SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
                SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT));
    }

    /**
     * Dark icons on the white window background, and the bars always shown.
     *
     * Framework APIs only (no androidx controller), guarded by version:
     *   - API 30+: WindowInsetsController with APPEARANCE_LIGHT_* flags
     *   - API 23-29: the legacy SYSTEM_UI_FLAG_LIGHT_* visibility flags
     * minSdk 24, so both paths exist at compile time and exactly one runs.
     */
    @SuppressWarnings("deprecation")
    private void applySystemBarAppearance() {
        Window window = getWindow();
        if (window == null) {
            return;
        }
        View decor = window.getDecorView();
        if (decor == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int darkIcons = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(darkIcons, darkIcons);
                // The bars carry the time, battery and network — never hide them.
                controller.show(WindowInsets.Type.systemBars());
            }
            return;
        }
        int flags = decor.getSystemUiVisibility();
        flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    private void applyEdgeToEdgeInsets() {
        View content = findViewById(android.R.id.content);
        if (content == null) {
            return;
        }
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, 0);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
