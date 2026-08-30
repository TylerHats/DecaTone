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
  Gauge,
  PlusCircle,
  Trash2,
  PauseCircle,
  ExternalLink
} from 'lucide-react';
import { usePhone } from '../context/PhoneContext';
import { useAuth } from '../context/AuthContext';
import { WebPhoneModal } from '../components/WebPhoneModal';

const PAIRING_WORDS = ['TONE', 'CALL', 'DIAL', 'RING', 'BELL', 'CORD', 'VINTAGE'];

export const PhoneSettingsPage: React.FC = () => {
  const {
    phone,
    phones,
    selectedPhoneId,
    selectPhone,
    updatePhoneSettings,
    testRingDevice,
    rebootDevice,
    claimPhone,
    claimPhoneByCode,
    unclaimDevice,
    fetchPhones
  } = usePhone();
  const { user, refreshUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'standard' | 'resonance' | 'services' | 'account' | 'advanced'>('standard');
  const [showWebPhone, setShowWebPhone] = useState(false);
  const [showPairingModal, setShowPairingModal] = useState(false);

  // Active Device State
  const [phoneLabel, setPhoneLabel] = useState('Main Phone');
  const [ringEnabled, setRingEnabled] = useState(true);
  const [earpieceVolume, setEarpieceVolume] = useState(80);
  const [micSensitivity, setMicSensitivity] = useState(80);
  const [audioProfile, setAudioProfile] = useState('vintage_pots');
  const [sidetoneLevel, setSidetoneLevel] = useState(10);
  const [ringStyle, setRingStyle] = useState('traditional');
  const [ringCadenceCustom, setRingCadenceCustom] = useState('2000,4000');
  const [ringTimeoutSec, setRingTimeoutSec] = useState(25);
  const [hardwareProfile, setHardwareProfile] = useState('western_electric_500');
  const [bellFrequencyHz, setBellFrequencyHz] = useState(20.0);
  const [intercomEnabled, setIntercomEnabled] = useState(true);
  const [otaAutoUpdateEnabled, setOtaAutoUpdateEnabled] = useState(true);
  const [otaUpdateTime, setOtaUpdateTime] = useState('03:00');
  const [otaUpdateChannel, setOtaUpdateChannel] = useState('stable');

  // Pairing State
  const [selectedWord, setSelectedWord] = useState('TONE');
  const [numericPairingCode, setNumericPairingCode] = useState('');
  const [deviceIdInput, setDeviceIdInput] = useState('');
  const [newPhoneLabel, setNewPhoneLabel] = useState('Secondary Phone');
  const [claiming, setClaiming] = useState(false);

  // Account Preferences & DND State
  const [emailInput, setEmailInput] = useState(user?.email || '');
  const [notifyOnVoicemail, setNotifyOnVoicemail] = useState(user?.notifyOnVoicemail !== false);
  const [notifyOnMissedCall, setNotifyOnMissedCall] = useState(user?.notifyOnMissedCall !== false);
  const [callPrivacy, setCallPrivacy] = useState(user?.call_privacy || 'friends_only');
  const [dndManualState, setDndManualState] = useState(user?.dnd_manual_state === 1);
  const [dndScheduleEnabled, setDndScheduleEnabled] = useState(user?.dnd_schedule_enabled === 1);
  const [dndScheduleStart, setDndScheduleStart] = useState(user?.dnd_schedule_start || '22:00');
  const [dndScheduleEnd, setDndScheduleEnd] = useState(user?.dnd_schedule_end || '07:00');
  const [dndScheduleDays, setDndScheduleDays] = useState<string[]>(
    user?.dnd_schedule_days ? user.dnd_schedule_days.split(',') : ['1', '2', '3', '4', '5', '6', '7']
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

  // Firmware Info & Manual OTA
  const [firmwareInfo, setFirmwareInfo] = useState<{ version: string; hasBinary: boolean; isCustomOverride?: boolean } | null>(null);
  const [updatingOta, setUpdatingOta] = useState(false);

  // Status & Feedback
  const [saving, setSaving] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchFirmwareInfo();
  }, []);

  const fetchFirmwareInfo = async () => {
    try {
      const res = await fetch('/api/firmware/info');
      if (res.ok) {
        const data = await res.json();
        setFirmwareInfo(data);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (phone) {
      setPhoneLabel(phone.phoneLabel || 'Main Phone');
      setRingEnabled(phone.ringEnabled !== false);
      setEarpieceVolume(phone.earpieceVolume ?? 80);
      setMicSensitivity(phone.micSensitivity ?? 80);
      setAudioProfile(phone.audioProfile || 'vintage_pots');
      setSidetoneLevel(phone.sidetoneLevel ?? 10);
      setRingStyle(phone.ringStyle || 'traditional');
      setRingCadenceCustom(phone.ringCadenceCustom || '2000,4000');
      setRingTimeoutSec(phone.ringTimeoutSec ?? 25);
      setHardwareProfile(phone.hardwareProfile || 'western_electric_500');
      setBellFrequencyHz(phone.bellFrequencyHz ?? 20.0);
      setOtaAutoUpdateEnabled(phone.otaAutoUpdateEnabled !== false);
      setOtaUpdateTime(phone.otaUpdateTime || '03:00');
      setOtaUpdateChannel(phone.otaUpdateChannel || 'stable');
    }
  }, [phone]);

  useEffect(() => {
    if (user) {
      setEmailInput(user.email || '');
      setCallPrivacy(user.call_privacy || 'friends_only');
      setDndManualState(user.dnd_manual_state === 1);
      setDndScheduleEnabled(user.dnd_schedule_enabled === 1);
      setDndScheduleDays(user.dnd_schedule_days ? user.dnd_schedule_days.split(',') : ['1', '2', '3', '4', '5', '6', '7']);
      setDndScheduleStart(user.dnd_schedule_start || '22:00');
      setDndScheduleEnd(user.dnd_schedule_end || '07:00');
      setDndRepeatedCallBreakthrough(user.dnd_repeated_call_breakthrough !== 0 && user.dnd_repeated_call_breakthrough !== false);
    }
  }, [user]);

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

  useEffect(() => {
    fetchGreeting();
  }, []);

  const handleSaveSettings = async () => {
    if (!phone) return;
    setSaving(true);
    setToast(null);
    try {
      await updatePhoneSettings(phone.deviceId, {
        phoneLabel,
        ringEnabled,
        earpieceVolume,
        micSensitivity,
        audioProfile,
        sidetoneLevel,
        ringStyle,
        ringCadenceCustom,
        ringTimeoutSec,
        hardwareProfile,
        bellFrequencyHz,
        otaAutoUpdateEnabled,
        otaUpdateTime,
        otaUpdateChannel
      });
      setToast({ type: 'success', text: `Settings saved for ${phoneLabel} (${phone.deviceId})!` });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to update settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleVolumeChange = (vol: number) => {
    setEarpieceVolume(vol);
    if (phone) {
      updatePhoneSettings(phone.deviceId, { earpieceVolume: vol }).catch(() => {});
    }
  };

  const handleMicChange = (gain: number) => {
    setMicSensitivity(gain);
    if (phone) {
      updatePhoneSettings(phone.deviceId, { micSensitivity: gain }).catch(() => {});
    }
  };

  const handleSidetoneChange = (level: number) => {
    setSidetoneLevel(level);
    if (phone) {
      updatePhoneSettings(phone.deviceId, { sidetoneLevel: level }).catch(() => {});
    }
  };

  const handleTestRing = async () => {
    if (!phone) return;
    setRinging(true);
    try {
      await testRingDevice(phone.deviceId, ringStyle, ringCadenceCustom);
      setToast({ type: 'success', text: `Ring signal sent to ${phoneLabel}!` });
    } catch (e) {
      setToast({ type: 'error', text: 'Test ring failed' });
    } finally {
      setTimeout(() => setRinging(false), 2000);
    }
  };

  const handleReboot = async () => {
    if (!phone || !window.confirm(`Are you sure you want to reboot ${phoneLabel}?`)) return;
    try {
      await rebootDevice(phone.deviceId);
      setToast({ type: 'success', text: 'Reboot command sent to phone' });
    } catch (e) {
      setToast({ type: 'error', text: 'Reboot command failed' });
    }
  };

  const handleManualOtaUpdate = async () => {
    if (!phone || !window.confirm(`Initiate Over-The-Air (OTA) firmware update on ${phoneLabel}? The phone will download the latest firmware from the switchboard and restart automatically.`)) return;
    setUpdatingOta(true);
    setToast(null);
    try {
      const res = await fetch(`/api/phone/ota-update/${phone.deviceId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to trigger OTA update' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: 'Failed to trigger OTA update' });
    } finally {
      setUpdatingOta(false);
    }
  };

  const handleUnclaim = async () => {
    if (!phone || !window.confirm(`Unpair ${phoneLabel} (${phone.deviceId}) from your account?`)) return;
    try {
      await unclaimDevice(phone.deviceId);
      setToast({ type: 'success', text: 'Phone successfully unpaired.' });
    } catch (e) {
      setToast({ type: 'error', text: 'Failed to unpair phone' });
    }
  };

  const handlePairByWordCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!numericPairingCode) return;
    setClaiming(true);
    setToast(null);
    try {
      await claimPhoneByCode(selectedWord, numericPairingCode, newPhoneLabel || 'Secondary Phone');
      setToast({ type: 'success', text: 'Hardware phone claimed and paired to your account!' });
      setNumericPairingCode('');
      setShowPairingModal(false);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Pairing failed. Check digits dialed on rotary phone.' });
    } finally {
      setClaiming(false);
    }
  };

  const handlePairByDeviceId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceIdInput) return;
    setClaiming(true);
    setToast(null);
    try {
      await claimPhone(deviceIdInput.trim(), newPhoneLabel || 'Secondary Phone');
      setToast({ type: 'success', text: `Device ${deviceIdInput} paired to your account!` });
      setDeviceIdInput('');
      setShowPairingModal(false);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to claim device ID' });
    } finally {
      setClaiming(false);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    setToast(null);
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
        },
        body: JSON.stringify({
          email: emailInput,
          notifyOnVoicemail,
          notifyOnMissedCall,
          call_privacy: callPrivacy,
          dnd_manual_state: dndManualState ? 1 : 0,
          dnd_schedule_enabled: dndScheduleEnabled ? 1 : 0,
          dnd_schedule_start: dndScheduleStart,
          dnd_schedule_end: dndScheduleEnd,
          dnd_schedule_days: dndScheduleDays.join(','),
          dnd_repeated_call_breakthrough: dndRepeatedCallBreakthrough ? 1 : 0
        })
      });

      if (res.ok) {
        setToast({ type: 'success', text: 'Account preferences and DND schedule updated!' });
        if (refreshUser) refreshUser();
      } else {
        const d = await res.json();
        setToast({ type: 'error', text: d.error || 'Failed to save account settings' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Network error saving settings' });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSweepTest = async (freqHz: number) => {
    if (!phone) return;
    setSweepFreq(freqHz);
    setSweepActive(true);
    try {
      await fetch('/api/phone/resonance-sweep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
        },
        body: JSON.stringify({ deviceId: phone.deviceId, frequencyHz: freqHz, durationSec: 3.0 })
      });
      setToast({ type: 'success', text: `Testing bell coils at ${freqHz.toFixed(1)} Hz...` });
    } catch (e) {
      setToast({ type: 'error', text: 'Resonance sweep test failed' });
    } finally {
      setTimeout(() => setSweepActive(false), 3200);
    }
  };

  const handleUploadGreeting = async (e: React.FormEvent) => {
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
            Multi-device management, party-line pickup, bell calibration, and dial codes.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '0.4rem', background: 'rgba(255,255,255,0.04)', padding: '0.35rem', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('standard')}
            className={`btn btn-sm ${activeTab === 'standard' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <Sliders size={14} /> Phones & Audio
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

      {/* Multi-Device Header Selector */}
      <div className="glass-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Cpu size={18} color="var(--accent-cyan)" />
            <strong style={{ fontSize: '1rem', color: '#fff' }}>Paired Telephones on Account ({phones.length})</strong>
          </div>
          <button
            type="button"
            onClick={() => setShowPairingModal(!showPairingModal)}
            className="btn btn-secondary btn-sm"
          >
            <PlusCircle size={14} /> Pair Additional Phone
          </button>
        </div>

        {/* List of Paired Phones */}
        {phones.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-dim)' }}>
            No physical rotary telephones are currently paired to your account. Use the wizard below to pair your first phone!
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' }}>
            {phones.map((p) => {
              const isSelected = p.deviceId === selectedPhoneId;
              return (
                <div
                  key={p.deviceId}
                  onClick={() => selectPhone(p.deviceId)}
                  style={{
                    background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ color: isSelected ? 'var(--accent-cyan)' : '#fff', fontSize: '0.95rem' }}>
                      {p.phoneLabel || 'Main Phone'}
                    </strong>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: p.isOnline ? '#34d399' : 'var(--text-dim)' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.isOnline ? '#34d399' : '#64748b' }} />
                      {p.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    <code style={{ fontFamily: 'var(--font-mono)' }}>{p.deviceId}</code>
                    <span>{p.ringEnabled !== false ? '🔔 Rings' : '🔕 Silent'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pairing Box (Collapsible / Modal) */}
        {showPairingModal && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '1rem', color: 'var(--accent-amber)', marginBottom: '0.5rem' }}>
              Pair a New Hardware Phone
            </h4>
            <div className="grid-2" style={{ gap: '1rem' }}>
              <form onSubmit={handlePairByDeviceId} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label className="form-label">Option A: By Device ID</label>
                <input
                  type="text"
                  placeholder="e.g. ESP32-BEDROOM-02"
                  className="form-input"
                  value={deviceIdInput}
                  onChange={(e) => setDeviceIdInput(e.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Phone Label (e.g. Bedroom Phone)"
                  className="form-input"
                  value={newPhoneLabel}
                  onChange={(e) => setNewPhoneLabel(e.target.value)}
                />
                <button type="submit" disabled={claiming} className="btn btn-primary btn-sm">
                  <Check size={14} /> {claiming ? 'Pairing...' : 'Claim Device'}
                </button>
              </form>

              <form onSubmit={handlePairByWordCode} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label className="form-label">Option B: By Rotary Pairing Code</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select className="form-select" value={selectedWord} onChange={(e) => setSelectedWord(e.target.value)} style={{ width: '110px' }}>
                    {PAIRING_WORDS.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="4 Digits"
                    className="form-input"
                    value={numericPairingCode}
                    onChange={(e) => setNumericPairingCode(e.target.value.replace(/\D/g, ''))}
                    style={{ fontFamily: 'var(--font-mono)' }}
                    required
                  />
                </div>
                <button type="submit" disabled={claiming} className="btn btn-amber btn-sm">
                  <Check size={14} /> {claiming ? 'Pairing...' : 'Pair by Word Code'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. PHONES & AUDIO SETTINGS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'standard' && phone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Active Device Label & Ring Enabled Toggle */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sliders size={20} color="var(--accent-cyan)" /> Selected Device Configuration: {phone.deviceId}
            </h3>

            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Device Label (e.g. Living Room, Study, Kitchen)</label>
                <input
                  type="text"
                  className="form-input"
                  value={phoneLabel}
                  onChange={(e) => setPhoneLabel(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={ringEnabled}
                    onChange={(e) => setRingEnabled(e.target.checked)}
                    style={{ width: '20px', height: '20px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>Ring this telephone on incoming calls</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                      Uncheck to keep this phone silent while other phones ring.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
              💡 <strong>Party-Line Auto-Join:</strong> Picking up this phone while any other phone on your account is in a call automatically joins the conversation in real-time!
            </div>
          </div>

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

            <div className="grid-2" style={{ marginTop: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">
                  <span>Acoustic Sidetone Feedback (Hear yourself in earpiece)</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#a78bfa' }}>{sidetoneLevel}%</strong>
                </label>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={sidetoneLevel}
                  onChange={(e) => handleSidetoneChange(parseInt(e.target.value, 10))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Audio DSP Profile</label>
                <select
                  className="form-select"
                  value={audioProfile}
                  onChange={(e) => setAudioProfile(e.target.value)}
                >
                  <option value="vintage_pots">Vintage POTS (300Hz–3.4kHz Carbon Warmth)</option>
                  <option value="early_bell">1930s Early Bell (450Hz–2.5kHz Narrowband Lo-Fi)</option>
                  <option value="modern_hd">Modern HD (16kHz Wideband Linear)</option>
                </select>
              </div>
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
                <Bell size={14} /> {ringing ? 'Ringing...' : 'Test Ring Selected Phone'}
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

          {/* Firmware & Over-The-Air (OTA) Updates Card */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Cpu size={20} color="var(--accent-cyan)" /> Firmware & Over-The-Air (OTA) Updates
                </h3>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                  Release channel is synchronized automatically with server system settings.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className="badge badge-online" style={{ fontFamily: 'var(--font-mono)' }}>
                  Current: v{phone?.firmwareVersion || '1.2.0'}
                </span>
                {firmwareInfo?.version && phone?.firmwareVersion && phone.firmwareVersion !== firmwareInfo.version && (
                  <span className="badge badge-amber" style={{ fontFamily: 'var(--font-mono)', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                    v{firmwareInfo.version} Available
                  </span>
                )}
              </div>
            </div>

            {/* Pending Update Alert & Trigger */}
            {firmwareInfo?.version && phone?.firmwareVersion && phone.firmwareVersion !== firmwareInfo.version && (
              <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <strong style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Sparkles size={16} /> Pending Firmware Update Available (v{firmwareInfo.version})
                  </strong>
                  <p style={{ color: 'var(--text-main)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                    A new firmware release is ready on the switchboard. You can update now or wait for the automatic scheduled time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleManualOtaUpdate}
                  disabled={updatingOta || !phone?.isOnline}
                  className="btn btn-amber btn-sm"
                >
                  <Zap size={14} /> {updatingOta ? 'Flashing...' : 'Update Firmware Now (OTA)'}
                </button>
              </div>
            )}

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={otaAutoUpdateEnabled}
                    onChange={(e) => setOtaAutoUpdateEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>Enable Automatic Firmware Updates (OTA)</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                      Automatically flashes new firmware releases when the phone is on-hook (idle).
                    </p>
                  </div>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Preferred Auto-Update Time Window</label>
                <input
                  type="time"
                  className="form-input"
                  value={otaUpdateTime}
                  onChange={(e) => setOtaUpdateTime(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                IP: <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{phone?.ipAddress || '192.168.x.x'}</strong> &bull; Device: <span style={{ fontFamily: 'var(--font-mono)' }}>{phone?.deviceId}</span>
              </div>

              <a
                href="https://github.com/TylerHats/DecaTone/wiki/Firmware-Flashing-and-Setup"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
              >
                <HelpCircle size={14} /> Firmware & Flashing Wiki Guide <ExternalLink size={12} />
              </a>
            </div>
          </div>

          {/* Save & Device Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleReboot}
                disabled={!phone?.isOnline}
                className="btn btn-secondary btn-sm"
              >
                <RotateCcw size={14} /> Remote Reboot
              </button>
              <button
                type="button"
                onClick={handleUnclaim}
                className="btn btn-danger btn-sm"
              >
                <Trash2 size={14} /> Unpair Phone
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn btn-primary"
              style={{ minWidth: '160px' }}
            >
              <Check size={16} /> {saving ? 'Saving...' : 'Save Phone Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. RESONANCE CALIBRATION WIZARD TAB */}
      {/* ========================================================================= */}
      {activeTab === 'resonance' && phone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-amber">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Zap size={22} /> Bell Resonance Frequency Calibration Sweep
              </h3>
              <a
                href="https://github.com/TylerHats/DecaTone/wiki/Audio-and-Bell-Ringer-Tuning"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
              >
                <HelpCircle size={14} /> Bell Ringer Tuning Wiki <ExternalLink size={12} />
              </a>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
              Targeting: <strong>{phoneLabel} ({phone.deviceId})</strong>. Test the presets below or sweep frequencies to find maximum resonance for your phone's mechanical bells.
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
                    <strong style={{ color: '#fff', fontSize: '1rem' }}>{preset.label}</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{preset.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSweepTest(preset.freq)}
                    disabled={sweepActive || !phone?.isOnline}
                    className="btn btn-secondary btn-sm"
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
      {/* 3. DIAL CODES & SERVICE DIRECTORY TAB */}
      {/* ========================================================================= */}
      {activeTab === 'services' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <HelpCircle size={22} color="var(--accent-cyan)" /> Telephony Dial Codes & Service Lines
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              DecaTone provides authentic 3-digit service lines and single-digit in-call controls.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {[
                { code: '111', title: 'Ringback Line Test', desc: 'Dial 111, hang up the handset, and the switchboard rings your bells 5 seconds later to test ringer mechanical operation.' },
                { code: '119 / 099', title: 'Audio Echo & Sidetone Loopback', desc: 'Speaks back your microphone audio in real-time with 350ms delay for acoustic calibration.' },
                { code: '411', title: 'Speaking Clock Service', desc: 'Announces official local system time with 1000Hz synchronization tone pip.' },
                { code: '567 / 300', title: 'Dial-Up Modem Handshake Simulator', desc: 'Plays authentic Bell 103 / V.34 dial-up modem screeching, carrier tones, and digital data transmission sounds.' },
                { code: '711', title: 'Automated Weather Hotline', desc: 'Reads out live local meteorological weather conditions and temperature forecast.' },
                { code: '069', title: 'Last Call Return (Redial)', desc: 'Automatically dials back the last person who called your telephone.' },
                { code: '078', title: 'Toggle Do Not Disturb', desc: 'Toggles DND on/off from the handset with spoken voice confirmation.' },
                { code: '079', title: 'Do Not Disturb Status', desc: 'Speaks whether DND is currently active or off for your line.' },
                { code: '0', title: 'Voicemail Inbox', desc: 'Dial 0 and pause 2s to listen to and manage your encrypted voice messages.' },
                { code: '8 (In Call)', title: 'Call Park / Hold', desc: 'Dial 8 during an active call to park it on hold with melodic music. You can hang up and pick up from any room to resume.' },
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
      {/* 4. DO NOT DISTURB & ACCOUNT TAB */}
      {/* ========================================================================= */}
      {activeTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-cyan">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Moon size={20} color="var(--accent-cyan)" /> Do Not Disturb (DND) & Scheduled Quiet Hours
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Silence incoming bell ringing automatically during sleep hours or on-demand.
            </p>

            <form onSubmit={handleSaveAccount}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dndManualState}
                    onChange={(e) => setDndManualState(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>Enable Do Not Disturb Now (Manual Mode)</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Directs all non-VIP calls straight to voicemail.</p>
                  </div>
                </label>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={dndScheduleEnabled}
                      onChange={(e) => setDndScheduleEnabled(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                    />
                    <div>
                      <strong style={{ color: '#fff' }}>Enable Scheduled Quiet Hours</strong>
                      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Automatically silences bells during specific times of day.</p>
                    </div>
                  </label>

                  {dndScheduleEnabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '2rem' }}>
                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">Start Time</label>
                          <input
                            type="time"
                            className="form-input"
                            value={dndScheduleStart}
                            onChange={(e) => setDndScheduleStart(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">End Time</label>
                          <input
                            type="time"
                            className="form-input"
                            value={dndScheduleEnd}
                            onChange={(e) => setDndScheduleEnd(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={dndRepeatedCallBreakthrough}
                      onChange={(e) => setDndRepeatedCallBreakthrough(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                    />
                    <div>
                      <strong style={{ color: '#fff' }}>Allow Repeated Call Breakthrough (Urgent Calls)</strong>
                      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                        If the same non-VIP caller rings twice within 3 minutes, ring through DND.
                      </p>
                    </div>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="submit" disabled={savingAccount} className="btn btn-primary">
                    <Check size={16} /> {savingAccount ? 'Saving...' : 'Save DND Preferences'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Voicemail Greeting Card */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PhoneForwarded size={20} color="var(--accent-cyan)" /> Outbound Voicemail Greeting
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Upload a personalized greeting or use the built-in system announcement.
            </p>

            <form onSubmit={handleUploadGreeting} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setGreetingFile(e.target.files?.[0] || null)}
                className="form-input"
                style={{ flex: 1, minWidth: '220px' }}
              />
              <button type="submit" disabled={!greetingFile || uploadingGreeting} className="btn btn-primary">
                <Upload size={16} /> {uploadingGreeting ? 'Uploading...' : 'Upload Greeting'}
              </button>
              {greetingInfo?.hasCustomGreeting && (
                <button type="button" onClick={handleResetGreeting} className="btn btn-secondary">
                  <RotateCcw size={16} /> Reset Default
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Floating In-Browser Softphone Button */}
      <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 90 }}>
        <button
          type="button"
          onClick={() => setShowWebPhone(true)}
          className="btn btn-primary"
          style={{
            borderRadius: '50px',
            padding: '0.85rem 1.4rem',
            boxShadow: '0 8px 24px rgba(56, 189, 248, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 700
          }}
        >
          <PhoneCall size={18} /> Open In-Browser Softphone
        </button>
      </div>

      <WebPhoneModal
        isOpen={showWebPhone}
        onClose={() => setShowWebPhone(false)}
      />
    </div>
  );
};
