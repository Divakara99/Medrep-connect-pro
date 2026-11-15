package in.medrepconnect.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Native save path for static resources embedded in the Android APK. */
@CapacitorPlugin(name = "NativeDownloads")
public class NativeDownloadsPlugin extends Plugin {

    @PluginMethod
    public void saveTemplate(PluginCall call) {
        String assetPath = call.getString("assetPath");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        if (assetPath == null || fileName == null || fileName.trim().isEmpty()) {
            call.reject("The template download request is incomplete.");
            return;
        }
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("The Android download service is unavailable.");
            return;
        }
        ((MainActivity) getActivity()).saveTemplateFromBridge(assetPath, fileName, mimeType, call);
    }
}
