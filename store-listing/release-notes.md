# Play Console release notes

Play requires every language's notes to be **wrapped in that language's tag**.
Plain text is rejected with:

> Line 1: text outside language tags.
> Release notes provided for 0 of 2 languages.

The listing carries two languages, so paste one block per language. Each block
must be under 500 characters — the text below is ~400.

## 1.0.4 — English (India)

```
<en-IN>
• Filter jobs by city and HQ, and pick the experience you have. The salary filter has been removed.
• Your profile now saves to your account, so it is there on any phone you sign in with.
• Small fixes to notifications and the sign-in screen.
</en-IN>
```

## 1.0.4 — Hindi

```
<hi-IN>
• अब नौकरियाँ शहर और HQ से छाँटें, साथ में अपना अनुभव चुनें। सैलरी फ़िल्टर हटा दिया गया है।
• आपकी प्रोफ़ाइल अब आपके अकाउंट में सेव होती है, इसलिए किसी भी फ़ोन पर उपलब्ध रहती है।
• नोटिफ़िकेशन और साइन-इन स्क्रीन में छोटे सुधार।
</hi-IN>
```

## 1.0.3 — English (India)

```
<en-IN>
• A company name you unlock with a video now stays visible for 10 minutes only. After that it blurs again — watch another video to reopen it.
• The ads banner no longer covers the Logout button, the menu or the page footer.
• "How to use the app" plays in all 7 languages with voice.
</en-IN>
```

## 1.0.3 — the second language

Use `<en-US>` with the same text if the second language is English (United
States), or the block below for Hindi:

```
<hi-IN>
• वीडियो से खुला कंपनी का नाम अब सिर्फ़ 10 मिनट दिखता है। उसके बाद वह फिर धुँधला हो जाता है — दोबारा खोलने के लिए एक और वीडियो देखें।
• ऐड बैनर अब लॉगआउट बटन को नहीं ढकता — मेन्यू और अकाउंट स्क्रीन, दोनों में।
• "How to use the app" सातों भाषाओं में आवाज़ के साथ।
</hi-IN>
```

## Rules worth remembering

- Close every tag. An unclosed `<en-IN>` fails the same way as no tag at all.
- Do not put a blank line before the first tag — Play reads it as text outside
  the tags.
- The 500-character limit is per language, tags included.
- "Copy from a previous release" keeps the old tags, so re-check the text after
  using it.
