import { useEffect, useState } from 'react';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Loader2, XCircle, Smartphone } from 'lucide-react';
import NSLogo from '../../assets/NSLogo.svg';
import './App.css';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from './components/ui/card';
import { Badge } from './components/ui/badge';

function WhatsAppAuth() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('close');
  const [hasOpenLink, setHasOpenLink] = useState<boolean>(false);

  useEffect(() => {
    // Get initial openLink
    const loadInitialData = async () => {
      const initialOpenLink = await window.electron.openLink.getOpenLink();
      if (initialOpenLink) {
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
          variant: 'success' as const,
          icon: <CheckCircle2 className="w-4 h-4 mr-1" />,
          message: 'You are successfully connected to WhatsApp!',
        };
      case 'close':
        return {
          text: 'Disconnected',
          variant: 'destructive' as const,
          icon: <XCircle className="w-4 h-4 mr-1" />,
          message: 'Please scan the QR code to connect.',
        };
      default:
        return {
          text: 'Connecting',
          variant: 'warning' as const,
          icon: <Loader2 className="w-4 h-4 mr-1 animate-spin" />,
          message: 'Please wait while we connect to WhatsApp.',
        };
    }
  };

  const statusInfo = getStatusDisplay();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header Section */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-white rounded-2xl shadow-sm mb-4">
            <img src={NSLogo} alt="Newton School" className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Iris
          </h1>
          <p className="text-slate-500">Your WhatsApp helper</p>
        </div>

        {/* Main Content Card */}
        <Card className="border-slate-200 shadow-xl">
          {!hasOpenLink ? (
            <CardContent className="pt-6 pb-8 text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Smartphone className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="text-xl font-semibold text-slate-700">
                Launch from LSQ
              </h2>
              <p className="text-slate-500 max-w-xs mx-auto">
                Please launch the application from your LSQ dashboard to
                continue.
              </p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="text-center pb-2">
                <div className="flex justify-center mb-2">
                  <Badge variant={statusInfo.variant} className="px-3 py-1">
                    {statusInfo.icon}
                    {statusInfo.text}
                  </Badge>
                </div>
                <CardDescription className="text-base">
                  {statusInfo.message}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col items-center justify-center py-6">
                {status === 'open' ? (
                  <div className="text-center space-y-4 py-8">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-in zoom-in duration-300">
                      <CheckCircle2 className="w-10 h-10" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-slate-900">Ready to use</p>
                      <p className="text-sm text-slate-500">
                        Iris is now active and syncing messages.
                      </p>
                    </div>
                  </div>
                ) : (
                  qrCode && (
                    <div className="space-y-6 w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="p-4 bg-white rounded-xl border-2 border-slate-100 shadow-sm">
                        <QRCodeSVG
                          value={qrCode}
                          size={240}
                          level="H"
                          className="rounded-lg"
                        />
                      </div>
                      <div className="flex items-start gap-3 text-sm text-slate-500 bg-slate-50 p-4 rounded-lg w-full max-w-xs">
                        <Smartphone className="w-5 h-5 mt-0.5 shrink-0" />
                        <p>
                          Open WhatsApp on your phone, go to{' '}
                          <strong>Settings {'>'} Linked Devices</strong>, and
                          scan the code.
                        </p>
                      </div>
                    </div>
                  )
                )}
              </CardContent>
            </>
          )}
        </Card>

        <p className="text-center text-xs text-slate-400">
          Powered by Newton School
        </p>
      </div>
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
