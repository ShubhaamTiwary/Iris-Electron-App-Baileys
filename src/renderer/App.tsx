import { useEffect, useState } from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import NSLogo from '../../assets/NSLogo.svg';
import './App.css';

function WhatsAppAuth() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('close');
  const [openLink, setOpenLink] = useState<string | null>(null);
  const [hasOpenLink, setHasOpenLink] = useState<boolean>(false);

  useEffect(() => {
    // Get initial openLink
    const loadInitialData = async () => {
      const initialOpenLink = await window.electron.openLink.getOpenLink();
      if (initialOpenLink) {
        setOpenLink(initialOpenLink);
        setHasOpenLink(true);

        // Load WhatsApp data if we have openLink
        const initialQR = await window.electron.whatsapp.getQR();
        const initialStatus = await window.electron.whatsapp.getStatus();
        setQrCode(initialQR);
        setStatus(initialStatus);
      }
    };

    loadInitialData();

    // Set up listener for openLink updates
    const unsubscribeOpenLink = window.electron.openLink.onOpenLinkUpdate(
      async (newOpenLink) => {
        if (newOpenLink) {
          setOpenLink(newOpenLink);
          setHasOpenLink(true);

          // Load WhatsApp data when openLink is received
          const initialQR = await window.electron.whatsapp.getQR();
          const initialStatus = await window.electron.whatsapp.getStatus();
          setQrCode(initialQR);
          setStatus(initialStatus);
        }
      },
    );

    // Set up listeners for WhatsApp updates
    const unsubscribeQR = window.electron.whatsapp.onQRUpdate((qr) => {
      setQrCode(qr);
    });

    const unsubscribeStatus = window.electron.whatsapp.onStatusUpdate(
      (newStatus) => {
        setStatus(newStatus);
      },
    );

    // Cleanup listeners on unmount
    return () => {
      unsubscribeOpenLink();
      unsubscribeQR();
      unsubscribeStatus();
    };
  }, []);

  const getStatusDisplay = () => {
    switch (status) {
      case 'open':
        return {
          text: 'Connected',
          className: 'status-connected',
          message: 'You are successfully connected to WhatsApp!',
        };
      case 'close':
        return {
          text: 'Disconnected',
          className: 'status-disconnected',
          message: 'Please scan the QR code to connect.',
        };
      default:
        return {
          text: 'Connecting',
          className: 'status-connecting',
          message: 'Please wait while we connect to WhatsApp.',
        };
    }
  };

  const statusInfo = getStatusDisplay();

  // Show "Launch from LSQ" message if openLink is not yet received
  if (!hasOpenLink) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <div className="logo-container">
              <img src={NSLogo} alt="Newton School" className="ns-logo" />
            </div>
            <h1 className="app-title">Iris</h1>
            <p className="app-subtitle">Your WhatsApp helper</p>
          </div>
        </header>

        <main className="app-main">
          <div className="lsq-message-section">
            <p className="lsq-message">Launch from LSQ</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <div className="logo-container">
            <img src={NSLogo} alt="Newton School" className="ns-logo" />
          </div>
          <h1 className="app-title">Iris</h1>
          <p className="app-subtitle">Your WhatsApp helper</p>
        </div>
      </header>

      <main className="app-main">
        <div className="status-section">
          <div className={`status-badge ${statusInfo.className}`}>
            <span className="status-dot" />
            <span className="status-text">{statusInfo.text}</span>
          </div>
          <p className="status-message">{statusInfo.message}</p>
        </div>

        {qrCode && status !== 'open' && (
          <div className="qr-section">
            <div className="qr-container">
              <QRCodeSVG value={qrCode} size={320} level="H" />
            </div>
            <p className="qr-instruction">
              Open WhatsApp on your phone and scan this QR code
            </p>
          </div>
        )}

        {status === 'open' && (
          <div className="success-section">
            <div className="success-icon">✓</div>
            <p className="success-message">
              You are successfully connected to WhatsApp!
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WhatsAppAuth />} />
      </Routes>
    </Router>
  );
}
