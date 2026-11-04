# Play Console release notes

Play requires every language's notes to be **wrapped in that language's tag**.
Plain text is rejected with:

> Line 1: text outside language tags.
> Release notes provided for 0 of 2 languages.

The listing carries two languages, so paste one block per language. Each block
must be under 500 characters — the text below is ~420.

## 1.0.1 — English (India)

```
<en-IN>
• "How to use the app" now plays in all 7 languages — English, हिन्दी, తెలుగు, தமிழ், ಕನ್ನಡ, മലയാളം, मराठी — with voice, opening with the founder's introduction.
• Starter plan is now ₹19 for 1 day.
• Every screen has a back button, and the top bar no longer overlaps the phone's status bar.
• An expired pass now clearly shows Expired, with one-tap renewal.
• Clearer messages when Google Play or ads are unavailable.
</en-IN>
```

## 1.0.1 — the second language

Use `<en-US>` with the same text if the second language is English (United
States), or the block below for Hindi:

```
<hi-IN>
• "How to use the app" अब सात भाषाओं में — English, हिन्दी, తెలుగు, தமிழ், ಕನ್ನಡ, മലയാളം, मराठी — आवाज़ के साथ, शुरुआत में ऐप बनाने वाले का परिचय।
• सबसे छोटा प्लान अब ₹19 में 1 दिन।
• हर स्क्रीन पर बैक बटन, और ऊपरी पट्टी अब फ़ोन के स्टेटस बार को नहीं ढकती।
• समय खत्म हो चुके पास अब साफ़ "Expired" दिखाते हैं, एक टैप में रिन्यू।
• Google Play या ऐड उपलब्ध न होने पर साफ़ संदेश।
</hi-IN>
```

## Rules worth remembering

- Close every tag. An unclosed `<en-IN>` fails the same way as no tag at all.
- Do not put a blank line before the first tag — Play reads it as text outside
  the tags.
- The 500-character limit is per language, tags included.
- "Copy from a previous release" keeps the old tags, so re-check the text after
  using it.
