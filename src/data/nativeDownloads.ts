import { registerPlugin } from '@capacitor/core'
import { isAndroidApp } from './platform'

type NativeTemplateDownload = {
  assetPath: string
  fileName: string
  mimeType: string
}

type NativeDownloadsPlugin = {
  saveTemplate(options: NativeTemplateDownload): Promise<{ fileName: string }>
}

const nativeDownloads = registerPlugin<NativeDownloadsPlugin>('NativeDownloads')

/**
 * Android WebView does not consistently honor HTML's `download` attribute for
 * bundled assets. Intercept those clicks and ask the native bridge to copy the
 * APK asset into the user's Downloads folder. Web links keep their normal
 * browser download behavior.
 */
export function downloadTemplateInAndroid(
  event: { preventDefault: () => void },
  assetPath: string,
  fileName: string,
  mimeType: string,
): void {
  if (!isAndroidApp()) return
  event.preventDefault()
  void nativeDownloads.saveTemplate({ assetPath, fileName, mimeType }).catch((error: unknown) => {
    console.error('The bundled template could not be saved from the Android app.', error)
  })
}
