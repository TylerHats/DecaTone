import React, { useState, useEffect } from 'react';
import { Sliders, Volume2, Mic, BellRing, Voicemail, Shield, Upload, Play, Check, RefreshCw, Smartphone } from 'lucide-react';
import { usePhone } from '../context/PhoneContext';
import { useAuth } from '../context/AuthContext';

export const PhoneSettingsPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { phone, updateSettings, testRing, unclaimPhone } = usePhone();

  const [earpieceVolume, setEarpieceVolume] = useState(80);
  const [micSensitivity, setMicSensitivity] = useState(80);
  const [ringStyle, setRingStyle] = useState('traditional');
  const [customCadence, setCustomCadence] = useState('2000,4000');
  const [ringTimeoutSec, setRingTimeoutSec] = useState(25);
  const [callPrivacy, setCallPrivacy] = useState('anyone');

  const [greetingInfo, setGreetingInfo] = useState<{ hasCustomGreeting: boolean; audioUrl: string } | null>(null);
  const [greetingFile, setGreetingFile] = useState<File | null>(null);
  const [uploadingGreeting, setUploadingGreeting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testingRing, setTestingRing] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (phone) {
      setEarpieceVolume(phone.earpieceVolume ?? 80);
      setMicSensitivity(phone.micSensitivity ?? 80);
      setRingStyle(phone.ringStyle || 'traditional');
      setCustomCadence(phone.ringCadenceCustom || '2000,4000');
      setRingTimeoutSec(phone.ringTimeoutSec ?? 25);
    }
    if (user?.callPrivacy) {
      setCallPrivacy(user.callPrivacy);
    }
    fetchGreeting();
  }, [phone, user]);

  const fetchGreeting = async () => {
    try {
      const res = await fetch('/api/voicemail/greeting', {
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGreetingInfo(data);
      }
    } catch (e) {}
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setToast(null);

    const ok = await updateSettings({
      earpieceVolume,
      micSensitivity,
      ringStyle,
      ringCadenceCustom: customCadence,
      ringTimeoutSec
    });

    // Update privacy mode
    await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
      },
      body: JSON.stringify({ callPrivacy })
    });
    await refreshUser();

    setSaving(false);
    if (ok) {
      setToast({ type: 'success', text: 'Hardware and audio settings synced to your phone!' });
    } else {
      setToast({ type: 'error', text: 'Failed to update settings' });
    }
  };

  const handleTestRing = async () => {
    setTestingRing(true);
    const ok = await testRing();
    setTestingRing(false);
    if (ok) {
      setToast({ type: 'success', text: 'Test ring signal sent using selected cadence!' });
    } else {
      setToast({ type: 'error', text: 'Phone is offline or unreachable' });
    }
  };

  const handleUploadGreeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!greetingFile) return;

    setUploadingGreeting(true);
    const formData = new FormData();
    formData.append('audio', greetingFile);

    try {
      const res = await fetch('/api/voicemail/greeting/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` },
        body: formData
      });

      if (res.ok) {
        setToast({ type: 'success', text: 'Custom voicemail greeting saved!' });
        setGreetingFile(null);
        fetchGreeting();
      } else {
        setToast({ type: 'error', text: 'Greeting upload failed' });
      }
    } catch (err) {
      setToast({ type: 'error', text: 'Upload failed' });
    } finally {
      setUploadingGreeting(false);
    }
  };

  const handleResetGreeting = async () => {
    try {
      const res = await fetch('/api/voicemail/greeting/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      if (res.ok) {
        setToast({ type: 'success', text: 'Voicemail greeting reset to default' });
        fetchGreeting();
      }
    } catch (e) {}
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Hardware & Audio Settings</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Customize your MAX98357A earpiece volume, MAX4466 mic gain, IRF640N bell ringer cadence, and voicemail greeting.
        </p>
      </div>

      {toast && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: toast.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            border: `1px solid ${toast.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            color: toast.type === 'success' ? '#34d399' : '#fda4af'
          }}
        >
          {toast.text}
        </div>
      )}

      {/* Audio Levels Card */}
      <div className="glass-card">
        <h3 style={{ fontSize: '1.15rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Volume2 size={20} color="var(--accent-cyan)" /> Handset Audio Levels
        </h3>

        <div className="grid-2">
          {/* Earpiece Volume Slider */}
          <div className="form-group">
            <label className="form-label">
              <span>Earpiece Speaker Output (MAX98357A I2S)</span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{earpieceVolume}%</strong>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={earpieceVolume}
              onChange={(e) => setEarpieceVolume(parseInt(e.target.value, 10))}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Controls the digital volume sent through the MAX98357A DAC to your vintage handset speaker.
            </span>
          </div>

          {/* Mic Gain Slider */}
          <div className="form-group">
            <label className="form-label">
              <span>Microphone Sensitivity (MAX4466 ADC)</span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{micSensitivity}%</strong>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={micSensitivity}
              onChange={(e) => setMicSensitivity(parseInt(e.target.value, 10))}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Controls digital gain scaling on the ADC1 channel connected to your MAX4466 microphone.
            </span>
          </div>
        </div>
      </div>

      {/* Bell Ringer & Cadence Tuning */}
      <div className="glass-card highlight-amber">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BellRing size={20} color="var(--accent-amber)" /> Physical Bell Ringer & Cadence
          </h3>
          <button
            onClick={handleTestRing}
            disabled={testingRing || !phone?.isOnline}
            className="btn btn-amber btn-sm"
          >
            <BellRing size={15} /> {testingRing ? 'Sending Signal...' : 'Test Selected Ring'}
          </button>
        </div>

        <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
          <div className="form-group">
            <label className="form-label">Ring Cadence Style</label>
            <select
              className="form-select"
              value={ringStyle}
              onChange={(e) => setRingStyle(e.target.value)}
            >
              <option value="traditional">Traditional Bell (2.0s Ring / 4.0s Silence)</option>
              <option value="european">European Double-Ring (0.4s on, 0.2s off, 0.4s on, 2.0s off)</option>
              <option value="pulse">Short Pulse Burst (0.2s on / 0.2s off x3, 2.5s off)</option>
              <option value="continuous">Rapid Ring (1.5s Ring / 1.5s Silence)</option>
              <option value="custom">Custom Timing (Milliseconds)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">
              <span>Ring Timeout Before Voicemail</span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{ringTimeoutSec}s</strong>
            </label>
            <input
              type="range"
              min="10"
              max="60"
              step="5"
              value={ringTimeoutSec}
              onChange={(e) => setRingTimeoutSec(parseInt(e.target.value, 10))}
            />
          </div>
        </div>

        {ringStyle === 'custom' && (
          <div className="form-group">
            <label className="form-label">Custom Millisecond Cadence (On,Off,On,Off...)</label>
            <input
              type="text"
              className="form-input"
              value={customCadence}
              onChange={(e) => setCustomCadence(e.target.value)}
              placeholder="e.g. 2000,4000 or 400,200,400,2000"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}
      </div>

      {/* Call Privacy Policy */}
      <div className="glass-card">
        <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Shield size={20} color="var(--accent-cyan)" /> Inbound Call Privacy Filter
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          {[
            { id: 'anyone', title: 'Allow Anyone', desc: 'Any user on this switch can call your rotary phone' },
            { id: 'friends_only', title: 'Friends Only', desc: 'Only accepted friends can ring your bell (others go to voicemail)' },
            { id: 'dnd', title: 'Do Not Disturb', desc: 'Direct all incoming calls straight to your voicemail box' }
          ].map((mode) => (
            <div
              key={mode.id}
              onClick={() => setCallPrivacy(mode.id)}
              style={{
                background: callPrivacy === mode.id ? 'rgba(14, 165, 233, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: `2px solid ${callPrivacy === mode.id ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '1rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <strong style={{ color: callPrivacy === mode.id ? '#38bdf8' : '#fff', fontSize: '0.95rem' }}>
                {mode.title}
              </strong>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                {mode.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Save Settings Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="btn btn-primary btn-lg"
          style={{ minWidth: '200px' }}
        >
          {saving ? 'Saving...' : 'Save All Settings'}
        </button>
      </div>

      {/* Voicemail Greeting Studio */}
      <div className="glass-card" style={{ marginTop: '1rem' }}>
        <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Voicemail size={20} color="var(--accent-amber)" /> Voicemail Greeting Studio
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          Callers will hear this greeting before leaving a voicemail message if you are away or on another call.
        </p>

        {greetingInfo?.audioUrl && (
          <div style={{ marginBottom: '1.5rem', background: 'rgba(0,0,0,0.4)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Active Greeting: {greetingInfo.hasCustomGreeting ? 'Custom Audio' : 'Default System Greeting'}
            </div>
            <audio controls src={greetingInfo.audioUrl} style={{ width: '100%', height: '36px' }} />
          </div>
        )}

        <form onSubmit={handleUploadGreeting} style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            type="file"
            accept="audio/mp3,audio/wav,audio/ogg"
            onChange={(e) => setGreetingFile(e.target.files?.[0] || null)}
            style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
          />

          <button
            type="submit"
            disabled={!greetingFile || uploadingGreeting}
            className="btn btn-secondary btn-sm"
          >
            <Upload size={14} /> {uploadingGreeting ? 'Uploading...' : 'Upload Greeting'}
          </button>

          {greetingInfo?.hasCustomGreeting && (
            <button
              type="button"
              onClick={handleResetGreeting}
              className="btn btn-danger btn-sm"
            >
              Reset to Default
            </button>
          )}
        </form>
      </div>

      {/* Paired Device Unbinding */}
      {phone && (
        <div className="glass-card" style={{ border: '1px solid rgba(244, 63, 94, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h4 style={{ color: '#fda4af', fontSize: '1rem' }}>Unpair Phone Hardware</h4>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                Unlinks device <code style={{ fontFamily: 'var(--font-mono)' }}>{phone.deviceId}</code> so it can be paired with another user.
              </p>
            </div>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to unpair this ESP32-S3 rotary phone from your account?')) {
                  unclaimPhone();
                }
              }}
              className="btn btn-danger btn-sm"
            >
              Unpair Phone
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
