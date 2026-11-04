/**
 * "How to use MedRep Pro" — the guided tour shown before signing in.
 *
 * Design notes
 * ------------
 * The tour is a REAL recorded walkthrough (screen recording with a human voice),
 * not a synthetic voice reading slides. Recording one per language is the only
 * supported narration path; the written steps below are the recording script,
 * the on-screen fallback while a language is still being recorded, and the
 * accessibility text.
 *
 * Wiring a finished video — no app release needed:
 *   1. Upload the recording (unlisted YouTube, ScreenPal, or an MP4 served from
 *      https://medrepconnect.in/tutorial/<code>.mp4).
 *   2. Put the link in https://medrepconnect.in/tutorial/videos.json, e.g.
 *      { "en": "https://go.screenpal.com/player/abc123", "hi": "https://youtu.be/xyz" }
 *      (the file lives at public/tutorial/videos.json in this repo and deploys
 *      with the website).
 *   3. The app reads that file when the tour opens and plays the matching video.
 *      Language codes without a link show the written steps until their video
 *      arrives.
 *
 * A link ending in .mp4/.webm plays in a native <video> player; anything else
 * (YouTube, ScreenPal, Vimeo) is embedded in its own player. See TUTORIAL.md.
 */

export type TutorialLanguageCode = 'en' | 'hi' | 'te' | 'ta' | 'kn' | 'ml' | 'mr'

export type TutorialSlide = {
  /** Short heading shown on the slide. */
  title: string
  /** Spoken aloud and shown as the caption. */
  body: string
}

export type TutorialLanguage = {
  code: TutorialLanguageCode
  /** Native name, shown first in the picker. */
  label: string
  /** English name, shown under the native one. */
  english: string
  /** BCP-47 tag, used for the video's lang attribute and captions. */
  locale: string
  /**
   * Fallback video link baked into the app. Leave unset to rely on
   * /tutorial/videos.json (the normal case: links are added there so no app
   * release is needed when a recording finishes).
   */
  videoUrl?: string
  slides: TutorialSlide[]
}

/**
 * Where the app looks for finished recordings when the tour opens. Lives on the
 * website so a new language video goes live without shipping a new APK.
 * Shape: { "en": "https://…", "hi": "https://…" }
 */
export const TUTORIAL_VIDEO_CONFIG_URL = 'https://medrepconnect.in/tutorial/videos.json'

/**
 * The walkthrough that ships inside the app: 44 s, 1080x1920, built from this
 * project's own screens by scripts/build-tutorial-video.py. It is SILENT on
 * purpose — narration must be the founder's recorded voice, never synthetic.
 * Bundled (not streamed) so it also works offline and adds < 1 MB to the APK.
 */
export const TUTORIAL_DEFAULT_VIDEO = '/tutorial/walkthrough.mp4'

/**
 * Which video a language should play.
 *   shared: true  → the bundled silent walkthrough (no recording for this
 *                   language yet), so the UI can say the spoken version is
 *                   still being recorded.
 *   shared: false → a real per-language recording from videos.json / videoUrl.
 */
export function resolveTutorialVideo(
  language: TutorialLanguage,
  videos: TutorialVideoMap,
): { url: string; shared: boolean } {
  const specific = videos[language.code] ?? language.videoUrl
  return specific ? { url: specific, shared: false } : { url: TUTORIAL_DEFAULT_VIDEO, shared: true }
}

/** A language → link map, e.g. { en: 'https://…', hi: 'https://…' }. */
export type TutorialVideoMap = Partial<Record<TutorialLanguageCode, string>>

/**
 * Accepts only real http(s) links and only for languages we ship, so a broken or
 * hostile videos.json can never inject markup into the player.
 */
export function sanitizeVideos(value: unknown): TutorialVideoMap {
  if (!value || typeof value !== 'object') return {}
  const out: TutorialVideoMap = {}
  for (const lang of TUTORIAL_LANGUAGES) {
    const raw = (value as Record<string, unknown>)[lang.code]
    if (typeof raw !== 'string') continue
    const url = raw.trim()
    if (/^https?:\/\//i.test(url)) out[lang.code] = url
  }
  return out
}

/**
 * Turns a shared link into something a player can embed: youtu.be/ID and
 * youtube.com/watch?v=ID become the /embed/ form, a ScreenPal watch page becomes
 * its player page. Anything else is returned unchanged.
 */
export function toEmbeddableUrl(url: string): string {
  const trimmed = url.trim()
  const yt = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0&playsinline=1`
  const screenpal = trimmed.match(/^https?:\/\/go\.screenpal\.com\/watch\/([\w-]+)/i)
  if (screenpal) return `https://go.screenpal.com/player/${screenpal[1]}`
  return trimmed
}

/** True for links we can hand to a <video> element instead of an iframe. */
export function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|webm|m4v|mov)(\?.*)?$/i.test(url.trim())
}

/**
 * Order matters: English first (safe fallback), then the languages the app is
 * most used in. Adding a language = adding one object here; the picker, the
 * speech engine and the player all read from this list.
 */
export const TUTORIAL_LANGUAGES: TutorialLanguage[] = [
  {
    code: 'en',
    label: 'English',
    english: 'English',
    locale: 'en-IN',
    videoUrl: '/tutorial/en.mp4',
    slides: [
      {
        title: 'Created by M Divakar Reddy',
        body: 'MedRep Pro is the idea of M Divakar Reddy, who has spent years on the road in India pharma field. He built this app so job seekers find the right opening faster. This short tour shows how it works.',
      },
      {
        title: 'Create your free account',
        body: 'Tap Create account, enter your name, email and a password of at least six characters. If you already have an account, sign in with your email and password. Your account is free for life.',
      },
      {
        title: 'Find the right vacancy',
        body: 'Home lists live openings for medical representatives plus FMCG, finance, banking, IT, healthcare, insurance and field sales roles. Urgent jobs are pinned first, and search and filters cover city, role, experience and salary.',
      },
      {
        title: 'Unlock the company name free',
        body: 'On a locked job, tap Watch video to unlock company name. One short video unlocks that company for you permanently. There is no daily limit, and this costs nothing.',
      },
      {
        title: 'See manager contacts with a pass',
        body: 'Manager name, email and phone numbers are for subscribers. Open Plans and choose a one-time pass, from nineteen rupees for one day to one thousand seven hundred ninety nine for one year, paid safely through Google Play. Nothing renews automatically.',
      },
      {
        title: 'Apply in one tap',
        body: 'Complete your profile and resume once, open any job and tap Apply. Your email app or WhatsApp opens with the application ready, and you always review it before sending. That is all — welcome to MedRep Pro.',
      },
    ],
  },
  {
    code: 'hi',
    label: 'हिन्दी',
    english: 'Hindi',
    locale: 'hi-IN',
    videoUrl: '/tutorial/hi.mp4',
    slides: [
      {
        title: 'एम दिवाकर रेड्डी द्वारा बनाया गया',
        body: 'मेडरेप प्रो एम दिवाकर रेड्डी का विचार है, जिन्होंने भारत के फार्मा क्षेत्र में वर्षों फील्ड में काम किया है। उन्होंने यह ऐप बनाया ताकि नौकरी खोजने वालों को सही अवसर जल्दी मिले। इस छोटे वीडियो में देखिए यह कैसे काम करता है।',
      },
      {
        title: 'अपना मुफ़्त खाता बनाएँ',
        body: 'क्रिएट अकाउंट दबाइए, अपना नाम, ईमेल और कम से कम छह अक्षर का पासवर्ड डालिए। खाता पहले से हो तो ईमेल और पासवर्ड से साइन इन करें। खाता जीवन भर मुफ़्त है।',
      },
      {
        title: 'अपनी सही नौकरी खोजें',
        body: 'होम पर मेडिकल रिप्रेजेंटेटिव के साथ एफएमसीजी, फाइनेंस, बैंकिंग, आईटी, हेल्थकेयर, बीमा और फील्ड सेल्स की ताज़ा नौकरियाँ दिखती हैं। ज़रूरी नौकरियाँ पहले पिन होती हैं, और शहर, पद, अनुभव व सैलरी के फ़िल्टर उपलब्ध हैं।',
      },
      {
        title: 'कंपनी का नाम मुफ़्त खोलें',
        body: 'बंद नौकरी पर वॉच वीडियो टू अनलॉक कंपनी नेम दबाइए। एक छोटा वीडियो उस कंपनी का नाम हमेशा के लिए खोल देता है। कोई दैनिक सीमा नहीं और कोई शुल्क नहीं।',
      },
      {
        title: 'पास से मैनेजर के संपर्क देखें',
        body: 'मैनेजर का नाम, ईमेल और फ़ोन नंबर सब्सक्राइबर के लिए हैं। प्लान्स खोलिए और एक बार का पास चुनिए, उन्नीस रुपये एक दिन से लेकर एक हज़ार सात सौ निन्यानवे रुपये एक साल तक, गूगल प्ले से सुरक्षित भुगतान। कोई ऑटो नवीनीकरण नहीं।',
      },
      {
        title: 'एक टैप में आवेदन करें',
        body: 'अपनी प्रोफ़ाइल और रिज़्यूमे एक बार भरें, कोई नौकरी खोलें और अप्लाई दबाएँ। ईमेल या व्हाट्सएप में आवेदन तैयार खुलता है, भेजने से पहले आप उसे देख सकते हैं। स्वागत है मेडरेप प्रो में।',
      },
    ],
  },
  {
    code: 'te',
    label: 'తెలుగు',
    english: 'Telugu',
    locale: 'te-IN',
    videoUrl: '/tutorial/te.mp4',
    slides: [
      {
        title: 'ఎం దివాకర్ రెడ్డి రూపకల్పన',
        body: 'మెడ్‌రెప్ ప్రో ఎం దివాకర్ రెడ్డి ఆలోచన. ఆయన భారతదేశ ఫార్మా రంగంలో ఎన్నో సంవత్సరాలు ఫీల్డ్‌లో పనిచేశారు. ఉద్యోగం వెతికేవారికి సరైన అవకాశం త్వరగా దొరకాలని ఈ యాప్‌ను తయారు చేశారు. ఈ చిన్న వీడియోలో ఎలా పనిచేస్తుందో చూడండి.',
      },
      {
        title: 'మీ ఉచిత ఖాతా సృష్టించండి',
        body: 'క్రియేట్ అకౌంట్ నొక్కి, మీ పేరు, ఈమెయిల్ మరియు కనీసం ఆరు అక్షరాల పాస్‌వర్డ్ ఇవ్వండి. ఖాతా ఉంటే ఈమెయిల్, పాస్‌వర్డ్‌తో సైన్ ఇన్ చేయండి. ఖాతా జీవితాంతం ఉచితం.',
      },
      {
        title: 'సరైన ఉద్యోగం వెతకండి',
        body: 'హోమ్‌లో మెడికల్ రిప్రజెంటేటివ్‌తో పాటు ఎఫ్ఎంసీజీ, ఫైనాన్స్, బ్యాంకింగ్, ఐటీ, హెల్త్‌కేర్, ఇన్సూరెన్స్ మరియు ఫీల్డ్ సేల్స్ ఉద్యోగాలు కనిపిస్తాయి. అత్యవసర ఉద్యోగాలు మొదట పిన్ అవుతాయి, నగరం, పదవి, అనుభవం, జీతం ఫిల్టర్లు ఉన్నాయి.',
      },
      {
        title: 'కంపెనీ పేరు ఉచితంగా తెరవండి',
        body: 'లాక్ ఉన్న ఉద్యోగంలో వాచ్ వీడియో టు అన్‌లాక్ కంపెనీ నేమ్ నొక్కండి. ఒక చిన్న వీడియో ఆ కంపెనీ పేరును శాశ్వతంగా తెరుస్తుంది. రోజువారీ పరిమితి లేదు, ఎటువంటి ఖర్చు లేదు.',
      },
      {
        title: 'పాస్‌తో మేనేజర్ నంబర్లు',
        body: 'మేనేజర్ పేరు, ఈమెయిల్, ఫోన్ నంబర్లు సబ్‌స్క్రైబర్లకు. ప్లాన్స్ తెరిచి ఒకసారి చెల్లించే పాస్ ఎంచుకోండి, పంతొమ్మిది రూపాయల నుండి ఒక రోజుకు, వెయ్యి ఏడు వందల తొంభై తొమ్మిది రూపాయల వరకు ఒక సంవత్సరానికి, గూగుల్ ప్లే ద్వారా సురక్షితం. ఆటో రిన్యూల్ ఉండదు.',
      },
      {
        title: 'ఒక ట్యాప్‌తో దరఖాస్తు',
        body: 'మీ ప్రొఫైల్ మరియు రెజ్యూమె ఒకసారి నింపండి, ఉద్యోగం తెరిచి అప్లై నొక్కండి. ఈమెయిల్ లేదా వాట్సాప్‌లో దరఖాస్తు సిద్ధంగా తెరుచుకుంటుంది, పంపే ముందు మీరు చూడవచ్చు. మెడ్‌రెప్ ప్రోకు స్వాగతం.',
      },
    ],
  },
  {
    code: 'ta',
    label: 'தமிழ்',
    english: 'Tamil',
    locale: 'ta-IN',
    videoUrl: '/tutorial/ta.mp4',
    slides: [
      {
        title: 'எம் திவாகர் ரெட்டி உருவாக்கியது',
        body: 'மெட்ரெப் புரோ எம் திவாகர் ரெட்டியின் யோசனை; இந்திய பார்மா துறையில் பல ஆண்டுகள் களத்தில் பணியாற்றியவர். வேலை தேடுபவர்களுக்கு சரியான வாய்ப்பு விரைவாக கிடைக்க இந்த செயலியை உருவாக்கினார். இந்த சிறு வீடியோவில் அது எப்படி வேலை செய்கிறது என்று பாருங்கள்.',
      },
      {
        title: 'உங்கள் இலவச கணக்கை உருவாக்குங்கள்',
        body: 'கிரியேட் அக்கவுன்ட் என்பதைத் தட்டி, உங்கள் பெயர், மின்னஞ்சல் மற்றும் குறைந்தது ஆறு எழுத்து கடவுச்சொல்லை இடுங்கள். கணக்கு இருந்தால் மின்னஞ்சல், கடவுச்சொல்லால் உள்நுழையுங்கள். கணக்கு வாழ்நாள் முழுவதும் இலவசம்.',
      },
      {
        title: 'சரியான வேலையைத் தேர்வு செய்யுங்கள்',
        body: 'முகப்பில் மருத்துவ பிரதிநிதி வேலைகளுடன் எஃப்எம்சிஜி, நிதி, வங்கி, ஐடி, சுகாதாரம், காப்பீடு மற்றும் ஃபீல்ட் செல்ஸ் வேலைகளும் தெரியும். அவசர வேலைகள் முதலில் பின் செய்யப்படும்; நகரம், பதவி, அனுபவம், சம்பளம் வடிகட்டிகள் உள்ளன.',
      },
      {
        title: 'நிறுவனப் பெயரை இலவசமாகத் திறங்கள்',
        body: 'பூட்டப்பட்ட வேலையில் வாட்ச் வீடியோ டு அன்லாக் கம்பெனி நேம் என்பதைத் தட்டுங்கள். ஒரு சிறு வீடியோ அந்த நிறுவனத்தின் பெயரை நிரந்தரமாகத் திறக்கும். தினசரி வரம்பு இல்லை, கட்டணம் இல்லை.',
      },
      {
        title: 'பாஸ் மூலம் மேலாளர் தொடர்புகள்',
        body: 'மேலாளர் பெயர், மின்னஞ்சல், தொலைபேசி எண்கள் சந்தாதாரர்களுக்கு. பிளான்ஸ் திறந்து ஒருமுறை செலுத்தும் பாஸைத் தேர்வு செய்யுங்கள், பத்தொன்பது ரூபாய் ஒரு நாளுக்கு முதல் ஆயிரத்து எழுநூற்று தொண்ணூற்று ஒன்பது ரூபாய் ஒரு வருடத்திற்கு, கூகுள் பிளே மூலம் பாதுகாப்பாக. தானாக புதுப்பிப்பு இல்லை.',
      },
      {
        title: 'ஒரு தட்டலில் விண்ணப்பம்',
        body: 'உங்கள் சுயவிவரம் மற்றும் ரெஸ்யூமை ஒருமுறை நிரப்பி, வேலையைத் திறந்து அப்ளை என்பதைத் தட்டுங்கள். மின்னஞ்சல் அல்லது வாட்ஸ்அப்பில் விண்ணப்பம் தயாராகத் திறக்கும், அனுப்பும் முன் நீங்கள் பார்க்கலாம். மெட்ரெப் புரோவுக்கு வருக.',
      },
    ],
  },
  {
    code: 'kn',
    label: 'ಕನ್ನಡ',
    english: 'Kannada',
    locale: 'kn-IN',
    videoUrl: '/tutorial/kn.mp4',
    slides: [
      {
        title: 'ಎಂ ದಿವಾಕರ್ ರೆಡ್ಡಿ ರಚನೆ',
        body: 'ಮೆಡ್‌ರೆಪ್ ಪ್ರೊ ಎಂ ದಿವಾಕರ್ ರೆಡ್ಡಿ ಅವರ ಕಲ್ಪನೆ; ಭಾರತದ ಫಾರ್ಮಾ ಕ್ಷೇತ್ರದಲ್ಲಿ ಹಲವು ವರ್ಷ ಫೀಲ್ಡ್‌ನಲ್ಲಿ ಕೆಲಸ ಮಾಡಿದ್ದಾರೆ. ಉದ್ಯೋಗ ಹುಡುಕುವವರಿಗೆ ಸರಿಯಾದ ಅವಕಾಶ ಬೇಗ ಸಿಗಲಿ ಎಂದು ಈ ಆ್ಯಪ್ ಮಾಡಿದ್ದಾರೆ. ಈ ಸಣ್ಣ ವೀಡಿಯೊದಲ್ಲಿ ಅದು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ ಎಂದು ನೋಡಿ.',
      },
      {
        title: 'ನಿಮ್ಮ ಉಚಿತ ಖಾತೆ ತೆರೆಯಿರಿ',
        body: 'ಕ್ರಿಯೇಟ್ ಅಕೌಂಟ್ ಒತ್ತಿ, ನಿಮ್ಮ ಹೆಸರು, ಇಮೇಲ್ ಮತ್ತು ಕನಿಷ್ಠ ಆರು ಅಕ್ಷರಗಳ ಪಾಸ್‌ವರ್ಡ್ ಹಾಕಿ. ಖಾತೆ ಇದ್ದರೆ ಇಮೇಲ್ ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡಿ. ಖಾತೆ ಜೀವನಪರ್ಯಂತ ಉಚಿತ.',
      },
      {
        title: 'ಸರಿಯಾದ ಉದ್ಯೋಗ ಹುಡುಕಿ',
        body: 'ಹೋಂನಲ್ಲಿ ಮೆಡಿಕಲ್ ಪ್ರತಿನಿಧಿ ಉದ್ಯೋಗಗಳ ಜೊತೆಗೆ ಎಫ್‌ಎಂಸಿಜಿ, ಫೈನಾನ್ಸ್, ಬ್ಯಾಂಕಿಂಗ್, ಐಟಿ, ಹೆಲ್ತ್‌ಕೇರ್, ವಿಮೆ ಮತ್ತು ಫೀಲ್ಡ್ ಸೇಲ್ಸ್ ಉದ್ಯೋಗಗಳು ಕಾಣುತ್ತವೆ. ತುರ್ತು ಉದ್ಯೋಗಗಳು ಮೊದಲು ಪಿನ್ ಆಗುತ್ತವೆ; ನಗರ, ಹುದ್ದೆ, ಅನುಭವ, ಸಂಬಳ ಫಿಲ್ಟರ್‌ಗಳಿವೆ.',
      },
      {
        title: 'ಕಂಪನಿ ಹೆಸರು ಉಚಿತವಾಗಿ ತೆರೆಯಿರಿ',
        body: 'ಲಾಕ್ ಆಗಿರುವ ಉದ್ಯೋಗದಲ್ಲಿ ವಾಚ್ ವೀಡಿಯೊ ಟು ಅನ್‌ಲಾಕ್ ಕಂಪನಿ ನೇಮ್ ಒತ್ತಿ. ಒಂದು ಸಣ್ಣ ವೀಡಿಯೊ ಆ ಕಂಪನಿಯ ಹೆಸರನ್ನು ಶಾಶ್ವತವಾಗಿ ತೆರೆಯುತ್ತದೆ. ದಿನದ ಮಿತಿ ಇಲ್ಲ, ಶುಲ್ಕ ಇಲ್ಲ.',
      },
      {
        title: 'ಪಾಸ್‌ನಿಂದ ಮ್ಯಾನೇಜರ್ ಸಂಪರ್ಕ',
        body: 'ಮ್ಯಾನೇಜರ್ ಹೆಸರು, ಇಮೇಲ್ ಮತ್ತು ಫೋನ್ ಸಂಖ್ಯೆಗಳು ಚಂದಾದಾರರಿಗೆ. ಪ್ಲಾನ್ಸ್ ತೆರೆದು ಒಮ್ಮೆ ಪಾವತಿಸುವ ಪಾಸ್ ಆಯ್ಕೆ ಮಾಡಿ, ಹತ್ತೊಂಬತ್ತು ರೂಪಾಯಿಯಿಂದ ಒಂದು ದಿನಕ್ಕೆ, ಸಾವಿರದ ಏಳುನೂರ ತೊಂಬತ್ತೊಂಬತ್ತು ರೂಪಾಯಿವರೆಗೆ ಒಂದು ವರ್ಷಕ್ಕೆ, ಗೂಗಲ್ ಪ್ಲೇ ಮೂಲಕ ಸುರಕ್ಷಿತ. ಸ್ವಯಂ ನವೀಕರಣ ಇಲ್ಲ.',
      },
      {
        title: 'ಒಂದೇ ಟ್ಯಾಪ್‌ನಲ್ಲಿ ಅರ್ಜಿ',
        body: 'ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ಮತ್ತು ರೆಸ್ಯೂಮೆ ಒಮ್ಮೆ ಭರ್ತಿ ಮಾಡಿ, ಉದ್ಯೋಗ ತೆರೆದು ಅಪ್ಲೈ ಒತ್ತಿ. ಇಮೇಲ್ ಅಥವಾ ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಅರ್ಜಿ ಸಿದ್ಧವಾಗಿ ತೆರೆಯುತ್ತದೆ, ಕಳುಹಿಸುವ ಮೊದಲು ನೀವು ನೋಡಬಹುದು. ಮೆಡ್‌ರೆಪ್ ಪ್ರೊಗೆ ಸ್ವಾಗತ.',
      },
    ],
  },
  {
    code: 'ml',
    label: 'മലയാളം',
    english: 'Malayalam',
    locale: 'ml-IN',
    videoUrl: '/tutorial/ml.mp4',
    slides: [
      {
        title: 'എം ദിവാകർ റെഡ്ഡിയുടെ ആശയം',
        body: 'മെഡ്‌റെപ് പ്രോ എം ദിവാകർ റെഡ്ഡിയുടെ ആശയമാണ്; ഇന്ത്യയുടെ ഫാർമ മേഖലയിൽ വർഷങ്ങളായി ഫീൽഡിൽ പ്രവർത്തിച്ചു. ജോലി തേടുന്നവർക്ക് ശരിയായ അവസരം വേഗത്തിൽ ലഭിക്കാൻ ഈ ആപ്പ് ഉണ്ടാക്കി. ഈ ചെറിയ വീഡിയോയിൽ അത് എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് കാണാം.',
      },
      {
        title: 'സൗജന്യ അക്കൗണ്ട് തുടങ്ങുക',
        body: 'ക്രിയേറ്റ് അക്കൗണ്ട് അമർത്തി പേര്, ഇമെയിൽ, കുറഞ്ഞത് ആറ് അക്ഷരമുള്ള പാസ്‌വേഡ് നൽകുക. അക്കൗണ്ട് ഉണ്ടെങ്കിൽ ഇമെയിലും പാസ്‌വേഡും ഉപയോഗിച്ച് സൈൻ ഇൻ ചെയ്യുക. അക്കൗണ്ട് ജീവിതകാലം സൗജന്യമാണ്.',
      },
      {
        title: 'ശരിയായ ജോലി കണ്ടെത്തുക',
        body: 'ഹോമിൽ മെഡിക്കൽ റെപ്രസന്റേറ്റീവ് ജോലികൾക്കൊപ്പം എഫ്എംസിജി, ധനകാര്യം, ബാങ്കിംഗ്, ഐടി, ആരോഗ്യം, ഇൻഷുറൻസ്, ഫീൽഡ് സെയിൽസ് ജോലികളും കാണാം. അടിയന്തിര ജോലികൾ ആദ്യം പിൻ ചെയ്യും; നഗരം, പദവി, പരിചയം, ശമ്പളം ഫിൽട്ടറുകളുണ്ട്.',
      },
      {
        title: 'കമ്പനിയുടെ പേര് സൗജന്യമായി തുറക്കുക',
        body: 'ലോക്ക് ചെയ്ത ജോലിയിൽ വാച്ച് വീഡിയോ ടു അൺലോക്ക് കമ്പനി നെയിം അമർത്തുക. ഒരു ചെറിയ വീഡിയോ ആ കമ്പനിയുടെ പേര് എന്നെന്നേക്കുമായി തുറക്കും. ദിവസേനയുള്ള പരിധിയില്ല, ചെലവില്ല.',
      },
      {
        title: 'പാസ് ഉപയോഗിച്ച് മാനേജർ വിവരങ്ങൾ',
        body: 'മാനേജരുടെ പേര്, ഇമെയിൽ, ഫോൺ നമ്പർ എന്നിവ സബ്‌സ്‌ക്രൈബർമാർക്ക്. പ്ലാൻസ് തുറന്ന് ഒറ്റത്തവണ പണമടയ്ക്കുന്ന പാസ് തിരഞ്ഞെടുക്കുക, പത്തൊമ്പത് രൂപ ഒരു ദിവസത്തിന് മുതൽ ആയിരത്തി എഴുന്നൂറ്റി തൊണ്ണൂറ്റിയൊമ്പത് രൂപ ഒരു വർഷത്തിന് വരെ, ഗൂഗിൾ പ്ലേ വഴി സുരക്ഷിതം. സ്വയം പുതുക്കൽ ഇല്ല.',
      },
      {
        title: 'ഒരു ടാപ്പിൽ അപേക്ഷ',
        body: 'പ്രൊഫൈലും റെസ്യൂമെയും ഒരിക്കൽ പൂരിപ്പിച്ച്, ജോലി തുറന്ന് അപ്ലൈ അമർത്തുക. ഇമെയിലിലോ വാട്ട്‌സ്ആപ്പിലോ അപേക്ഷ തയ്യാറായി തുറക്കും, അയയ്ക്കുന്നതിന് മുൻപ് നിങ്ങൾക്ക് പരിശോധിക്കാം. മെഡ്‌റെപ് പ്രോയിലേക്ക് സ്വാഗതം.',
      },
    ],
  },
  {
    code: 'mr',
    label: 'मराठी',
    english: 'Marathi',
    locale: 'mr-IN',
    videoUrl: '/tutorial/mr.mp4',
    slides: [
      {
        title: 'एम दिवाकर रेड्डी यांची निर्मिती',
        body: 'मेडरेप प्रो एम दिवाकर रेड्डी यांची कल्पना आहे; त्यांनी भारताच्या फार्मा क्षेत्रात अनेक वर्षे फील्डमध्ये काम केले आहे. नोकरी शोधणाऱ्यांना योग्य संधी लवकर मिळावी म्हणून त्यांनी हे अ‍ॅप बनवले. या छोट्या व्हिडिओत ते कसे काम करते ते पहा.',
      },
      {
        title: 'तुमचे मोफत खाते तयार करा',
        body: 'क्रिएट अकाउंट दाबा, तुमचे नाव, ईमेल आणि किमान सहा अक्षरांचा पासवर्ड टाका. खाते असल्यास ईमेल आणि पासवर्डने साइन इन करा. खाते आयुष्यभर मोफत आहे.',
      },
      {
        title: 'योग्य नोकरी शोधा',
        body: 'होमवर मेडिकल रिप्रेझेंटेटिव्हसह एफएमसीजी, फायनान्स, बँकिंग, आयटी, हेल्थकेअर, विमा आणि फील्ड सेल्स नोकऱ्या दिसतात. तातडीच्या नोकऱ्या आधी पिन होतात; शहर, पद, अनुभव आणि पगाराचे फिल्टर उपलब्ध आहेत.',
      },
      {
        title: 'कंपनीचे नाव मोफत उघडा',
        body: 'लॉक असलेल्या नोकरीवर वॉच व्हिडिओ टू अनलॉक कंपनी नेम दाबा. एक छोटा व्हिडिओ त्या कंपनीचे नाव कायमचे उघडतो. दैनंदिन मर्यादा नाही आणि काहीही शुल्क नाही.',
      },
      {
        title: 'पासने मॅनेजरचे संपर्क',
        body: 'मॅनेजरचे नाव, ईमेल आणि फोन क्रमांक सदस्यांसाठी आहेत. प्लान्स उघडा आणि एकदाच भरायचा पास निवडा, एकोणीस रुपयांपासून एका दिवसासाठी ते एक हजार सातशे एकोणनव्वद रुपये एका वर्षासाठी, गूगल प्लेद्वारे सुरक्षित. स्वयंचलित नूतनीकरण नाही.',
      },
      {
        title: 'एका टॅपमध्ये अर्ज',
        body: 'तुमची प्रोफाइल आणि रेझ्युमे एकदा भरा, नोकरी उघडा आणि अप्लाय दाबा. ईमेल किंवा व्हॉट्सअ‍ॅपमध्ये अर्ज तयार होऊन उघडतो, पाठवण्यापूर्वी तुम्ही पाहू शकता. मेडरेप प्रोमध्ये स्वागत.',
      },
    ],
  },
]

/**
 * The language the tour should open with: the device's preferred language when
 * we have a translation for it, otherwise English. Never throws — a browser
 * without `navigator.language` just gets English.
 */
export function preferredTutorialLanguage(preferred?: string): TutorialLanguage {
  const raw = (preferred ?? (typeof navigator !== 'undefined' ? navigator.language : '') ?? '').toLowerCase()
  const base = raw.split('-')[0]
  const match = TUTORIAL_LANGUAGES.find((l) => l.code === base)
  return match ?? TUTORIAL_LANGUAGES[0]
}
