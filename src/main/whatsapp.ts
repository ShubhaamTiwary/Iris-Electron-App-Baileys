import makeWASocket, {
  useMultiFileAuthState,
  ConnectionState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import path from 'path';
import { app } from 'electron';
import fs from 'fs/promises';
import { Buffer } from 'buffer';

export interface WhatsAppStatus {
  connection: ConnectionState;
  qr?: string;
}

export interface SendMessageParams {
  phone: string;
  message: string;
  document?: {
    data: string; // base64 string
    mimeType: string;
    filename: string;
  };
}

export interface SendMessageResult {
  success: boolean;
  error?: string;
}

class WhatsAppService extends EventEmitter {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private currentQR: string | null = null;
  private currentStatus: ConnectionState = 'close';
  private authDir: string;
  private isInitializing: boolean = false;
  private phoneNumber: string | null = null;

  constructor() {
    super();
    const userDataPath = app.getPath('userData');
    this.authDir = path.join(userDataPath, 'auth_info_baileys');
  }

  private async clearAuthState() {
    try {
      await fs.mkdir(this.authDir, { recursive: true });
      const files = await fs.readdir(this.authDir);
      await Promise.all(
        files.map((file) =>
          fs.unlink(path.join(this.authDir, file)).catch(() => {}),
        ),
      );
      console.log('Auth state cleared');
    } catch (error) {
      // Directory might not exist, that's okay
      console.log('Auth directory does not exist or already cleared');
    }
  }

  async initialize() {
    // Prevent multiple simultaneous initializations
    if (this.isInitializing) {
      console.log('Already initializing, skipping...');
      return;
    }

    this.isInitializing = true;

    try {
      // Clean up existing socket first
      if (this.socket) {
        this.socket.end(undefined);
        this.socket = null;
      }

      // Ensure auth directory exists
      await fs.mkdir(this.authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
      });

      // Save credentials whenever they update
      this.socket.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Update connection status
        if (connection) {
          this.currentStatus = connection;
          this.emit('status-update', this.currentStatus);
        }

        // Handle QR code - this is important for showing QR after disconnect
        if (qr) {
          console.log('QR code received');
          this.currentQR = qr;
          this.emit('qr-update', qr);
        } else {
          // Clear QR when connection is established
          if (this.currentQR && connection === 'open') {
            this.currentQR = null;
            this.emit('qr-update', null);
          }
        }

        // Handle disconnect event
        if (connection === 'close' || lastDisconnect) {
          const statusCode = (lastDisconnect?.error as Boom)?.output
            ?.statusCode;
          console.log('Disconnect detected, status code:', statusCode);

          // Clean up current socket
          if (this.socket) {
            this.socket.end(undefined);
            this.socket = null;
          }

          // Clear current QR and update status
          this.currentQR = null;
          this.phoneNumber = null; // Clear phone number on disconnect
          this.emit('qr-update', null);
          this.currentStatus = 'close';
          this.emit('status-update', this.currentStatus);

          // Reset initialization flag
          this.isInitializing = false;

          // If logged out (401), clear auth state to force new QR
          if (statusCode === DisconnectReason.loggedOut) {
            console.log(
              'Logged out - clearing auth state and reinitializing...',
            );
            await this.clearAuthState();
          }

          // Always reinitialize to show QR again after disconnect
          console.log('Disconnected - reinitializing to show QR code...');
          setTimeout(() => {
            this.initialize();
          }, 3000);
        } else if (connection === 'open') {
          console.log('Connected to WhatsApp');
          this.currentStatus = 'open';

          // Extract and store phone number when connected
          try {
            const userJid = this.socket?.user?.id || this.socket?.user?.jid;
            if (userJid) {
              // Extract JID part (before @s.whatsapp.net)
              const jidPart = userJid.split('@')[0];

              if (jidPart) {
                // Remove device identifier (everything after :)
                const withoutDeviceId = jidPart.split(':')[0];

                // Remove country code (91 for India) - check if starts with 91
                let phoneNumber = withoutDeviceId;
                if (
                  withoutDeviceId.startsWith('91') &&
                  withoutDeviceId.length > 10
                ) {
                  phoneNumber = withoutDeviceId.substring(2);
                }

                this.phoneNumber = phoneNumber;
                console.log('Phone number extracted:', this.phoneNumber);
              }
            }
          } catch (error) {
            console.error('Error extracting phone number:', error);
          }

          this.emit('status-update', this.currentStatus);
          this.isInitializing = false;
        }
      });
    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      this.currentStatus = 'close';
      this.emit('status-update', this.currentStatus);
      this.isInitializing = false;
    }
  }

  getQR(): string | null {
    return this.currentQR;
  }

  getStatus(): ConnectionState {
    return this.currentStatus;
  }

  getPhoneNumber(): string | null {
    try {
      // Return stored phone number if available
      if (this.phoneNumber) {
        return this.phoneNumber;
      }

      // Fallback: Try to get from socket if connected
      if (this.socket && this.currentStatus === 'open') {
        const userJid = this.socket.user?.id || this.socket.user?.jid;
        if (userJid) {
          // Extract JID part (before @s.whatsapp.net)
          const jidPart = userJid.split('@')[0];

          if (jidPart) {
            // Remove device identifier (everything after :)
            const withoutDeviceId = jidPart.split(':')[0];

            // Remove country code (91 for India) - check if starts with 91
            let phoneNumber = withoutDeviceId;
            if (
              withoutDeviceId.startsWith('91') &&
              withoutDeviceId.length > 10
            ) {
              phoneNumber = withoutDeviceId.substring(2);
            }

            if (phoneNumber) {
              this.phoneNumber = phoneNumber; // Cache it
              return phoneNumber;
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting phone number:', error);
      return null;
    }
  }

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    try {
      // Validate connection status
      if (this.currentStatus !== 'open') {
        return {
          success: false,
          error: 'WhatsApp is not connected. Please wait for connection.',
        };
      }

      if (!this.socket) {
        return {
          success: false,
          error: 'WhatsApp socket is not available.',
        };
      }

      // Format phone number (add @s.whatsapp.net suffix)
      const phoneNumber = params.phone.trim();
      if (!phoneNumber) {
        return {
          success: false,
          error: 'Phone number is required.',
        };
      }

      // Ensure phone number has @s.whatsapp.net suffix
      const jid = phoneNumber.includes('@')
        ? phoneNumber
        : `${phoneNumber}@s.whatsapp.net`;

      // Handle document (image or PDF)
      if (params.document) {
        try {
          // Convert base64 to Buffer
          const documentBuffer = Buffer.from(params.document.data, 'base64');
          const mimeType = params.document.mimeType.toLowerCase();

          // Check if it's an image type
          const isImage = mimeType.startsWith('image/');

          if (isImage) {
            // Send image with optional caption
            await this.socket.sendMessage(jid, {
              image: documentBuffer,
              caption: params.message || undefined,
              mimetype: params.document.mimeType,
            });
          } else {
            // Send as document (PDF or other file types)
            await this.socket.sendMessage(jid, {
              document: documentBuffer,
              mimetype: params.document.mimeType,
              fileName: params.document.filename,
              caption: params.message || undefined,
            });
          }

          return { success: true };
        } catch (error) {
          console.error('Error sending document:', error);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to send document.',
          };
        }
      }

      // Handle text-only message
      if (!params.message || !params.message.trim()) {
        return {
          success: false,
          error: 'Message text is required.',
        };
      }

      try {
        await this.socket.sendMessage(jid, {
          text: params.message.trim(),
        });

        return { success: true };
      } catch (error) {
        console.error('Error sending text message:', error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to send message.',
        };
      }
    } catch (error) {
      console.error('Error in sendMessage:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred.',
      };
    }
  }

  async disconnect() {
    if (this.socket) {
      await this.socket.end(undefined);
      this.socket = null;
    }
  }

  async logout(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Logging out WhatsApp session...');

      // Clear auth state first to force logout
      await this.clearAuthState();

      // Disconnect the socket
      if (this.socket) {
        await this.socket.end(undefined);
        this.socket = null;
      }

      // Clear cached data
      this.currentQR = null;
      this.phoneNumber = null;
      this.currentStatus = 'close';
      this.isInitializing = false;

      // Emit status updates
      this.emit('qr-update', null);
      this.emit('status-update', this.currentStatus);

      // Reinitialize to show new QR code
      console.log('Reinitializing after logout...');
      setTimeout(() => {
        this.initialize();
      }, 1000);

      return { success: true };
    } catch (error) {
      console.error('Error during logout:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred during logout.',
      };
    }
  }
}

export default WhatsAppService;
