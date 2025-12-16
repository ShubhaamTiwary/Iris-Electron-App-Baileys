/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import WhatsAppService, { SendMessageParams } from './whatsapp';

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;
let whatsappService: WhatsAppService | null = null;

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

// WhatsApp IPC handlers
ipcMain.handle('whatsapp-get-qr', async () => {
  return whatsappService?.getQR() || null;
});

ipcMain.handle('whatsapp-get-status', async () => {
  return whatsappService?.getStatus() || 'close';
});

ipcMain.handle(
  'whatsapp-send-message',
  async (_event, params: SendMessageParams) => {
    if (!whatsappService) {
      return {
        success: false,
        error: 'WhatsApp service is not initialized.',
      };
    }

    try {
      return await whatsappService.sendMessage(params);
    } catch (error) {
      console.error('Error in whatsapp-send-message handler:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred.',
      };
    }
  },
);

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  // Use platform-specific icon
  const getIconPath = (): string => {
    if (process.platform === 'win32') {
      return getAssetPath('icon.ico');
    }
    if (process.platform === 'darwin') {
      return getAssetPath('icon.icns');
    }
    return getAssetPath('icon.png');
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    icon: getIconPath(),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();

    // Initialize WhatsApp service
    whatsappService = new WhatsAppService();
    whatsappService.initialize();

    // Forward WhatsApp events to renderer
    whatsappService.on('qr-update', (qr: string | null) => {
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-qr-update', qr);
      }
    });

    const EXTERNAL_URL = 'https://my.newtonschool.co/send-whatsapp-message';
    let hasNavigatedToExternal = false;

    whatsappService.on('status-update', (status: ConnectionState) => {
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-status-update', status);

        // Navigate to external URL when connected
        if (status === 'open' && !hasNavigatedToExternal) {
          hasNavigatedToExternal = true;
          mainWindow.loadURL(EXTERNAL_URL);
        }

        // Navigate back to local QR screen when disconnected
        if (status === 'close' && hasNavigatedToExternal) {
          hasNavigatedToExternal = false;
          mainWindow.loadURL(resolveHtmlPath('index.html'));
        }
      }
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);

app.on('before-quit', async () => {
  if (whatsappService) {
    await whatsappService.disconnect();
  }
});
