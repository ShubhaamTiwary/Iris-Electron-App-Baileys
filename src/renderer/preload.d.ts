import { ElectronHandler } from '../main/preload';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler;
    irisElectron: {
      sendMessage(params: {
        phone: string;
        message: string;
        image?: {
          data: string;
          mimeType: string;
          filename: string;
        };
      }): Promise<{ success: boolean; error?: string }>;
    };
  }
}

export {};
