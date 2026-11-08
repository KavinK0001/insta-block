# InstaBlock

A Chromium extension that limits time spent browsing Instagram while keeping Direct Messages accessible.

## Features

- Shared session timer across Feed, Explore, Stories, Reels, and profiles.
- Timer pauses in Direct Messages and when the browser is unfocused.
- Cooldown blocks monitored browsing after the session limit. DMs remain available.
- Draggable, minimizable timer and a cooldown screen with the unlock time.
- Configurable session duration (0.1–60 minutes; default 5) and cooldown (0.1–1440 minutes; default 60).
- Settings and reset are locked during a session or cooldown.

## Install

1. Download and extract the repository ZIP from **Code → Download ZIP**, or clone it:
   ```sh
   git clone https://github.com/<your-username>/insta-block.git
   ```
2. Open your browser’s extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode**, then select **Load unpacked**.
4. Choose the extracted project folder containing `manifest.json`.
5. Optionally pin InstaBlock from the browser’s extensions menu.

To update, replace the project files and click **Reload** on the extensions page. Keep the folder in place.

## Test

1. Open the extension popup and set short session and cooldown values, such as 1 minute each.
2. Visit Instagram and browse Feed, Stories, or Reels. The shared timer starts when you enter a monitored section.
3. When time runs out, monitored browsing is blocked until the cooldown ends. Direct Messages remain available.

## Project structure

```text
manifest.json              Extension configuration
background/service-worker.js  Shared timer and state management
content/content.js          Instagram route handling and timer UI
content/content.css         Timer and cooldown screen styles
popup/                      Settings and status popup
icons/                      Extension icons
```

## Browser support

Chrome, Brave, and Microsoft Edge are supported. Firefox support is not currently available.
