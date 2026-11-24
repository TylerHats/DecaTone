import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert, FileText, Lock, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PhoneProvider, usePhone } from './context/PhoneContext';
import { BrandingProvider } from './context/BrandingContext';

import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CallModal } from './components/CallModal';
import { WebPhoneModal } from './components/WebPhoneModal';
import { SafeMarkdown } from './components/SafeMarkdown';

import { HomePage } from './pages/HomePage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { OnboardingPage } from './pages/OnboardingPage';
import { PhoneSettingsPage } from './pages/PhoneSettingsPage';
import { FriendsPage } from './pages/FriendsPage';
import { VoicemailPage } from './pages/VoicemailPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { SetupWizardPage } from './pages/SetupWizardPage';
import { LegalPage } from './pages/LegalPages';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';

const HttpFallbackBanner: React.FC = () => {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  const isPlainHttpRemote =
    typeof window !== 'undefined' &&
    !window.isSecureContext &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  if (dismissed || !isPlainHttpRemote) return null;

  return (
    <div
      style={{
        background: 'rgba(245, 158, 11, 0.14)',
        borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
        color: '#fcd34d',
        padding: '0.55rem 1.25rem',
        fontSize: '0.8rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', maxWidth: '1200px', margin: '0 auto', flex: 1 }}>
        <Lock size={15} style={{ flexShrink: 0 }} />
        <span>
          <strong>Plain HTTP LAN Mode:</strong> Pure-JS E2EE is active with keys held in volatile RAM until reload. Browser microphone capture may also require HTTPS.{' '}
          {user?.role === 'admin'
            ? 'Configure HTTPS (Reverse Proxy, Let’s Encrypt ACME, or Local CA) in Admin → Networking & TLS.'
            : 'Ask your administrator to enable HTTPS or install the Local Root CA certificate.'}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss HTTP security notice"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fcd34d',
          cursor: 'pointer',
          padding: '0.2rem',
          display: 'inline-flex',
          alignItems: 'center'
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode; requireAdmin?: boolean }> = ({
  children,
  requireAdmin
}) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          color: 'var(--text-muted)'
        }}
      >
        Loading DecaTone...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const TermsReacceptanceModal: React.FC = () => {
  const { user, refreshUser, logout } = useAuth();
  const [termsText, setTermsText] = useState('');
  const [checkedTerms, setCheckedTerms] = useState(false);
  const [checkedE911, setCheckedE911] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const needsReacceptance = Boolean(
    user &&
      user.currentTermsVersion &&
      String(user.termsAcceptedVersion ?? '') !== String(user.currentTermsVersion)
  );

  useEffect(() => {
    if (!needsReacceptance) return;
    fetch('/api/legal/config')
      .then((res) => res.json())
      .then((data) => {
        setTermsText(data.terms || '');
      })
      .catch(() => {});
  }, [needsReacceptance]);

  if (!needsReacceptance || !user) return null;

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkedTerms || !checkedE911) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/accept-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          agreedToTerms: true,
          acknowledgedE911: true,
          version: user.currentTermsVersion
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record terms acceptance');
      }
      await refreshUser();
    } catch (err: any) {
      setError(err?.message || 'Unable to accept updated terms');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1200 }}>
      <div
        className="glass-card"
        style={{
          maxWidth: '700px',
          width: '100%',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          padding: '2rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <FileText size={22} color="var(--accent-amber)" />
          <div>
            <h2 style={{ fontSize: '1.35rem', margin: 0 }}>Updated Terms &amp; 911 Notice (v{user.currentTermsVersion})</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Please review and accept the updated switchboard agreement to continue using your extension.
            </p>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '1.25rem',
            fontSize: '0.88rem',
            maxHeight: '320px'
          }}
        >
          <SafeMarkdown content={termsText || 'Loading updated Terms of Service...'} />
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fda4af',
              padding: '0.65rem 0.9rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleAccept} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              fontSize: '0.82rem',
              color: '#fda4af',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={checkedE911}
              onChange={(e) => setCheckedE911(e.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <span>
              <ShieldAlert size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              I acknowledge that DecaTone does <strong>NOT</strong> provide 911 / Emergency calling and cannot reach emergency dispatchers.
            </span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={checkedTerms}
              onChange={(e) => setCheckedTerms(e.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <span>I have read and agree to the updated Terms of Service &amp; Privacy Policy.</span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.35rem' }}>
            <button type="button" onClick={() => void logout()} className="btn btn-secondary btn-sm">
              Sign Out
            </button>
            <button
              type="submit"
              disabled={submitting || !checkedTerms || !checkedE911}
              className="btn btn-primary"
            >
              {submitting ? 'Saving Acceptance...' : 'Accept & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const GlobalWebPhoneHost: React.FC = () => {
  const { user } = useAuth();
  const { isWebPhoneModalOpen, setWebPhoneModalOpen, webPhoneInitialNumber } = usePhone();
  if (!user) return null;
  return (
    <WebPhoneModal
      isOpen={isWebPhoneModalOpen}
      onClose={() => setWebPhoneModalOpen(false)}
      initialNumber={webPhoneInitialNumber}
    />
  );
};

const AppContent: React.FC = () => {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const location = useLocation();

  // Fetch /api/setup/status once on mount (never on every route change)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/setup/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setSetupRequired(Boolean(data.setupRequired));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSetupRequired(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSetupComplete = useCallback(() => {
    setSetupRequired(false);
  }, []);

  if (setupRequired === null) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          color: 'var(--text-muted)'
        }}
      >
        Connecting to switchboard...
      </div>
    );
  }

  const isLegalRoute =
    location.pathname === '/terms' ||
    location.pathname === '/privacy' ||
    location.pathname === '/legal/licenses';

  if (setupRequired && location.pathname !== '/setup' && !isLegalRoute) {
    return <Navigate to="/setup" replace />;
  }

  if (!setupRequired && location.pathname === '/setup') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-container">
      <Navbar />
      <HttpFallbackBanner />
      <CallModal />
      <GlobalWebPhoneHost />
      <TermsReacceptanceModal />
      <main className="main-content">
        <Routes>
          <Route
            path="/setup"
            element={<SetupWizardPage onSetupComplete={handleSetupComplete} />}
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/terms" element={<LegalPage />} />
          <Route path="/privacy" element={<LegalPage />} />
          <Route path="/legal/licenses" element={<LegalPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <PhoneSettingsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/friends"
            element={
              <ProtectedRoute>
                <FriendsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/voicemail"
            element={
              <ProtectedRoute>
                <VoicemailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrandingProvider>
      <AuthProvider>
        <PhoneProvider>
          <AppContent />
        </PhoneProvider>
      </AuthProvider>
    </BrandingProvider>
  );
};

export default App;
