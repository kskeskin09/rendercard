const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session
} = require('electron');
const { readFile, writeFile, rename, rm, stat } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const scheme = 'rendercard';
const appUrl = 'rendercard://editor/';
const dirtyWindows = new WeakSet();
const projectPaths = new WeakMap();
const projectName = 'sahne.rendercard.json';
const maxFileSize = 256 * 1024 * 1024;
const saveFormats = new Map([
  [
    'sahne.rendercard.json',
    { name: 'Rendercard projesi', extensions: ['json'] }
  ],
  ['rendercard.png', { name: 'PNG görseli', extensions: ['png'] }],
  ['rendercard.webm', { name: 'WebM videosu', extensions: ['webm'] }],
  ['rendercard.mp4', { name: 'MP4 videosu', extensions: ['mp4'] }],
  ['rendercard.glb', { name: 'GLB modeli', extensions: ['glb'] }],
  ['rendercard.gltf', { name: 'glTF modeli', extensions: ['gltf'] }],
  ['rendercard.obj', { name: 'OBJ modeli', extensions: ['obj'] }],
  ['rendercard.stl', { name: 'STL modeli', extensions: ['stl'] }]
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
      /^[\w.-]+\.(js|css)$/.test(path.basename(relative)) &&
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
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src blob:; connect-src 'self' blob: data:"
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function registerSave() {
  function projectOwner(event) {
    const window = BrowserWindow.fromWebContents(event.sender);
    const sender = event.senderFrame;
    if (!window || !sender || sender.parent || sender.url !== appUrl)
      throw new Error('Geçersiz proje isteği.');
    if (!projectPaths.has(window)) projectPaths.set(window, new Map());
    return { window, paths: projectPaths.get(window) };
  }
  ipcMain.handle('rendercard:open-project', async event => {
    const { window, paths } = projectOwner(event);
    const result = await dialog.showOpenDialog(window, {
      title: 'Projeyi aç', properties: ['openFile'], filters: [saveFormats.get(projectName)]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const [file] = result.filePaths;
    if ((await stat(file)).size > maxFileSize) throw new Error('Proje dosyası çok büyük.');
    const content = await readFile(file, 'utf8');
    const handle = randomUUID();
    paths.set(handle, file);
    return { content, handle };
  });
  ipcMain.handle('rendercard:save-project', async (event, handle, bytes, saveAs) => {
    const { window, paths } = projectOwner(event);
    if ((handle !== null && !paths.has(handle)) || typeof saveAs !== 'boolean' ||
        !(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > maxFileSize)
      throw new Error('Geçersiz proje kaydı.');
    let file = paths.get(handle);
    if (!file || saveAs) {
      const result = await dialog.showSaveDialog(window, {
        title: saveAs ? 'Farklı kaydet' : 'Dosyayı kaydet',
        defaultPath: file ?? path.join(app.getPath('documents'), projectName),
        filters: [saveFormats.get(projectName)]
      });
      if (result.canceled || !result.filePath) return null;
      file = result.filePath;
      handle = randomUUID();
    }
    const temporary = path.join(path.dirname(file), '.rendercard-' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, new Uint8Array(bytes), { flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    paths.set(handle, file);
    return handle;
  });
  ipcMain.on('rendercard:document-dirty', (event, dirty) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const sender = event.senderFrame;
    if (!owner || !sender || sender.parent || sender.url !== appUrl || typeof dirty !== 'boolean') return;
    if (dirty) dirtyWindows.add(owner);
    else dirtyWindows.delete(owner);
  });
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
  let confirming = false;
  let allowClose = false;
  window.on('close', event => {
    if (allowClose || !dirtyWindows.has(window)) return;
    event.preventDefault();
    if (confirming) return;
    confirming = true;
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Kaydedilmemiş değişiklikler',
      message: 'Kaydedilmemiş değişiklikler var. Yine de çıkmak istiyor musunuz?',
      buttons: ['Vazgeç', 'Çık'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(({ response }) => {
      if (response !== 1 || window.isDestroyed()) return;
      allowClose = true;
      window.close();
    }).catch(error => {
      console.error('Çıkış uyarısı açılamadı.', error);
    }).finally(() => {
      confirming = false;
    });
  });
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
