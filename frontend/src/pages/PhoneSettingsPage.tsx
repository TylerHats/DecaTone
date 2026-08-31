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
  ExternalLink,
  Signal,
  CheckCircle2,
  AlertCircle,
  Wrench
} from 'lucide-react';
import { usePhone } from '../context/PhoneContext';
import { useAuth } from '../context/AuthContext';
import { WebPhoneModal } from '../components/WebPhoneModal';

export const PhoneSettingsPage: React.FC = () => {
  const {
    phone,
    phones,
    selectedPhoneId,
    selectPhone,
    updatePhoneSettings,
    testRingDevice,
    rebootDevice,
    claimPhoneByCode,
    unclaimDevice,
    fetchPhones
  } = usePhone();
  const { user, refreshUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'standard' | 'resonance' | 'diagnostics' | 'services' | 'account'>('standard');
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
  const [pairingCodeInput, setPairingCodeInput] = useState('');
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
  const [greetingInfo, setGreetingInfo] = useState<{ hasCustomGreeting: boolean; audioUrl?: string } | null>(null);
  const [greetingFile, setGreetingFile] = useState<File | null>(null);
  const [uploadingGreeting, setUploadingGreeting] = useState(false);

  // Resonance Calibration Sweep State
  const [sweepFreq, setSweepFreq] = useState(20.0);
  const [sweepActive, setSweepActive] = useState(false);
  const [wizardRunning, setWizardRunning] = useState(false);
  const [wizardProgress, setWizardProgress] = useState<{ freq: number; percent: number } | null>(null);
  const [wizardResult, setWizardResult] = useState<any>(null);

  // Diagnostics State
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

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
      setSweepFreq(phone.bellFrequencyHz ?? 20.0);
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

  const fetchDiagnostics = async () => {
    if (!phone) return;
    setLoadingDiagnostics(true);
    try {
      const res = await fetch(`/api/phone/${phone.id || ''}/diagnostics`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDiagnosticsData(data.diagnostics);
      }
    } catch (e) {}
    setLoadingDiagnostics(false);
  };

  useEffect(() => {
    fetchGreeting();
  }, []);

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      fetchDiagnostics();
    }
  }, [activeTab, phone]);

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
      setToast({ type: 'success', text: `Settings saved for ${phoneLabel}!` });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccountPreferences = async () => {
    setSavingAccount(true);
    setToast(null);
    try {
      const res = await fetch('/api/phone/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
        },
        body: JSON.stringify({
          email: emailInput,
          notifyOnVoicemail,
          notifyOnMissedCall,
          callPrivacy,
          dndManualState,
          dndScheduleEnabled,
          dndScheduleStart,
          dndScheduleEnd,
          dndScheduleDays: dndScheduleDays.join(','),
          dndRepeatedCallBreakthrough
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update preferences');

      await refreshUser();
      setToast({ type: 'success', text: 'Account preferences & Do Not Disturb schedule updated!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSweepTest = async (freqToTest: number) => {
    if (!phone) return;
    setSweepActive(true);
    setSweepFreq(freqToTest);
    setBellFrequencyHz(freqToTest);
    try {
      const res = await fetch('/api/phone/resonance-sweep', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
        },
        body: JSON.stringify({
          deviceId: phone.deviceId,
          frequencyHz: freqToTest,
          durationMs: 3000
        })
      });
      if (res.ok) {
        setToast({ type: 'success', text: `Resonance test ring sent at ${freqToTest.toFixed(1)} Hz (3 seconds)` });
      }
    } catch (err) {}
    setTimeout(() => setSweepActive(false), 3200);
  };

  const handleRunResonanceWizard = async () => {
    if (!phone) return;
    setWizardRunning(true);
    setWizardProgress({ freq: 15.0, percent: 0 });
    setWizardResult(null);
    setToast(null);

    try {
      const res = await fetch(`/api/phone/${phone.id || ''}/calibrate-resonance-wizard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('decatone_token')}`
        },
        body: JSON.stringify({ deviceId: phone.deviceId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resonance sweep failed');

      setWizardResult(data.result);
      setBellFrequencyHz(data.result.peakFrequency);
      setSweepFreq(data.result.peakFrequency);
      setToast({ type: 'success', text: data.message });
      await fetchPhones();
    } catch (err: any) {
      setToast({ type: 'error', text: err.message });
    } finally {
      setWizardRunning(false);
    }
  };

  const handleManualOtaUpdate = async () => {
    if (!phone) return;
    if (!window.confirm(`Push firmware update v${firmwareInfo?.version || 'latest'} to this telephone adapter? The device will reboot when finished.`)) return;

    setUpdatingOta(true);
    try {
      const res = await fetch(`/api/admin/fleet/${phone.deviceId}/ota`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('decatone_token')}` }
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: 'Firmware update broadcast sent! Flashing telephone...' });
      } else {
        setToast({ type: 'error', text: data.error || 'OTA trigger failed' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message });
    } finally {
      setUpdatingOta(false);
    }
  };

  const handlePairByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingCodeInput.trim()) return;

    setClaiming(true);
    setToast(null);
    try {
      const success = await claimPhoneByCode('', '', pairingCodeInput.trim());
      if (success) {
        setToast({ type: 'success', text: 'Telephone successfully paired to your account!' });
        setShowPairingModal(false);
        setPairingCodeInput('');
        await fetchPhones();
      } else {
        setToast({ type: 'error', text: 'Invalid or expired pairing code. Please check the code shown on your telephone adapter.' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message });
    } finally {
      setClaiming(false);
    }
  };

  const handleUnclaim = async () => {
    if (!phone) return;
    if (!window.confirm(`Unpair '${phoneLabel}' from your account? You can re-pair it at any time with its pairing code.`)) return;

    try {
      const ok = await unclaimDevice(phone.deviceId);
      if (ok) {
        setToast({ type: 'success', text: 'Telephone unpaired.' });
        await fetchPhones();
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message });
    }
  };

  const handleReboot = async () => {
    if (!phone) return;
    try {
      const ok = await rebootDevice(phone.deviceId);
      if (ok) {
        setToast({ type: 'success', text: 'Reboot command sent to telephone.' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message });
    }
  };

  const handleTestRing = async () => {
    if (!phone) return;
    setRinging(true);
    try {
      await testRingDevice(phone.deviceId);
      setToast({ type: 'success', text: 'Test ring signal sent!' });
    } catch (e: any) {
      setToast({ type: 'error', text: e.message });
    } finally {
      setTimeout(() => setRinging(false), 2000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
      {/* Page Header */}
      <div className="glass-card highlight-cyan" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Telephone & Account Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Configure bell ringer resonance, audio DSP filters, voicemail greetings, and hardware pairing.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={() => setShowWebPhone(true)} className="btn btn-primary btn-sm">
            <PhoneCall size={16} /> Web Softphone
          </button>
        </div>
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

      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
        {[
          { id: 'standard', label: 'Telephone Configuration', icon: Sliders },
          { id: 'resonance', label: 'Bell Resonance Tuning', icon: Zap },
          { id: 'diagnostics', label: 'Hardware Diagnostics', icon: Activity },
          { id: 'account', label: 'Account & DND Rules', icon: Moon },
          { id: 'services', label: 'Service Lines Directory', icon: HelpCircle }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Device Selector Card */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Telephone:</span>
          {phones.length > 0 ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {phones.map((p) => {
                const isSelected = p.deviceId === (phone?.deviceId || selectedPhoneId);
                return (
                  <button
                    key={p.deviceId}
                    onClick={() => selectPhone(p.deviceId)}
                    className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: p.isOnline ? '#34d399' : '#f43f5e'
                      }}
                    />
                    {p.phoneLabel || 'Telephone'}
                  </button>
                );
              })}
            </div>
          ) : (
            <span style={{ color: 'var(--accent-amber)', fontSize: '0.9rem' }}>
              No telephone hardware paired yet
            </span>
          )}
        </div>

        <button
          onClick={() => setShowPairingModal(!showPairingModal)}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <PlusCircle size={15} /> {showPairingModal ? 'Close Pairing Form' : 'Pair New Phone'}
        </button>
      </div>

      {/* Pairing Box */}
      {showPairingModal && (
        <div className="glass-card highlight-amber" style={{ padding: '1.5rem' }}>
          <h4 style={{ fontSize: '1.1rem', color: 'var(--accent-amber)', marginBottom: '0.5rem' }}>
            Pair a Rotary Telephone Adapter
          </h4>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Enter the Word + 4-Digit pairing code displayed on your telephone's web interface (e.g. <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>TONE-4821</strong> or <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>4821</strong>).
          </p>

          <form onSubmit={handlePairByCode} style={{ display: 'flex', gap: '0.75rem', maxWidth: '450px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. TONE-4821 or 4821"
              value={pairingCodeInput}
              onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', textAlign: 'center', letterSpacing: '0.08em' }}
              required
              autoFocus
            />
            <button type="submit" disabled={claiming || !pairingCodeInput} className="btn btn-amber" style={{ whiteSpace: 'nowrap' }}>
              <Check size={16} /> {claiming ? 'Pairing...' : 'Claim Telephone'}
            </button>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. STANDARD CONFIGURATION TAB */}
      {/* ========================================================================= */}
      {activeTab === 'standard' && phone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sliders size={20} color="var(--accent-cyan)" /> Selected Telephone: {phoneLabel}
            </h3>

            <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Telephone Name / Room Label</label>
                <input
                  type="text"
                  className="form-input"
                  value={phoneLabel}
                  onChange={(e) => setPhoneLabel(e.target.value)}
                  placeholder="e.g. Living Room Rotary, Office 500"
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

            {/* Audio Profile & Sidetone */}
            <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Audio DSP Filter Profile</label>
                <select
                  className="form-select"
                  value={audioProfile}
                  onChange={(e) => setAudioProfile(e.target.value)}
                >
                  <option value="vintage_pots">Vintage POTS (300Hz - 3400Hz Bandpass)</option>
                  <option value="early_1930s">1930s Carbon Mic (Harmonic Warmth)</option>
                  <option value="modern_hd">Modern HD (Clean Wideband Audio)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Telephone Hardware Profile</label>
                <select
                  className="form-select"
                  value={hardwareProfile}
                  onChange={(e) => setHardwareProfile(e.target.value)}
                >
                  <option value="western_electric_500">Western Electric 500 / 2500 (US)</option>
                  <option value="gpo_746">British GPO 746 / 706 (UK Double Bell)</option>
                  <option value="kellogg_harmonic">Kellogg Harmonic Party Line Ringer</option>
                  <option value="ericsson_dbb">Ericsson DBH 1001 / European</option>
                </select>
              </div>
            </div>

            {/* Volume Sliders */}
            <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <label className="form-label">Earpiece Volume ({earpieceVolume}%)</label>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={earpieceVolume}
                  onChange={(e) => setEarpieceVolume(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <label className="form-label">Microphone Sensitivity ({micSensitivity}%)</label>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={micSensitivity}
                  onChange={(e) => setMicSensitivity(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Firmware Version & Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                Firmware: <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>v{phone.firmwareVersion || '1.2.2'}</strong> &bull; Status: <span style={{ color: phone.isOnline ? '#34d399' : '#f43f5e', fontWeight: 600 }}>{phone.isOnline ? 'Online' : 'Offline'}</span>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" onClick={handleTestRing} disabled={ringing || !phone.isOnline} className="btn btn-amber btn-sm">
                  <Bell size={14} /> {ringing ? 'Ringing...' : 'Test Bell'}
                </button>
                <button type="button" onClick={handleReboot} disabled={!phone.isOnline} className="btn btn-secondary btn-sm">
                  <RotateCcw size={14} /> Reboot
                </button>
                <button type="button" onClick={handleUnclaim} className="btn btn-danger btn-sm">
                  <Trash2 size={14} /> Unpair Phone
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={handleSaveSettings} disabled={saving} className="btn btn-primary btn-lg">
              <Check size={18} /> {saving ? 'Saving...' : 'Save Telephone Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. BELL RESONANCE TUNING & ACOUSTIC SWEEP WIZARD */}
      {/* ========================================================================= */}
      {activeTab === 'resonance' && phone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Automated Calibration Wizard Card */}
          <div className="glass-card highlight-amber" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                  <Zap size={22} /> Automated Acoustic Resonance Calibration Wizard
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                  The switchboard will ring your telephone across 15Hz – 35Hz, measure acoustic microphone energy, and automatically tune your bell driver to maximum loudness.
                </p>
              </div>

              <a
                href="https://github.com/TylerHats/DecaTone/wiki/Audio-and-Bell-Ringer-Tuning"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
              >
                <HelpCircle size={14} /> Bell Tuning Wiki <ExternalLink size={12} />
              </a>
            </div>

            {/* Critical Volume Notice */}
            <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <AlertCircle size={22} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.9rem', color: '#fef08a' }}>
                <strong>Important Before Running:</strong> Ensure the physical mechanical bell loudness lever on the bottom of your telephone body is set to <strong>MAXIMUM (LOUD)</strong>. Place the handset microphone directly next to the metal bells.
              </div>
            </div>

            {/* Wizard Progress / Action */}
            {wizardRunning ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ fontSize: '1.2rem', color: '#fbbf24', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Zap size={20} className="spin" />
                  Calibrating Bell Resonance: {wizardProgress?.freq?.toFixed(1) || '20.0'} Hz ({wizardProgress?.percent || 0}%)
                </div>
                <div style={{ width: '100%', height: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden', maxWidth: '400px', margin: '0 auto' }}>
                  <div style={{ width: `${wizardProgress?.percent || 0}%`, height: '100%', background: 'var(--accent-amber)', transition: 'width 0.3s ease' }} />
                </div>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  Listening to microphone acoustic feedback pulses...
                </p>
              </div>
            ) : wizardResult ? (
              <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-sm)', padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#34d399', fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  <CheckCircle2 size={20} /> Calibration Successful! Optimal Peak Resonance: {wizardResult.peakFrequency} Hz
                </div>
                <p style={{ color: 'var(--text-main)', fontSize: '0.875rem', margin: 0 }}>
                  Optimal resonant frequency has been saved and applied to your telephone ringer driver.
                </p>
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={handleRunResonanceWizard}
                disabled={wizardRunning || !phone.isOnline}
                className="btn btn-amber btn-lg"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Zap size={18} /> {wizardRunning ? 'Running Sweep...' : 'Start Acoustic Calibration Wizard'}
              </button>
            </div>
          </div>

          {/* Preset Badges (Directly Clickable) */}
          <div className="glass-card">
            <h4 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: '#fff' }}>
              Manual Resonance Presets & Frequency Slider
            </h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Click any standard preset below to instantly apply and test it, or fine-tune using the slider.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                { freq: 20.0, label: '20.0 Hz (US Standard)', desc: 'Western Electric 500 / 2500 C4A' },
                { freq: 16.6, label: '16.6 Hz (Party Line)', desc: 'Rural & harmonic party bells' },
                { freq: 25.0, label: '25.0 Hz (UK / GPO)', desc: 'British GPO 746 double bells' },
                { freq: 30.0, label: '30.0 Hz (Kellogg High)', desc: 'Harmonic frequency ringers' },
                { freq: 33.3, label: '33.3 Hz (Harmonic Mid)', desc: 'Harmonic tuned bells' }
              ].map(preset => {
                const isSelected = bellFrequencyHz === preset.freq;
                return (
                  <div
                    key={preset.freq}
                    onClick={() => {
                      setBellFrequencyHz(preset.freq);
                      setSweepFreq(preset.freq);
                    }}
                    style={{
                      background: isSelected ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                      border: `2px solid ${isSelected ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '1rem',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div>
                      <strong style={{ color: isSelected ? '#fbbf24' : '#fff', fontSize: '0.95rem' }}>{preset.label}</strong>
                      <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{preset.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSweepTest(preset.freq);
                      }}
                      disabled={sweepActive || !phone?.isOnline}
                      className={`btn btn-sm ${isSelected ? 'btn-amber' : 'btn-secondary'}`}
                    >
                      <Bell size={13} /> {sweepActive && sweepFreq === preset.freq ? 'Testing...' : 'Test Ring'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Custom Resonance Slider */}
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: '600', color: '#fff' }}>Fine-Tuning Frequency Slider (15.0 Hz – 35.0 Hz)</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', color: 'var(--accent-amber)', fontWeight: '700' }}>
                  {bellFrequencyHz.toFixed(1)} Hz
                </span>
              </div>
              <input
                type="range"
                min="15"
                max="35"
                step="0.5"
                value={bellFrequencyHz}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setBellFrequencyHz(val);
                  setSweepFreq(val);
                }}
                style={{ width: '100%', marginBottom: '1rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleSweepTest(bellFrequencyHz)}
                  disabled={sweepActive || !phone?.isOnline}
                  className="btn btn-secondary btn-sm"
                >
                  <Bell size={14} /> {sweepActive ? 'Testing Bell...' : 'Test Selected Frequency (3s)'}
                </button>

                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="btn btn-primary btn-sm"
                >
                  <Check size={14} /> Save Resonance Setting
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. HARDWARE DIAGNOSTICS & TELEMETRY TAB */}
      {/* ========================================================================= */}
      {activeTab === 'diagnostics' && phone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-cyan">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Activity size={22} color="var(--accent-cyan)" /> Live Hardware Diagnostics & Board Telemetry
              </h3>
              <button onClick={fetchDiagnostics} disabled={loadingDiagnostics} className="btn btn-secondary btn-sm">
                <RotateCcw size={14} /> Refresh Metrics
              </button>
            </div>

            {diagnosticsData ? (
              <div className="grid-2" style={{ gap: '1rem' }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Rotary Governor Health</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#34d399', marginTop: '0.25rem' }}>
                    {diagnosticsData.rotaryGovernorSpeed}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    Pulse Break Ratio: {diagnosticsData.rotaryBreakRatio}
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>WiFi Signal Strength (RSSI)</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#38bdf8', marginTop: '0.25rem' }}>
                    {diagnosticsData.rssi} dBm ({diagnosticsData.wifiQualityPercent}%)
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    IP Address: {diagnosticsData.ipAddress}
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Audio Circuit Health</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>
                    {diagnosticsData.audioNoiseFloor}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    Microphone Gain: {diagnosticsData.adcMicGain} &bull; Output Level: {diagnosticsData.dacOutputLevel}
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Bell Ringer Circuit</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-amber)', marginTop: '0.25rem' }}>
                    {diagnosticsData.bellFrequencyHz.toFixed(1)} Hz Coil Tuning
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    Driver: Solid-State MOSFET H-Bridge
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                {loadingDiagnostics ? 'Fetching telemetry from telephone...' : 'No diagnostics received yet'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. ACCOUNT PREFERENCES & DO NOT DISTURB */}
      {/* ========================================================================= */}
      {activeTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Moon size={20} color="var(--accent-cyan)" /> Do Not Disturb (DND) & Privacy
            </h3>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Incoming Call Privacy</label>
              <select
                className="form-select"
                value={callPrivacy}
                onChange={(e) => setCallPrivacy(e.target.value)}
              >
                <option value="open">Open (Anyone can call your extension)</option>
                <option value="friends_only">Friends & VIP Only (Unknown callers go to Voicemail)</option>
                <option value="closed">Closed (Reject all incoming calls)</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={dndManualState}
                  onChange={(e) => setDndManualState(e.target.checked)}
                  style={{ width: '20px', height: '20px', accentColor: 'var(--accent-cyan)' }}
                />
                <div>
                  <strong style={{ color: '#fff' }}>Enable Do Not Disturb Right Now</strong>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                    Directs incoming calls straight to your voicemail box.
                  </p>
                </div>
              </label>
            </div>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={dndRepeatedCallBreakthrough}
                  onChange={(e) => setDndRepeatedCallBreakthrough(e.target.checked)}
                  style={{ width: '20px', height: '20px', accentColor: 'var(--accent-cyan)' }}
                />
                <div>
                  <strong style={{ color: '#fff' }}>Repeated Call Breakthrough</strong>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                    Allow a caller who rings twice within 3 minutes to ring through DND for emergencies.
                  </p>
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleSaveAccountPreferences}
                disabled={savingAccount}
                className="btn btn-primary"
              >
                <Check size={16} /> {savingAccount ? 'Saving...' : 'Save Account Preferences'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. SERVICE DIRECTORY TAB */}
      {/* ========================================================================= */}
      {activeTab === 'services' && (
        <div className="glass-card">
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HelpCircle size={22} color="var(--accent-cyan)" /> Telephony Dial Codes & Service Lines
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            DecaTone provides authentic 3-digit service lines and in-call controls.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {[
              { code: '111', title: 'Ringback Line Test', desc: 'Dial 111, hang up the handset, and the switchboard rings your bells 5 seconds later to test mechanical operation.' },
              { code: '119 / 099', title: 'Audio Echo Loopback', desc: 'Speaks back your microphone audio in real-time with 350ms delay for acoustic calibration.' },
              { code: '411', title: 'Speaking Clock Service', desc: 'Announces official local system time with 1000Hz synchronization tone pip.' },
              { code: '567 / 300', title: 'Dial-Up Modem Simulator', desc: 'Plays authentic Bell 103 / V.34 dial-up modem screeching, carrier tones, and digital data sounds.' },
              { code: '711', title: 'Automated Weather Hotline', desc: 'Reads out live local meteorological weather conditions and forecast.' },
              { code: '0', title: 'Voicemail Inbox', desc: 'Dial 0 and pause 2 seconds to listen to and manage your encrypted voice messages.' }
            ].map(s => (
              <div key={s.code} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong style={{ color: '#fff', fontSize: '1.05rem' }}>{s.title}</strong>
                  <span className="badge badge-cyan" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                    {s.code}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Web Softphone Modal */}
      <WebPhoneModal isOpen={showWebPhone} onClose={() => setShowWebPhone(false)} />
    </div>
  );
};
