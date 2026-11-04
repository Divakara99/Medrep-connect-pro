package in.medrepconnect.app;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * MedRep Pro shell.
 *
 * Android 15+ (API 35, and mandatory from 35) draws apps edge-to-edge, so the
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
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyEdgeToEdgeInsets();
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
