import { useEffect, useState } from 'react'
import { Button, Modal } from './ui'
import {
  TUTORIAL_LANGUAGES,
  TUTORIAL_SLIDE_MS,
  preferredTutorialLanguage,
  type TutorialLanguage,
} from '../data/tutorial'

/**
 * "How to use the app" — the guided tour behind the button on the sign-in page.
 *
 * Flow (deliberately, per the product decision):
 *   1. The button never plays anything by itself — it opens a language choice.
 *   2. After the user picks a language, the tour plays in that language,
 *      starting with the founder's introduction.
 *
 * Narration prefers, in order:
 *   a recorded video for that language (lang.videoUrl),
 *   a recorded voice-over (lang.audioUrl) or the device's speech engine,
 * and always shows the written steps so a silent device loses nothing.
 */

const speechAvailable = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

function stopSpeaking() {
  if (!speechAvailable()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // A cancelled queue is not an error worth surfacing.
  }
}

function speak(text: string, lang: string): boolean {
  if (!speechAvailable()) return false
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    // Slightly slower than default: phone speakers + unfamiliar accents.
    utterance.rate = 0.95
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    return false
  }
}

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
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Capability of the device, not state to synchronise: read it once.
  const [voiceReady] = useState(speechAvailable)

  // Pick the device language as the highlighted suggestion, without deciding
  // for the user: they still have to tap a language to start.
  const suggested = preferredTutorialLanguage()

  // Closing must always kill the narration queue, otherwise the voice keeps
  // reading after the sheet is gone.
  function closeTour() {
    stopSpeaking()
    setOpen(false)
    setLanguage(null)
    setIndex(0)
    setPlaying(false)
  }

  function openTour() {
    stopSpeaking()
    setLanguage(null)
    setIndex(0)
    setPlaying(false)
    setOpen(true)
  }

  // Unmount (navigating away from sign-in) must stop the audio too.
  useEffect(() => () => stopSpeaking(), [])

  useEffect(() => {
    if (!open || !language || !playing) return
    // A recorded video brings its own audio and timing.
    if (language.videoUrl) return
    const slide = language.slides[index]
    if (!slide) return
    speak(slide.body, language.voice)
    const timer = window.setTimeout(() => {
      if (index + 1 < language.slides.length) setIndex(index + 1)
      else setPlaying(false)
    }, TUTORIAL_SLIDE_MS)
    return () => {
      window.clearTimeout(timer)
      stopSpeaking()
    }
  }, [open, language, index, playing])

  function chooseLanguage(next: TutorialLanguage) {
    setLanguage(next)
    setIndex(0)
    setPlaying(true)
  }

  const slide = language?.slides[index]
  const total = language?.slides.length ?? 0

  return (
    <>
      <Button variant="secondary" className={`w-full ${className}`} onClick={openTour}>
        <PlayIcon />
        How to use the app
      </Button>

      <Modal open={open} onClose={closeTour} title={language ? 'How to use MedRep Pro' : 'Choose your language'}>
        {!language ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">
              Watch a one-minute tour in your language. The founder explains the app, then you see each step on screen.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TUTORIAL_LANGUAGES.map((lang) => {
                const isSuggested = lang.code === suggested.code
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => chooseLanguage(lang)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                      isSuggested
                        ? 'border-brand-400 bg-brand-50 hover:bg-brand-100'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-base font-bold text-slate-900">{lang.label}</span>
                      <span className="block text-xs font-medium text-slate-500">{lang.english}</span>
                    </span>
                    <span aria-hidden="true" className="text-brand-600">
                      ▸
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-500">
              Spoken aloud when your phone supports the language; the written steps are always shown.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {language.videoUrl ? (
              <video
                key={language.videoUrl}
                className="w-full rounded-xl bg-black"
                src={language.videoUrl}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-bold text-white">
                    {index === 0 ? 'Founder' : `Step ${index} of ${total - 1}`}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {index + 1} / {total}
                  </span>
                </div>
                <h4 className="mt-2 text-lg font-bold leading-snug text-slate-900">{slide?.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{slide?.body}</p>
                {language.audioUrl && (
                  <audio key={`${language.code}-${index}`} src={language.audioUrl} autoPlay className="mt-3 w-full" controls />
                )}
                {!language.audioUrl && !voiceReady && (
                  <p className="mt-3 text-xs font-medium text-amber-700">
                    Voice is not available on this device — read the steps above.
                  </p>
                )}
              </div>
            )}

            {!language.videoUrl && (
              <>
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {language.slides.map((s, i) => (
                    <span
                      key={s.title}
                      className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-brand-600' : 'bg-slate-200'}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    disabled={index === 0}
                    onClick={() => {
                      setIndex(Math.max(0, index - 1))
                      setPlaying(true)
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    variant={playing ? 'secondary' : 'primary'}
                    onClick={() => {
                      if (!playing && index === total - 1) setIndex(0)
                      setPlaying(!playing)
                    }}
                  >
                    {playing ? 'Pause' : index === total - 1 ? 'Replay' : 'Play'}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={index >= total - 1}
                    onClick={() => {
                      setIndex(Math.min(total - 1, index + 1))
                      setPlaying(true)
                    }}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}

            <button
              type="button"
              className="w-full text-center text-sm font-semibold text-brand-700 hover:text-brand-800"
              onClick={() => {
                stopSpeaking()
                setPlaying(false)
                setLanguage(null)
                setIndex(0)
              }}
            >
              Change language
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
