package in.medrepconnect.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate(): BridgeActivity inflates its content
        // view there, and the window flags have to be in place first.
        enableEdgeToEdge();
        super.onCreate(savedInstanceState);
        // Belt and braces: a title bar would sit between the status bar and the
        // WebView, pushing the whole app down and eating the inset we reserve for
        // the clock. The themes are NoActionBar, so this should already be null.
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }
        applyEdgeToEdgeInsets();
        applySystemBarAppearance();
    }

    @Override
    public void onPostResume() {
        super.onPostResume();
        // Re-assert once the activity is actually on screen: the startup path
        // resets the appearance flags after onCreate.
        applySystemBarAppearance();
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
