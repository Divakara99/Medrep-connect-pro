import { Capacitor } from '@capacitor/core'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const OCR_WORKER_TIMEOUT_MS = 90_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** OCR a vacancy image locally in this browser; the original image is not uploaded. */
export async function readVacancyImageText(
  image: File,
  onProgress?: (status: string, progress: number) => void,
): Promise<string> {
  if (!image.type.startsWith('image/')) throw new Error('Choose a photo or screenshot image file.')
  if (image.size > MAX_IMAGE_BYTES) throw new Error('Choose an image under 12 MB.')

  const { createWorker } = await import('tesseract.js')
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href)
  const asset = (path: string) => new URL(`ocr/${path}`, baseUrl).toString()
  const workerPromise = createWorker('eng', undefined, {
    workerPath: asset('worker.min.js'),
    corePath: asset('tesseract-core-lstm.js'),
    langPath: asset('4.0.0_best_int'),
    cachePath: 'medrep-vacancy-ocr',
    // IndexedDB can stall or be unavailable in some Android WebViews. The
    // compact English model is bundled locally, so skip that cache on native;
    // websites keep the cache to make later scans faster.
    cacheMethod: Capacitor.isNativePlatform() ? 'none' : 'write',
    workerBlobURL: false,
    logger: (message) => {
      const status = message.status === 'loading language traineddata'
        ? 'Loading offline English OCR data (first scan may take a little while)…'
        : message.status
      onProgress?.(status, message.progress)
    },
  })

  let worker
  try {
    worker = await withTimeout(
      workerPromise,
      OCR_WORKER_TIMEOUT_MS,
      'OCR could not start after 90 seconds. Try again or use Paste text instead.',
    )
    const result = await withTimeout(
      worker.recognize(image, { rotateAuto: true }),
      OCR_WORKER_TIMEOUT_MS,
      'Reading this image took too long. Try a clearer or smaller image, or use Paste text instead.',
    )
    return result.data.text.trim()
  } catch (error) {
    // Tesseract can finish initialization after the UI timeout; stop that late
    // worker so it does not stay alive in the Android WebView.
    if (!worker) void workerPromise.then((lateWorker) => lateWorker.terminate()).catch(() => undefined)
    throw error
  } finally {
    if (worker) await worker.terminate()
  }
}
