import { useEffect, useState } from 'react'
import { Button, Modal } from './ui'
import {
  TUTORIAL_LANGUAGES,
  TUTORIAL_VIDEO_CONFIG_URL,
  isDirectVideoFile,
  preferredTutorialLanguage,
  resolveTutorialVideo,
  sanitizeVideos,
  toEmbeddableUrl,
  type TutorialLanguage,
  type TutorialVideoMap,
} from '../data/tutorial'

/**
 * "How to use the app" — the guided tour behind the button on the sign-in page.
 *
 * Flow (product decision):
 *   1. The button plays nothing by itself — it opens a language choice.
 *   2. After a language is picked, the tour plays in that language, and the
 *      founder's introduction is the first thing the viewer sees.
 *
 * The narration is a REAL recorded video per language. There is no synthetic
 * voice anywhere in this app: a language whose recording is not ready yet shows
 * the written steps instead of computer speech.
 *
 * Video links are read from /tutorial/videos.json on the website every time the
 * sheet opens, so a finished recording goes live without a Play release.
 */

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  )
}

export function HowToUseVideoButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState<TutorialLanguage | null>(null)
  // Links published on the website win over anything baked into the app.
  const [videos, setVideos] = useState<TutorialVideoMap>({})
  const [loadingVideos, setLoadingVideos] = useState(false)

  // Suggested from the phone's language, but the user still chooses: nothing
  // plays until they tap a language.
  const suggested = preferredTutorialLanguage()

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 4000)
    fetch(TUTORIAL_VIDEO_CONFIG_URL, { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : {}))
      .then((json) => setVideos(sanitizeVideos(json)))
      .catch(() => {
        // Offline or the file is missing: the app's own links still work.
      })
      .finally(() => {
        window.clearTimeout(timer)
        setLoadingVideos(false)
      })
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open])

  function videoFor(lang: TutorialLanguage) {
    return resolveTutorialVideo(lang, videos)
  }

  function openTour() {
    setLanguage(null)
    setLoadingVideos(true)
    setOpen(true)
  }

  function closeTour() {
    setOpen(false)
    setLanguage(null)
  }

  const chosen = language ? videoFor(language) : undefined
  const url = chosen?.url

  return (
    <>
      <Button variant="secondary" className={`w-full ${className}`} onClick={openTour}>
        <PlayIcon />
        How to use the app
      </Button>

      <Modal open={open} onClose={closeTour} title={language ? 'How to use MedRep Pro' : 'Choose your language'}>
        {!language ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-slate-700">
              Watch a short walkthrough in your language. The founder introduces the app, then you see every step on screen.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TUTORIAL_LANGUAGES.map((lang) => {
                const recorded = !videoFor(lang).shared
                const isSuggested = lang.code === suggested.code
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                      isSuggested ? 'border-brand-400 bg-brand-50 hover:bg-brand-100' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-base font-bold text-slate-900">{lang.label}</span>
                      <span className="block text-xs font-medium text-slate-500">{lang.english}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        recorded ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {recorded ? 'Video' : 'Walkthrough'}
                    </span>
                  </button>
                )
              })}
            </div>
            {loadingVideos && <p className="text-xs text-slate-500">Checking for the latest videos…</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {url ? (
              isDirectVideoFile(url) ? (
                <video
                  key={url}
                  className="w-full rounded-xl bg-black"
                  src={url}
                  controls
                  autoPlay
                  playsInline
                  lang={language.locale}
                />
              ) : (
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                  <iframe
                    key={url}
                    src={toEmbeddableUrl(url)}
                    title={`MedRep Pro — how to use the app (${language.english})`}
                    className="h-full w-full border-0"
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )
            ) : null}
            {chosen?.shared && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                Silent walkthrough of the app. The spoken {language.english} version is being recorded — the steps are written out below.
              </p>
            )}

            <details className="rounded-xl border border-slate-200 bg-white" open={Boolean(chosen?.shared)}>
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-slate-800">
                Steps in this video
              </summary>
              <ol className="space-y-3 px-4 pb-4">
                {language.slides.map((slide, i) => (
                  <li key={slide.title}>
                    <p className="text-sm font-bold text-slate-900">
                      {i === 0 ? 'Founder' : i}. {slide.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{slide.body}</p>
                  </li>
                ))}
              </ol>
            </details>

            <button
              type="button"
              className="w-full text-center text-sm font-semibold text-brand-700 hover:text-brand-800"
              onClick={closeTour}
            >
              Change language
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
