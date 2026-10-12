# ♪ LyricStatus

Shows the **synced lyrics of your current Spotify song** on your Discord profile, live.

- Current lyric line + the next line (in tiny text) on your Discord card, with song title, cover art and a progress bar
- Card buttons: **Listen on Spotify** and **Get LyricStatus**
- A good-looking desktop app with karaoke-style word-by-word lyrics, cover-art colours and a settings panel
- Lyrics from [LRCLIB](https://lrclib.net) (free, no key). Spotify login uses PKCE, so no client secret is stored.

Windows only (Discord's local IPC pipe + `.bat` launchers).

## Install

1. Install [Node.js](https://nodejs.org) (LTS) and make sure the **Discord desktop app** is running.
2. Download or clone this repo.
3. Double-click **`setup.bat`**. It walks you through:
   - creating a Discord application (for the "Listening to ..." name) and copying its Application ID
   - creating a Spotify app (adds the redirect URI for you via clipboard) and copying its Client ID
   - installing the app window (Electron)
4. Double-click **`run.bat`** any time to start. The first launch opens a Spotify login in your browser once.

Prefer manual setup? Copy `.env.example` to `.env`, fill in the IDs, run `npm install` then `run.bat`.
Redirect URI to add in the Spotify dashboard: `http://127.0.0.1:8888/callback`

## Settings (gear icon in the app)

| Setting | What it does |
| --- | --- |
| Show on Discord | Turn the presence on/off without closing the app |
| Next lyric line | Show the upcoming line on your card |
| Card buttons | Toggle the Spotify / LyricStatus buttons |
| Always on top | Pin the window above other apps |
| Lyric timing | Show lyrics earlier/later to match your setup |

## Notes & limits

- **Why not the custom status?** Discord only allows changing it with your personal user token, which violates Discord's ToS and can get accounts banned. Rich Presence is the supported route.
- Discord allows roughly 5 presence updates per 20 seconds, so very fast lyrics can skip lines on your card. The in-app view is never rate limited.
- Discord doesn't show *your own* card buttons to you. Others see them.
- Word-by-word highlighting is estimated from line timings, so it's close but not perfect.
- Spotify apps in development mode only allow listed users, which is fine, since it is just you.
- "Get LyricStatus" button points at `REPO_URL` in `.env` (setup.bat asks for it; leave empty to hide).

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Engine: Spotify polling, lyrics, Discord IPC, local GUI server |
| `gui.html` | The interface |
| `main.js` | Electron window |
| `setup.bat` / `setup.js` | Guided first-time setup |
| `run.bat` | Launcher |

## License

MIT
