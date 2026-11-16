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

function imageAsBase64(image: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected image could not be opened. Choose it again or use Paste text.'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The selected image could not be opened. Choose it again or use Paste text.'))
        return
      }
      const comma = reader.result.indexOf(',')
      if (comma < 0) {
        reject(new Error('The selected image could not be read. Choose it again or use Paste text.'))
        return
      }
      resolve(reader.result.slice(comma + 1))
    }
    reader.readAsDataURL(image)
  })
}

/** Use Android's bundled, on-device ML Kit model rather than a WebView worker. */
async function readNativeVacancyImageText(
  image: File,
  onProgress?: (status: string, progress: number) => void,
): Promise<string> {
  const [{ Filesystem, Directory }, { TextRecognition, Script }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor-mlkit/text-recognition'),
  ])
  const extension = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `vacancy-ocr-${Date.now()}.${extension}`
  onProgress?.('Preparing on-device text recognition…', 0.1)
  const base64 = await withTimeout(
    imageAsBase64(image),
    OCR_WORKER_TIMEOUT_MS,
    'The image could not be prepared for reading. Try again or use Paste text.',
  )
  const { uri } = await withTimeout(
    Filesystem.writeFile({ path, data: base64, directory: Directory.Cache }),
    OCR_WORKER_TIMEOUT_MS,
    'The image could not be prepared for reading. Try again or use Paste text.',
  )

  try {
    onProgress?.('Reading text with on-device OCR…', 0.35)
    const result = await withTimeout(
      TextRecognition.processImage({ path: uri, script: Script.Latin }),
      OCR_WORKER_TIMEOUT_MS,
      'Reading this image took too long. Try a clearer or smaller image, or use Paste text instead.',
    )
    onProgress?.('Finished reading the image.', 1)
    return result.text.trim()
  } finally {
    try { await Filesystem.deleteFile({ path, directory: Directory.Cache }) } catch { /* a cache file is safe to remove later */ }
  }
}

/** OCR a vacancy image locally; native Android uses bundled ML Kit, web uses Tesseract.js. */
export async function readVacancyImageText(
  image: File,
  onProgress?: (status: string, progress: number) => void,
): Promise<string> {
  if (!image.type.startsWith('image/')) throw new Error('Choose a photo or screenshot image file.')
  if (image.size > MAX_IMAGE_BYTES) throw new Error('Choose an image under 12 MB.')
  if (Capacitor.isNativePlatform()) return readNativeVacancyImageText(image, onProgress)

  const { createWorker } = await import('tesseract.js')
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href)
  const asset = (path: string) => new URL(`ocr/${path}`, baseUrl).toString()
  const workerPromise = createWorker('eng', undefined, {
    workerPath: asset('worker.min.js'),
    corePath: asset('tesseract-core-lstm.js'),
    langPath: asset('4.0.0_best_int'),
    cachePath: 'medrep-vacancy-ocr',
    cacheMethod: 'write',
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
    // worker so it does not stay alive in the browser.
    if (!worker) void workerPromise.then((lateWorker) => lateWorker.terminate()).catch(() => undefined)
    throw error
  } finally {
    if (worker) await worker.terminate()
  }
}
