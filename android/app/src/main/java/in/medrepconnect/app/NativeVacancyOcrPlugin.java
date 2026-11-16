package in.medrepconnect.app;

import android.net.Uri;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.IOException;

/** Latin-script, on-device OCR for vacancy flyers. */
@CapacitorPlugin(name = "NativeVacancyOcr")
public class NativeVacancyOcrPlugin extends Plugin {

    @PluginMethod
    public void recognizeFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("The selected image path is missing.");
            return;
        }

        final InputImage image;
        try {
            image = InputImage.fromFilePath(getContext(), Uri.parse(path));
        } catch (IOException exception) {
            call.reject("The selected image could not be opened for OCR.", exception);
            return;
        }

        final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(image)
            .addOnSuccessListener(result -> {
                JSObject response = new JSObject();
                response.put("text", result.getText());
                call.resolve(response);
            })
            .addOnFailureListener(exception -> call.reject("On-device OCR could not read this image.", exception))
            .addOnCompleteListener(task -> recognizer.close());
    }
}
