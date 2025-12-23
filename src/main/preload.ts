// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels =
  | 'ipc-example'
  | 'whatsapp-qr-update'
  | 'whatsapp-status-update'
  | 'whatsapp-send-message'
  | 'openlink-update';

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  whatsapp: {
    async getQR(): Promise<string | null> {
      return ipcRenderer.invoke('whatsapp-get-qr');
    },
    async getStatus(): Promise<string> {
      return ipcRenderer.invoke('whatsapp-get-status');
    },
    async getPhoneNumber(): Promise<string | null> {
      return ipcRenderer.invoke('whatsapp-get-phone-number');
    },
    async logout(): Promise<{ success: boolean; error?: string }> {
      return ipcRenderer.invoke('whatsapp-logout');
    },
    async sendMessage(params: {
      phone: string;
      message: string;
      document?: {
        data: string;
        mimeType: string;
        filename: string;
      };
    }): Promise<{ success: boolean; error?: string }> {
      return ipcRenderer.invoke('whatsapp-send-message', params);
    },
    onQRUpdate(func: (qr: string | null) => void) {
      const subscription = (_event: IpcRendererEvent, qr: string | null) =>
        func(qr);
      ipcRenderer.on('whatsapp-qr-update', subscription);

      return () => {
        ipcRenderer.removeListener('whatsapp-qr-update', subscription);
      };
    },
    onStatusUpdate(func: (status: string) => void) {
      const subscription = (_event: IpcRendererEvent, status: string) =>
        func(status);
      ipcRenderer.on('whatsapp-status-update', subscription);

      return () => {
        ipcRenderer.removeListener('whatsapp-status-update', subscription);
      };
    },
  },
  openLink: {
    async getOpenLink(): Promise<string | null> {
      return ipcRenderer.invoke('get-openlink');
    },
    onOpenLinkUpdate(func: (openLink: string | null) => void) {
      const subscription = (
        _event: IpcRendererEvent,
        openLink: string | null,
      ) => func(openLink);
      ipcRenderer.on('openlink-update', subscription);

      return () => {
        ipcRenderer.removeListener('openlink-update', subscription);
      };
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

// Expose irisElectron as alias to electron (for compatibility with external renderer)
contextBridge.exposeInMainWorld('irisElectron', {
  sendMessage: electronHandler.whatsapp.sendMessage.bind(
    electronHandler.whatsapp,
  ),
  getPhoneNumber: electronHandler.whatsapp.getPhoneNumber.bind(
    electronHandler.whatsapp,
  ),
  logout: electronHandler.whatsapp.logout.bind(electronHandler.whatsapp),
});

export type ElectronHandler = typeof electronHandler;
