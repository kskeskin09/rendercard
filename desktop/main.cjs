const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session
} = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const scheme = 'rendercard';
const appUrl = 'rendercard://editor/';
const saveFormats = new Map([
  [
    'sahne.rendercard.json',
    { name: 'Rendercard projesi', extensions: ['json'] }
  ],
  ['rendercard.png', { name: 'PNG görseli', extensions: ['png'] }],
  ['rendercard.webm', { name: 'WebM videosu', extensions: ['webm'] }],
  ['rendercard.mp4', { name: 'MP4 videosu', extensions: ['mp4'] }]
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function serveEditor() {
  const root = path.join(app.getAppPath(), 'dist');
  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'editor' || !['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, { status: 404 });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    const target = path.resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : pathname)
    );
    const relative = path.relative(root, target);
    const bundledAsset =
      /^[\w-]+\.(js|css)$/.test(path.basename(relative)) &&
      path.dirname(relative) === 'assets';
    if (relative !== 'index.html' && !bundledAsset)
      return new Response(null, { status: 404 });

    try {
      const response = await net.fetch(pathToFileURL(target).href, {
        method: request.method
      });
      const headers = new Headers(response.headers);
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src blob:; connect-src 'self'"
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function registerSave() {
  ipcMain.handle('rendercard:save-file', async (event, name, bytes) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const sender = event.senderFrame;
    const filter = saveFormats.get(name);
    if (
      !owner ||
      !sender ||
      sender.parent ||
      sender.url !== appUrl ||
      !filter ||
      !(bytes instanceof ArrayBuffer) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > 256 * 1024 * 1024
    ) {
      throw new Error('Geçersiz kayıt isteği.');
    }
    const result = await dialog.showSaveDialog(owner, {
      title: 'Dosyayı kaydet',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [filter]
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, new Uint8Array(bytes));
    return true;
  });
}

function openWindow() {
  const window = new BrowserWindow({
    title: 'Rendercard',
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#f8f9f5',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void window.loadURL(appUrl);
  return window;
}

app.setAppUserModelId('io.github.kskeskin09.rendercard');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    serveEditor();
    registerSave();
    openWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
