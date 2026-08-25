import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Wifi, Server, Cpu, BellRing, CheckCircle2, Copy, Check, ArrowRight, ShieldCheck, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePhone } from '../context/PhoneContext';
import { useBranding } from '../context/BrandingContext';

export const OnboardingPage: React.FC = () => {
  const { user } = useAuth();
  const { phone, claimPhone, testRing } = usePhone();
  const { appName } = useBranding();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [deviceIdInput, setDeviceIdInput] = useState('');
  const [copiedServerUrl, setCopiedServerUrl] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState('');
  const [pairSuccess, setPairSuccess] = useState(false);
  const [testingRing, setTestingRing] = useState(false);
  const [ringSuccess, setRingSuccess] = useState(false);

  const serverUrl = window.location.origin;

  const handleCopyServerUrl = () => {
    navigator.clipboard.writeText(serverUrl);
    setCopiedServerUrl(true);
    setTimeout(() => setCopiedServerUrl(false), 2000);
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceIdInput.trim()) return;

    setPairing(true);
    setPairError('');
    const success = await claimPhone(deviceIdInput.trim());
    setPairing(false);

    if (success) {
      setPairSuccess(true);
      setStep(4);
    } else {
      setPairError('Could not pair phone. Please check the Device ID and ensure the ESP32-S3 is powered on.');
    }
  };

  const handleTestRing = async () => {
    setTestingRing(true);
    const ok = await testRing();
    setTestingRing(false);
    if (ok) setRingSuccess(true);
  };

  return (
    <div style={{ maxWidth: '720px', margin: '2rem auto', width: '100%' }}>
      {/* Stepper Progress Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '18px', left: '30px', right: '30px', height: '2px', background: 'var(--border-subtle)', zIndex: 1 }} />
        {[
          { num: 1, title: 'Setup WiFi' },
          { num: 2, title: 'Server URL' },
          { num: 3, title: 'Enter Device ID' },
          { num: 4, title: 'Ring Test' }
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
                cursor: 'pointer'
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
                  fontWeight: '700',
                  fontSize: '0.9rem',
                  background: isDone ? '#10b981' : isCurrent ? 'var(--accent-cyan)' : 'var(--bg-card-solid)',
                  color: isDone || isCurrent ? '#fff' : 'var(--text-dim)',
                  border: `2px solid ${isDone ? '#10b981' : isCurrent ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                  boxShadow: isCurrent ? '0 0 15px rgba(14, 165, 233, 0.5)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                {isDone ? <Check size={18} /> : s.num}
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: '600', color: isCurrent ? '#fff' : 'var(--text-dim)' }}>
                {s.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Connect to ESP32-S3 SoftAP */}
      {step === 1 && (
        <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ padding: '0.6rem', borderRadius: '12px', background: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-cyan)' }}>
              <Wifi size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Step 1: Connect to ESP32-S3 Setup WiFi</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Power on your rotary phone to start initial provisioning</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', margin: '1.5rem 0', color: 'var(--text-main)', fontSize: '0.95rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontWeight: '700' }}>1</span>
              <span>Plug in your ESP32-S3 rotary phone using USB-C or internal 5V power supply.</span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontWeight: '700' }}>2</span>
              <span>
                On your phone or laptop, look for the WiFi network named <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>DecaTone-Setup-XXXX</strong> and connect to it. (Default Password: <code style={{ fontFamily: 'var(--font-mono)' }}>rotary123</code> or open).
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontWeight: '700' }}>3</span>
              <span>
                Your browser should automatically open the setup page. If not, browse to <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>http://192.168.4.1</strong>.
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
            <div style={{ padding: '0.6rem', borderRadius: '12px', background: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-cyan)' }}>
              <Server size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Step 2: Enter Base Server URL</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Tell your phone which switchboard server to register with</p>
            </div>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '1rem 0' }}>
            In the ESP32-S3 web setup screen, select your home WiFi network, enter its password, and copy & paste this server base URL into the <strong>Server Base URL</strong> field:
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(0,0,0,0.5)',
              padding: '0.85rem 1.25rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '1.5rem'
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', color: 'var(--accent-amber)', fontWeight: '700' }}>
              {serverUrl}
            </span>
            <button onClick={handleCopyServerUrl} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {copiedServerUrl ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
              {copiedServerUrl ? 'Copied!' : 'Copy URL'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(1)} className="btn btn-secondary btn-lg" style={{ flex: 1 }}>
              Back
            </button>
            <button onClick={() => setStep(3)} className="btn btn-primary btn-lg" style={{ flex: 2 }}>
              Next: Pair Device ID <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Enter Device ID */}
      {step === 3 && (
        <div className="glass-card highlight-amber" style={{ padding: '2.5rem 2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ padding: '0.6rem', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-amber)' }}>
              <Cpu size={24} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.4rem' }}>Step 3: Pair Your Unique Device ID</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Link your ESP32-S3 rotary hardware to your user account</p>
            </div>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '1rem 0' }}>
            After saving your WiFi and Server settings on the ESP32-S3, the setup page will display a unique <strong>Device ID</strong> (e.g. <code style={{ fontFamily: 'var(--font-mono)' }}>DT-A1B2C3D4</code>). Enter or paste it below:
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
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">ESP32-S3 Unique Device ID</label>
              <input
                type="text"
                className="form-input"
                required
                autoFocus
                value={deviceIdInput}
                onChange={(e) => setDeviceIdInput(e.target.value.toUpperCase())}
                placeholder="e.g. DT-3485189A"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', letterSpacing: '0.1em', textAlign: 'center' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setStep(2)} className="btn btn-secondary btn-lg" style={{ flex: 1 }}>
                Back
              </button>
              <button type="submit" disabled={pairing || !deviceIdInput} className="btn btn-amber btn-lg" style={{ flex: 2 }}>
                {pairing ? 'Linking Phone...' : 'Pair Phone to My Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 4: Ring Test & Completion */}
      {step === 4 && (
        <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem', textAlign: 'center' }}>
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '2px solid #10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem'
            }}
          >
            <CheckCircle2 size={36} color="#10b981" />
          </div>

          <h2 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Phone Paired Successfully!</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '480px', margin: '0 auto 1.5rem' }}>
            Your ESP32-S3 rotary phone is now registered to extension <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>EXT {user?.phoneNumber}</strong> on {appName}.
          </p>

          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              padding: '1.5rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              marginBottom: '2rem'
            }}
          >
            <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Test Your Physical Bell Ringer</h4>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Click below to send a 20Hz pulse burst through the IRF640N MOSFET and ring your rotary telephone's mechanical bells.
            </p>

            <button
              onClick={handleTestRing}
              disabled={testingRing}
              className="btn btn-amber btn-lg"
              style={{ minWidth: '220px' }}
            >
              <BellRing size={20} /> {testingRing ? 'Sending Signal...' : 'Ring Physical Bell'}
            </button>

            {ringSuccess && (
              <div style={{ marginTop: '0.75rem', color: '#34d399', fontSize: '0.85rem', fontWeight: '600' }}>
                &check; Test ring sent! Did your bell chime?
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <Link to="/settings" className="btn btn-secondary">
              Tune Audio & Cadence
            </Link>
            <Link to="/" className="btn btn-primary btn-lg">
              Go to Switchboard Dashboard &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
