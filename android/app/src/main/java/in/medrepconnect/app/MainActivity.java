package in.medrepconnect.app;

import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * MedRep Pro shell.
 *
 * Android 15+ (API 35, mandatory from 36) draws apps edge-to-edge, so the
 * WebView starts underneath the status bar — testers saw the clock sitting on
 * top of the header, and Play Console reports "Edge-to-edge may not display for
 * all users". Instead of trying to opt out (Android 16 ignores the opt-out for
 * apps targeting 36), pad the content view by the real system-bar / cutout
 * insets. The top inset clears the status bar, the side insets handle camera
 * cutouts in landscape.
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
        super.onCreate(savedInstanceState);
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

    private void applySystemBarAppearance() {
        Window window = getWindow();
        if (window == null) {
            return;
        }
        View decor = window.getDecorView();
        if (decor == null) {
            return;
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        // White window background: dark clock/battery/signal icons, and dark
        // gesture-bar handle. Without this they are white on white.
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
        // The bars themselves always stay visible — they carry the time,
        // battery and network the user expects to see.
        controller.show(WindowInsetsCompat.Type.systemBars());
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
