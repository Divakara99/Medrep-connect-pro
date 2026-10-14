const MAX_IMAGE_BYTES = 12 * 1024 * 1024

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
  const worker = await createWorker('eng', undefined, {
    workerPath: asset('worker.min.js'),
    corePath: asset('tesseract-core-lstm.js'),
    langPath: asset('4.0.0_best_int'),
    cachePath: 'medrep-vacancy-ocr',
    cacheMethod: 'write',
    workerBlobURL: false,
    logger: (message) => onProgress?.(message.status, message.progress),
  })

  try {
    const result = await worker.recognize(image, { rotateAuto: true })
    return result.data.text.trim()
  } finally {
    await worker.terminate()
  }
}
