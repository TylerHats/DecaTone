import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Cpu,
  Mic,
  Activity,
  Sliders,
  Check,
  RotateCcw,
  PhoneForwarded,
  Upload,
  Play,
  Square,
  PhoneCall,
  Zap,
  HelpCircle,
  Moon,
  PlusCircle,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Lock,
  Download,
  UserCheck,
  Volume2,
  Smartphone,
  AlertTriangle,
  Key,
  Copy
} from 'lucide-react';
import { usePhone } from '../context/PhoneContext';
import { useAuth } from '../context/AuthContext';
import {
  generateRecoveryKey,
  getUnlockedKeyBundle,
  hasRawKeyInMemory,
  rewrapUserKeyBundleForPasswordChange,
  unlockPrivateKeyWithPassword,
  wrapBundle96WithRecoveryKey
} from '../services/e2eeCrypto';
import { copyToClipboard } from '../utils/clipboard';

function encodeMono16kWav(samples: Int16Array, sampleRate = 16000): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataByteLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }
  return buffer;
}

const WEEK_DAYS = [
  { id: '1', label: 'Mon' },
  { id: '2', label: 'Tue' },
  { id: '3', label: 'Wed' },
  { id: '4', label: 'Thu' },
  { id: '5', label: 'Fri' },
  { id: '6', label: 'Sat' },
  { id: '7', label: 'Sun' }
];

export const PhoneSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    phone,
    phones,
    selectedPhoneId,
    calibrationProgress,
    phonesNeedingPasswordSync,
    syncDeviceVmKeys,
    setWebPhoneModalOpen,
    selectPhone,
    updatePhoneSettings,
    testRingDevice,
    rebootDevice,
    claimPhoneByCode,
    unclaimDevice,
    fetchPhones
  } = usePhone();
  const { user, login, unlockE2ee, refreshUser, logout } = useAuth();

  const [activeTab, setActiveTab] = useState<'standard' | 'resonance' | 'diagnostics' | 'services' | 'account'>('standard');
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
  const [hookFlashEnabled, setHookFlashEnabled] = useState(true);
  const [intercomEnabled, setIntercomEnabled] = useState(true);
  const [callForwardingEnabled, setCallForwardingEnabled] = useState(false);
  const [forwardToNumber, setForwardToNumber] = useState('');
  const [otaAutoUpdateEnabled, setOtaAutoUpdateEnabled] = useState(true);
  const [otaUpdateTime, setOtaUpdateTime] = useState('03:00');
  const [otaUpdateChannel, setOtaUpdateChannel] = useState('stable');

  // Pairing State
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [newPhoneLabel, setNewPhoneLabel] = useState('Main Phone');
  const [claiming, setClaiming] = useState(false);

  // Account Preferences & DND State
  const [displayNameInput, setDisplayNameInput] = useState(user?.displayName || '');
  const [emailInput, setEmailInput] = useState(user?.email || '');
  const [notifyOnVoicemail, setNotifyOnVoicemail] = useState(Boolean(user?.notifyOnVoicemail ?? true));
  const [notifyOnMissedCall, setNotifyOnMissedCall] = useState(Boolean(user?.notifyOnMissedCall ?? true));
  const [callPrivacy, setCallPrivacy] = useState<string>(() => {
    const raw = user?.callPrivacy || 'everyone';
    return raw === 'open' || raw === 'anyone' ? 'everyone' : raw;
  });
  const [dndManualState, setDndManualState] = useState(Boolean(user?.dndManualState));
  const [dndScheduleEnabled, setDndScheduleEnabled] = useState(Boolean(user?.dndScheduleEnabled));
  const [dndScheduleStart, setDndScheduleStart] = useState(user?.dndScheduleStart || '22:00');
  const [dndScheduleEnd, setDndScheduleEnd] = useState(user?.dndScheduleEnd || '07:00');
  const [dndScheduleDays, setDndScheduleDays] = useState<string[]>(
    user?.dndScheduleDays ? user.dndScheduleDays.split(',').filter(Boolean) : ['1', '2', '3', '4', '5', '6', '7']
  );
  const [dndRepeatedCallBreakthrough, setDndRepeatedCallBreakthrough] = useState(
    user?.dndRepeatedCallBreakthrough !== undefined ? Boolean(user.dndRepeatedCallBreakthrough) : true
  );

  // Change Password, Recovery Key, Device Key Sync, Export & Delete Account State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [syncPasswordInput, setSyncPasswordInput] = useState('');
  const [syncingDeviceKey, setSyncingDeviceKey] = useState(false);
  const [recoveryPasswordInput, setRecoveryPasswordInput] = useState('');
  const [generatingRecovery, setGeneratingRecovery] = useState(false);
  const [newRecoveryKeyShown, setNewRecoveryKeyShown] = useState<string | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const recordingElapsedRef = useRef(0);

  // Voicemail Greeting State & Browser Mic Recorder
  const [greetingInfo, setGreetingInfo] = useState<{ hasCustomGreeting: boolean; updatedAt?: string } | null>(null);
  const [greetingFile, setGreetingFile] = useState<File | null>(null);
  const [uploadingGreeting, setUploadingGreeting] = useState(false);
  const [loadingGreetingAudio, setLoadingGreetingAudio] = useState(false);
  const [greetingPlayUrl, setGreetingPlayUrl] = useState<string | null>(null);
  const [isRecordingGreeting, setIsRecordingGreeting] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedGreetingBlob, setRecordedGreetingBlob] = useState<Blob | null>(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string | null>(null);

  const recStreamRef = useRef<MediaStream | null>(null);
  const recAudioCtxRef = useRef<AudioContext | null>(null);
  const recProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const recChunksRef = useRef<number[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const greetingPlayUrlRef = useRef<string | null>(null);
  const recordedPreviewUrlRef = useRef<string | null>(null);
  const sweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const stopRecordingResources = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (recProcessorRef.current) {
      try {
        recProcessorRef.current.disconnect();
      } catch {
        // Ignore
      }
      recProcessorRef.current.onaudioprocess = null;
      recProcessorRef.current = null;
    }
    if (recStreamRef.current) {
      recStreamRef.current.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
    }
    if (recAudioCtxRef.current) {
      recAudioCtxRef.current.close().catch(() => {});
      recAudioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopRecordingResources();
      if (sweepTimerRef.current) {
        clearTimeout(sweepTimerRef.current);
      }
      if (greetingPlayUrlRef.current) {
        URL.revokeObjectURL(greetingPlayUrlRef.current);
      }
      if (recordedPreviewUrlRef.current) {
        URL.revokeObjectURL(recordedPreviewUrlRef.current);
      }
    };
  }, [stopRecordingResources]);

  const fetchFirmwareInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/firmware/info');
      if (res.ok) {
        const data = await res.json();
        setFirmwareInfo(data);
      }
    } catch {
      // Ignore
    }
  }, []);

  const fetchGreeting = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/voicemail/greeting', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setGreetingInfo(data);
      }
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    void fetchFirmwareInfo();
    void fetchGreeting();
  }, [fetchFirmwareInfo, fetchGreeting]);

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
      setHookFlashEnabled(phone.hookFlashEnabled !== false);
      setIntercomEnabled(phone.intercomEnabled !== false);
      setCallForwardingEnabled(Boolean(phone.callForwardingEnabled ?? phone.callForwardEnabled ?? false));
      setForwardToNumber(phone.forwardToNumber ?? phone.callForwardNumber ?? '');
      setOtaAutoUpdateEnabled(phone.otaAutoUpdateEnabled !== false);
      setOtaUpdateTime(phone.otaUpdateTime || '03:00');
      setOtaUpdateChannel(phone.otaUpdateChannel || 'stable');
    }
  }, [phone]);

  useEffect(() => {
    if (user) {
      setDisplayNameInput(user.displayName || user.username || '');
      setEmailInput(user.email || '');
      setNotifyOnVoicemail(user.notifyOnVoicemail !== undefined ? Boolean(user.notifyOnVoicemail) : true);
      setNotifyOnMissedCall(user.notifyOnMissedCall !== undefined ? Boolean(user.notifyOnMissedCall) : true);
      const rawPrivacy = user.callPrivacy || 'everyone';
      setCallPrivacy(rawPrivacy === 'open' || rawPrivacy === 'anyone' ? 'everyone' : rawPrivacy);
      setDndManualState(Boolean(user.dndManualState));
      setDndScheduleEnabled(Boolean(user.dndScheduleEnabled));
      setDndScheduleDays(
        user.dndScheduleDays ? user.dndScheduleDays.split(',').filter(Boolean) : ['1', '2', '3', '4', '5', '6', '7']
      );
      setDndScheduleStart(user.dndScheduleStart || '22:00');
      setDndScheduleEnd(user.dndScheduleEnd || '07:00');
      setDndRepeatedCallBreakthrough(
        user.dndRepeatedCallBreakthrough !== undefined ? Boolean(user.dndRepeatedCallBreakthrough) : true
      );
    }
  }, [user]);

  const fetchDiagnostics = useCallback(async () => {
    if (!phone) return;
    setLoadingDiagnostics(true);
    try {
      const targetId = phone.id ?? phone.deviceId;
      const res = await fetch(`/api/phone/${encodeURIComponent(String(targetId))}/diagnostics`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setDiagnosticsData(data.diagnostics || data);
      } else {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', text: err.error || 'Failed to load hardware diagnostics' });
      }
    } catch {
      setToast({ type: 'error', text: 'Failed to contact server for diagnostics' });
    } finally {
      setLoadingDiagnostics(false);
    }
  }, [phone]);

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      void fetchDiagnostics();
    }
  }, [activeTab, fetchDiagnostics]);

  const handleSaveSettings = async () => {
    if (!phone) return;
    setSaving(true);
    setToast(null);
    try {
      const ok = await updatePhoneSettings(phone.deviceId, {
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
        hookFlashEnabled,
        intercomEnabled,
        callForwardingEnabled,
        callForwardEnabled: callForwardingEnabled,
        forwardToNumber: forwardToNumber.trim(),
        callForwardNumber: forwardToNumber.trim(),
        otaAutoUpdateEnabled,
        otaUpdateTime,
        otaUpdateChannel
      });
      if (!ok) {
        throw new Error('Failed to save telephone settings. Please verify your connection and try again.');
      }
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
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          displayName: displayNameInput.trim(),
          email: emailInput.trim() || null,
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update account preferences');

      await refreshUser();
      setToast({ type: 'success', text: 'Account profile, notifications & Do Not Disturb rules updated!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save account settings' });
    } finally {
      setSavingAccount(false);
    }
  };

  const toggleDndDay = (dayId: string) => {
    setDndScheduleDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId].sort()
    );
  };

  // Voicemail Greeting Handlers
  const startBrowserGreetingRecording = async () => {
    setToast(null);
    stopRecordingResources();
    recChunksRef.current = [];
    setRecordingSeconds(0);
    setRecordedGreetingBlob(null);
    if (recordedPreviewUrlRef.current) {
      URL.revokeObjectURL(recordedPreviewUrlRef.current);
      recordedPreviewUrlRef.current = null;
      setRecordedPreviewUrl(null);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      recStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      recAudioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3600;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      recProcessorRef.current = processor;

      const ratio = ctx.sampleRate / 16000;
      let phase = 0;

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        while (phase < input.length) {
          const idx = Math.floor(phase);
          const s = Math.max(-1, Math.min(1, input[idx] || 0));
          recChunksRef.current.push(s < 0 ? Math.round(s * 32768) : Math.round(s * 32767));
          phase += ratio;
        }
        phase -= input.length;
      };

      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;

      source.connect(lowpass);
      lowpass.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(ctx.destination);

      recordingElapsedRef.current = 0;
      setIsRecordingGreeting(true);
      recTimerRef.current = setInterval(() => {
        recordingElapsedRef.current += 1;
        setRecordingSeconds(recordingElapsedRef.current);
        if (recordingElapsedRef.current >= 60) {
          finishBrowserGreetingRecording();
        }
      }, 1000);
    } catch {
      stopRecordingResources();
      setToast({
        type: 'error',
        text: 'Microphone access denied or unavailable. Check browser microphone permissions.'
      });
    }
  };

  const finishBrowserGreetingRecording = () => {
    stopRecordingResources();
    setIsRecordingGreeting(false);

    if (recChunksRef.current.length < 1600) {
      setToast({ type: 'error', text: 'Recording was too short. Please record at least 1 second.' });
      return;
    }

    const pcm = new Int16Array(recChunksRef.current);
    const wavBuf = encodeMono16kWav(pcm, 16000);
    const blob = new Blob([wavBuf], { type: 'audio/wav' });
    setRecordedGreetingBlob(blob);

    if (recordedPreviewUrlRef.current) {
      URL.revokeObjectURL(recordedPreviewUrlRef.current);
    }
    const url = URL.createObjectURL(blob);
    recordedPreviewUrlRef.current = url;
    setRecordedPreviewUrl(url);
  };

  const uploadGreetingBlob = async (blobOrFile: Blob | File, filename = 'greeting.wav') => {
    setUploadingGreeting(true);
    setToast(null);
    try {
      const formData = new FormData();
      formData.append('audio', blobOrFile, filename);
      const res = await fetch('/api/voicemail/greeting/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to upload custom greeting');

      setGreetingFile(null);
      setRecordedGreetingBlob(null);
      if (greetingPlayUrlRef.current) {
        URL.revokeObjectURL(greetingPlayUrlRef.current);
        greetingPlayUrlRef.current = null;
        setGreetingPlayUrl(null);
      }
      await fetchGreeting();
      setToast({ type: 'success', text: 'Custom voicemail greeting uploaded and active!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to upload greeting' });
    } finally {
      setUploadingGreeting(false);
    }
  };

  const handlePlayCurrentGreeting = async () => {
    setLoadingGreetingAudio(true);
    setToast(null);
    try {
      const res = await fetch('/api/voicemail/greeting/audio', {
        credentials: 'include'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No custom greeting audio available');
      }
      const blob = await res.blob();
      if (greetingPlayUrlRef.current) {
        URL.revokeObjectURL(greetingPlayUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      greetingPlayUrlRef.current = url;
      setGreetingPlayUrl(url);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Could not play greeting' });
    } finally {
      setLoadingGreetingAudio(false);
    }
  };

  const handleResetGreeting = async () => {
    if (!window.confirm('Revert your voicemail greeting back to the automated switchboard default?')) return;
    setUploadingGreeting(true);
    setToast(null);
    try {
      const res = await fetch('/api/voicemail/greeting/reset', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to reset greeting');

      if (greetingPlayUrlRef.current) {
        URL.revokeObjectURL(greetingPlayUrlRef.current);
        greetingPlayUrlRef.current = null;
        setGreetingPlayUrl(null);
      }
      await fetchGreeting();
      setToast({ type: 'success', text: 'Voicemail greeting reset to system default.' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to reset greeting' });
    } finally {
      setUploadingGreeting(false);
    }
  };

  // Change Password (with E2EE Private Key Re-Wrapping)
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setToast({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setToast({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    setChangingPassword(true);
    setToast(null);
    try {
      const rewrapped = await rewrapUserKeyBundleForPasswordChange(
        currentPassword,
        newPassword,
        user?.keySalt,
        user?.encryptedPrivateKey
      );

      const res = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          encryptionPublicKey: rewrapped.encryptionPublicKey,
          encryptedPrivateKey: rewrapped.encryptedPrivateKey,
          keySalt: rewrapped.keySalt
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to change password');
      }

      if (user) {
        login(null, {
          ...user,
          keySalt: data.keySalt ?? rewrapped.keySalt,
          encryptionPublicKey: data.encryptionPublicKey ?? rewrapped.encryptionPublicKey,
          encryptedPrivateKey: data.encryptedPrivateKey ?? rewrapped.encryptedPrivateKey
        });
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      await refreshUser();
      setToast({
        type: 'success',
        text: 'Password updated and your Zero-Access E2EE key bundle was safely re-wrapped!'
      });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to change password' });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleGenerateRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingRecovery(true);
    setToast(null);
    try {
      let bundle96 = getUnlockedKeyBundle();
      if (!bundle96) {
        if (!recoveryPasswordInput) {
          throw new Error('Enter your current password to unlock your key bundle before generating a Recovery Key.');
        }
        if (!user?.keySalt || !user?.encryptedPrivateKey) {
          throw new Error('No encrypted vault key found on account.');
        }
        bundle96 = await unlockPrivateKeyWithPassword(
          recoveryPasswordInput,
          user.keySalt,
          user.encryptedPrivateKey
        );
      }

      const recoveryKey = generateRecoveryKey();
      const recWrapped = await wrapBundle96WithRecoveryKey(bundle96, recoveryKey);
      const res = await fetch('/api/auth/recovery-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(recWrapped)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save Recovery Key');
      }
      setRecoveryPasswordInput('');
      setNewRecoveryKeyShown(recoveryKey);
      await refreshUser();
      setToast({ type: 'success', text: 'New Zero-Access Recovery Key saved! Store it safely offline.' });
    } catch (err: any) {
      setToast({ type: 'error', text: err?.message || 'Failed to generate Recovery Key' });
    } finally {
      setGeneratingRecovery(false);
    }
  };

  const handleUnlockAndSyncDevices = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!syncPasswordInput) return;
    setSyncingDeviceKey(true);
    setToast(null);
    try {
      await unlockE2ee(syncPasswordInput);
      await syncDeviceVmKeys();
      setSyncPasswordInput('');
      setToast({ type: 'success', text: 'Wrapped Zero-Access voicemail key synced to your hardware telephone!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err?.message || 'Failed to unwrap vault key' });
    } finally {
      setSyncingDeviceKey(false);
    }
  };

  // Export Account Data (JSON)
  const handleExportMyData = async () => {
    setExportingData(true);
    setToast(null);
    try {
      const res = await fetch('/api/auth/export-data', { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to export account data');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `decatone-export-${user?.username || 'account'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast({ type: 'success', text: 'Account data archive downloaded.' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Export failed' });
    } finally {
      setExportingData(false);
    }
  };

  // Self-Service Account Deletion
  const handleDeleteMyAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletePassword) return;
    if (
      !window.confirm(
        'PERMANENT ACTION: Delete your DecaTone account, extension, call logs, and encrypted voicemails? This cannot be undone.'
      )
    ) {
      return;
    }

    setDeletingAccount(true);
    setToast(null);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: deletePassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Account deletion failed');
      }
      await logout();
      navigate('/login');
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to delete account' });
    } finally {
      setDeletingAccount(false);
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          deviceId: phone.deviceId,
          frequencyHz: freqToTest,
          durationMs: 3000
        })
      });
      if (res.ok) {
        setToast({ type: 'success', text: `Resonance test ring sent at ${freqToTest.toFixed(1)} Hz (3 seconds)` });
      } else {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', text: err.error || 'Failed to trigger resonance test ring' });
      }
    } catch {
      setToast({ type: 'error', text: 'Network error triggering test ring' });
    }
    if (sweepTimerRef.current) clearTimeout(sweepTimerRef.current);
    sweepTimerRef.current = setTimeout(() => setSweepActive(false), 3200);
  };

  const handleRunResonanceWizard = async () => {
    if (!phone) return;
    setWizardRunning(true);
    setWizardProgress({ freq: 15.0, percent: 0 });
    setWizardResult(null);
    setToast(null);

    try {
      const targetId = phone.id ?? phone.deviceId;
      const res = await fetch(`/api/phone/${encodeURIComponent(String(targetId))}/calibrate-resonance-wizard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ deviceId: phone.deviceId })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Resonance sweep failed');

      setWizardResult(data.result);
      if (data.result?.peakFrequency) {
        setBellFrequencyHz(data.result.peakFrequency);
        setSweepFreq(data.result.peakFrequency);
      }
      setToast({ type: 'success', text: data.message || 'Bell resonance calibrated!' });
      await fetchPhones();
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Calibration sweep failed' });
    } finally {
      setWizardRunning(false);
    }
  };

  const handleManualOtaUpdate = async () => {
    if (!phone) return;
    if (
      !window.confirm(
        `Push firmware update v${firmwareInfo?.version || 'latest'} to '${phoneLabel}'? The adapter will flash and reboot automatically.`
      )
    ) {
      return;
    }

    setUpdatingOta(true);
    setToast(null);
    try {
      const res = await fetch(`/api/phone/ota-update/${encodeURIComponent(phone.deviceId)}`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'OTA firmware update command sent! Flashing telephone...' });
      } else {
        setToast({ type: 'error', text: data.error || 'OTA trigger failed (verify phone is online)' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'OTA request failed' });
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
      const success = await claimPhoneByCode(pairingCodeInput.trim(), newPhoneLabel.trim() || 'Main Phone');
      if (success) {
        setToast({ type: 'success', text: 'Telephone successfully paired and synced with your E2EE voicemail key!' });
        setShowPairingModal(false);
        setPairingCodeInput('');
        setNewPhoneLabel('Main Phone');
        await fetchPhones();
      } else {
        setToast({
          type: 'error',
          text: 'Invalid or expired pairing code. Check the code announced or shown on your telephone adapter.'
        });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to pair telephone' });
    } finally {
      setClaiming(false);
    }
  };

  const handleUnclaim = async () => {
    if (!phone) return;
    if (
      !window.confirm(
        `Unpair '${phoneLabel}' from your account? You can re-pair it at any time with its pairing code.`
      )
    ) {
      return;
    }

    try {
      const ok = await unclaimDevice(phone.deviceId);
      if (ok) {
        setToast({ type: 'success', text: 'Telephone unpaired from your account.' });
        await fetchPhones();
      } else {
        setToast({ type: 'error', text: 'Failed to unpair telephone.' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to unpair telephone' });
    }
  };

  const handleReboot = async () => {
    if (!phone) return;
    try {
      const ok = await rebootDevice(phone.deviceId);
      if (ok) {
        setToast({ type: 'success', text: 'Reboot command sent to telephone.' });
      } else {
        setToast({ type: 'error', text: 'Failed to reboot telephone (check if device is online).' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to reboot telephone' });
    }
  };

  const handleTestRing = async () => {
    if (!phone) return;
    setRinging(true);
    setToast(null);
    try {
      const ok = await testRingDevice(
        phone.deviceId,
        ringStyle,
        ringStyle === 'custom' ? ringCadenceCustom : undefined
      );
      if (ok) {
        setToast({ type: 'success', text: 'Test ring signal sent to telephone!' });
      } else {
        setToast({ type: 'error', text: 'Failed to ring telephone (check if device is online).' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Test ring failed' });
    } finally {
      setTimeout(() => setRinging(false), 2000);
    }
  };

  const activeCalibrationProgress =
    calibrationProgress && (!calibrationProgress.deviceId || calibrationProgress.deviceId === phone?.deviceId)
      ? calibrationProgress
      : wizardProgress;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
      {/* Page Header */}
      <div className="glass-card highlight-cyan" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Telephone & Account Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Configure bell ringer resonance, audio DSP filters, line features, voicemail greetings, and account security.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={() => setWebPhoneModalOpen(true)} className="btn btn-primary btn-sm">
            <PhoneCall size={16} /> Web Softphone
          </button>
        </div>
      </div>

      {phonesNeedingPasswordSync && (
        <form
          onSubmit={handleUnlockAndSyncDevices}
          className="glass-card highlight-amber"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '1rem 1.25rem' }}
        >
          <div style={{ fontSize: '0.86rem', color: '#fde68a', maxWidth: '520px' }}>
            <strong style={{ color: '#fff' }}>Sync Voicemail Key to Hardware Phone:</strong> Enter your password once to wrap and authorize your paired ESP32-S3 phone for Dial-0 encrypted voicemail playback.
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="password"
              className="form-input"
              placeholder="Account password"
              value={syncPasswordInput}
              onChange={(e) => setSyncPasswordInput(e.target.value)}
              style={{ width: '190px' }}
              required
            />
            <button type="submit" disabled={syncingDeviceKey} className="btn btn-amber btn-sm">
              {syncingDeviceKey ? 'Syncing...' : 'Authorize Hardware Phone'}
            </button>
          </div>
        </form>
      )}

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
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
        {[
          { id: 'standard', label: 'Telephone Configuration', icon: Sliders },
          { id: 'resonance', label: 'Bell Resonance Tuning', icon: Zap },
          { id: 'diagnostics', label: 'Hardware Diagnostics', icon: Activity },
          { id: 'account', label: 'Account, Voicemail & DND', icon: Moon },
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
            Enter the pairing code displayed on your telephone's web interface or announced through the handset (e.g.{' '}
            <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>TONE-4821</strong> or{' '}
            <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>4821</strong>).
          </p>

          <form onSubmit={handlePairByCode} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 200px' }}>
              <label className="form-label">Pairing Code</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. TONE-4821"
                value={pairingCodeInput}
                onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', textAlign: 'center', letterSpacing: '0.08em' }}
                required
                autoFocus
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 200px' }}>
              <label className="form-label">Room / Label</label>
              <input
                type="text"
                className="form-input"
                placeholder="Main Phone"
                value={newPhoneLabel}
                onChange={(e) => setNewPhoneLabel(e.target.value)}
              />
            </div>

            <button type="submit" disabled={claiming || !pairingCodeInput.trim()} className="btn btn-amber" style={{ whiteSpace: 'nowrap', height: '42px' }}>
              <Check size={16} /> {claiming ? 'Pairing...' : 'Claim Telephone'}
            </button>
          </form>
        </div>
      )}

      {/* Empty state if hardware tab selected without a paired phone */}
      {(activeTab === 'standard' || activeTab === 'resonance' || activeTab === 'diagnostics') && !phone && (
        <div className="glass-card" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <Smartphone size={36} color="var(--accent-amber)" style={{ marginBottom: '0.75rem' }} />
          <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No Physical Rotary Phone Paired</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto 1.25rem' }}>
            Pair an ESP32-S3 telephone adapter using the button above to configure mechanical bell resonance, audio profiles, and hardware diagnostics, or use the Web Softphone right away.
          </p>
          <button onClick={() => setShowPairingModal(true)} className="btn btn-amber btn-sm">
            <PlusCircle size={15} /> Pair a Telephone Adapter
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. STANDARD CONFIGURATION TAB */}
      {/* ========================================================================= */}
      {activeTab === 'standard' && phone && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Primary Audio & Ringer Card */}
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
                      Uncheck to keep this phone silent while other household extensions ring.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Audio Profile & Hardware Model */}
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

            {/* Volume, Mic & Sidetone Sliders */}
            <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Earpiece Volume ({earpieceVolume}%)</label>
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
                <label className="form-label">Mic Sensitivity ({micSensitivity}%)</label>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={micSensitivity}
                  onChange={(e) => setMicSensitivity(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Sidetone Feedback ({sidetoneLevel}%)</label>
                <input
                  type="range"
                  min="0"
                  max="30"
                  value={sidetoneLevel}
                  onChange={(e) => setSidetoneLevel(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Ring Cadence Style & Ring Timeout */}
            <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">Default Bell Ring Cadence</label>
                <select
                  className="form-select"
                  value={ringStyle}
                  onChange={(e) => setRingStyle(e.target.value)}
                >
                  <option value="traditional">Traditional US (2s ON, 4s OFF)</option>
                  <option value="european">UK / GPO Double-Ring (400ms, 200ms, 400ms, 2s)</option>
                  <option value="pulse">Short Pulse Chirp (500ms ON, 1.5s OFF)</option>
                  <option value="continuous">Urgent Continuous Ring</option>
                  <option value="custom">Custom Millisecond Pattern</option>
                </select>
                {ringStyle === 'custom' && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <label className="form-label" style={{ fontSize: '0.78rem' }}>
                      Custom Cadence Pattern (comma-separated ON,OFF ms)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={ringCadenceCustom}
                      onChange={(e) => setRingCadenceCustom(e.target.value)}
                      placeholder="2000,4000"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">No-Answer Voicemail Timeout ({ringTimeoutSec}s)</label>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={ringTimeoutSec}
                  onChange={(e) => setRingTimeoutSec(parseInt(e.target.value, 10))}
                  style={{ width: '100%', marginTop: '0.5rem' }}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  Unanswered calls forward to Zero-Access Voicemail after {ringTimeoutSec} seconds.
                </span>
              </div>
            </div>

            {/* Quick Hardware Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                Device ID: <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>{phone.deviceId}</strong> &bull; Status:{' '}
                <span style={{ color: phone.isOnline ? '#34d399' : '#f43f5e', fontWeight: 600 }}>
                  {phone.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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

          {/* Line Features: Hook-Flash, Intercom & Call Forwarding */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PhoneForwarded size={18} color="var(--accent-amber)" /> Switchboard Line Features & Call Forwarding
            </h3>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={hookFlashEnabled}
                  onChange={(e) => setHookFlashEnabled(e.target.checked)}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--accent-cyan)' }}
                />
                <div>
                  <strong style={{ color: '#fff', fontSize: '0.92rem' }}>Enable Cradle Hook-Flash</strong>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '0.15rem 0 0' }}>
                    Tap the cradle switch briefly (120–750ms) during a call for Call Waiting, Call Park, or 3-Way Conferencing.
                  </p>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={intercomEnabled}
                  onChange={(e) => setIntercomEnabled(e.target.checked)}
                  style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--accent-cyan)' }}
                />
                <div>
                  <strong style={{ color: '#fff', fontSize: '0.92rem' }}>Household Intercom (Dial 00)</strong>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '0.15rem 0 0' }}>
                    Include this telephone when another room in your account dials 00 for internal intercom paging.
                  </p>
                </div>
              </label>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
              <div className="grid-2" style={{ alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={callForwardingEnabled}
                    onChange={(e) => setCallForwardingEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--accent-amber)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff', fontSize: '0.92rem' }}>Unconditional Call Forwarding (072 / 073)</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '0.15rem 0 0' }}>
                      Redirect all incoming calls to another extension. Can also be toggled by dialing 072 / 073.
                    </p>
                  </div>
                </label>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Forward-To Extension Number</label>
                  <input
                    type="text"
                    className="form-input"
                    value={forwardToNumber}
                    onChange={(e) => setForwardToNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 102"
                    disabled={!callForwardingEnabled}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Per-Phone Firmware OTA Card */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Cpu size={18} color="var(--accent-cyan)" /> Adapter Firmware & Over-The-Air (OTA) Updates
                </h3>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', margin: '0.2rem 0 0' }}>
                  Installed: <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>v{phone.firmwareVersion || '1.0.0'}</strong>
                  {' '}&bull; Server Latest:{' '}
                  <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                    v{firmwareInfo?.version || '1.2.2'}
                  </strong>
                </p>
              </div>

              <button
                type="button"
                onClick={handleManualOtaUpdate}
                disabled={updatingOta || !phone.isOnline}
                className="btn btn-amber btn-sm"
              >
                <Upload size={14} /> {updatingOta ? 'Flashing OTA...' : 'Flash OTA Update Now'}
              </button>
            </div>

            <div className="grid-3">
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={otaAutoUpdateEnabled}
                    onChange={(e) => setOtaAutoUpdateEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <span style={{ fontSize: '0.88rem', color: '#fff', fontWeight: 600 }}>Automatic Nightly OTA</span>
                </label>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Preferred Update Window</label>
                <input
                  type="time"
                  className="form-input"
                  value={otaUpdateTime}
                  onChange={(e) => setOtaUpdateTime(e.target.value)}
                  disabled={!otaAutoUpdateEnabled}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Firmware Release Channel</label>
                <select
                  className="form-select"
                  value={otaUpdateChannel}
                  onChange={(e) => setOtaUpdateChannel(e.target.value)}
                >
                  <option value="stable">Stable</option>
                  <option value="beta">Beta</option>
                  <option value="alpha">Alpha</option>
                </select>
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
          <div className="glass-card highlight-amber" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                  <Zap size={22} /> Automated Acoustic Resonance Calibration Wizard
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                  The switchboard sweeps your bells across 15Hz – 35Hz, measures acoustic microphone energy, and tunes your H-bridge driver to peak mechanical resonance.
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

            <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <AlertCircle size={22} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.9rem', color: '#fef08a' }}>
                <strong>Important Before Running:</strong> Set the physical mechanical bell loudness lever underneath your telephone to <strong>MAXIMUM (LOUD)</strong> and place the handset microphone directly beside the brass bells.
              </div>
            </div>

            {wizardRunning ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ fontSize: '1.2rem', color: '#fbbf24', fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Zap size={20} className="spin" />
                  Calibrating Bell Resonance: {(activeCalibrationProgress?.freq ?? 20.0).toFixed(1)} Hz ({Math.round(activeCalibrationProgress?.percent ?? 0)}%)
                </div>
                <div style={{ width: '100%', height: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden', maxWidth: '420px', margin: '0 auto' }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(5, activeCalibrationProgress?.percent ?? 5))}%`,
                      height: '100%',
                      background: 'var(--accent-amber)',
                      transition: 'width 0.25s ease'
                    }}
                  />
                </div>
                <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  Sampling handset microphone acoustic energy across frequency steps...
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

          {/* Preset Badges & Fine Slider */}
          <div className="glass-card">
            <h4 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: '#fff' }}>
              Manual Resonance Presets & Frequency Slider
            </h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Click any standard preset below to select and test it, or fine-tune using the 0.5 Hz slider.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                { freq: 20.0, label: '20.0 Hz (US Standard)', desc: 'Western Electric 500 / 2500 C4A' },
                { freq: 16.6, label: '16.6 Hz (Party Line)', desc: 'Rural & harmonic party bells' },
                { freq: 25.0, label: '25.0 Hz (UK / GPO)', desc: 'British GPO 746 double bells' },
                { freq: 30.0, label: '30.0 Hz (Kellogg High)', desc: 'Harmonic frequency ringers' },
                { freq: 33.3, label: '33.3 Hz (Harmonic Mid)', desc: 'Harmonic tuned bells' }
              ].map((preset) => {
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
                        void handleSweepTest(preset.freq);
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

            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: 600, color: '#fff' }}>Fine-Tuning Frequency Slider (15.0 Hz – 35.0 Hz)</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', color: 'var(--accent-amber)', fontWeight: 700 }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => void handleSweepTest(bellFrequencyHz)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Activity size={22} color="var(--accent-cyan)" /> Live Hardware Diagnostics & Board Telemetry
              </h3>
              <button onClick={() => void fetchDiagnostics()} disabled={loadingDiagnostics} className="btn btn-secondary btn-sm">
                <RotateCcw size={14} className={loadingDiagnostics ? 'spin' : ''} /> Refresh Metrics
              </button>
            </div>

            {diagnosticsData ? (
              <div className="grid-2" style={{ gap: '1rem' }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Rotary Governor Health</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#34d399', marginTop: '0.25rem' }}>
                    {diagnosticsData.rotaryGovernorSpeed || '10.0 PPS (Nominal)'}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    Pulse Break Ratio: {diagnosticsData.rotaryBreakRatio || '60% / 40%'}
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>WiFi Signal Strength (RSSI)</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#38bdf8', marginTop: '0.25rem' }}>
                    {diagnosticsData.rssi ?? phone.rssi ?? -55} dBm
                    {diagnosticsData.wifiQualityPercent !== undefined ? ` (${diagnosticsData.wifiQualityPercent}%)` : ''}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    IP Address: {diagnosticsData.ipAddress || phone.ipAddress || '---'}
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Audio Circuit Health</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>
                    {diagnosticsData.audioNoiseFloor || '-68 dBFS (Clean)'}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    Mic Gain: {diagnosticsData.adcMicGain ?? `${micSensitivity}%`} &bull; Output Level: {diagnosticsData.dacOutputLevel ?? `${earpieceVolume}%`}
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Bell Ringer Circuit</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-amber)', marginTop: '0.25rem' }}>
                    {Number(diagnosticsData.bellFrequencyHz ?? bellFrequencyHz).toFixed(1)} Hz Coil Tuning
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                    Driver: Solid-State MOSFET H-Bridge
                  </p>
                </div>

                {(diagnosticsData.freeHeap !== undefined || diagnosticsData.freePsram !== undefined || diagnosticsData.uptimeSec !== undefined) && (
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>ESP32-S3 Memory & Core Runtime</span>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '0.4rem', fontSize: '0.92rem' }}>
                      {diagnosticsData.freeHeap !== undefined && (
                        <div>
                          Free SRAM Heap:{' '}
                          <strong style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                            {(Number(diagnosticsData.freeHeap) / 1024).toFixed(1)} KB
                          </strong>
                        </div>
                      )}
                      {diagnosticsData.freePsram !== undefined && (
                        <div>
                          Free Octal PSRAM:{' '}
                          <strong style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                            {(Number(diagnosticsData.freePsram) / 1024).toFixed(1)} KB
                          </strong>
                        </div>
                      )}
                      {diagnosticsData.uptimeSec !== undefined && (
                        <div>
                          Adapter Uptime:{' '}
                          <strong style={{ color: '#fff', fontFamily: 'var(--font-mono)' }}>
                            {Math.floor(Number(diagnosticsData.uptimeSec) / 60)}m {Number(diagnosticsData.uptimeSec) % 60}s
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
      {/* 4. ACCOUNT, VOICEMAIL GREETING & DO NOT DISTURB TAB */}
      {/* ========================================================================= */}
      {activeTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Custom Voicemail Greeting Card */}
          <div className="glass-card highlight-amber">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Volume2 size={20} color="var(--accent-amber)" /> Voicemail Greeting Announcement
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                  Record a personal greeting using your browser microphone (16kHz 16-bit mono WAV) or upload a pre-recorded `.wav` file.
                </p>
              </div>

              <span className={`badge ${greetingInfo?.hasCustomGreeting ? 'badge-online' : 'badge-cyan'}`}>
                {greetingInfo?.hasCustomGreeting ? 'Custom Greeting Active' : 'System Default Greeting'}
              </span>
            </div>

            {/* Play or Reset Current Greeting */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={handlePlayCurrentGreeting}
                disabled={loadingGreetingAudio || !greetingInfo?.hasCustomGreeting}
                title={greetingInfo?.hasCustomGreeting ? 'Play uploaded voicemail greeting' : 'Upload or record a custom greeting first'}
                className="btn btn-secondary btn-sm"
              >
                <Play size={14} /> {loadingGreetingAudio ? 'Loading Audio...' : 'Play Custom Greeting'}
              </button>

              {greetingInfo?.hasCustomGreeting && (
                <button
                  type="button"
                  onClick={handleResetGreeting}
                  disabled={uploadingGreeting}
                  className="btn btn-danger btn-sm"
                >
                  <RotateCcw size={14} /> Reset to Default
                </button>
              )}

              {greetingPlayUrl && (
                <audio controls src={greetingPlayUrl} style={{ height: '34px', maxWidth: '300px' }} />
              )}
            </div>

            {/* Record in Browser vs Upload WAV */}
            <div className="grid-2" style={{ gap: '1rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
                <strong style={{ display: 'block', color: '#fff', fontSize: '0.92rem', marginBottom: '0.5rem' }}>
                  Record Greeting in Browser
                </strong>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {!isRecordingGreeting ? (
                    <button type="button" onClick={startBrowserGreetingRecording} className="btn btn-amber btn-sm">
                      <Mic size={14} /> Record Microphone
                    </button>
                  ) : (
                    <button type="button" onClick={finishBrowserGreetingRecording} className="btn btn-danger btn-sm">
                      <Square size={14} /> Stop ({recordingSeconds}s / 60s)
                    </button>
                  )}

                  {recordedGreetingBlob && !isRecordingGreeting && (
                    <button
                      type="button"
                      onClick={() => void uploadGreetingBlob(recordedGreetingBlob, 'recorded-greeting.wav')}
                      disabled={uploadingGreeting}
                      className="btn btn-primary btn-sm"
                    >
                      <Upload size={14} /> {uploadingGreeting ? 'Saving...' : 'Save Recorded Greeting'}
                    </button>
                  )}
                </div>

                {recordedPreviewUrl && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <audio controls src={recordedPreviewUrl} style={{ width: '100%', height: '34px' }} />
                  </div>
                )}
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
                <strong style={{ display: 'block', color: '#fff', fontSize: '0.92rem', marginBottom: '0.5rem' }}>
                  Upload `.wav` Audio File
                </strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <input
                    type="file"
                    accept=".wav,audio/wav,audio/x-wav"
                    onChange={(e) => setGreetingFile(e.target.files?.[0] || null)}
                    style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}
                  />
                  <div>
                    <button
                      type="button"
                      disabled={!greetingFile || uploadingGreeting}
                      onClick={() => greetingFile && void uploadGreetingBlob(greetingFile, greetingFile.name)}
                      className="btn btn-secondary btn-sm"
                    >
                      <Upload size={14} /> {uploadingGreeting ? 'Uploading...' : 'Upload WAV Greeting'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Profile, Email Alerts & Do Not Disturb Card */}
          <div className="glass-card">
            <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserCheck size={20} color="var(--accent-cyan)" /> Account Profile, Notifications & Do Not Disturb
            </h3>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Caller ID Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  placeholder="Your display name"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address (Recovery & Alerts)</label>
                <input
                  type="email"
                  className="form-input"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={notifyOnVoicemail}
                  onChange={(e) => setNotifyOnVoicemail(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                />
                <span style={{ fontSize: '0.9rem', color: '#fff' }}>Email alert on new voicemail</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={notifyOnMissedCall}
                  onChange={(e) => setNotifyOnMissedCall(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                />
                <span style={{ fontSize: '0.9rem', color: '#fff' }}>Email alert on missed calls</span>
              </label>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem', marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Incoming Call Privacy</label>
                <select
                  className="form-select"
                  value={callPrivacy}
                  onChange={(e) => setCallPrivacy(e.target.value)}
                >
                  <option value="everyone">Anyone (All extensions on this switchboard can ring you)</option>
                  <option value="friends_only">Friends &amp; VIP Only (Unknown callers go directly to Voicemail)</option>
                  <option value="closed">Closed / VIPs Only (Non-VIP calls go directly to Voicemail)</option>
                </select>
              </div>

              <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dndManualState}
                    onChange={(e) => setDndManualState(e.target.checked)}
                    style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff', fontSize: '0.92rem' }}>Enable Do Not Disturb Right Now (078 / 079)</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                      Silences mechanical bells and routes incoming calls straight to voicemail.
                    </p>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dndRepeatedCallBreakthrough}
                    onChange={(e) => setDndRepeatedCallBreakthrough(e.target.checked)}
                    style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff', fontSize: '0.92rem' }}>Repeated-Call Emergency Breakthrough</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                      Allows a caller dialing twice within 3 minutes to ring through DND.
                    </p>
                  </div>
                </label>
              </div>

              {/* Scheduled Quiet Hours */}
              <div style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', cursor: 'pointer', marginBottom: dndScheduleEnabled ? '1rem' : 0 }}>
                  <input
                    type="checkbox"
                    checked={dndScheduleEnabled}
                    onChange={(e) => setDndScheduleEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-amber)' }}
                  />
                  <strong style={{ color: '#fff', fontSize: '0.95rem' }}>Scheduled Quiet Hours (Automatic Nightly DND)</strong>
                </label>

                {dndScheduleEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                      <span className="form-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Active Days of Week</span>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {WEEK_DAYS.map((day) => {
                          const active = dndScheduleDays.includes(day.id);
                          return (
                            <button
                              key={day.id}
                              type="button"
                              onClick={() => toggleDndDay(day.id)}
                              className={`btn btn-sm ${active ? 'btn-amber' : 'btn-secondary'}`}
                              style={{ minWidth: '52px' }}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Quiet Hours Start</label>
                        <input
                          type="time"
                          className="form-input"
                          value={dndScheduleStart}
                          onChange={(e) => setDndScheduleStart(e.target.value)}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Quiet Hours End</label>
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
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleSaveAccountPreferences}
                disabled={savingAccount}
                className="btn btn-primary"
              >
                <Check size={16} /> {savingAccount ? 'Saving...' : 'Save Account & DND Preferences'}
              </button>
            </div>
          </div>

          {/* Change Password & E2EE Key Re-Wrap Card */}
          <form onSubmit={handleChangePassword} className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={18} color="var(--accent-cyan)" /> Change Password &amp; Re-Wrap Zero-Access Key
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Changing your password here automatically re-encrypts your P-256 private key locally so all existing Zero-Access voicemails remain playable.
            </p>

            <div className="grid-3" style={{ marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">New Password (min 8 chars)</label>
                <input
                  type="password"
                  className="form-input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={changingPassword || !currentPassword || !newPassword} className="btn btn-secondary btn-sm">
                <Lock size={14} /> {changingPassword ? 'Re-wrapping Key & Updating...' : 'Update Password'}
              </button>
            </div>
          </form>

          {/* Zero-Access Recovery Key Card */}
          <form onSubmit={handleGenerateRecoveryKey} className="glass-card highlight-amber">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <h3 style={{ fontSize: '1.15rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Key size={18} color="var(--accent-amber)" /> Zero-Access Vault Recovery Key
              </h3>
              <span className={`badge ${user?.hasRecoveryKey ? 'badge-online' : 'badge-amber'}`}>
                {user?.hasRecoveryKey ? 'Recovery Key Active' : 'Not Configured'}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Generate an offline backup key to restore encrypted voicemails if you ever forget your password and must use an email reset link.
            </p>

            {newRecoveryKeyShown && (
              <div style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(245, 158, 11, 0.45)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <code style={{ fontFamily: 'var(--font-mono)', color: '#fcd34d', fontWeight: 700, wordBreak: 'break-all' }}>
                  {newRecoveryKeyShown}
                </code>
                <button
                  type="button"
                  onClick={async () => {
                    if (await copyToClipboard(newRecoveryKeyShown)) {
                      setCopiedRecovery(true);
                      setTimeout(() => setCopiedRecovery(false), 2000);
                    }
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <Copy size={13} /> {copiedRecovery ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {!hasRawKeyInMemory() && (
                <input
                  type="password"
                  className="form-input"
                  placeholder="Enter password to authorize new key..."
                  value={recoveryPasswordInput}
                  onChange={(e) => setRecoveryPasswordInput(e.target.value)}
                  style={{ flex: '1 1 240px' }}
                  required
                />
              )}
              <button type="submit" disabled={generatingRecovery} className="btn btn-amber btn-sm">
                <Key size={14} /> {generatingRecovery ? 'Generating...' : user?.hasRecoveryKey ? 'Rotate Recovery Key' : 'Generate Recovery Key'}
              </button>
            </div>
          </form>

          {/* Data Portability & Danger Zone */}
          <div className="grid-2">
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <h4 style={{ fontSize: '1.05rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Download size={18} color="var(--accent-cyan)" /> Export My Account Data
                </h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', margin: 0 }}>
                  Download a portable JSON archive containing your profile, paired hardware metadata, speed dials, contacts, call history, and voicemail metadata.
                </p>
              </div>

              <div>
                <button type="button" onClick={handleExportMyData} disabled={exportingData} className="btn btn-secondary btn-sm">
                  <Download size={14} /> {exportingData ? 'Preparing Archive...' : 'Download My Data (.json)'}
                </button>
              </div>
            </div>

            <form
              onSubmit={handleDeleteMyAccount}
              className="glass-card"
              style={{ border: '1px solid rgba(244, 63, 94, 0.4)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' }}
            >
              <div>
                <h4 style={{ fontSize: '1.05rem', color: '#fda4af', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={18} color="#f43f5e" /> Delete My Account
                </h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginBottom: '0.75rem' }}>
                  Permanently erase your user profile, unpair your telephones, and delete all encrypted voicemails.
                </p>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Confirm your current password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  required
                />
              </div>

              <div>
                <button type="submit" disabled={deletingAccount || !deletePassword} className="btn btn-danger btn-sm">
                  <Trash2 size={14} /> {deletingAccount ? 'Deleting Account...' : 'Permanently Delete Account'}
                </button>
              </div>
            </form>
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
            DecaTone provides classic central-office test numbers, starless rotary codes, and automated voice services.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {[
              { code: '0', title: 'Zero-Access Voicemail Inbox', desc: 'Dial 0 and pause 2 seconds to unlock and listen to your ECIES encrypted voice messages.' },
              { code: '00', title: 'Household Intercom', desc: 'Rings all other telephones paired to your own account for room-to-room intercom calls.' },
              { code: '111', title: 'Ringback Line Test', desc: 'Dial 111, hang up the handset, and the switchboard rings your bells 5 seconds later.' },
              { code: '119 / 099', title: 'Audio Echo Loopback', desc: 'Speaks back your microphone audio in real-time with delay for acoustic calibration.' },
              { code: '411', title: 'Speaking Clock Service', desc: 'Announces official local system time with 1000Hz synchronization tone pip.' },
              { code: '567 / 300', title: 'Dial-Up Modem Simulator', desc: 'Plays Bell 103 / V.34 dial-up modem carrier handshakes and data modulation tones.' },
              { code: '611', title: 'Line & Extension Diagnostics', desc: 'Reads back your assigned extension number, line health, and paired device status.' },
              { code: '711', title: 'Automated Weather Hotline', desc: 'Reads out live local meteorological weather conditions and forecast.' },
              { code: '069', title: 'Last-Call Return', desc: 'Automatically dials back the last extension that rang your line.' },
              { code: '072 / 073', title: 'Call Forwarding Enable / Disable', desc: 'Dial 072 followed by an extension to enable forwarding, or 073 to cancel.' },
              { code: '078 / 079', title: 'Do Not Disturb Enable / Disable', desc: 'Dial 078 to enable Do Not Disturb, or 079 to resume normal bell ringing.' }
            ].map((s) => (
              <div key={s.code} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '0.5rem' }}>
                  <strong style={{ color: '#fff', fontSize: '1rem' }}>{s.title}</strong>
                  <span className="badge badge-cyan" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
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

    </div>
  );
};
