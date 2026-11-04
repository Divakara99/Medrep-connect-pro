# Store screenshots — capture on a phone

The four `screenshot-*.png` files in this folder are rendered from the app's own
screens by `npm run store:screenshots:render` (1080x1920, opaque, the live
catalogue prices). They show the real layout, wording and prices, but they are
**renders, not OS captures** — this build machine has no browser and no route to
Supabase, so a signed-in phone cannot be photographed here.

Real captures always beat renders and remove any doubt during review. Replace
the four files with the phone shots below whenever you have two minutes; keep
the same names and run `npm run store:screenshots` to check them first.

## What to capture (in this order)

Use the **release APK** on a real phone, signed in as a normal job-seeker
account, and take the shots in **portrait** at full resolution (1080×1920 or
higher). Play crops nothing if the aspect ratio is 9:16.

| File to overwrite | Screen | Make sure it shows |
|---|---|---|
| `screenshot-1-home.png` | Home | Several job cards with role, city, HQ and salary; the pinned/priority job on top |
| `screenshot-2-unlock.png` | Any locked job | The blurred company name with the **"Watch video to unlock"** button visible |
| `screenshot-3-details.png` | An unlocked or subscribed job | Point-wise job description and the Apply button |
| `screenshot-4-plans.png` | Plans | The plan cards with real prices — **₹19 for 1 day** up to ₹1799 for 1 year |

The feature graphic (`feature-graphic.png`, 1024×500) and `icon-512.png` stay as
they are; both are generated from the logo and are not screenshots.

## Rules that get screenshots rejected

- No status-bar clutter with personal data (notifications, phone number, carrier
  balance). Pull down nothing; use a clean home screen or hide the bar.
- No email address, phone number or OTP visible anywhere.
- Nothing that looks like a fake OS — don't paste screenshots into another
  phone's frame with a different status bar.
- Don't capture the Google Play purchase sheet or a payment success screen with
  a real order number.
- Keep the same account and the same font size across all four, or the listing
  looks stitched together.

## After capturing

1. Rename them exactly as in the table and overwrite the files in this folder,
   so the repo and the listing stay in sync.
2. Upload all four in Play Console → Store presence → Main store listing →
   Phone screenshots.
3. Keep the order above: free → unlock → details → plans tells the story in the
   same sequence as the in-app tour.
