# InstaBlock

**Cut down on Instagram scrolling without missing your DMs.** InstaBlock lets you set a browsing limit, pauses the timer when you’re away, and blocks monitored pages during cooldown.

## 💡 Philosophy and mechanism

<u>**Stay connected without endless scrolling.**</u> InstaBlock keeps DMs available and gives browsing surfaces one shared time limit. The timer runs while a monitored Instagram page is active and visible, pauses in DMs or when the browser loses focus, then resumes when you return. When time runs out, browsing is blocked until cooldown ends. State is stored locally and shared across tabs.

## Features

- Shared timer for Feed, Explore, Stories, Reels, and profiles.
- Timer pauses in DMs and when the browser is unfocused.
- Cooldown blocks browsing after the session limit.
- Adjustable session (0.1–60 min; default 5) and cooldown (0.1–1440 min; default 60).
- Draggable, minimizable timer and live cooldown screen.

## ⬇️ Install

1. Download and extract the ZIP from **Code → Download ZIP**, or clone:
   ```sh
   git clone https://github.com/KavinK0001/insta-block.git
   ```
2. Open `chrome://extensions`, `brave://extensions`, or `edge://extensions`.
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`.

To update, replace the files and click **Reload** on the extensions page.

## Test

Set short session and cooldown values in the popup, then browse Instagram. When the session ends, monitored pages are blocked for the cooldown; DMs remain available.

## 🌐 Browser support

Any Chromium browser should work. Tested on Google Chrome and Microsoft Edge.