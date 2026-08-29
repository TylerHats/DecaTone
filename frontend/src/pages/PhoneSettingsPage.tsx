import React, { useState, useEffect } from 'react';
import {
  Volume2,
  Bell,
  Cpu,
  Mic,
  Activity,
  Sliders,
  Check,
  RotateCcw,
  Sparkles,
  PhoneForwarded,
  Shield,
  Upload,
  Play,
  Square,
  Radio,
  Clock,
  PhoneCall,
  Zap,
  HelpCircle,
  Hash,
  Moon,
  Calendar,
  Gauge
} from 'lucide-react';
import { usePhone } from '../context/PhoneContext';
import { useAuth } from '../context/AuthContext';
import { WebPhoneModal } from '../components/WebPhoneModal';

const PAIRING_WORDS = ['TONE', 'CALL', 'DIAL', 'RING', 'BELL', 'CORD', 'VINTAGE'];

export const PhoneSettingsPage: React.FC = () => {
  const { phone, settings, updateSettings, testRing, rebootPhone, claimPhoneByCode, unclaimPhone, fetchSettings } = usePhone();
  const { user, refreshUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'standard' | 'resonance' | 'services' | 'account' | 'advanced'>('standard');
  const [showWebPhone, setShowWebPhone] = useState(false);

  // Hardware state
  const [earpieceVolume, setEarpieceVolume] = useState(80);
  const [micSensitivity, setMicSensitivity] = useState(80);
  const [audioProfile, setAudioProfile] = useState('vintage_pots');
  const [sidetoneLevel, setSidetoneLevel] = useState(10);
  const [ringStyle, setRingStyle] = useState('traditional');
  const [ringCadenceCustom, setRingCadenceCustom] = useState('2000,4000');
  const [ringTimeoutSec, setRingTimeoutSec] = useState(25);
  const [hardwareProfile, setHardwareProfile] = useState('western_electric_500');
  const [bellFrequencyHz, setBellFrequencyHz] = useState(20.0);
  const [hookFlashEnabled, setHookFlashEnabled] = useState(true);
  const [intercomEnabled, setIntercomEnabled] = useState(true);

  // Pairing State
  const [selectedWord, setSelectedWord] = useState("TONE");
  const [numericPairingCode, setNumericPairingCode] = useState("");
  const [claiming, setClaiming] = useState(false);

  // Account Preferences & DND State
  const [emailInput, setEmailInput] = useState(user?.email || "");
  const [notifyOnVoicemail, setNotifyOnVoicemail] = useState(user?.notifyOnVoicemail !== false);
  const [notifyOnMissedCall, setNotifyOnMissedCall] = useState(user?.notifyOnMissedCall !== false);
  const [callPrivacy, setCallPrivacy] = useState(user?.call_privacy || "friends_only");
  const [dndManualState, setDndManualState] = useState(user?.dnd_manual_state === 1);
  const [dndScheduleEnabled, setDndScheduleEnabled] = useState(user?.dnd_schedule_enabled === 1);
  const [dndScheduleStart, setDndScheduleStart] = useState(user?.dnd_schedule_start || "22:00");
  const [dndScheduleEnd, setDndScheduleEnd] = useState(user?.dnd_schedule_end || "07:00");
  const [dndScheduleDays, setDndScheduleDays] = useState<string[]>(
    user?.dnd_schedule_days ? user.dnd_schedule_days.split(",") : ["1", "2", "3", "4", "5", "6", "7"]
  );
  const [dndRepeatedCallBreakthrough, setDndRepeatedCallBreakthrough] = useState(
    user?.dnd_repeated_call_breakthrough !== 0 && user?.dnd_repeated_call_breakthrough !== false
  );

  // Voicemail Greeting state
  const [greetingInfo, setGreetingInfo] = useState<{ hasCustomGreeting: boolean; greetingUrl?: string } | null>(null);
  const [greetingFile, setGreetingFile] = useState<File | null>(null);
  const [uploadingGreeting, setUploadingGreeting] = useState(false);

  // Resonance Calibration Sweep State
  const [sweepFreq, setSweepFreq] = useState(20.0);
  const [sweepActive, setSweepActive] = useState(false);

  // Rotary Dial Pulse Oscilloscope Diagnostics State
  const [lastDialedDigit, setLastDialedDigit] = useState<string | null>(null);
  const [lastPps, setLastPps] = useState<number>(10.0);
  const [lastBreakRatio, setLastBreakRatio] = useState<number>(60.0);
  const [lastPulseCount, setLastPulseCount] = useState<number>(0);
  const [pulseHistory, setPulseHistory] = useState<{ digit: string; pps: number; breakRatio: number; time: string }[]>([]);

  // Status & Feedback
  const [saving, setSaving] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (settings) {
      setEarpieceVolume(settings.earpieceVolume ?? 80);
      setMicSensitivity(settings.micSensitivity ?? 80);
      setAudioProfile(settings.audioProfile || "authentic_carbon");
      setSidetoneLevel(settings.sidetoneLevel ?? 15);
      setRingStyle(settings.ringStyle || "standard_us");
      setRingCadenceCustom(settings.ringCadenceCustom || "2000,4000");
      setRingTimeoutSec(settings.ringTimeoutSec || 25);
      setHardwareProfile(settings.hardwareProfile || "western_electric_500");
      setBellFrequencyHz(settings.bellFrequencyHz ?? 20.0);
      setSweepFreq(settings.bellFrequencyHz ?? 20.0);
      setHookFlashEnabled(settings.hookFlashEnabled !== false);
      setIntercomEnabled(settings.intercomEnabled !== false);
    }
  }, [settings]);

  useEffect(() => {
    if (user) {
      setEmailInput(user.email || "");
      setNotifyOnVoicemail(user.notifyOnVoicemail !== false);
      setNotifyOnMissedCall(user.notifyOnMissedCall !== false);
      setCallPrivacy(user.call_privacy || "friends_only");
      setDndManualState(user.dnd_manual_state === 1);
      setDndScheduleEnabled(user.dnd_schedule_enabled === 1);
      setDndScheduleDays(user.dnd_schedule_days ? user.dnd_schedule_days.split(",") : ["1", "2", "3", "4", "5", "6", "7"]);
      setDndScheduleStart(user.dnd_schedule_start || "22:00");
      setDndScheduleEnd(user.dnd_schedule_end || "07:00");
      setDndRepeatedCallBreakthrough(user.dnd_repeated_call_breakthrough !== 0 && user.dnd_repeated_call_breakthrough !== false);
    }
  }, [user]);

  const fetchGreeting = async () => {
    try {
      const res = await fetch("/api/voicemail/greeting/info", {
        headers: { Authorization: `Bearer ${localStorage.getItem("decatone_token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGreetingInfo(data);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchGreeting();
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    setToast(null);
    try {
      await updateSettings({
        earpieceVolume,
        micSensitivity,
        audioProfile,
        sidetoneLevel,
        ringStyle,
        ringCadenceCustom,
        ringTimeoutSec,
        hardwareProfile,
        bellFrequencyHz,
        hookFlashEnabled,
        intercomEnabled
      });
      setToast({ type: "success", text: "Hardware and audio DSP settings saved and synced to your phone!" });
    } catch (err: any) {
      setToast({ type: "error", text: err.message || "Failed to update settings" });
    } finally {
      setSaving(false);
    }
  };

  const handleVolumeChange = (vol: number) => {
    setEarpieceVolume(vol);
    updateSettings({ earpieceVolume: vol }).catch(() => {});
  };

  const handleMicChange = (mic: number) => {
    setMicSensitivity(mic);
    updateSettings({ micSensitivity: mic }).catch(() => {});
  };

  const handleTestRing = async () => {
    setRinging(true);
    try {
      await testRing(ringStyle, ringCadenceCustom);
      setToast({ type: "success", text: "Test ring signal transmitted to phone bell coils!" });
    } catch (e: any) {
      setToast({ type: "error", text: e.message || "Failed to send test ring" });
    } finally {
      setTimeout(() => setRinging(false), 4000);
    }
  };

  const handleSweepTest = async (freq: number) => {
    setSweepFreq(freq);
    setSweepActive(true);
    try {
      await testRing('custom', '3000,1000');
      setToast({ type: 'success', text: `Testing bell resonance at ${freq.toFixed(1)} Hz...` });
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Sweep test failed' });
    } finally {
      setTimeout(() => setSweepActive(false), 3200);
    }
  };

  const handlePairByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numericPairingCode.trim()) return;

    setClaiming(true);
    setToast(null);
    try {
      await claimPhoneByCode(selectedWord, numericPairingCode.trim());
      setToast({ type: 'success', text: `Success! Rotary phone paired to extension ${user?.phoneNumber}!` });
      setNumericPairingCode('');
      fetchSettings();
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Pairing code not found or expired.' });
    } finally {
      setClaiming(false);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    setToast(null);

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
          notifyOnMissedCall,
          callPrivacy,
          dndManualState: dndManualState ? 1 : 0,
          dndScheduleEnabled: dndScheduleEnabled ? 1 : 0,
          dndScheduleStart,
          dndScheduleEnd,
          dndScheduleDays: dndScheduleDays.join(','),
          dndRepeatedCallBreakthrough: dndRepeatedCallBreakthrough ? 1 : 0
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');

      setToast({ type: 'success', text: 'Privacy, Do Not Disturb, and account preferences saved!' });
      refreshUser();
    } catch (err: any) {
      setToast({ type: 'error', text: err.message });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleGreetingUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!greetingFile) return;

    setUploadingGreeting(true);
    const formData = new FormData();
    formData.append('greeting', greetingFile);

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
        const d = await res.json();
        setToast({ type: 'error', text: d.error || 'Upload failed' });
      }
    } catch (e) {
      setToast({ type: 'error', text: 'Upload failed' });
    } finally {
      setUploadingGreeting(false);
    }
  };

  const handleResetGreeting = async () => {
    if (!window.confirm('Reset to standard automated greeting?')) return;
    try {
      const res = await fetch('/api/voicemail/greeting/reset', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      if (res.ok) {
        setToast({ type: 'success', text: 'Greeting reset to default' });
        fetchGreeting();
      }
    } catch (e) {}
  };

  const toggleDay = (day: string) => {
    if (dndScheduleDays.includes(day)) {
      if (dndScheduleDays.length > 1) {
        setDndScheduleDays(dndScheduleDays.filter(d => d !== day));
      }
    } else {
      setDndScheduleDays([...dndScheduleDays, day].sort());
    }
  };

  const dayLabels: Record<string, string> = {
    '1': 'Mon',
    '2': 'Tue',
    '3': 'Wed',
    '4': 'Thu',
    '5': 'Fri',
    '6': 'Sat',
    '7': 'Sun'
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Hardware & Telephony Control Center</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Acoustic DSP filters, physical bell calibration, DND schedules, and live rotary pulse diagnostics.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '0.4rem', background: 'rgba(255,255,255,0.04)', padding: '0.35rem', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('standard')}
            className={`btn btn-sm ${activeTab === 'standard' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Sliders size={14} /> Audio & Bell
          </button>
          <button
            onClick={() => setActiveTab('resonance')}
            className={`btn btn-sm ${activeTab === 'resonance' ? 'btn-amber' : 'btn-secondary'}`}
          >
            <Zap size={14} /> Resonance Wizard
          </button>
          <button
            onClick={() => setActiveTab('services')}
            className={`btn btn-sm ${activeTab === 'services' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <HelpCircle size={14} /> Dial Codes
          </button>
          <button
            onClick={() => setActiveTab('account')}
            className={`btn btn-sm ${activeTab === 'account' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Moon size={14} /> DND & Account
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`btn btn-sm ${activeTab === 'advanced' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Gauge size={14} /> Diagnostics & Oscilloscope
          </button>
        </div>
      </div>

      {toast && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9rem',
            background: toast.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            border: `1px solid ${toast.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            color: toast.type === 'success' ? '#34d399' : '#fda4af'
          }}
        >
          {toast.text}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. AUDIO & BELL TAB */}
      {/* ========================================================================= */}
      {activeTab === 'standard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Quick Hardware Sliders */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Volume2 size={20} color="var(--accent-cyan)" /> Handset Acoustics & Audio Levels
            </h3>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">
                  <span>Earpiece Volume</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{earpieceVolume}%</strong>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={earpieceVolume}
                  onChange={(e) => handleVolumeChange(parseInt(e.target.value, 10))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <span>Microphone Sensitivity (Mic Gain)</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{micSensitivity}%</strong>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={micSensitivity}
                  onChange={(e) => handleMicChange(parseInt(e.target.value, 10))}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '1.25rem' }}>
              <label className="form-label">
                <span>Acoustic Sidetone Feedback (Hear yourself in earpiece)</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#a78bfa' }}>{sidetoneLevel}%</strong>
              </label>
              <input
                type="range"
                min="0"
                max="30"
                value={sidetoneLevel}
                onChange={(e) => setSidetoneLevel(parseInt(e.target.value, 10))}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                Authentic analog phone feature: feeds a small amount of your own voice into your ear so you know the call is alive.
              </span>
            </div>
          </div>

          {/* Physical Bell & Ring Cadence Card */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Bell size={20} color="var(--accent-amber)" /> Bell Ringer & Cadence
              </h3>
              <button
                type="button"
                onClick={handleTestRing}
                disabled={ringing || !phone?.isOnline}
                className="btn btn-secondary btn-sm"
              >
                <Bell size={14} /> {ringing ? 'Ringing...' : 'Test Ring Handset'}
              </button>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Default Ring Cadence Pattern</label>
                <select
                  className="form-select"
                  value={ringStyle}
                  onChange={(e) => setRingStyle(e.target.value)}
                >
                  <option value="traditional">Traditional North American (2s On, 4s Off)</option>
                  <option value="double_ring">Double Ring (0.8s On, 0.4s Off, 0.8s On, 4s Off)</option>
                  <option value="short_short_long">Short-Short-Long (0.4s, 0.2s, 0.4s, 0.2s, 1.2s, 3.8s)</option>
                  <option value="custom">Custom Timing (Specified Below)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Custom Milliseconds (On, Off)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="2000,4000"
                  disabled={ringStyle !== 'custom'}
                  value={ringCadenceCustom}
                  onChange={(e) => setRingCadenceCustom(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn btn-primary"
              style={{ minWidth: '160px' }}
            >
              <Check size={16} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. RESONANCE CALIBRATION WIZARD TAB */}
      {/* ========================================================================= */}
      {activeTab === 'resonance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-amber">
            <h3 style={{ fontSize: '1.25rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Zap size={22} /> Bell Resonance Frequency Calibration Sweep
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Every vintage telephone bell has a physical mechanical resonance frequency based on coil inductance and gong metallurgy.
              Test the presets below or dial a precise frequency to find the loudest, cleanest ring for your phone.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                { freq: 20.0, label: '20.0 Hz (US Standard)', desc: 'Western Electric 500/2500 C4A Ringer' },
                { freq: 16.6, label: '16.6 Hz (Party Line)', desc: 'Antique rural & multi-party line bells' },
                { freq: 25.0, label: '25.0 Hz (UK / GPO)', desc: 'British GPO 746 / European double bells' },
                { freq: 30.0, label: '30.0 Hz (Kellogg High)', desc: 'Kellogg / Stromberg harmonic ringers' },
                { freq: 33.3, label: '33.3 Hz (Kellogg Mid)', desc: 'Harmonic frequency party ringers' }
              ].map(preset => (
                <div
                  key={preset.freq}
                  style={{
                    background: sweepFreq === preset.freq ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${sweepFreq === preset.freq ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem'
                  }}
                >
                  <div>
                    <strong style={{ color: '#fff', fontSize: '0.95rem' }}>{preset.label}</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{preset.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSweepTest(preset.freq)}
                    disabled={sweepActive || !phone?.isOnline}
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%', borderColor: sweepFreq === preset.freq ? 'var(--accent-amber)' : undefined }}
                  >
                    <Bell size={13} /> {sweepActive && sweepFreq === preset.freq ? 'Testing Ring...' : 'Test Frequency'}
                  </button>
                </div>
              ))}
            </div>

            {/* Custom Sweep Frequency Slider */}
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: '600', color: '#fff' }}>Custom Resonance Frequency (16.0 Hz – 35.0 Hz)</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', color: 'var(--accent-amber)', fontWeight: '700' }}>
                  {sweepFreq.toFixed(1)} Hz
                </span>
              </div>
              <input
                type="range"
                min="16"
                max="35"
                step="0.5"
                value={sweepFreq}
                onChange={(e) => setSweepFreq(parseFloat(e.target.value))}
                style={{ width: '100%', marginBottom: '1rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => handleSweepTest(sweepFreq)}
                  disabled={sweepActive || !phone?.isOnline}
                  className="btn btn-primary btn-sm"
                >
                  <Bell size={14} /> {sweepActive ? 'Testing Bell...' : 'Test Selected Frequency (3s)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. SERVICES & DIAL PLAN CHEAT SHEET TAB */}
      {/* ========================================================================= */}
      {activeTab === 'services' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-cyan">
            <h3 style={{ fontSize: '1.25rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <HelpCircle size={22} /> Telephony Services & 0-Prefix Feature Codes
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Pick up your vintage handset and rotary-dial any of these special service lines and in-call control codes.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {[
                { code: '0', title: 'Voicemail Inbox', desc: 'Dial 0 and pause 2s to listen to and manage your encrypted voice messages.' },
                { code: '0 + Ext', title: 'Direct-to-Voicemail Memo', desc: 'Leave a direct voice memo on a friend\'s extension without ringing their bell.' },
                { code: '078', title: 'Toggle Do Not Disturb', desc: 'Toggles DND on/off from the handset with spoken voice confirmation.' },
                { code: '079', title: 'Do Not Disturb Status', desc: 'Speaks whether DND is currently active or off for your line.' },
                { code: '119 / 099', title: 'Audio Echo & Sidetone Loopback', desc: 'Speaks back your microphone audio in real-time with 350ms delay for acoustic calibration.' },
                { code: '411', title: 'Speaking Clock Service', desc: 'Announces official local system time and 1000Hz synchronization tone pip.' },
                { code: '711', title: 'Automated Weather Hotline', desc: 'Reads out live local meteorological weather forecast and conditions.' },
                { code: '069', title: 'Last Call Return', desc: 'Automatically dials back the last person who called your telephone.' },
                { code: '2 (In Call)', title: 'Mute / Unmute Microphone', desc: 'Toggles handset mic on/off with in-ear audio chirp confirmation.' },
                { code: '3 + Ext (In Call)', title: 'Multi-Party Conference Invite', desc: 'Invite another friend into your active call (up to 5 callers).' },
                { code: '1 (Screening)', title: 'Live Voicemail Intercept', desc: 'When screening someone leaving a voicemail, dial 1 to take the call live immediately.' },
                { code: '0 / 1 (Call Waiting)', title: 'Call Waiting Controls', desc: 'When call waiting tone beeps: dial 0 to reject to VM, or 1 to accept & swap.' }
              ].map(svc => (
                <div
                  key={svc.code}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '1rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <strong style={{ color: '#fff', fontSize: '0.95rem' }}>{svc.title}</strong>
                    <code style={{ fontFamily: 'var(--font-mono)', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '2px 6px', borderRadius: '4px', fontWeight: '700' }}>
                      {svc.code}
                    </code>
                  </div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.4 }}>{svc.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. DO NOT DISTURB, PRIVACY & ACCOUNT TAB */}
      {/* ========================================================================= */}
      {activeTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Do Not Disturb (DND) Suite Card */}
          <div className="glass-card highlight-cyan">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Moon size={20} color="var(--accent-cyan)" /> Do Not Disturb (DND) & Scheduled Quiet Hours
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Upload a personalized greeting audio file (WAV or MP3) played to callers when you cannot answer the phone.
            </p>

            <form onSubmit={handleGreetingUpload} style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="file"
                accept="audio/wav,audio/mp3,audio/mpeg,audio/ogg"
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. DIAGNOSTICS & ROTARY OSCILLOSCOPE TAB */}
      {/* ========================================================================= */}
      {activeTab === 'advanced' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Rotary Pulse & Rhythm Oscilloscope Diagnostics Card */}
          <div className="glass-card highlight-amber">
            <h3 style={{ fontSize: '1.2rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Gauge size={22} /> Rotary Pulse Speed & Rhythm Diagnostic Oscilloscope
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Real-time telemetry measuring governor rotational speed (Pulses Per Second) and contact Break Ratio % as you dial digits on your physical telephone.
            </p>

            {/* Gauges Metric Strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {/* Dial Speed (PPS) Meter */}
              <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Dial Speed (PPS)
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: '800', color: lastPps >= 9 && lastPps <= 11 ? '#34d399' : '#fbbf24' }}>
                  {lastPps.toFixed(1)} <span style={{ fontSize: '1rem', fontWeight: '400' }}>PPS</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                  {lastPps >= 9 && lastPps <= 11 ? '✓ Optimal (9.0 – 11.0 PPS)' : lastPps < 9 ? '⚠️ Governor Running Slow' : '⚠️ Governor Running Fast'}
                </div>
              </div>

              {/* Break Ratio % Meter */}
              <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Contact Break Ratio
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: '800', color: lastBreakRatio >= 55 && lastBreakRatio <= 68 ? '#38bdf8' : '#fbbf24' }}>
                  {lastBreakRatio.toFixed(0)}% <span style={{ fontSize: '1rem', fontWeight: '400' }}>Break</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                  Target: 60% Break / 40% Make (Bell System)
                </div>
              </div>

              {/* Last Dialed Pulses */}
              <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                  Last Decoded Digit
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: '800', color: '#fbbf24' }}>
                  {lastDialedDigit || '—'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                  {lastPulseCount > 0 ? `${lastPulseCount} Pulses counted` : 'Pick up handset and dial'}
                </div>
              </div>
            </div>

            {/* Visual Oscilloscope Pulse Train Rendering */}
            <div style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                Simulated Pulse Train Waveform (10 PPS @ 60% Break):
              </div>
              <svg viewBox="0 0 600 60" style={{ width: '100%', height: '60px', overflow: 'visible' }}>
                {/* Grid Lines */}
                <line x1="0" y1="15" x2="600" y2="15" stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                <line x1="0" y1="45" x2="600" y2="45" stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />

                {/* Pulse Train */}
                <path
                  d="M 10 45 L 30 45 L 30 15 L 66 15 L 66 45 L 90 45 L 90 15 L 126 15 L 126 45 L 150 45 L 150 15 L 186 15 L 186 45 L 210 45 L 210 15 L 246 15 L 246 45 L 270 45 L 270 15 L 306 15 L 306 45 L 330 45 L 330 15 L 366 15 L 366 45 L 390 45 L 390 15 L 426 15 L 426 45 L 450 45 L 450 15 L 486 15 L 486 45 L 510 45 L 510 15 L 546 15 L 546 45 L 590 45"
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                <span>Make (40ms Closed)</span>
                <span>Break (60ms Open Contact)</span>
                <span>Inter-digit Pause (&gt;250ms)</span>
              </div>
            </div>
          </div>

          {/* Chassis Architecture Card */}
          <div className="glass-card highlight-cyan">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={20} color="var(--accent-cyan)" /> Physical Telephone Chassis & Debounce Architecture
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Hardware specifications reported during provisioning. Configures physical pulse debounce tables and acoustic sidetone curves.
            </p>

            <div className="grid-2">
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
              </div>

              <div className="form-group">
                <label className="form-label">Bell Frequency Preset</label>
                <select
                  className="form-select"
                  value={bellFrequencyHz.toString()}
                  onChange={(e) => setBellFrequencyHz(parseFloat(e.target.value))}
                >
                  <option value="20.0">20.0 Hz (North American Standard - WE C4A)</option>
                  <option value="16.6">16.6 Hz (North American Rural / Party Line)</option>
                  <option value="25.0">25.0 Hz (European / British GPO Standard)</option>
                  <option value="30.0">30.0 Hz (Kellogg Harmonic High-Pitch)</option>
                  <option value="33.3">33.3 Hz (Kellogg Harmonic Mid-Pitch)</option>
                  <option value="50.0">50.0 Hz (European Buzzer / AC Coil)</option>
                </select>
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
                    Quickly pressing the cradle hook switch for 100ms–400ms puts your active caller on hold and plays a dial tone so you can dial another extension to transfer or 3-way conference. Tapping again resumes the call.
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
                    Dialing <code>00</code> sends an urgent short chime cadence to all active rotary phones on your network, bridging answering lines into a voice broadcast.
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

          {/* Paired Hardware Diagnostics & Remote Controls */}
          {phone && (
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Activity size={20} color="var(--accent-cyan)" /> Live Hardware Fleet Diagnostics
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm('Reboot this ESP32-S3 rotary phone now?')) {
                      await rebootPhone();
                      setToast({ type: 'success', text: 'Reboot signal sent to hardware.' });
                    }
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <RotateCcw size={14} /> Remote Reboot
                </button>
              </div>

              <div className="grid-2" style={{ gap: '1rem', fontSize: '0.85rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Unique Device ID: </span>
                  <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>{phone.deviceId}</code>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Firmware Version: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>v{phone.firmwareVersion || '1.2.0'}</span>
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
                  type="button"
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
