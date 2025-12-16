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
  image?: {
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

      // Handle image message
      if (params.image) {
        try {
          // Convert base64 to Buffer
          const imageBuffer = Buffer.from(params.image.data, 'base64');

          // Send image with optional caption
          await this.socket.sendMessage(jid, {
            image: imageBuffer,
            caption: params.message || undefined,
            mimetype: params.image.mimeType,
          });

          return { success: true };
        } catch (error) {
          console.error('Error sending image message:', error);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to send image message.',
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
}

export default WhatsAppService;
