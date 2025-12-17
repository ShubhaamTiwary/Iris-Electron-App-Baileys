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
import { ConnectionState } from '@whiskeysockets/baileys';
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
let openLink: string | null = null;
let hasNavigatedToOpenLink = false;

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

// OpenLink IPC handlers
ipcMain.handle('get-openlink', async () => {
  return openLink;
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
 * Parse deeplink URL to extract openLink query parameter
 * Handles cases where openLink itself contains query parameters
 */
function parseDeeplink(url: string): string | null {
  try {
    // Handle iris://?openLink=... format
    const urlObj = new URL(url);

    // First, try to get openLink using standard URL parsing
    let openLinkParam = urlObj.searchParams.get('openLink');

    // If openLink was found but the URL has other params, the openLink might be truncated
    // This happens when openLink contains unencoded & characters
    if (openLinkParam) {
      const allParams = Array.from(urlObj.searchParams.entries());

      // If there are params after openLink, they might be part of the openLink value
      if (allParams.length > 1) {
        const openLinkIndex = allParams.findIndex(
          ([key]) => key === 'openLink',
        );

        // If openLink is found and there are params after it, reconstruct
        if (openLinkIndex !== -1 && openLinkIndex < allParams.length - 1) {
          // Common URL query parameter names that indicate these belong to openLink
          const urlParamNames = [
            'message',
            'phone',
            'id',
            'token',
            'code',
            'state',
            'data',
            'params',
          ];

          // Check if subsequent params look like URL query params
          const subsequentParams = allParams.slice(openLinkIndex + 1);
          const looksLikeUrlParams = subsequentParams.some(([key]) =>
            urlParamNames.includes(key.toLowerCase()),
          );

          // If openLink doesn't already contain &, or if subsequent params look like URL params,
          // reconstruct the full openLink
          if (!openLinkParam.includes('&') || looksLikeUrlParams) {
            const reconstructed = [openLinkParam];
            for (let i = openLinkIndex + 1; i < allParams.length; i++) {
              const [key, value] = allParams[i];
              if (value) {
                reconstructed.push(`${key}=${value}`);
              }
            }
            openLinkParam = reconstructed.join('&');
          }
        }
      }

      return openLinkParam;
    }

    // Fallback: manual extraction if URL parsing didn't work
    const queryStart = url.indexOf('?');
    if (queryStart === -1) {
      return null;
    }

    const queryString = url.substring(queryStart + 1);
    const openLinkIndex = queryString.indexOf('openLink=');
    if (openLinkIndex === -1) {
      return null;
    }

    // Extract everything after openLink=
    const valueStart = openLinkIndex + 'openLink='.length;
    const remaining = queryString.substring(valueStart);

    // Try to decode it (in case it's URL-encoded)
    try {
      return decodeURIComponent(remaining);
    } catch (e) {
      // If decoding fails, return as-is
      return remaining;
    }
  } catch (error) {
    console.error('Error parsing deeplink URL:', error);
    return null;
  }
}

/**
 * Handle deeplink and initialize WhatsApp if needed
 */
function handleDeeplink(url: string) {
  const extractedOpenLink = parseDeeplink(url);
  if (extractedOpenLink) {
    openLink = extractedOpenLink;
    console.log('Received openLink from deeplink:', openLink);

    // Notify renderer about openLink update
    if (mainWindow) {
      mainWindow.webContents.send('openlink-update', openLink);
    }

    // Initialize WhatsApp service if not already initialized
    if (!whatsappService) {
      console.log('Initializing WhatsApp service...');
      whatsappService = new WhatsAppService();
      whatsappService.initialize();

      // Forward WhatsApp events to renderer
      whatsappService.on('qr-update', (qr: string | null) => {
        if (mainWindow) {
          mainWindow.webContents.send('whatsapp-qr-update', qr);
        }
      });

      whatsappService.on('status-update', (status: ConnectionState) => {
        if (mainWindow) {
          mainWindow.webContents.send('whatsapp-status-update', status);

          // Navigate to openLink when connected
          if (status === 'open' && openLink && !hasNavigatedToOpenLink) {
            hasNavigatedToOpenLink = true;
            console.log('Navigating to openLink:', openLink);
            mainWindow.loadURL(openLink);
          }

          // Navigate back to local QR screen when disconnected
          if (status === 'close' && hasNavigatedToOpenLink) {
            hasNavigatedToOpenLink = false;
            mainWindow.loadURL(resolveHtmlPath('index.html'));
          }
        }
      });
    }
  }
}

/**
 * Register protocol handler and set up deeplink handling
 */
// Register protocol handler (only in production, dev mode uses electron-builder)
if (app.isPackaged && !app.isDefaultProtocolClient('iris')) {
  app.setAsDefaultProtocolClient('iris');
}

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeeplink(url);
});

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

    // Check for deeplink on all platforms (when app is launched via deeplink)
    const deeplinkUrl = process.argv.find((arg) => arg.startsWith('iris://'));
    if (deeplinkUrl) {
      handleDeeplink(deeplinkUrl);
    }

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
