import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Volume2, Mic, BellRing, Voicemail, Shield, Upload, Play, Check, RefreshCw, Smartphone, Radio, Sparkles, Mail, Cpu, PhoneForwarded, Megaphone, Activity, HelpCircle } from 'lucide-react';
import { usePhone } from '../context/PhoneContext';
import { useAuth } from '../context/AuthContext';

export const PhoneSettingsPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { phone, updateSettings, testRing, unclaimPhone } = usePhone();

  const [activeTab, setActiveTab] = useState<'standard' | 'advanced'>('standard');

  // Standard settings
  const [earpieceVolume, setEarpieceVolume] = useState(80);
  const [micSensitivity, setMicSensitivity] = useState(80);
  const [audioProfile, setAudioProfile] = useState('vintage_pots');
  const [sidetoneLevel, setSidetoneLevel] = useState(10);
  const [ringStyle, setRingStyle] = useState('traditional');
  const [customCadence, setCustomCadence] = useState('2000,4000');
  const [ringTimeoutSec, setRingTimeoutSec] = useState(25);
  const [callPrivacy, setCallPrivacy] = useState('anyone');
  const [emailInput, setEmailInput] = useState('');
  const [notifyOnVoicemail, setNotifyOnVoicemail] = useState(true);
  const [notifyOnMissedCall, setNotifyOnMissedCall] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);

  // Advanced hardware settings
  const [hardwareProfile, setHardwareProfile] = useState('western_electric_500');
  const [bellFrequencyHz, setBellFrequencyHz] = useState(20.0);
  const [hookFlashEnabled, setHookFlashEnabled] = useState(true);
  const [intercomEnabled, setIntercomEnabled] = useState(true);

  // Voicemail greeting
  const [greetingInfo, setGreetingInfo] = useState<{ hasCustomGreeting: boolean; audioUrl: string } | null>(null);
  const [greetingFile, setGreetingFile] = useState<File | null>(null);
  const [uploadingGreeting, setUploadingGreeting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testingRing, setTestingRing] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Debounce timer ref for real-time live synchronization to ESP32-S3
  const syncTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (phone) {
      setEarpieceVolume(phone.earpieceVolume ?? 80);
      setMicSensitivity(phone.micSensitivity ?? 80);
      setAudioProfile(phone.audioProfile || 'vintage_pots');
      setSidetoneLevel(phone.sidetoneLevel ?? 10);
      setRingStyle(phone.ringStyle || 'traditional');
      setCustomCadence(phone.ringCadenceCustom || '2000,4000');
      setRingTimeoutSec(phone.ringTimeoutSec ?? 25);
      setHardwareProfile(phone.hardwareProfile || 'western_electric_500');
      setBellFrequencyHz(phone.bellFrequencyHz ?? 20.0);
      setHookFlashEnabled(phone.hookFlashEnabled !== false);
      setIntercomEnabled(phone.intercomEnabled !== false);
    }
    if (user) {
      if (user.callPrivacy) setCallPrivacy(user.callPrivacy);
      setEmailInput(user.email || '');
      setNotifyOnVoicemail(user.notify_on_voicemail !== 0);
      setNotifyOnMissedCall(user.notify_on_missed_call !== 0);
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

  // Immediate Real-Time DSP Sync helper (Debounced by 150ms for smooth slider dragging)
  const triggerLiveSync = (newSettings: Partial<any>) => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      await updateSettings(newSettings);
    }, 150);
  };

  const handleVolumeChange = (val: number) => {
    setEarpieceVolume(val);
    triggerLiveSync({ earpieceVolume: val, micSensitivity, audioProfile, sidetoneLevel });
  };

  const handleMicChange = (val: number) => {
    setMicSensitivity(val);
    triggerLiveSync({ earpieceVolume, micSensitivity: val, audioProfile, sidetoneLevel });
  };

  const handleAudioProfileChange = (profile: string) => {
    setAudioProfile(profile);
    triggerLiveSync({ earpieceVolume, micSensitivity, audioProfile: profile, sidetoneLevel });
    setToast({ type: 'success', text: `Switched DSP Audio Profile to ${profile === 'modern_hd' ? 'Modern HD Voice' : profile === 'early_1930s' ? '1930s Antique Lo-Fi' : 'Vintage POTS Telephone'} (synced to hardware in real-time)!` });
  };

  const handleSidetoneChange = (val: number) => {
    setSidetoneLevel(val);
    triggerLiveSync({ earpieceVolume, micSensitivity, audioProfile, sidetoneLevel: val });
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setToast(null);

    const ok = await updateSettings({
      earpieceVolume,
      micSensitivity,
      audioProfile,
      sidetoneLevel,
      ringStyle,
      ringCadenceCustom: customCadence,
      ringTimeoutSec,
      hardwareProfile,
      bellFrequencyHz,
      hookFlashEnabled,
      intercomEnabled
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
      setToast({ type: 'success', text: 'Hardware and telephony settings saved and synced to your phone!' });
    } else {
      setToast({ type: 'error', text: 'Failed to update settings' });
    }
  };

  const handleTestRing = async () => {
    setTestingRing(true);
    const ok = await testRing();
    setTestingRing(false);
    if (ok) {
      setToast({ type: 'success', text: `Test ring signal sent at ${bellFrequencyHz}Hz using selected cadence!` });
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

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
        },
        body: JSON.stringify({
          email: emailInput.trim(),
          notifyOnVoicemail,
          notifyOnMissedCall
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update account');

      await refreshUser();
      setToast({ type: 'success', text: 'Account email and notification preferences saved!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to update account preferences' });
    } finally {
      setSavingAccount(false);
    }
  };

  return (
    <div style={{ maxWidth: '920px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Telephone Hardware & Audio Settings</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Customize your real-time sound character, volume levels, mechanical bell cadences, and advanced telephony features.
        </p>
      </div>

      {/* Tabs Navigation (Standard vs Advanced) */}
      <div style={{ display: 'flex', gap: '0.75rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
        <button
          onClick={() => setActiveTab('standard')}
          className={`btn ${activeTab === 'standard' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Sliders size={16} /> Standard Sound & Telephony
        </button>
        <button
          onClick={() => setActiveTab('advanced')}
          className={`btn ${activeTab === 'advanced' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Cpu size={16} /> Advanced Hardware Tuning
        </button>
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

      {/* ========================================================================= */}
      {/* STANDARD SETTINGS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'standard' && (
        <>
          {/* 1. Audio DSP Profile Selector */}
          <div className="glass-card highlight-cyan">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Radio size={20} color="var(--accent-cyan)" /> Audio DSP Character Profile
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              Select the acoustic tone character processed in real-time by the ESP32-S3 before end-to-end encryption.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              {[
                {
                  id: 'modern_hd',
                  title: 'Modern HD Voice',
                  badge: 'Crisp & Clear',
                  desc: 'Transparent 16kHz wideband digital audio with maximum fidelity and wide dynamic range.'
                },
                {
                  id: 'vintage_pots',
                  title: 'Vintage POTS Phone',
                  badge: 'Recommended',
                  desc: 'Authentic 300Hz–3.4kHz telephone bandpass with subtle carbon mic harmonic warmth and vintage induction tone.'
                },
                {
                  id: 'early_1930s',
                  title: '1930s Antique Lo-Fi',
                  badge: 'Warm Retro',
                  desc: 'Tight 400Hz–2.5kHz resonant bandpass with gentle non-linear carbon granule saturation and nostalgic antique crunch.'
                }
              ].map((profile) => {
                const isSelected = audioProfile === profile.id;
                return (
                  <div
                    key={profile.id}
                    onClick={() => handleAudioProfileChange(profile.id)}
                    style={{
                      background: isSelected ? 'rgba(14, 165, 233, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: `2px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '1.25rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <strong style={{ color: isSelected ? '#38bdf8' : '#fff', fontSize: '1rem' }}>
                        {profile.title}
                      </strong>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: '800',
                          textTransform: 'uppercase',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: isSelected ? 'var(--accent-cyan)' : 'rgba(255,255,255,0.06)',
                          color: isSelected ? '#0b0f17' : 'var(--text-dim)'
                        }}
                      >
                        {profile.badge}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.4 }}>
                      {profile.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Audio Levels & Sidetone Card */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Volume2 size={20} color="var(--accent-cyan)" /> Handset Audio Levels & Sidetone
            </h3>

            <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
              {/* Earpiece Volume Slider */}
              <div className="form-group">
                <label className="form-label">
                  <span>Earpiece Speaker Volume (MAX98357A I2S)</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{earpieceVolume}%</strong>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={earpieceVolume}
                  onChange={(e) => handleVolumeChange(parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Controls digital DAC output volume sent to your handset speaker (synced in real-time).
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
                  onChange={(e) => handleMicChange(parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Digital gain scaling on the ADC1 channel connected to your electret microphone.
                </span>
              </div>
            </div>

            {/* Sidetone Slider */}
            <div className="form-group" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
              <label className="form-label">
                <span>Handset Sidetone Feedback (Hear Yourself)</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{sidetoneLevel}%</strong>
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={sidetoneLevel}
                onChange={(e) => handleSidetoneChange(parseInt(e.target.value, 10))}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                Feeds a subtle percentage of your own voice into the earpiece so the handset feels natural and not dead.
              </span>
            </div>
          </div>

          {/* 3. Physical Bell Ringer & Cadence */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <BellRing size={20} color="var(--accent-amber)" /> Physical Bell Ringer & Cadence
              </h3>
              <button
                type="button"
                onClick={handleTestRing}
                disabled={testingRing || !phone?.isOnline}
                className="btn btn-secondary btn-sm"
              >
                <Play size={14} /> {testingRing ? 'Ringing Bell...' : 'Test Physical Bell Ring'}
              </button>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Ring Style & Pattern</label>
                <select className="form-select" value={ringStyle} onChange={(e) => setRingStyle(e.target.value)}>
                  <option value="traditional">Traditional North American (2s Ring, 4s Silence)</option>
                  <option value="european">European / British Double Ring (0.4s on, 0.2s off, 0.4s on, 2s off)</option>
                  <option value="pulse">Short Rapid Pulses (Party Line / Alert)</option>
                  <option value="continuous">Continuous Long Rings (1.5s on, 1.5s off)</option>
                  <option value="custom">Custom Cadence (Millisecond Steps)</option>
                </select>
              </div>

              {ringStyle === 'custom' && (
                <div className="form-group">
                  <label className="form-label">Custom Cadence (On, Off, On, Off... in ms)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 1000, 2000, 1000, 4000"
                    value={customCadence}
                    onChange={(e) => setCustomCadence(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 4. Privacy Settings */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Shield size={20} color="#10b981" /> Inbound Call Privacy Filter
            </h3>
            <div className="form-group" style={{ maxWidth: '400px' }}>
              <select className="form-select" value={callPrivacy} onChange={(e) => setCallPrivacy(e.target.value)}>
                <option value="anyone">Anyone on Switchboard (Public Inbound)</option>
                <option value="friends_only">Friends Only (Reject Unknown Callers)</option>
                <option value="dnd">Do Not Disturb (Direct All Calls to Voicemail)</option>
              </select>
            </div>
          </div>

          {/* 5. Save Button for Standard Settings */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn btn-primary"
              style={{ minWidth: '180px' }}
            >
              <Check size={16} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* 6. Email Notifications & Password Recovery */}
          <form onSubmit={handleSaveAccount} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Mail size={20} color="var(--accent-amber)" /> Email Notifications & Recovery
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                Set your email to receive self-service password recovery links, new voicemail arrival notices, and missed call alerts.
              </p>
            </div>

            <div className="form-group" style={{ maxWidth: '450px' }}>
              <label className="form-label">Notification & Recovery Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="your-email@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="notifyVmToggle"
                  checked={notifyOnVoicemail}
                  onChange={(e) => setNotifyOnVoicemail(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="notifyVmToggle" style={{ fontSize: '0.9rem', color: '#fff', cursor: 'pointer' }}>
                  Send me an email notification when a new voicemail is recorded
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="notifyMissedToggle"
                  checked={notifyOnMissedCall}
                  onChange={(e) => setNotifyOnMissedCall(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="notifyMissedToggle" style={{ fontSize: '0.9rem', color: '#fff', cursor: 'pointer' }}>
                  Send me an email notification when I have a missed call
                </label>
              </div>
            </div>

            <button type="submit" disabled={savingAccount} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
              {savingAccount ? 'Saving Preferences...' : 'Save Email Preferences'}
            </button>
          </form>

          {/* 7. Voicemail Greeting Studio */}
          <div className="glass-card">
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
        </>
      )}

      {/* ========================================================================= */}
      {/* ADVANCED HARDWARE TUNING TAB */}
      {/* ========================================================================= */}
      {activeTab === 'advanced' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Hardware Profile & Coil Resonance Card */}
          <div className="glass-card highlight-cyan">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={20} color="var(--accent-cyan)" /> Physical Telephone Chassis & Bell Resonance
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              These base hardware specifications are reported by the ESP32-S3 during initial builder provisioning. You can fine-tune them here to match your specific vintage bell coils.
            </p>

            <div className="grid-2" style={{ gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Telephone Model & Chassis Architecture</label>
                <select
                  className="form-select"
                  value={hardwareProfile}
                  onChange={(e) => setHardwareProfile(e.target.value)}
                >
                  <option value="western_electric_500">Western Electric 500 / 2500 (US Standard)</option>
                  <option value="western_electric_302">Western Electric 302 / Metal Case (Antique US)</option>
                  <option value="gpo_746">British GPO 706 / 746 (UK European)</option>
                  <option value="kellogg_harmonic">Kellogg / Stromberg-Carlson (Harmonic Bells)</option>
                  <option value="ericofon">Ericofon 'Cobra' (Buzzer/Electronic Ring)</option>
                  <option value="custom">Custom / Other Retro Phone</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Configures physical pulse debounce tables and acoustic sidetone curves.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <span>Bell Coil AC PWM Frequency</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{bellFrequencyHz} Hz</strong>
                </label>
                <select
                  className="form-select"
                  value={bellFrequencyHz.toString()}
                  onChange={(e) => setBellFrequencyHz(parseFloat(e.target.value))}
                >
                  <option value="20.0">20.0 Hz (North American Standard - WE C4A Ringer)</option>
                  <option value="16.6">16.6 Hz (North American Rural / Party Line Tuning)</option>
                  <option value="25.0">25.0 Hz (European / British GPO Standard Ringers)</option>
                  <option value="30.0">30.0 Hz (Kellogg Harmonic High-Pitch Ringer)</option>
                  <option value="33.3">33.3 Hz (Kellogg Harmonic Mid-Pitch Ringer)</option>
                  <option value="50.0">50.0 Hz (European Buzzer / Direct AC Coil)</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Adjusts the exact switching frequency of the IRF640N MOSFET driving your bell clapper.
                </span>
              </div>
            </div>
          </div>

          {/* Telephony Features (Hook-Flash & Intercom) */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PhoneForwarded size={20} color="var(--accent-cyan)" /> Handset Call Transfer & Broadcast Telephony
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Hook Flash Transfer */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <input
                  type="checkbox"
                  id="hookFlashToggle"
                  checked={hookFlashEnabled}
                  onChange={(e) => setHookFlashEnabled(e.target.checked)}
                  style={{ marginTop: '0.25rem', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label htmlFor="hookFlashToggle" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#fff', cursor: 'pointer' }}>
                    Enable Hook-Flash Handset Call Transfer (~300ms Tap)
                  </label>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Quickly pressing the cradle hook switch for 100ms–400ms puts your active caller on hold and plays a dial tone so you can dial another extension to transfer the call. Tapping again resumes the conversation.
                  </p>
                </div>
              </div>

              {/* Intercom Broadcast */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <input
                  type="checkbox"
                  id="intercomToggle"
                  checked={intercomEnabled}
                  onChange={(e) => setIntercomEnabled(e.target.checked)}
                  style={{ marginTop: '0.25rem', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label htmlFor="intercomToggle" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#fff', cursor: 'pointer' }}>
                    Enable Operator All-Call Intercom / Broadcast (Dial <code>00</code>)
                  </label>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Dialing <code>00</code> or <code>*0</code> sends an urgent high-priority short chime cadence to all active rotary phones on your network, bridging answering lines into a real-time voice broadcast.
                  </p>
                </div>
              </div>

              {/* Ring Timeout Duration */}
              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <label className="form-label">
                  <span>Inbound Ring Timeout Before Voicemail</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{ringTimeoutSec} seconds</strong>
                </label>
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="5"
                  value={ringTimeoutSec}
                  onChange={(e) => setRingTimeoutSec(parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Number of seconds your physical bell will ring before sending unanswered callers to your encrypted voicemail.
                </span>
              </div>
            </div>
          </div>

          {/* Paired Hardware Diagnostics */}
          {phone && (
            <div className="glass-card">
              <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Activity size={20} color="var(--accent-cyan)" /> Live Hardware Fleet Diagnostics
              </h3>
              <div className="grid-2" style={{ gap: '1rem', fontSize: '0.85rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Unique Device ID: </span>
                  <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{phone.deviceId}</code>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Firmware Version: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>v{phone.firmwareVersion || '1.1.0'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Local IP Address: </span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{phone.ipAddress || '192.168.x.x'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>WiFi Signal (RSSI): </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: (phone.rssi ?? -50) > -70 ? '#34d399' : '#fbbf24' }}>
                    {phone.rssi ? `${phone.rssi} dBm` : '-54 dBm'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Save Button for Advanced Settings */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn btn-primary"
              style={{ minWidth: '180px' }}
            >
              <Check size={16} /> {saving ? 'Saving...' : 'Save Advanced Settings'}
            </button>
          </div>

          {/* Paired Device Unbinding */}
          {phone && (
            <div className="glass-card" style={{ border: '1px solid rgba(244, 63, 94, 0.3)', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h4 style={{ color: '#fda4af', fontSize: '1rem' }}>Unpair Phone Hardware</h4>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    Unlinks device <code style={{ fontFamily: 'var(--font-mono)' }}>{phone.deviceId}</code> so it can be paired with another user account.
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
      )}
    </div>
  );
};
