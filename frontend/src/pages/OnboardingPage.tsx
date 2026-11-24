import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wifi,
  Server,
  BellRing,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  Zap,
  ShieldAlert
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePhone } from '../context/PhoneContext';
import { copyToClipboard } from '../utils/clipboard';

export const OnboardingPage: React.FC = () => {
  const { user } = useAuth();
  const { claimPhoneByCode, testRing } = usePhone();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [phoneLabelInput, setPhoneLabelInput] = useState('Main Phone');
  const [copiedServerUrl, setCopiedServerUrl] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [testingRing, setTestingRing] = useState(false);
  const [ringSuccess, setRingSuccess] = useState(false);

  const serverUrl = window.location.origin;

  const handleCopyServerUrl = async () => {
    if (await copyToClipboard(serverUrl)) {
      setCopiedServerUrl(true);
      setTimeout(() => setCopiedServerUrl(false), 2000);
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingCodeInput.trim()) return;

    setPairing(true);
    setPairError('');
    try {
      const success = await claimPhoneByCode(
        pairingCodeInput.trim(),
        phoneLabelInput.trim() || 'Main Phone'
      );
      if (success) {
        setStep(4);
      } else {
        setPairError(
          'Could not pair phone. Please ensure your DecaTone adapter is powered on and connected to the switchboard.'
        );
      }
    } catch (err: any) {
      setPairError(
        err?.message ||
          'Could not pair phone. Verify the pairing code and ensure your phone is connected to the switchboard.'
      );
    } finally {
      setPairing(false);
    }
  };

  const handleTestRing = async () => {
    setTestingRing(true);
    try {
      const ok = await testRing();
      if (ok) setRingSuccess(true);
    } finally {
      setTestingRing(false);
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '2rem auto', width: '100%' }}>
      {/* Stepper Progress Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '2.5rem',
          position: 'relative'
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '18px',
            left: '30px',
            right: '30px',
            height: '2px',
            background: 'var(--border-subtle)',
            zIndex: 1
          }}
        />
        {[
          { num: 1, title: 'Connect to Setup AP' },
          { num: 2, title: 'Server Address' },
          { num: 3, title: 'Enter Pairing Code' },
          { num: 4, title: 'Bell Ringer Test' }
        ].map((s) => {
          const isDone = step > s.num;
          const isCurrent = step === s.num;
          return (
            <div
              key={s.num}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                position: 'relative',
                zIndex: 2,
                cursor: s.num < step ? 'pointer' : 'default'
              }}
              onClick={() => s.num < step && setStep(s.num)}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  background: isDone
                    ? '#10b981'
                    : isCurrent
                    ? 'var(--accent-cyan)'
                    : 'var(--bg-card-solid)',
                  color: isDone || isCurrent ? '#fff' : 'var(--text-dim)',
                  border: `2px solid ${
                    isDone ? '#10b981' : isCurrent ? 'var(--accent-cyan)' : 'var(--border-subtle)'
                  }`,
                  boxShadow: isCurrent ? '0 0 15px rgba(14, 165, 233, 0.5)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                {isDone ? <Check size={18} /> : s.num}
              </div>
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: isCurrent ? '#fff' : 'var(--text-dim)',
                  textAlign: 'center'
                }}
              >
                {s.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Connect to Setup AP */}
      {step === 1 && (
        <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div
              style={{
                padding: '0.6rem',
                borderRadius: '12px',
                background: 'rgba(14, 165, 233, 0.15)',
                color: 'var(--accent-cyan)'
              }}
            >
              <Wifi size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Step 1: Connect to Telephone Setup WiFi</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Power on your rotary phone adapter to start initial setup
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              margin: '1.5rem 0',
              color: 'var(--text-main)',
              fontSize: '0.95rem'
            }}
          >
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 700
                }}
              >
                1
              </span>
              <span>Plug in your DecaTone telephone adapter using USB-C or internal 5V power supply.</span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 700
                }}
              >
                2
              </span>
              <span>
                On your phone or computer, open your WiFi settings and connect to the network named{' '}
                <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                  DecaTone-Setup-XXXX
                </strong>{' '}
                (WiFi password:{' '}
                <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>decatone</strong>).
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 700
                }}
              >
                3
              </span>
              <span>
                Your browser should automatically open the setup page. If not, browse to{' '}
                <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                  http://192.168.4.1
                </strong>
                .
              </span>
            </div>
          </div>

          <button onClick={() => setStep(2)} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            Next: Server Connection URL <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* Step 2: Configure Server URL & WiFi */}
      {step === 2 && (
        <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div
              style={{
                padding: '0.6rem',
                borderRadius: '12px',
                background: 'rgba(14, 165, 233, 0.15)',
                color: 'var(--accent-cyan)'
              }}
            >
              <Server size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Step 2: Enter Base Server URL</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Tell your phone which switchboard server to register with
              </p>
            </div>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '1rem 0' }}>
            In the telephone setup screen, select your home WiFi network, enter its password, and copy &amp; paste this server base URL into the <strong>Server Base URL</strong> field:
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              background: 'rgba(0,0,0,0.5)',
              padding: '0.85rem 1.25rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '1.5rem'
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.05rem',
                color: 'var(--accent-amber)',
                fontWeight: 700
              }}
            >
              {serverUrl}
            </span>
            <button onClick={handleCopyServerUrl} className="btn btn-secondary btn-sm">
              {copiedServerUrl ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
              {copiedServerUrl ? 'Copied!' : 'Copy URL'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(1)} className="btn btn-secondary btn-lg" style={{ flex: 1 }}>
              Back
            </button>
            <button onClick={() => setStep(3)} className="btn btn-primary btn-lg" style={{ flex: 2 }}>
              Next: Enter Pairing Code <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Enter Pairing Code */}
      {step === 3 && (
        <div className="glass-card highlight-amber" style={{ padding: '2.5rem 2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div
              style={{
                padding: '0.6rem',
                borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: 'var(--accent-amber)'
              }}
            >
              <Zap size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Step 3: Enter Hardware Pairing Code</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Link your telephone hardware to your account
              </p>
            </div>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '1rem 0' }}>
            Once connected, lift the handset or check the adapter screen for its <strong>Pairing Code</strong> (e.g.{' '}
            <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>TONE-4821</strong> or{' '}
            <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>4821</strong>):
          </p>

          {pairError && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                color: '#fda4af',
                fontSize: '0.875rem',
                marginBottom: '1.25rem'
              }}
            >
              {pairError}
            </div>
          )}

          <form onSubmit={handlePair}>
            <div className="form-group">
              <label className="form-label">Phone Label</label>
              <input
                type="text"
                className="form-input"
                value={phoneLabelInput}
                onChange={(e) => setPhoneLabelInput(e.target.value)}
                placeholder="e.g. Desk Bell 500, Kitchen Wall Phone"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Pairing Code</label>
              <input
                type="text"
                className="form-input"
                required
                autoFocus
                value={pairingCodeInput}
                onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                placeholder="e.g. TONE-4821 or 4821"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.2rem',
                  letterSpacing: '0.1em',
                  textAlign: 'center'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn btn-secondary btn-lg"
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={pairing || !pairingCodeInput.trim()}
                className="btn btn-amber btn-lg"
                style={{ flex: 2 }}
              >
                {pairing ? 'Pairing Phone...' : 'Pair Telephone to My Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 4: Test Mechanical Bell Ringer & Safety Notice */}
      {step === 4 && (
        <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem', textAlign: 'center' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              color: '#34d399',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem auto'
            }}
          >
            <CheckCircle2 size={36} />
          </div>

          <h2 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Telephone Paired Successfully!</h2>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '0.95rem',
              maxWidth: '480px',
              margin: '0 auto 1.5rem auto'
            }}
          >
            Your rotary telephone is now connected to{' '}
            <strong style={{ color: '#fff' }}>EXT {user?.phoneNumber}</strong>. Let&apos;s send a test ring signal to verify the mechanical bell driver.
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              maxWidth: '360px',
              margin: '0 auto 1.5rem auto'
            }}
          >
            <button
              type="button"
              onClick={handleTestRing}
              disabled={testingRing}
              className="btn btn-amber btn-lg"
              style={{ width: '100%' }}
            >
              <BellRing size={20} /> {testingRing ? 'Ringing Bell...' : 'Test Bell Ringer'}
            </button>

            {ringSuccess && (
              <div
                style={{
                  color: '#34d399',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem'
                }}
              >
                <CheckCircle2 size={16} /> Signal sent! Your telephone should be ringing.
              </div>
            )}
          </div>

          <button
            onClick={() => navigate('/')}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', maxWidth: '360px' }}
          >
            Go to Switchboard Dashboard &rarr;
          </button>
        </div>
      )}

      {/* Hardware Physical E911 Sticker / Safety Labeling Tip */}
      <div
        style={{
          marginTop: '1.5rem',
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(244, 63, 94, 0.08)',
          border: '1px solid rgba(244, 63, 94, 0.28)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.85rem'
        }}
      >
        <ShieldAlert size={20} color="#f43f5e" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <strong style={{ color: '#fda4af' }}>Hardware Safety Tip — Affix a Physical E911 Warning Label:</strong>{' '}
          Because DecaTone is a private VoIP switchboard with <strong>no PSTN or 911/E911 emergency calling access</strong>, always place a clearly visible sticker or dial-center card reading{' '}
          <code style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
            NOT CONNECTED TO 911 — USE MOBILE PHONE FOR EMERGENCIES
          </code>{' '}
          on or beside every converted rotary telephone so guests and household members are informed.
        </div>
      </div>
    </div>
  );
};
