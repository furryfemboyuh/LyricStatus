// LyricStatus: Spotify current song -> synced lyric line -> Discord Rich Presence.
// Engine has zero dependencies (Electron is only the window). Needs Node 18+ and the Discord desktop app; run setup.bat first.
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

// ---- config ----
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
if (!SPOTIFY_CLIENT_ID || !DISCORD_CLIENT_ID) {
  console.error('Missing SPOTIFY_CLIENT_ID or DISCORD_CLIENT_ID. Copy .env.example to .env and fill it in (see README).');
  process.exit(1);
}
const REPO_URL = 'https://github.com/furryfemboyuh/LyricStatus'; // "Get LyricStatus" button on the Discord card
const REDIRECT = 'http://127.0.0.1:8888/callback';
const TOKEN_FILE = path.join(__dirname, 'tokens.json');
const LEAD_MS = +process.env.LEAD_MS || 1500; // show lines this much early to hide Spotify/Discord lag
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const settings = { enabled: true, nextLine: true, buttons: true, onTop: false, lead: LEAD_MS };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch {}
const saveSettings = () => { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Spotify auth (PKCE, no client secret) ----
let tokens = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) : null;

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...params }),
  });
  if (!res.ok) throw new Error('Spotify token error: ' + (await res.text()));
  const j = await res.json();
  tokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token || tokens?.refresh_token,
    expires_at: Date.now() + (j.expires_in - 30) * 1000,
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function login() {
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(64).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(8).toString('hex');
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') return res.end();
      try {
        if (u.searchParams.get('state') !== state) throw new Error('state mismatch');
        await tokenRequest({
          grant_type: 'authorization_code',
          code: u.searchParams.get('code'),
          redirect_uri: REDIRECT,
          code_verifier: verifier,
        });
        res.end('LyricStatus is connected to Spotify. You can close this tab.');
        server.close();
        resolve();
      } catch (e) {
        res.end('Login failed: ' + e.message);
        server.close();
        reject(e);
      }
    });
    server.listen(8888, '127.0.0.1', () => {
      const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT,
        scope: 'user-read-currently-playing user-read-playback-state',
        code_challenge_method: 'S256', code_challenge: challenge, state,
      });
      console.log('Opening browser for Spotify login...\n' + url);
      exec(`start "" "${url}"`);
    });
  });
}

async function accessToken() {
  if (!tokens) await login();
  else if (Date.now() > tokens.expires_at) {
    try { await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }); }
    catch { tokens = null; await login(); }
  }
  return tokens.access_token;
}

async function currentlyPlaying() {
  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: 'Bearer ' + (await accessToken()) },
  });
  if (res.status === 204) return null;
  if (res.status === 429) { await sleep((+res.headers.get('retry-after') || 5) * 1000); return undefined; }
  if (!res.ok) return undefined;
  const j = await res.json();
  if (!j.item || j.currently_playing_type !== 'track') return null;
  return {
    id: j.item.id, title: j.item.name, artist: j.item.artists.map((a) => a.name).join(', '),
    album: j.item.album.name, url: j.item.external_urls?.spotify, art: j.item.album.images?.[0]?.url, duration: Math.round(j.item.duration_ms / 1000),
    progress: j.progress_ms, playing: j.is_playing, fetchedAt: Date.now(),
  };
}

// ---- lyrics (LRCLIB, free, no key) ----
async function getLyrics(t) {
  const q = new URLSearchParams({
    track_name: t.title, artist_name: t.artist.split(', ')[0], album_name: t.album, duration: t.duration,
  });
  try {
    const H = { headers: { 'User-Agent': 'LyricStatus/1.0' } };
    let j = null;
    const res = await fetch('https://lrclib.net/api/get?' + q, H);
    if (res.ok) j = await res.json();
    if (!j?.syncedLyrics) { // fallback: fuzzy search, closest duration wins
      const sr = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: t.title, artist_name: t.artist.split(', ')[0] }), H);
      const list = sr.ok ? (await sr.json()).filter((x) => x.syncedLyrics && Math.abs(x.duration - t.duration) <= 5) : [];
      j = list.sort((a, b) => Math.abs(a.duration - t.duration) - Math.abs(b.duration - t.duration))[0];
    }
    if (!j?.syncedLyrics) return null;
    const lines = [];
    for (const l of j.syncedLyrics.split('\n')) {
      const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (m) lines.push({ t: (+m[1] * 60 + +m[2]) * 1000, text: m[3].trim() });
    }
    return lines.length ? lines : null;
  } catch { return null; }
}

function lineAt(lyrics, posMs) {
  let i = -1;
  while (i + 1 < lyrics.length && lyrics[i + 1].t <= posMs) i++;
  return [i >= 0 ? lyrics[i].text : '', lyrics[i + 1]?.text || ''];
}

// ---- Discord Rich Presence over local IPC ----
class DiscordIPC {
  constructor(clientId) { this.clientId = clientId; this.sock = null; this.ready = false; this.buf = Buffer.alloc(0); }
  frame(op, data) {
    const body = Buffer.from(JSON.stringify(data));
    const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(body.length, 4);
    this.sock.write(Buffer.concat([h, body]));
  }
  async connect() {
    for (let i = 0; i < 10; i++) {
      const ok = await new Promise((resolve) => {
        const s = net.createConnection(`\\\\?\\pipe\\discord-ipc-${i}`);
        s.once('connect', () => { this.sock = s; resolve(true); });
        s.once('error', () => resolve(false));
      });
      if (ok) break;
    }
    if (!this.sock) throw new Error('Discord not running (no IPC pipe found).');
    await new Promise((resolve, reject) => {
      this.sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        while (this.buf.length >= 8) {
          const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
          if (this.buf.length < 8 + len) break;
          const msg = JSON.parse(this.buf.subarray(8, 8 + len).toString());
          this.buf = this.buf.subarray(8 + len);
          if (process.env.DEBUG) console.log('IPC<-', JSON.stringify(msg).slice(0,300));
          if (msg.evt === 'READY') { this.ready = true; resolve(); }
          else if (msg.evt === 'ERROR' && this.ready) console.error('Discord rejected activity:', msg.data?.message);
          else if (msg.evt === 'ERROR') reject(new Error(msg.data?.message));
          if (op === 2) { this.ready = false; }
        }
      });
      this.sock.on('close', () => { this.ready = false; this.sock = null; });
      this.sock.on('error', () => {});
      this.frame(0, { v: 1, client_id: this.clientId });
    });
  }
  setActivity(activity) {
    if (!this.ready) return false;
    this.frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: crypto.randomUUID() });
    return true;
  }
}

// ---- GUI (local web page, opened in an app-style window) ----
const ui = { discord: false, settings, err: '', track: null, lyrics: null, lyricsState: 'idle', sent: null };
global.lyricStatus = { settings };
const GUI_PORT = 8889;
http.createServer((req, res) => {
  if (req.url === '/state') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ...ui, now: Date.now() }));
  }
  if (req.method === 'POST' && req.url.startsWith('/set')) {
    const q = new URL(req.url, 'http://x').searchParams;
    for (const k of ['enabled', 'nextLine', 'buttons', 'onTop']) if (q.has(k)) settings[k] = q.get(k) === '1';
    if (q.has('lead')) settings.lead = Math.max(-2000, Math.min(5000, +q.get('lead') || 0));
    saveSettings();
    return res.end('ok');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'gui.html')));
}).listen(GUI_PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${GUI_PORT}`;
  console.log('GUI: ' + url);
  if (process.env.NO_GUI) return;
  const edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe';
  const chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe';
  const exe = [chrome, edge].find((p) => fs.existsSync(p));
  exec(exe ? `"${exe}" --app=${url} --window-size=460,760` : `start "" ${url}`);
});

// ---- main loop ----
const pad = (s) => clip(s.length < 2 ? s + ' ♪' : s);
// Discord has no font-size control, so fake "smaller" text with Unicode superscript.
const SC = ['ᵃ','ᵇ','ᶜ','ᵈ','ᵉ','ᶠ','ᵍ','ʰ','ⁱ','ʲ','ᵏ','ˡ','ᵐ','ⁿ','ᵒ','ᵖ','q','ʳ','ˢ','ᵗ','ᵘ','ᵛ','ʷ','ˣ','ʸ','ᶻ']; // superscript; no real superscript q exists
const small = (s) => s.replace(/[a-z]/gi, (c) => SC[c.toLowerCase().charCodeAt(0) - 97]);
const buttonsFor = (t) => {
  if (!settings.buttons) return undefined;
  const b = [];
  if (t.url) b.push({ label: 'Listen on Spotify', url: t.url });
  if (REPO_URL) b.push({ label: 'Get LyricStatus', url: REPO_URL });
  return b.length ? b : undefined;
};
const clip = (s, n = 128) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

(async () => {
  const discord = new DiscordIPC(DISCORD_CLIENT_ID);
  let lyricsDone = false, sentTimes = [], lastStart = 0, track = null, lyrics = null, lastSent = null, lastSentAt = 0, lastPoll = 0;

  const send = (line, next, t) => {
    const state = t ? next : null;
    const details = line;
    const start = t ? Math.round(Date.now() - (t.progress + (Date.now() - t.fetchedAt))) : 0;
    const key = [details, next, settings.nextLine, settings.buttons].join('|');
    const seeked = t && lastStart && Math.abs(start - lastStart) > 6000;
    const now = Date.now();
    sentTimes = sentTimes.filter((x) => now - x < 20000);
    if (process.env.DEBUG && key !== lastSent) console.log("  [pending]", details.slice(0,30), "sent in 20s:", sentTimes.length);
    if ((key === lastSent && !seeked) || now - lastSentAt < 700 || sentTimes.length >= 5) return; // Discord allows ~5 updates / 20s // Discord limits updates (~5 / 20s)
    const act = state === null ? null : { type: 2, details: pad(t.title), state: pad(line || '♪ ♪'), assets: t.art ? { large_image: t.art, large_text: settings.nextLine && next ? pad(small(next)) : undefined } : undefined, timestamps: { start, end: start + t.duration * 1000 }, buttons: buttonsFor(t) };
    if (discord.setActivity(act)) { sentTimes.push(Date.now()); lastSent = key; lastStart = start; lastSentAt = Date.now(); console.log(details ? '♪ ' + details : '(no lyric)'); }
  };

  while (true) {
    try {
      if (!discord.ready) { await discord.connect(); console.log('Connected to Discord.'); }

      if (Date.now() - lastPoll > 4000) {
        lastPoll = Date.now();
        const t = await currentlyPlaying();
        if (t !== undefined) {
          if (t && (!track || track.id !== t.id)) {
            console.log(`Now playing: ${t.artist} - ${t.title}`);
            lyrics = null; lyricsDone = false; track = t;
            getLyrics(t).then((l) => { if (track?.id === t.id) { lyrics = l; lyricsDone = true; console.log(l ? `Loaded ${l.length} lyric lines.` : 'No synced lyrics found.'); } });
          }
          track = t ? { ...t } : null;
          if (!t) { lyrics = null; }
        }
      }

      ui.discord = discord.ready; ui.track = track; ui.lyrics = lyrics; ui.lyricsState = !track ? 'idle' : lyrics === null ? (lyricsDone ? 'none' : 'loading') : 'ok'; ui.sent = lastSent; ui.err = '';
      if (!track || !track.playing || !settings.enabled) {
        send('', null, null); // clear presence when paused/stopped
      } else {
        const pos = track.progress + (Date.now() - track.fetchedAt) + settings.lead;
        const [line, next] = lyrics ? lineAt(lyrics, pos) : ['', ''];
        send(line, next, track);
      }
    } catch (e) {
      console.error(e.message); ui.err = e.message; ui.discord = discord.ready;
      await sleep(5000);
    }
    await sleep(150);
  }
})();
