import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  ShieldCheck,
  Volume2,
  Download,
  Play,
  Lock,
  Key,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { LegalModal, LegalTabType } from '../components/LegalModal';
import { clearUnlockedKey, generateRecoveryKey, generateUserKeyBundle } from '../services/e2eeCrypto';
import { copyToClipboard } from '../utils/clipboard';

interface SetupWizardPageProps {
  onSetupComplete?: () => void;
}

const FALLBACK_VOICES_BY_ENGINE: Record<string, { id: string; label: string }[]> = {
  piper: [
    { id: 'en_US-lessac-medium', label: 'Lessac — US Female Central Office Operator' },
    { id: 'en_US-amy-medium', label: 'Amy — US Female Clear Modern' },
    { id: 'en_US-ryan-medium', label: 'Ryan — US Male Broadcast Announcer' },
    { id: 'en_GB-alba-medium', label: 'Alba — UK GPO Female Operator' },
    { id: 'en_GB-alan-medium', label: 'Alan — UK GPO Male Operator' }
  ],
  kokoro: [
    { id: 'kokoro_af_heart', label: 'Heart — US Female Natural Warm' },
    { id: 'kokoro_af_bella', label: 'Bella — US Female Expressive Operator' }
  ],
  espeak: [
    { id: 'espeak_en_us_m', label: 'Local eSpeak-NG US Male' }
  ]
};

export const SetupWizardPage: React.FC<SetupWizardPageProps> = ({ onSetupComplete }) => {
  const { login } = useAuth();
  const { appName, logoUrl, refreshBranding } = useBranding();
  const navigate = useNavigate();

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('System Administrator');
  const [adminPhoneNumber, setAdminPhoneNumber] = useState('1000');
  const [appNameInput, setAppNameInput] = useState('DecaTone');
  const [phoneNumberMinLength, setPhoneNumberMinLength] = useState('4');
  const [phoneNumberMaxLength, setPhoneNumberMaxLength] = useState('7');
  const [assignmentMode, setAssignmentMode] = useState('user_choice');
  const [acknowledgedE911AndTerms, setAcknowledgedE911AndTerms] = useState(false);

  // Voice & Local Neural TTS OOBE choices
  const [ttsEngine, setTtsEngine] = useState<'piper' | 'kokoro' | 'espeak'>('piper');
  const [ttsVoice, setTtsVoice] = useState('en_US-lessac-medium');
  const [ttsStatus, setTtsStatus] = useState<any>(null);
  const [previewingTts, setPreviewingTts] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Networking & TLS OOBE choices
  const [tlsMode, setTlsMode] = useState<'proxy' | 'acme' | 'local_ca'>('proxy');
  const [trustProxy, setTrustProxy] = useState(false);
  const [acmeDomain, setAcmeDomain] = useState('');
  const [acmeEmail, setAcmeEmail] = useState('');
  const [acmeStaging, setAcmeStaging] = useState(false);
  const [localCaHosts, setLocalCaHosts] = useState('');

  // Recovery Key confirmation screen state
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState<string | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [confirmedRecoverySaved, setConfirmedRecoverySaved] = useState(false);

  const [showLegalModal, setShowLegalModal] = useState(false);
  const [modalTab, setModalTab] = useState<LegalTabType>('terms');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const fetchOobeTtsStatus = async () => {
    try {
      const res = await fetch('/api/setup/tts/status');
      if (res.ok) {
        const data = await res.json();
        setTtsStatus(data);
        return data;
      }
    } catch {
      // Ignore
    }
    return null;
  };

  useEffect(() => {
    void fetchOobeTtsStatus();
  }, []);

  // Poll progress while an on-demand TTS download is running
  useEffect(() => {
    if (ttsStatus?.downloadState?.status !== 'downloading') return;
    const timer = setInterval(() => {
      void fetchOobeTtsStatus();
    }, 800);
    return () => clearInterval(timer);
  }, [ttsStatus?.downloadState?.status]);

  const voicesForSelectedEngine = (() => {
    const serverVoices = Array.isArray(ttsStatus?.voices)
      ? ttsStatus.voices.filter((v: any) => v.engine === ttsEngine)
      : [];
    if (serverVoices.length > 0) {
      return serverVoices.map((v: any) => ({
        id: v.id,
        label: v.label || v.name || v.id,
        installed: Boolean(v.installed)
      }));
    }
    return (FALLBACK_VOICES_BY_ENGINE[ttsEngine] || FALLBACK_VOICES_BY_ENGINE.piper).map((v) => ({
      ...v,
      installed: ttsEngine === 'espeak'
    }));
  })();

  const handleEngineSelect = (engine: 'piper' | 'kokoro' | 'espeak') => {
    setTtsEngine(engine);
    const serverMatch = Array.isArray(ttsStatus?.voices)
      ? ttsStatus.voices.find((v: any) => v.engine === engine)
      : null;
    const fallbackMatch = FALLBACK_VOICES_BY_ENGINE[engine]?.[0];
    if (serverMatch?.id) setTtsVoice(serverMatch.id);
    else if (fallbackMatch?.id) setTtsVoice(fallbackMatch.id);
  };

  const handleStartTtsDownload = async () => {
    setError('');
    try {
      const res = await fetch('/api/setup/tts/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: ttsEngine, voiceId: ttsVoice })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start TTS model download');
      }
      setTtsStatus(data);
    } catch (err: any) {
      setError(err?.message || 'Unable to start voice model download');
    }
  };

  const handlePreviewVoice = async () => {
    setPreviewingTts(true);
    setError('');
    try {
      const res = await fetch('/api/setup/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: ttsEngine, voiceId: ttsVoice })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Voice preview failed');
      }
      const blob = await res.blob();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewAudioUrl(url);
    } catch (err: any) {
      setError(err?.message || 'Unable to generate voice preview');
    } finally {
      setPreviewingTts(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Administrator password must be at least 8 characters long.');
      return;
    }

    const minLen = parseInt(phoneNumberMinLength, 10);
    const maxLen = parseInt(phoneNumberMaxLength, 10);
    if (isNaN(minLen) || isNaN(maxLen) || minLen > maxLen) {
      setError('Minimum extension length cannot be greater than maximum extension length.');
      return;
    }

    if (adminPhoneNumber.length < minLen || adminPhoneNumber.length > maxLen) {
      setError(
        `Admin extension number (${adminPhoneNumber.length} digits) must be between ${minLen} and ${maxLen} digits.`
      );
      return;
    }

    if (tlsMode === 'acme' && (!acmeDomain.trim() || !acmeEmail.trim())) {
      setError('Let’s Encrypt ACME mode requires both a public domain name and an ACME contact email.');
      return;
    }

    if (!acknowledgedE911AndTerms) {
      setError(
        'Please acknowledge the E911 No-Emergency-Calling notice and Terms of Service to initialize.'
      );
      return;
    }

    setSubmitting(true);

    try {
      const recoveryKey = generateRecoveryKey();
      const keyBundle = await generateUserKeyBundle(password, recoveryKey);

      const res = await fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username,
          password,
          displayName,
          adminPhoneNumber,
          appName: appNameInput,
          phoneNumberLength: phoneNumberMinLength,
          phoneNumberMinLength,
          phoneNumberMaxLength,
          assignmentMode,
          agreedToTerms: true,
          acknowledgedE911: true,
          encryptionPublicKey: keyBundle.encryptionPublicKey,
          encryptedPrivateKey: keyBundle.encryptedPrivateKey,
          keySalt: keyBundle.keySalt,
          recoveryEncryptedPrivateKey: keyBundle.recoveryEncryptedPrivateKey,
          recoveryKeySalt: keyBundle.recoveryKeySalt,
          ttsEngine,
          ttsVoice,
          tlsMode,
          trustProxy,
          acmeDomain: acmeDomain.trim() || undefined,
          acmeEmail: acmeEmail.trim() || undefined,
          acmeStaging,
          localCaHosts: localCaHosts.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        clearUnlockedKey();
        throw new Error(data.error || 'Setup failed');
      }

      await refreshBranding();
      login(null, {
        ...data.user,
        encryptionPublicKey: data.user?.encryptionPublicKey ?? keyBundle.encryptionPublicKey,
        encryptedPrivateKey: data.user?.encryptedPrivateKey ?? keyBundle.encryptedPrivateKey,
        keySalt: data.user?.keySalt ?? keyBundle.keySalt,
        hasRecoveryKey: true
      });
      setGeneratedRecoveryKey(recoveryKey);
    } catch (err: any) {
      setError(err?.message || 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyRecovery = async () => {
    if (!generatedRecoveryKey) return;
    if (await copyToClipboard(generatedRecoveryKey)) {
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2500);
    }
  };

  const handleDownloadRecovery = () => {
    if (!generatedRecoveryKey) return;
    const text = [
      `${appNameInput || 'DecaTone'} Zero-Access Vault Recovery Key`,
      `Account: @${username} (Extension ${adminPhoneNumber})`,
      `Created: ${new Date().toISOString()}`,
      '',
      `RECOVERY KEY: ${generatedRecoveryKey}`,
      '',
      'Keep this key safe offline. It lets you recover existing encrypted voicemails after a forgotten password reset.'
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decatone-recovery-key-${username}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (generatedRecoveryKey) {
    return (
      <div style={{ maxWidth: '580px', margin: '3rem auto', width: '100%' }}>
        <div className="glass-card highlight-amber" style={{ padding: '2.25rem 2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <Key size={38} color="var(--accent-amber)" style={{ marginBottom: '0.6rem' }} />
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>Save Your Zero-Access Recovery Key</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Switchboard initialization succeeded. Save this offline Recovery Key so a future password reset never locks out your encrypted voicemails.
            </p>
          </div>

          <div
            style={{
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              borderRadius: 'var(--radius-sm)',
              padding: '1rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.95rem',
              fontWeight: 700,
              color: '#fcd34d',
              textAlign: 'center',
              letterSpacing: '0.04em',
              wordBreak: 'break-all',
              marginBottom: '1rem'
            }}
          >
            {generatedRecoveryKey}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void handleCopyRecovery()} className="btn btn-secondary" style={{ flex: 1 }}>
              <Copy size={15} /> {copiedRecovery ? 'Copied!' : 'Copy Recovery Key'}
            </button>
            <button type="button" onClick={handleDownloadRecovery} className="btn btn-secondary" style={{ flex: 1 }}>
              <Download size={15} /> Download .txt Backup
            </button>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '0.88rem',
              color: '#fff',
              cursor: 'pointer',
              marginBottom: '1.25rem'
            }}
          >
            <input
              type="checkbox"
              checked={confirmedRecoverySaved}
              onChange={(e) => setConfirmedRecoverySaved(e.target.checked)}
              style={{ width: '17px', height: '17px', accentColor: 'var(--accent-amber)' }}
            />
            <span>I have saved this Recovery Key in a safe place.</span>
          </label>

          <button
            type="button"
            disabled={!confirmedRecoverySaved}
            onClick={() => {
              onSetupComplete?.();
              navigate('/onboarding', { replace: true });
            }}
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
          >
            <CheckCircle2 size={17} /> Continue to Phone Setup
          </button>
        </div>
      </div>
    );
  }

  const dlState = ttsStatus?.downloadState;
  const isDownloadingTts = dlState?.status === 'downloading';

  return (
    <div style={{ maxWidth: '680px', margin: '2.5rem auto', width: '100%' }}>
      <div className="glass-card highlight-cyan" style={{ padding: '2.25rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <img
            src={logoUrl || '/branding/logo.png'}
            alt={appName}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '14px',
              marginBottom: '0.85rem',
              objectFit: 'contain',
              boxShadow: '0 0 20px rgba(14,165,233,0.3)'
            }}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/branding/logo.png';
            }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Welcome to DecaTone</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Initial Setup: Create master administrator, E2EE vault, dial plan, voice engine &amp; TLS mode
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
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Admin Username</label>
              <input
                type="text"
                className="form-input"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                type="text"
                className="form-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Admin Password (8+ chars)</label>
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
                  fontSize: '0.72rem',
                  color: '#34d399',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
              >
                <ShieldCheck size={12} /> Encrypts admin P-256 vault key
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Admin Extension Number</label>
              <input
                type="text"
                className="form-input"
                required
                value={adminPhoneNumber}
                onChange={(e) => setAdminPhoneNumber(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 1000 or 5550100"
                style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}
              />
            </div>
          </div>

          {/* Dial Plan */}
          <div
            style={{
              marginTop: '1.1rem',
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '1.1rem'
            }}
          >
            <h4 style={{ fontSize: '0.95rem', color: '#38bdf8', marginBottom: '0.85rem' }}>
              Dial Plan &amp; Number Policy
            </h4>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">App Branding Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={appNameInput}
                  onChange={(e) => setAppNameInput(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Assignment Policy</label>
                <select
                  className="form-select"
                  value={assignmentMode}
                  onChange={(e) => setAssignmentMode(e.target.value)}
                >
                  <option value="user_choice">User Choice (Sign up pick)</option>
                  <option value="fixed_random">Fully Random (Fixed length)</option>
                  <option value="sequential">Sequential Auto-Allocate</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Min Extension Length</label>
                <select
                  className="form-select"
                  value={phoneNumberMinLength}
                  onChange={(e) => setPhoneNumberMinLength(e.target.value)}
                >
                  <option value="3">3 Digits (100–999)</option>
                  <option value="4">4 Digits (1000–9999)</option>
                  <option value="5">5 Digits (10000–99999)</option>
                  <option value="7">7 Digits (Standard Local)</option>
                  <option value="10">10 Digits (Full Phone Number)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Max Extension Length</label>
                <select
                  className="form-select"
                  value={phoneNumberMaxLength}
                  onChange={(e) => setPhoneNumberMaxLength(e.target.value)}
                >
                  <option value="3">3 Digits (100–999)</option>
                  <option value="4">4 Digits (1000–9999)</option>
                  <option value="5">5 Digits (10000–99999)</option>
                  <option value="7">7 Digits (Standard Local)</option>
                  <option value="10">10 Digits (Full Phone Number)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Voice & Local Neural TTS */}
          <div
            style={{
              marginTop: '1.1rem',
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '1.1rem'
            }}
          >
            <h4 style={{ fontSize: '0.95rem', color: 'var(--accent-amber)', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Volume2 size={16} /> Local Operator Voice &amp; Neural TTS (Offline)
            </h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.8rem' }}>
              Powers 411 Speaking Clock, 711 Weather, 611 Diagnostics, and voicemail greetings locally with zero cloud calls. Switchable anytime in Admin Settings.
            </p>

            <div className="grid-3" style={{ marginBottom: '0.85rem' }}>
              {[
                {
                  id: 'piper' as const,
                  title: 'Piper Neural ONNX',
                  badge: 'Lightweight Default',
                  pros: '~65 MB download, crisp voice, fast on Raspberry Pi / small hosts.'
                },
                {
                  id: 'kokoro' as const,
                  title: 'Kokoro-82M ONNX',
                  badge: 'Studio Voice',
                  pros: '~86 MB on-demand weights, ultra-natural prosody; auto-unloads after 10m idle.'
                },
                {
                  id: 'espeak' as const,
                  title: 'eSpeak-NG Built-In',
                  badge: '0 MB Instant',
                  pros: 'Zero download, classic vintage synth timbre.'
                }
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleEngineSelect(opt.id)}
                  style={{
                    textAlign: 'left',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${ttsEngine === opt.id ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                    background: ttsEngine === opt.id ? 'rgba(245, 158, 11, 0.12)' : 'rgba(0,0,0,0.28)',
                    cursor: 'pointer',
                    color: '#fff'
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{opt.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-amber)', marginBottom: '0.25rem' }}>{opt.badge}</div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>{opt.pros}</div>
                </button>
              ))}
            </div>

            <div className="grid-2" style={{ alignItems: 'end', marginBottom: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Voice Model</label>
                <select
                  className="form-select"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                >
                  {voicesForSelectedEngine.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {ttsEngine !== 'espeak' && (
                  <button
                    type="button"
                    onClick={() => void handleStartTtsDownload()}
                    disabled={isDownloadingTts}
                    className="btn btn-secondary btn-sm"
                  >
                    <Download size={14} /> {isDownloadingTts ? `Downloading ${dlState.progress || 0}%` : 'Download Weights'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handlePreviewVoice()}
                  disabled={previewingTts}
                  className="btn btn-secondary btn-sm"
                >
                  <Play size={14} /> {previewingTts ? 'Synthesizing...' : 'Preview Voice'}
                </button>
              </div>
            </div>

            {isDownloadingTts && (
              <div style={{ marginBottom: '0.75rem', background: 'rgba(0,0,0,0.35)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: '#fcd34d', marginBottom: '0.35rem' }}>
                  <span>{dlState.message || 'Downloading voice weights...'}</span>
                  <span>{dlState.progress || 0}%</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, dlState.progress || 0))}%`,
                      height: '100%',
                      background: 'var(--accent-amber)',
                      transition: 'width 0.25s ease'
                    }}
                  />
                </div>
              </div>
            )}

            {previewAudioUrl && (
              <audio controls autoPlay src={previewAudioUrl} style={{ height: '34px', width: '100%', marginBottom: '0.4rem' }} />
            )}
          </div>

          {/* Networking & TLS Termination Mode */}
          <div
            style={{
              marginTop: '1.1rem',
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: '1.1rem'
            }}
          >
            <h4 style={{ fontSize: '0.95rem', color: '#34d399', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Lock size={16} /> Networking &amp; TLS Mode
            </h4>

            <div className="form-group">
              <select
                className="form-select"
                value={tlsMode}
                onChange={(e) => setTlsMode(e.target.value as any)}
              >
                <option value="proxy">Reverse Proxy / HTTP Mode (Default — best for Traefik, Nginx Proxy Manager, Caddy)</option>
                <option value="acme">Built-in Let’s Encrypt HTTPS (Bare-metal / public port 80 auto-renewal)</option>
                <option value="local_ca">Built-in Local Root CA HTTPS (Offline LAN + automatic ESP32 CA pinning)</option>
              </select>
            </div>

            {tlsMode === 'proxy' && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={trustProxy}
                  onChange={(e) => setTrustProxy(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }}
                />
                <span>
                  <strong style={{ color: '#fff' }}>Trust Reverse Proxy Headers</strong> (default OFF; turn ON if placed behind Nginx/Traefik/Caddy so HTTPS cookies and client IP limits work properly)
                </span>
              </label>
            )}

            {tlsMode === 'acme' && (
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Public Domain Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={acmeDomain}
                    onChange={(e) => setAcmeDomain(e.target.value)}
                    placeholder="phone.example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">ACME Email</label>
                  <input
                    type="email"
                    className="form-input"
                    value={acmeEmail}
                    onChange={(e) => setAcmeEmail(e.target.value)}
                    placeholder="admin@example.com"
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  <input type="checkbox" checked={acmeStaging} onChange={(e) => setAcmeStaging(e.target.checked)} />
                  Use Let’s Encrypt Staging CA (testing)
                </label>
              </div>
            )}

            {tlsMode === 'local_ca' && (
              <div className="form-group">
                <label className="form-label">Extra LAN Hostnames / IPs for Certificate SANs (optional, comma-separated)</label>
                <input
                  type="text"
                  className="form-input"
                  value={localCaHosts}
                  onChange={(e) => setLocalCaHosts(e.target.value)}
                  placeholder="decatone.local, 192.168.1.50"
                />
              </div>
            )}
          </div>

          {/* Mandatory E911 & Terms Acknowledgment */}
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.85rem 1rem',
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
              id="setupTermsE911"
              required
              checked={acknowledgedE911AndTerms}
              onChange={(e) => setAcknowledgedE911AndTerms(e.target.checked)}
              style={{ marginTop: '0.25rem', cursor: 'pointer' }}
            />
            <label
              htmlFor="setupTermsE911"
              style={{ fontSize: '0.8rem', color: '#fda4af', lineHeight: 1.45, cursor: 'pointer' }}
            >
              <strong style={{ color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <ShieldAlert size={13} color="#f43f5e" /> E911 Disclaimer &amp; Terms Acknowledgment:
              </strong>{' '}
              I understand DecaTone provides <strong>NO 911 / Emergency Calling</strong> and accept the{' '}
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
                Privacy Policy
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
                GNU GPL v3.0 License
              </button>
              .
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || !acknowledgedE911AndTerms}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: '1.5rem' }}
          >
            {submitting ? 'Initializing Switchboard...' : 'Initialize DecaTone System'}
          </button>
        </form>
      </div>

      <LegalModal
        isOpen={showLegalModal}
        initialTab={modalTab}
        onClose={() => setShowLegalModal(false)}
      />
    </div>
  );
};
