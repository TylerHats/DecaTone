import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldAlert, ShieldCheck, Key, Copy, Download, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { LegalModal, LegalTabType } from '../components/LegalModal';
import { clearUnlockedKey, generateRecoveryKey, generateUserKeyBundle } from '../services/e2eeCrypto';
import { copyToClipboard } from '../utils/clipboard';

export const LoginPage: React.FC = () => {
  const { loginWithCredentials } = useAuth();
  const { appName, logoUrl } = useBranding();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await loginWithCredentials(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '4rem auto', width: '100%' }}>
      <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src={logoUrl || '/branding/logo.png'}
            alt={appName}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '14px',
              marginBottom: '1rem',
              objectFit: 'contain',
              boxShadow: '0 0 20px rgba(14,165,233,0.3)'
            }}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/branding/logo.png';
            }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Welcome to {appName}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Sign in to manage your rotary line &amp; unlock E2EE keys
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fda4af',
              fontSize: '0.875rem',
              marginBottom: '1.5rem'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. rotary_fan"
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label">Password</label>
              <Link to="/forgot-password" style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)' }}>
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              className="form-input"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
          >
            {submitting ? 'Authenticating & Unlocking Keys...' : 'Sign In'}
          </button>
        </form>

        <div
          style={{
            textAlign: 'center',
            marginTop: '1.5rem',
            fontSize: '0.9rem',
            color: 'var(--text-muted)'
          }}
        >
          Don&apos;t have an extension? <Link to="/register">Create Account</Link>
        </div>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { login } = useAuth();
  const { appName, logoUrl } = useBranding();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [requestedNumber, setRequestedNumber] = useState('');
  const [requestedAreaCode, setRequestedAreaCode] = useState('');
  const [numberConfig, setNumberConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [acknowledgedE911, setAcknowledgedE911] = useState(false);
  const [requireTerms, setRequireTerms] = useState(true);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [modalTab, setModalTab] = useState<LegalTabType>('terms');
  const [recoveryKeyShown, setRecoveryKeyShown] = useState<string | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [confirmedRecoverySaved, setConfirmedRecoverySaved] = useState(false);

  useEffect(() => {
    fetch('/api/auth/number-options')
      .then((res) => res.json())
      .then((data) => {
        setNumberConfig(data.config);
        if (data.suggestedNumber && data.config?.allowUserChoice) {
          setRequestedNumber(data.suggestedNumber);
        }
        if (data.suggestedAreaCode) setRequestedAreaCode(data.suggestedAreaCode);
      })
      .catch(() => {});

    fetch('/api/legal/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.requireTermsOnSignup !== undefined) {
          setRequireTerms(Boolean(data.requireTermsOnSignup));
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (requireTerms && !agreedToTerms) {
      setError('Please accept the Terms of Service and Privacy Policy to continue.');
      return;
    }
    if (!acknowledgedE911) {
      setError('You must acknowledge that DecaTone does not provide 911 / Emergency calling.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const recoveryKey = generateRecoveryKey();
      const keyBundle = await generateUserKeyBundle(password, recoveryKey);

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username,
          password,
          displayName,
          email: email.trim() || undefined,
          requestedPhoneNumber: numberConfig?.allowUserChoice ? requestedNumber : undefined,
          requestedAreaCode,
          agreedToTerms,
          acknowledgedE911: true,
          encryptionPublicKey: keyBundle.encryptionPublicKey,
          encryptedPrivateKey: keyBundle.encryptedPrivateKey,
          keySalt: keyBundle.keySalt,
          recoveryEncryptedPrivateKey: keyBundle.recoveryEncryptedPrivateKey,
          recoveryKeySalt: keyBundle.recoveryKeySalt
        })
      });

      const data = await res.json();
      if (!res.ok) {
        clearUnlockedKey();
        throw new Error(data.error || 'Registration failed');
      }

      login(null, {
        ...data.user,
        encryptionPublicKey: data.user?.encryptionPublicKey ?? keyBundle.encryptionPublicKey,
        encryptedPrivateKey: data.user?.encryptedPrivateKey ?? keyBundle.encryptedPrivateKey,
        keySalt: data.user?.keySalt ?? keyBundle.keySalt,
        hasRecoveryKey: true
      });
      setRecoveryKeyShown(recoveryKey);
    } catch (err: any) {
      setError(err?.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (recoveryKeyShown) {
    return (
      <div style={{ maxWidth: '520px', margin: '3rem auto', width: '100%' }}>
        <div className="glass-card highlight-amber" style={{ padding: '2.25rem 2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <Key size={36} color="var(--accent-amber)" style={{ marginBottom: '0.5rem' }} />
            <h2 style={{ fontSize: '1.45rem', marginBottom: '0.35rem' }}>Save Your Zero-Access Recovery Key</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Keep this key safe offline. If you ever forget your password, this key lets you restore your encrypted voicemail vault without data loss.
            </p>
          </div>
          <div
            style={{
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.9rem',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: '#fcd34d',
              textAlign: 'center',
              wordBreak: 'break-all',
              marginBottom: '1rem'
            }}
          >
            {recoveryKeyShown}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={async () => {
                if (await copyToClipboard(recoveryKeyShown)) {
                  setCopiedRecovery(true);
                  setTimeout(() => setCopiedRecovery(false), 2500);
                }
              }}
              className="btn btn-secondary"
              style={{ flex: 1 }}
            >
              <Copy size={14} /> {copiedRecovery ? 'Copied!' : 'Copy Key'}
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob(
                  [`DecaTone Recovery Key (@${username}):\n${recoveryKeyShown}\n`],
                  { type: 'text/plain;charset=utf-8' }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `decatone-recovery-${username}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn btn-secondary"
              style={{ flex: 1 }}
            >
              <Download size={14} /> Download .txt
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.86rem', color: '#fff', marginBottom: '1rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={confirmedRecoverySaved}
              onChange={(e) => setConfirmedRecoverySaved(e.target.checked)}
            />
            <span>I have stored my Recovery Key safely.</span>
          </label>
          <button
            type="button"
            disabled={!confirmedRecoverySaved}
            onClick={() => navigate('/onboarding')}
            className="btn btn-amber btn-lg"
            style={{ width: '100%' }}
          >
            <CheckCircle2 size={16} /> Continue to Phone Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '500px', margin: '3rem auto', width: '100%' }}>
      <div className="glass-card highlight-amber" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src={logoUrl || '/branding/logo.png'}
            alt={appName}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '14px',
              marginBottom: '1rem',
              objectFit: 'contain',
              boxShadow: '0 0 20px rgba(245,158,11,0.3)'
            }}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/branding/logo.png';
            }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Join {appName}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Claim your vintage extension &amp; generate Zero-Access E2EE keys
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fda4af',
              fontSize: '0.875rem',
              marginBottom: '1.5rem'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. vintage_bell"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email Address (Optional)</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. you@example.com (for password recovery & alerts)"
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Used for password resets and optional voicemail/missed call alerts.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice's Rotary Desk"
            />
          </div>

          {/* Phone Number / Extension Selector */}
          <div className="form-group">
            <label className="form-label">
              <span>Assigned Phone Extension</span>
              {numberConfig?.allowUserChoice && (
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-amber)' }}>
                  User Customizable
                </span>
              )}
            </label>

            {numberConfig && !numberConfig.allowUserChoice ? (
              <div
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.7rem 0.9rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)'
                }}
              >
                Your extension ({numberConfig.minNumberLength}–{numberConfig.maxNumberLength} digits) will be automatically assigned by switchboard policy on creation.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {numberConfig?.areaCodeEnabled && (
                  <select
                    className="form-select"
                    style={{ width: '110px', fontFamily: 'var(--font-mono)' }}
                    value={requestedAreaCode}
                    onChange={(e) => setRequestedAreaCode(e.target.value)}
                  >
                    {numberConfig.allowedAreaCodes?.map((ac: string) => (
                      <option key={ac} value={ac}>
                        ({ac})
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  className="form-input"
                  required
                  value={requestedNumber}
                  onChange={(e) => setRequestedNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder={
                    numberConfig
                      ? numberConfig.minNumberLength === numberConfig.maxNumberLength
                        ? `${numberConfig.minNumberLength} digits`
                        : `${numberConfig.minNumberLength}–${numberConfig.maxNumberLength} digits`
                      : '1000'
                  }
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    letterSpacing: '0.05em'
                  }}
                />
              </div>
            )}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              {numberConfig?.minNumberLength !== numberConfig?.maxNumberLength
                ? `Extension length: ${numberConfig?.minNumberLength}–${numberConfig?.maxNumberLength} digits. Other users dial this to call you.`
                : 'This is the extension other users dial on their rotary phones to call you.'}
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Password (8+ characters)</label>
            <input
              type="password"
              className="form-input"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <span
              style={{
                fontSize: '0.73rem',
                color: '#34d399',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
            >
              <ShieldCheck size={12} /> Protects your client-side ECDH P-256 Zero-Access voicemail key.
            </span>
          </div>

          {/* Mandatory E911 No-Emergency-Calling Acknowledgment */}
          <div
            style={{
              marginBottom: '0.9rem',
              padding: '0.75rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(244, 63, 94, 0.1)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.65rem'
            }}
          >
            <input
              type="checkbox"
              id="e911Checkbox"
              required
              checked={acknowledgedE911}
              onChange={(e) => setAcknowledgedE911(e.target.checked)}
              style={{ marginTop: '0.25rem', cursor: 'pointer' }}
            />
            <label
              htmlFor="e911Checkbox"
              style={{ fontSize: '0.8rem', color: '#fda4af', lineHeight: 1.45, cursor: 'pointer' }}
            >
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#fff' }}>
                <ShieldAlert size={13} color="#f43f5e" /> No 911 / Emergency Calling Acknowledgment:
              </strong>{' '}
              I understand that {appName} is a private VoIP hobbyist switchboard, is{' '}
              <strong>NOT connected to the public telephone network (PSTN)</strong>, and{' '}
              <strong>CANNOT dial 911 or emergency services</strong>.
            </label>
          </div>

          {/* Legal Terms & Privacy Agreement Checkbox */}
          {requireTerms && (
            <div
              style={{
                marginBottom: '1.4rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.65rem'
              }}
            >
              <input
                type="checkbox"
                id="termsCheckbox"
                required
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                style={{ marginTop: '0.25rem', cursor: 'pointer' }}
              />
              <label
                htmlFor="termsCheckbox"
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  lineHeight: 1.4,
                  cursor: 'pointer'
                }}
              >
                I agree to the{' '}
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('terms');
                    setShowLegalModal(true);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-amber)',
                    padding: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    font: 'inherit'
                  }}
                >
                  Terms of Service
                </button>
                ,{' '}
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('privacy');
                    setShowLegalModal(true);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-amber)',
                    padding: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    font: 'inherit'
                  }}
                >
                  Privacy &amp; Zero-Access Policy
                </button>
                , and{' '}
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('licenses');
                    setShowLegalModal(true);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-amber)',
                    padding: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    font: 'inherit'
                  }}
                >
                  GNU GPL v3.0 Notices
                </button>
                .
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !acknowledgedE911 || (requireTerms && !agreedToTerms)}
            className="btn btn-amber btn-lg"
            style={{ width: '100%' }}
          >
            {submitting ? 'Generating Keys & Creating Extension...' : 'Claim Extension & Setup Phone'}
          </button>
        </form>

        <div
          style={{
            textAlign: 'center',
            marginTop: '1.5rem',
            fontSize: '0.9rem',
            color: 'var(--text-muted)'
          }}
        >
          Already have an account? <Link to="/login">Sign In</Link>
        </div>
      </div>

      <LegalModal
        isOpen={showLegalModal}
        initialTab={modalTab}
        onClose={() => setShowLegalModal(false)}
      />
    </div>
  );
};
