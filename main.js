// Electron shell: runs the LyricStatus engine (index.js) and shows the GUI in a native window.
const { app, BrowserWindow } = require('electron');
const path = require('path');
process.env.NO_GUI = '1';
require('./index.js');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 470, height: 780, minWidth: 400, minHeight: 640,
    backgroundColor: '#07070a', title: 'LyricStatus', autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 52 },
  });
  win.loadURL('http://127.0.0.1:8889');
  setInterval(() => { // keep the window's always-on-top in sync with the GUI setting
    const on = !!global.lyricStatus?.settings.onTop;
    if (win.isAlwaysOnTop() !== on) win.setAlwaysOnTop(on);
  }, 500);
});
app.on('window-all-closed', () => app.quit());
