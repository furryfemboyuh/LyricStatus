// Interactive first-time setup for LyricStatus. Run through setup.bat (or `node setup.js`).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec, spawnSync } = require('child_process');

const ENV = path.join(__dirname, '.env');
const REDIRECT = 'http://127.0.0.1:8888/callback';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
const open = (url) => exec(`start "" "${url}"`);
const clip = (text) => spawnSync('clip', { input: text });
const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const head = (n, t) => console.log(`\n${c(36, `━━ Step ${n}/4 ━━`)} ${c(1, t)}\n`);

// existing values (so re-running setup keeps what you already entered)
const cur = {};
if (fs.existsSync(ENV)) for (const l of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) cur[m[1]] = m[2]; }

async function prompt(label, test, hint, existing) {
  while (true) {
    const a = await ask(`${label}${existing ? c(90, ` [Enter keeps ${existing.slice(0, 6)}…]`) : ''}: `);
    if (!a && existing) return existing;
    if (test(a)) return a;
    console.log(c(33, `  That doesn't look right. ${hint}`));
  }
}

(async () => {
  console.log(c(35, '\n  ♪  LyricStatus setup\n'));
  console.log('  This takes about 3 minutes. You need two free "apps" so Discord and Spotify');
  console.log('  will talk to LyricStatus. Nothing is shared with anyone: the IDs stay on this PC.\n');
  console.log('  Before you start, make sure the ' + c(1, 'Discord desktop app') + ' is open and logged in.');
  await ask(c(90, '\n  Press Enter to begin…'));

  // ---- 1: Discord application ----
  head(1, 'Discord application');
  console.log('  1. Your browser is opening the Discord Developer Portal.');
  console.log('  2. Click ' + c(1, 'New Application') + ', name it what you want shown after "Listening to"');
  console.log('     (e.g. ' + c(1, 'Lyrics') + '), accept the terms, and click Create.');
  console.log('  3. On the ' + c(1, 'General Information') + ' page, copy the ' + c(1, 'Application ID') + '.\n');
  open('https://discord.com/developers/applications');
  const discord = await prompt('  Paste Application ID', (a) => /^\d{17,20}$/.test(a), 'It is a long number, 17-20 digits.', cur.DISCORD_CLIENT_ID);

  // ---- 2: Spotify app ----
  head(2, 'Spotify app');
  clip(REDIRECT);
  console.log('  1. Your browser is opening the Spotify Developer Dashboard (log in if asked).');
  console.log('  2. Click ' + c(1, 'Create app') + '. Any name and description work.');
  console.log('  3. In ' + c(1, 'Redirect URIs') + ' paste this (already copied to your clipboard):');
  console.log('       ' + c(32, REDIRECT) + c(90, '   <- click Add after pasting'));
  console.log('  4. Tick ' + c(1, 'Web API') + ', accept the terms, and Save.');
  console.log('  5. Open the app\'s ' + c(1, 'Settings') + ' and copy the ' + c(1, 'Client ID') + '.');
  console.log(c(90, '     (Dev mode is fine. Only your own account needs to log in. If Spotify says the user is'));
  console.log(c(90, '      not registered, add your Spotify email under Settings -> User Management.)\n'));
  open('https://developer.spotify.com/dashboard');
  const spotify = await prompt('  Paste Client ID', (a) => /^[0-9a-f]{32}$/i.test(a), 'It is 32 letters/numbers (0-9, a-f).', cur.SPOTIFY_CLIENT_ID);

  // ---- 3: optional repo link ----
  head(3, 'Card button (optional)');
  console.log('  Your Discord card can show a "Get LyricStatus" button linking to the project.');
  console.log('  Paste a link (e.g. your GitHub repo), or press Enter to skip.\n');
  let repo = await ask(`  Link${cur.REPO_URL ? c(90, ' [Enter keeps current]') : ''}: `);
  if (!repo) repo = cur.REPO_URL || '';
  if (repo && !/^https?:\/\//.test(repo)) repo = 'https://' + repo;

  fs.writeFileSync(ENV, `SPOTIFY_CLIENT_ID=${spotify}\nDISCORD_CLIENT_ID=${discord}\nREPO_URL=${repo}\n`);
  console.log(c(32, '\n  ✔ Saved .env'));

  // ---- 4: install the app window ----
  head(4, 'Installing the app window (Electron)');
  if (fs.existsSync(path.join(__dirname, 'node_modules', 'electron', 'dist'))) console.log('  Already installed.');
  else {
    console.log('  Downloading Electron (~100 MB, one time)…\n');
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: __dirname, stdio: 'inherit', shell: true });
    if (r.status !== 0) console.log(c(33, '\n  npm install failed. LyricStatus will still run in your browser instead of its own window.'));
  }

  console.log(c(32, '\n  ✔ All set!'));
  console.log('\n  What happens next:');
  console.log('   • Spotify asks you to log in ONCE the first time you launch (a browser tab opens).');
  console.log('   • Play a song in Spotify with the Discord app open, and the lyrics appear on your profile.');
  console.log(c(90, '   • Others see your card; Discord does not show your own buttons to you.\n'));
  const go = await ask('  Launch LyricStatus now? (Y/n): ');
  rl.close();
  if (go.toLowerCase() !== 'n') exec(`start "" "${path.join(__dirname, 'run.bat')}"`);
})();
