const { app, BrowserWindow } = require('electron');
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`)).slice(name.length + 3);
app.setPath('userData', argument('fixture-profile'));
app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    frame: false,
    // A utility window keeps desktop tiling rules from changing test geometry.
    // This still exercises Electron viewport resize, not OS edge dragging.
    type: 'utility',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  window.loadURL(argument('fixture-url'));
});
app.on('window-all-closed', () => app.quit());
