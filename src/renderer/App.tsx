import { useEffect, useState } from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';

function WhatsAppAuth() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('close');

  useEffect(() => {
    // Get initial QR and status
    const loadInitialData = async () => {
      const initialQR = await window.electron.whatsapp.getQR();
      const initialStatus = await window.electron.whatsapp.getStatus();
      setQrCode(initialQR);
      setStatus(initialStatus);
    };

    loadInitialData();

    // Set up listeners for updates
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
      unsubscribeQR();
      unsubscribeStatus();
    };
  }, []);

  if (status === 'open') {
    return (
      <div className="Hello">
        <h1>Logged In</h1>
        <p>You are successfully connected to WhatsApp!</p>
      </div>
    );
  }

  if (qrCode) {
    return (
      <div className="Hello">
        <h1>Scan QR Code</h1>
        <p>Open WhatsApp on your phone and scan this QR code:</p>
        <div style={{ margin: '20px 0' }}>
          <QRCodeSVG value={qrCode} size={256} />
        </div>
        <p style={{ fontSize: '14px', color: '#666' }}>
          Waiting for authentication...
        </p>
      </div>
    );
  }

  return (
    <div className="Hello">
      <h1>Connecting...</h1>
      <p>Please wait while we connect to WhatsApp.</p>
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
