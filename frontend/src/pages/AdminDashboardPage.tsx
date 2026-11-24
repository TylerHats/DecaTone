import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Shield,
  Users,
  Cpu,
  Database,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  Key,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  BellRing,
  Smartphone,
  Globe,
  Mail,
  FileArchive,
  Clock,
  ExternalLink,
  HelpCircle,
  Sparkles,
  RotateCcw,
  Volume2,
  Hash,
  Radio,
  Play,
  ShieldCheck
} from 'lucide-react';
import { useBranding } from '../context/BrandingContext';
import { clearUnlockedKey, purgeLegacyStorageKeys } from '../services/e2eeCrypto';

export const AdminDashboardPage: React.FC = () => {
  const { refreshBranding } = useBranding();

  const [activeTab, setActiveTab] = useState<
    'metrics' | 'users' | 'fleet' | 'ota' | 'backups' | 'updates' | 'settings' | 'wipe'
  >('metrics');

  // Metrics
  const [metrics, setMetrics] = useState<any>(null);

  // Users
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<any | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [selectedUserForNumber, setSelectedUserForNumber] = useState<any | null>(null);
  const [newNumberInput, setNewNumberInput] = useState('');
  const [newAreaCodeInput, setNewAreaCodeInput] = useState('');

  // Fleet
  const [fleet, setFleet] = useState<any[]>([]);

  // OTA Firmware
  const [firmwareInfo, setFirmwareInfo] = useState<any>(null);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [firmwareVersionInput, setFirmwareVersionInput] = useState('1.3.0');
  const [uploadingFw, setUploadingFw] = useState(false);

  // Backups
  const [backups, setBackups] = useState<any[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [downloadingBackup, setDownloadingBackup] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [autoBackupInterval, setAutoBackupInterval] = useState('daily');
  const [autoBackupTime, setAutoBackupTime] = useState('02:00');
  const [backupRetentionCount, setBackupRetentionCount] = useState(10);
  const [savingBackupSettings, setSavingBackupSettings] = useState(false);

  // Updates
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [serverAutoUpdateEnabled, setServerAutoUpdateEnabled] = useState(false);
  const [serverAutoUpdateChannel, setServerAutoUpdateChannel] = useState('stable');
  const [serverAutoUpdateTime, setServerAutoUpdateTime] = useState('03:00');
  const [serverAutoUpdateFrequency, setServerAutoUpdateFrequency] = useState('daily');
  const [savingUpdateSettings, setSavingUpdateSettings] = useState(false);

  // Settings & Branding
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [navbarIconFile, setNavbarIconFile] = useState<File | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testEmailInput, setTestEmailInput] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [broadcastingOta, setBroadcastingOta] = useState(false);

  // Unified TLS / HTTPS & Reverse Proxy Management
  const [sslStatus, setSslStatus] = useState<any>(null);
  const [healthInfo, setHealthInfo] = useState<any>(null);
  const [tlsMode, setTlsMode] = useState<'proxy' | 'acme' | 'local_ca'>('proxy');
  const [trustProxyInput, setTrustProxyInput] = useState<string>('false');
  const [acmeDomain, setAcmeDomain] = useState('');
  const [acmeEmail, setAcmeEmail] = useState('');
  const [acmeStaging, setAcmeStaging] = useState(false);
  const [localCaHosts, setLocalCaHosts] = useState('');
  const [savingTls, setSavingTls] = useState(false);
  const [renewingAcme, setRenewingAcme] = useState(false);
  const [regeneratingCa, setRegeneratingCa] = useState(false);
  const [restartingServer, setRestartingServer] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState<string | null>(null);
  const loadedTabsRef = useRef<Set<string>>(new Set());

  // System Voice & Local Neural TTS
  const [ttsStatus, setTtsStatus] = useState<any>(null);
  const [ttsEngine, setTtsEngine] = useState<string>('piper');
  const [ttsVoice, setTtsVoice] = useState<string>('en_US-lessac-medium');
  const [savingTts, setSavingTts] = useState(false);
  const [downloadingTts, setDownloadingTts] = useState(false);
  const [ttsPreviewText, setTtsPreviewText] = useState(
    'At the tone, the DecaTone central office time will be twelve forty five and ten seconds.'
  );
  const [previewingTts, setPreviewingTts] = useState(false);
  const [ttsPreviewUrl, setTtsPreviewUrl] = useState<string | null>(null);
  const ttsPreviewUrlRef = useRef<string | null>(null);

  // Dial-Plan & Numbering Policy
  const [dialMinLen, setDialMinLen] = useState<number>(3);
  const [dialMaxLen, setDialMaxLen] = useState<number>(4);
  const [dialAssignmentMode, setDialAssignmentMode] = useState<string>('user_choice');
  const [dialAreaCodeEnabled, setDialAreaCodeEnabled] = useState<boolean>(false);
  const [dialAllowedAreaCodes, setDialAllowedAreaCodes] = useState<string>('');
  const [dialDefaultAreaCode, setDialDefaultAreaCode] = useState<string>('');
  const [savingDialPlan, setSavingDialPlan] = useState(false);

  // Home Assistant MQTT Integration
  const [mqttEnabled, setMqttEnabled] = useState(false);
  const [mqttHost, setMqttHost] = useState('localhost');
  const [mqttPort, setMqttPort] = useState('1883');
  const [mqttUser, setMqttUser] = useState('');
  const [mqttPass, setMqttPass] = useState('');
  const [mqttPin, setMqttPin] = useState('512');
  const [savingMqtt, setSavingMqtt] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    return () => {
      if (ttsPreviewUrlRef.current) {
        URL.revokeObjectURL(ttsPreviewUrlRef.current);
      }
    };
  }, []);

  const fetchBackupSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/backups/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAutoBackupEnabled(Boolean(data.autoBackupEnabled));
        setAutoBackupInterval(data.autoBackupInterval || 'daily');
        setAutoBackupTime(data.autoBackupTime || '02:00');
        setBackupRetentionCount(Number(data.backupRetentionCount) || 10);
      }
    } catch {}
  }, []);

  const fetchUpdateSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/update/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setServerAutoUpdateEnabled(Boolean(data.autoUpdateEnabled));
        setServerAutoUpdateChannel(data.autoUpdateChannel || 'stable');
        setServerAutoUpdateTime(data.autoUpdateTime || '03:00');
        setServerAutoUpdateFrequency(data.autoUpdateFrequency || 'daily');
      }
    } catch {}
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/metrics', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.stats || data);
      }
    } catch {}
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {}
  }, []);

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/fleet', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFleet(data.phones || []);
      }
    } catch {}
  }, []);

  const fetchFirmwareInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/firmware/info', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFirmwareInfo(data);
      }
    } catch {}
  }, []);

  const fetchBackups = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/backups', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      }
    } catch {}
  }, []);

  const fetchUpdateCheck = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const res = await fetch('/api/admin/update/check', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
      }
    } catch {
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const map = data.settings || {};
        setSettings(map);
        return map;
      }
    } catch {}
    return null;
  }, []);

  const fetchHealthAndSsl = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealthInfo(data);
      }
    } catch {}

    try {
      const sslRes = await fetch('/api/admin/tls', { credentials: 'include' });
      if (sslRes.ok) {
        const sslData = await sslRes.json();
        setSslStatus(sslData);
        if (sslData.mode === 'proxy' || sslData.mode === 'acme' || sslData.mode === 'local_ca') {
          setTlsMode(sslData.mode);
        }
        setTrustProxyInput(String(sslData.trustProxyRaw ?? 'false'));
        if (sslData.acme) {
          setAcmeDomain(sslData.acme.domain || '');
          setAcmeEmail(sslData.acme.email || '');
          setAcmeStaging(Boolean(sslData.acme.staging));
        }
        if (sslData.localCa) {
          setLocalCaHosts(sslData.localCa.customHosts || '');
        }
      }
    } catch {}
  }, []);

  const fetchTtsStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tts', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTtsStatus(data);
        const eng = data.configuredEngine || data.engine;
        if (eng) setTtsEngine(eng);
        const v = data.selectedVoice || data.voice || data.voiceModel || data.model;
        if (v) setTtsVoice(v);
      }
    } catch {}
  }, []);

  const fetchDialPlan = useCallback(async (fallbackSettings?: Record<string, string> | null) => {
    try {
      const res = await fetch('/api/admin/dial-plan', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const plan = data.dialPlan || data;
        const minL = Number(plan.minLength ?? plan.minNumberLength ?? plan.phoneNumberMinLength ?? 3);
        const maxL = Number(plan.maxLength ?? plan.maxNumberLength ?? plan.phoneNumberMaxLength ?? minL);
        setDialMinLen(Number.isFinite(minL) && minL >= 2 ? minL : 3);
        setDialMaxLen(Number.isFinite(maxL) && maxL >= 2 ? maxL : 4);
        setDialAssignmentMode(plan.assignmentMode || plan.numberAssignmentMode || 'user_choice');
        setDialAreaCodeEnabled(Boolean(plan.areaCodeEnabled));
        const codes = Array.isArray(plan.allowedAreaCodes)
          ? plan.allowedAreaCodes.join(', ')
          : String(plan.allowedAreaCodes || plan.areaCodesList || '');
        setDialAllowedAreaCodes(codes);
        setDialDefaultAreaCode(plan.defaultAreaCode || '');
        return;
      }
    } catch {}

    if (fallbackSettings) {
      const minL = parseInt(fallbackSettings.phone_number_min_length || fallbackSettings.phone_number_length || '3', 10);
      const maxL = parseInt(fallbackSettings.phone_number_max_length || fallbackSettings.phone_number_length || '4', 10);
      setDialMinLen(isNaN(minL) ? 3 : minL);
      setDialMaxLen(isNaN(maxL) ? 4 : maxL);
      setDialAssignmentMode(fallbackSettings.number_assignment_mode || 'user_choice');
      setDialAreaCodeEnabled(fallbackSettings.area_code_enabled === 'true');
      setDialAllowedAreaCodes(fallbackSettings.area_codes_list || '');
      setDialDefaultAreaCode(fallbackSettings.default_area_code || '');
    }
  }, []);

  const fetchMqttSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mqtt', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMqttEnabled(Boolean(data.enabled));
        setMqttHost(data.host || 'localhost');
        setMqttPort(String(data.port || '1883'));
        setMqttUser(data.user || '');
        setMqttPass(data.pass || '');
        setMqttPin(String(data.pin || '512'));
      }
    } catch {}
  }, []);

  // Overview load on mount
  useEffect(() => {
    void fetchMetrics();
    void fetchHealthAndSsl();
  }, [fetchMetrics, fetchHealthAndSsl]);

  // Lazy-load dataset for each tab when first opened
  useEffect(() => {
    if (loadedTabsRef.current.has(activeTab)) return;
    loadedTabsRef.current.add(activeTab);

    if (activeTab === 'users') {
      void fetchUsers();
      void fetchSettings().then((map) => fetchDialPlan(map));
    } else if (activeTab === 'fleet') {
      void fetchFleet();
    } else if (activeTab === 'ota') {
      void fetchFirmwareInfo();
    } else if (activeTab === 'backups') {
      void fetchBackups();
      void fetchBackupSettings();
    } else if (activeTab === 'updates') {
      void fetchUpdateCheck();
      void fetchUpdateSettings();
    } else if (activeTab === 'settings') {
      void fetchHealthAndSsl();
      void fetchTtsStatus();
      void fetchMqttSettings();
      void fetchSettings().then((map) => fetchDialPlan(map));
    }
  }, [
    activeTab,
    fetchUsers,
    fetchFleet,
    fetchFirmwareInfo,
    fetchBackups,
    fetchBackupSettings,
    fetchUpdateCheck,
    fetchUpdateSettings,
    fetchHealthAndSsl,
    fetchTtsStatus,
    fetchMqttSettings,
    fetchSettings,
    fetchDialPlan
  ]);

  // Live poll on-demand TTS weight download progress
  useEffect(() => {
    if (ttsStatus?.downloadState?.status !== 'downloading') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/tts/download-status', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setTtsStatus(data);
          if (data.downloadState?.status !== 'downloading') {
            setDownloadingTts(false);
            if (data.downloadState?.status === 'ready') {
              setToast({ type: 'success', text: data.downloadState.message || 'Voice model downloaded and ready!' });
            } else if (data.downloadState?.status === 'error') {
              setToast({ type: 'error', text: data.downloadState.error || 'Voice model download failed' });
            }
          }
        }
      } catch {}
    }, 800);
    return () => clearInterval(interval);
  }, [ttsStatus?.downloadState?.status]);

  // User Actions
  const handleUpdateRole = async (userId: number, role: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: 'User role updated' });
        void fetchUsers();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to update user role' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Network error updating role' });
    }
  };

  const handleToggleDisable = async (userId: number, currentDisabled: boolean) => {
    const reason = !currentDisabled ? prompt('Enter reason for disabling account:') : '';
    if (!currentDisabled && reason === null) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isDisabled: !currentDisabled, disabledReason: reason })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: currentDisabled ? 'User account re-enabled' : 'User account disabled' });
        void fetchUsers();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to update account status' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Failed to update account status' });
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUserForPassword || !newPasswordInput) return;
    try {
      const res = await fetch(`/api/admin/users/${selectedUserForPassword.id}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword: newPasswordInput })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: `Password for @${selectedUserForPassword.username} has been reset` });
        setSelectedUserForPassword(null);
        setNewPasswordInput('');
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to reset password' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Failed to reset password' });
    }
  };

  const handleUpdateNumber = async () => {
    if (!selectedUserForNumber || !newNumberInput) return;
    try {
      const res = await fetch(`/api/admin/users/${selectedUserForNumber.id}/phone-number`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phoneNumber: newNumberInput, areaCode: newAreaCodeInput })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: 'User extension updated' });
        setSelectedUserForNumber(null);
        void fetchUsers();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to update extension' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Failed to update extension' });
    }
  };

  const handleDeleteUser = async (userId: number, username?: string) => {
    if (
      !window.confirm(
        `Permanently delete user ${username ? `@${username}` : `#${userId}`}, unassign their extension, and remove their voicemails? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'User account deleted' });
        void fetchUsers();
        void fetchMetrics();
        void fetchFleet();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to delete user account' });
      }
    } catch (e: any) {
      setToast({ type: 'error', text: e.message || 'Failed to delete user account' });
    }
  };

  // Fleet Actions
  const handleFleetTestRing = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${encodeURIComponent(deviceId)}/test-ring`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setToast({ type: 'success', text: `Test ring signal dispatched to ${deviceId}` });
      else setToast({ type: 'error', text: data.error || 'Device offline' });
    } catch {
      setToast({ type: 'error', text: 'Failed to send test ring' });
    }
  };

  const handleFleetReboot = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${encodeURIComponent(deviceId)}/reboot`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setToast({ type: 'success', text: `Reboot command sent to ${deviceId}` });
      else setToast({ type: 'error', text: data.error || 'Device offline' });
    } catch {
      setToast({ type: 'error', text: 'Failed to send reboot command' });
    }
  };

  const handleFleetUnpair = async (deviceId: string) => {
    if (!window.confirm(`Unpair hardware device ${deviceId} from its assigned user?`)) return;
    try {
      const res = await fetch(`/api/admin/fleet/${encodeURIComponent(deviceId)}/unpair`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: `Device ${deviceId} unpaired successfully` });
        void fetchFleet();
        void fetchUsers();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to unpair device' });
      }
    } catch {
      setToast({ type: 'error', text: 'Failed to unpair device' });
    }
  };

  const handleFleetOta = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${encodeURIComponent(deviceId)}/ota`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || `OTA dispatched to ${deviceId}` });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to push OTA to device' });
      }
    } catch {
      setToast({ type: 'error', text: 'Failed to push OTA to device' });
    }
  };

  const handleDownloadFirmware = async () => {
    try {
      const res = await fetch('/api/firmware/download/latest', {
        credentials: 'include'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `decatone-firmware-v${firmwareInfo?.version || 'latest'}.bin`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to download firmware binary' });
    }
  };

  // OTA Firmware Actions
  const handleUploadFirmware = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firmwareFile) return;

    setUploadingFw(true);
    const formData = new FormData();
    formData.append('firmware', firmwareFile);
    formData.append('version', firmwareVersionInput);

    try {
      const res = await fetch('/api/admin/firmware/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'Firmware uploaded' });
        setFirmwareFile(null);
        void fetchFirmwareInfo();
      } else {
        setToast({ type: 'error', text: data.error || 'Firmware upload failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Firmware upload failed' });
    } finally {
      setUploadingFw(false);
    }
  };

  // Backups Actions
  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await fetch('/api/admin/backups/create', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: 'Compressed backup archive created!' });
        void fetchBackups();
        void fetchMetrics();
      } else {
        setToast({ type: 'error', text: data.error || 'Backup creation failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Backup creation failed' });
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    setDownloadingBackup(filename);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/backups/download/${encodeURIComponent(filename)}`, {
        credentials: 'include'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to download backup archive' });
    } finally {
      setDownloadingBackup(null);
    }
  };

  const handleRestoreExistingBackup = async (filename: string) => {
    if (
      !window.confirm(
        `Restore server backup '${filename}'? Current database, custom branding, and voicemails will be overwritten.`
      )
    ) {
      return;
    }
    setRestoring(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ filename })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || `Restored '${filename}' cleanly!` });
        void fetchMetrics();
        void fetchUsers();
        void fetchFleet();
        void fetchHealthAndSsl();
        await refreshBranding();
      } else {
        setToast({ type: 'error', text: data.error || 'Backup restoration failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Backup restoration failed' });
    } finally {
      setRestoring(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    if (!window.confirm(`Permanently delete backup archive '${filename}'?`)) return;
    setDeletingBackup(filename);
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || `Deleted '${filename}'` });
        void fetchBackups();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to delete backup' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to delete backup' });
    } finally {
      setDeletingBackup(null);
    }
  };

  const handleRestoreBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreFile) return;
    if (
      !window.confirm(
        'Proceed with backup restoration? Current database, custom branding, and voicemails will be overwritten.'
      )
    ) {
      return;
    }

    setRestoring(true);
    const formData = new FormData();
    formData.append('backup_file', restoreFile);

    try {
      const res = await fetch('/api/admin/backups/restore', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'Backup restored successfully!' });
        setRestoreFile(null);
        void fetchMetrics();
        void fetchUsers();
        void fetchFleet();
        void fetchHealthAndSsl();
        await refreshBranding();
      } else {
        setToast({ type: 'error', text: data.error || 'Backup restoration failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Backup restoration failed' });
    } finally {
      setRestoring(false);
    }
  };

  // Self-Updater Actions
  const handleChangeChannel = async (channel: string) => {
    try {
      const res = await fetch('/api/admin/update/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast({ type: 'error', text: err.error || 'Failed to change update channel' });
      }
      void fetchUpdateCheck();
    } catch {
      setToast({ type: 'error', text: 'Failed to change update channel' });
    }
  };

  const handleApplyUpdate = async () => {
    if (!window.confirm('Apply update? DecaTone will update in-container and reboot in 5 seconds.')) return;
    setApplyingUpdate(true);
    try {
      const res = await fetch('/api/admin/update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetVersion: updateInfo?.targetVersion })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'Applying update...' });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to apply update' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to apply update' });
    } finally {
      setApplyingUpdate(false);
    }
  };

  const handleSaveBackupSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBackupSettings(true);
    try {
      const res = await fetch('/api/admin/backups/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          autoBackupEnabled,
          autoBackupInterval,
          autoBackupTime,
          backupRetentionCount
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'Backup schedule saved' });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to save backup policy' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save backup policy' });
    } finally {
      setSavingBackupSettings(false);
    }
  };

  const handleSaveUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUpdateSettings(true);
    try {
      const res = await fetch('/api/admin/update/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          autoUpdateEnabled: serverAutoUpdateEnabled,
          autoUpdateChannel: serverAutoUpdateChannel,
          autoUpdateTime: serverAutoUpdateTime,
          autoUpdateFrequency: serverAutoUpdateFrequency
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'Auto-update schedule saved' });
        void fetchUpdateCheck();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to save update schedule' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save update schedule' });
    } finally {
      setSavingUpdateSettings(false);
    }
  };

  const handleBroadcastOta = async () => {
    if (!window.confirm('Broadcast OTA update command to all currently online physical rotary phones?')) return;
    setBroadcastingOta(true);
    try {
      const res = await fetch('/api/admin/firmware/ota-broadcast', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'OTA broadcast sent' });
      } else {
        setToast({ type: 'error', text: data.error || 'OTA broadcast failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'OTA broadcast failed' });
    } finally {
      setBroadcastingOta(false);
    }
  };

  const handleResetFirmwareOverride = async () => {
    if (!window.confirm('Clear custom firmware override and revert to the official release binary?')) return;
    try {
      const res = await fetch('/api/admin/firmware/reset-override', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', text: data.message || 'Firmware override cleared' });
        void fetchFirmwareInfo();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to reset firmware override' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to reset firmware override' });
    }
  };

  // Unified TLS / Proxy Handlers
  const handleSaveTls = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTls(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/tls', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: tlsMode,
          trustProxy: trustProxyInput,
          acmeDomain,
          acmeEmail,
          acmeStaging,
          localCaHosts
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save TLS settings');
      await fetchHealthAndSsl();
      setToast({ type: 'success', text: data.message || 'TLS settings updated!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save TLS settings' });
    } finally {
      setSavingTls(false);
    }
  };

  const handleRenewAcme = async () => {
    setRenewingAcme(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/tls/acme/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: acmeDomain, email: acmeEmail, staging: acmeStaging })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ACME issuance/renewal failed');
      await fetchHealthAndSsl();
      setToast({ type: 'success', text: data.message || 'Let’s Encrypt certificate issued and loaded!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'ACME issuance/renewal failed' });
    } finally {
      setRenewingAcme(false);
    }
  };

  const handleRegenerateLocalCa = async () => {
    if (
      !window.confirm(
        'Regenerating the Local Root CA invalidates previously trusted CA certificates on browsers and ESP32 phones until re-fetched. Continue?'
      )
    ) {
      return;
    }
    setRegeneratingCa(true);
    try {
      const res = await fetch('/api/admin/tls/local-ca/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ localCaHosts })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate Local CA');
      await fetchHealthAndSsl();
      setToast({ type: 'success', text: data.message || 'Local Root CA regenerated!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to regenerate Local CA' });
    } finally {
      setRegeneratingCa(false);
    }
  };

  const handleRestartServer = async () => {
    if (!window.confirm('Restart the DecaTone server process now to switch HTTP/HTTPS transport?')) return;
    setRestartingServer(true);
    try {
      const res = await fetch('/api/admin/system/restart', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      setToast({ type: 'success', text: data.message || 'Server restarting...' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to restart server' });
    } finally {
      setRestartingServer(false);
    }
  };

  // Settings & Branding Save (verifies res.ok on every request)
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setToast(null);
    try {
      const settingsRes = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings })
      });
      if (!settingsRes.ok) {
        const err = await settingsRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save system settings');
      }

      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        const logoRes = await fetch('/api/admin/branding/logo', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        if (!logoRes.ok) {
          const err = await logoRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to upload brand logo');
        }
        setLogoFile(null);
      }

      if (faviconFile) {
        const formData = new FormData();
        formData.append('favicon', faviconFile);
        const favRes = await fetch('/api/admin/branding/favicon', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        if (!favRes.ok) {
          const err = await favRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to upload favicon');
        }
        setFaviconFile(null);
      }

      if (navbarIconFile) {
        const formData = new FormData();
        formData.append('navbar_icon', navbarIconFile);
        const navRes = await fetch('/api/admin/branding/navbar-icon', {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        if (!navRes.ok) {
          const err = await navRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to upload navbar program icon');
        }
        setNavbarIconFile(null);
      }

      await refreshBranding();
      await fetchSettings();
      setToast({ type: 'success', text: 'System settings & brand assets saved!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetBranding = async () => {
    if (!window.confirm('Reset brand logo, favicons, and program icons to factory defaults?')) return;
    try {
      const res = await fetch('/api/admin/branding/reset', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await refreshBranding();
        setToast({ type: 'success', text: 'Branding assets reset to default' });
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to reset branding' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to reset branding' });
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailInput.trim()) return;

    setSendingTestEmail(true);
    setSmtpTestResult(null);

    try {
      const res = await fetch('/api/admin/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ testEmail: testEmailInput.trim() })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSmtpTestResult({ success: true, message: data.message || 'Test email sent!' });
      } else {
        setSmtpTestResult({ success: false, message: data.error || 'SMTP test failed' });
      }
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message || 'SMTP connection failed' });
    } finally {
      setSendingTestEmail(false);
    }
  };

  // System Voice & Dual Local Neural TTS Handlers
  const handleSaveTts = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTts(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/tts/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          engine: ttsEngine,
          voiceId: ttsVoice
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save TTS configuration');
      setTtsStatus(data);
      setToast({ type: 'success', text: data.message || 'System TTS voice configuration saved!' });
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save TTS settings' });
    } finally {
      setSavingTts(false);
    }
  };

  const handleDownloadTtsModel = async () => {
    setDownloadingTts(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/tts/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ engine: ttsEngine, voiceId: ttsVoice })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Voice model download failed');
      setTtsStatus(data);
      if (data.downloadState?.status !== 'downloading') {
        setDownloadingTts(false);
        setToast({ type: 'success', text: data.message || `Voice model '${ttsVoice}' is ready!` });
      }
    } catch (err: any) {
      setDownloadingTts(false);
      setToast({ type: 'error', text: err.message || 'Failed to download voice model' });
    }
  };

  const handlePreviewTtsVoice = async () => {
    if (!ttsPreviewText.trim()) return;
    setPreviewingTts(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: ttsPreviewText.trim(),
          voiceId: ttsVoice,
          engine: ttsEngine
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to synthesize voice preview');
      }

      const contentType = res.headers.get('content-type') || '';
      let audioBlob: Blob;
      if (contentType.includes('application/json')) {
        const json = await res.json();
        const b64 = json.audioBase64 || json.wavBase64 || '';
        const bin = window.atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        audioBlob = new Blob([bytes], { type: 'audio/wav' });
      } else {
        audioBlob = await res.blob();
      }

      if (ttsPreviewUrlRef.current) {
        URL.revokeObjectURL(ttsPreviewUrlRef.current);
      }
      const url = URL.createObjectURL(audioBlob);
      ttsPreviewUrlRef.current = url;
      setTtsPreviewUrl(url);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Voice preview failed' });
    } finally {
      setPreviewingTts(false);
    }
  };

  // Dial-Plan & Numbering Policy Save
  const handleSaveDialPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dialMinLen < 2 || dialMaxLen > 15 || dialMinLen > dialMaxLen) {
      setToast({
        type: 'error',
        text: 'Invalid extension length bounds: minimum length must be <= maximum length (between 2 and 15 digits).'
      });
      return;
    }

    setSavingDialPlan(true);
    setToast(null);
    try {
      const codesArray = dialAllowedAreaCodes
        .split(',')
        .map((c) => c.trim().replace(/\D/g, ''))
        .filter(Boolean);

      const res = await fetch('/api/admin/dial-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          minLength: dialMinLen,
          maxLength: dialMaxLen,
          minNumberLength: dialMinLen,
          maxNumberLength: dialMaxLen,
          phoneNumberMinLength: dialMinLen,
          phoneNumberMaxLength: dialMaxLen,
          assignmentMode: dialAssignmentMode,
          numberAssignmentMode: dialAssignmentMode,
          areaCodeEnabled: dialAreaCodeEnabled,
          allowedAreaCodes: codesArray,
          areaCodesList: codesArray.join(','),
          defaultAreaCode: dialDefaultAreaCode.trim().replace(/\D/g, '')
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update dial-plan policy');

      setToast({ type: 'success', text: data.message || 'Dial-plan & extension numbering policy saved!' });
      const updatedMap = await fetchSettings();
      await fetchDialPlan(updatedMap);
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save dial-plan' });
    } finally {
      setSavingDialPlan(false);
    }
  };

  // Home Assistant MQTT Integration Save
  const handleSaveMqtt = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMqtt(true);
    setToast(null);
    try {
      const res = await fetch('/api/admin/mqtt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enabled: mqttEnabled,
          host: mqttHost.trim() || 'localhost',
          port: mqttPort.trim() || '1883',
          user: mqttUser.trim(),
          pass: mqttPass,
          pin: mqttPin.trim() || '512'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update MQTT integration settings');
      setToast({ type: 'success', text: data.message || 'Home Assistant MQTT integration saved!' });
      await fetchMqttSettings();
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'Failed to save MQTT settings' });
    } finally {
      setSavingMqtt(false);
    }
  };

  // Factory Reset
  const handleSystemWipe = async () => {
    const conf1 = prompt(
      'WARNING: This will PERMANENTLY ERASE all users, phones, call logs, and data. Type "ERASE" to confirm:'
    );
    if (conf1 !== 'ERASE') return;

    try {
      const res = await fetch('/api/admin/system/wipe', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert('DecaTone has been wiped to factory defaults. Redirecting to setup wizard...');
        purgeLegacyStorageKeys();
        clearUnlockedKey();
        window.location.href = '/';
      } else {
        setToast({ type: 'error', text: data.error || 'System wipe failed' });
      }
    } catch (err: any) {
      setToast({ type: 'error', text: err.message || 'System wipe failed' });
    }
  };

  const detectedProto =
    sslStatus?.effectiveProtocol ||
    sslStatus?.protocol ||
    healthInfo?.detectedProtocol ||
    window.location.protocol.replace(':', '');
  const isHttpsActive = Boolean(sslStatus?.isHttps ?? detectedProto === 'https');
  const isBehindProxy = Boolean(sslStatus?.isBehindReverseProxy ?? healthInfo?.isBehindProxy);
  const browserSecureContext = typeof window !== 'undefined' && Boolean(window.isSecureContext);

  const allVoices: { id: string; label: string; engine: string; installed?: boolean }[] = Array.isArray(
    ttsStatus?.voices
  ) && ttsStatus.voices.length > 0
    ? ttsStatus.voices
    : [
        { id: 'en_US-lessac-medium', label: 'Lessac — US Female Central Office Operator', engine: 'piper' },
        { id: 'en_US-amy-medium', label: 'Amy — US Female Clear Modern', engine: 'piper' },
        { id: 'en_US-ryan-medium', label: 'Ryan — US Male Broadcast Announcer', engine: 'piper' },
        { id: 'en_GB-alba-medium', label: 'Alba — UK GPO Female Operator', engine: 'piper' },
        { id: 'kokoro_af_heart', label: 'Heart — US Female Natural Warm', engine: 'kokoro' },
        { id: 'kokoro_af_bella', label: 'Bella — US Female Expressive Operator', engine: 'kokoro' },
        { id: 'espeak_en_us_m', label: 'Local eSpeak-NG US Male', engine: 'espeak' }
      ];
  const filteredVoices = allVoices.filter((v) => v.engine === ttsEngine);
  const availableVoices = filteredVoices.length > 0 ? filteredVoices : allVoices;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Admin Header */}
      <div className="glass-card highlight-amber" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Shield size={26} color="var(--accent-amber)" /> DecaTone Admin Center
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            System metrics, phone fleet management, OTA firmware updates, neural TTS, dial-plan, backups, and whitelabeling.
          </p>
        </div>

        {/* Admin Navigation Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', background: 'rgba(0,0,0,0.4)', padding: '0.35rem', borderRadius: 'var(--radius-md)' }}>
          {[
            { id: 'metrics', label: 'Metrics', icon: Database },
            { id: 'users', label: `Users (${users.length})`, icon: Users },
            { id: 'fleet', label: `Hardware Fleet (${fleet.length})`, icon: Cpu },
            { id: 'ota', label: 'Firmware OTA', icon: Smartphone },
            { id: 'backups', label: 'Backups', icon: FileArchive },
            { id: 'updates', label: 'Self-Updater', icon: RefreshCw },
            { id: 'settings', label: 'Settings & SSL', icon: Sliders },
            { id: 'wipe', label: 'System Wipe', icon: AlertTriangle }
          ].map((tab) => {
            const Icon = tab.icon;
            const isCurrent = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`btn btn-sm ${isCurrent ? (tab.id === 'wipe' ? 'btn-danger' : 'btn-amber') : 'btn-secondary'}`}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
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
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* TAB 1: METRICS */}
      {activeTab === 'metrics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="grid-4">
            <div className="glass-card">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Total Users</span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.25rem', color: '#fff' }}>{metrics?.totalUsers ?? 0}</h2>
            </div>
            <div className="glass-card">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Hardware Phones</span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.25rem', color: 'var(--accent-cyan)' }}>
                {metrics?.onlinePhones ?? 0} <span style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>/ {metrics?.totalPhones ?? 0} online</span>
              </h2>
            </div>
            <div className="glass-card">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Calls Logged</span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.25rem', color: 'var(--accent-amber)' }}>{metrics?.totalCalls ?? 0}</h2>
            </div>
            <div className="glass-card">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Voicemails</span>
              <h2 style={{ fontSize: '2rem', marginTop: '0.25rem', color: '#34d399' }}>{metrics?.totalVoicemails ?? 0}</h2>
            </div>
          </div>

          <div className="grid-2">
            <div className="glass-card">
              <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Storage & Database Footprint</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>SQLite Database (decatone.db)</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{((metrics?.dbSizeBytes || 0) / 1024).toFixed(1)} KB</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Uploads & Encrypted Voicemails</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{((metrics?.uploadsSizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
              </div>
            </div>

            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={18} color={isHttpsActive || browserSecureContext ? '#34d399' : 'var(--accent-amber)'} /> SSL / HTTPS & Reverse Proxy Status
                </h3>
                <button type="button" onClick={() => void fetchHealthAndSsl()} className="btn btn-secondary btn-sm">
                  <RefreshCw size={12} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.88rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Detected Transport Protocol</span>
                  <strong style={{ color: isHttpsActive ? '#34d399' : 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                    {String(detectedProto).toUpperCase()}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Reverse Proxy TLS Termination</span>
                  <span style={{ color: isBehindProxy ? '#34d399' : 'var(--text-dim)' }}>
                    {isBehindProxy ? 'Active (X-Forwarded-Proto)' : 'Direct Connection'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>WebCrypto & Softphone Secure Context</span>
                  <span style={{ color: browserSecureContext ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
                    {browserSecureContext ? 'Ready (E2EE + Mic Enabled)' : 'HTTPS Required for Non-Localhost'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="glass-card">
          <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={18} color="var(--accent-cyan)" /> User Directory & Line Assignments
          </h3>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Extension</th>
                  <th>Role</th>
                  <th>Paired Hardware</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>#{u.id}</td>
                    <td>
                      <strong>{u.display_name || u.displayName || u.username}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>@{u.username}</div>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-amber)' }}>
                        EXT {u.phone_number || u.phoneNumber || '---'}
                      </span>
                    </td>
                    <td>
                      <select
                        className="form-select"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '90px' }}
                        value={u.role}
                        onChange={(e) => void handleUpdateRole(u.id, e.target.value)}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      {u.device_id ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                          {u.device_id} {u.phone_online ? '🟢' : '⚪'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>None</span>
                      )}
                    </td>
                    <td>
                      {u.is_disabled ? (
                        <span className="badge badge-busy">Disabled</span>
                      ) : (
                        <span className="badge badge-online">Active</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => {
                            setSelectedUserForNumber(u);
                            setNewNumberInput(u.phone_number || u.phoneNumber || '');
                            setNewAreaCodeInput(u.area_code || u.areaCode || '');
                          }}
                          className="btn btn-secondary btn-sm"
                          title="Change Extension Number"
                        >
                          EXT
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUserForPassword(u);
                            setNewPasswordInput('');
                          }}
                          className="btn btn-secondary btn-sm"
                          title="Reset Password"
                        >
                          <Key size={14} />
                        </button>
                        <button
                          onClick={() => void handleToggleDisable(u.id, !!u.is_disabled)}
                          className="btn btn-secondary btn-sm"
                          title={u.is_disabled ? 'Enable Account' : 'Disable Account'}
                        >
                          <Lock size={14} color={u.is_disabled ? '#34d399' : '#f59e0b'} />
                        </button>
                        <button
                          onClick={() => void handleDeleteUser(u.id, u.username)}
                          className="btn btn-danger btn-sm"
                          title="Delete User"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Reset Password Modal */}
          {selectedUserForPassword && (
            <div className="modal-backdrop">
              <div className="modal-content">
                <h3 style={{ marginBottom: '0.75rem' }}>Reset Password for @{selectedUserForPassword.username}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                  Note: Admin password resets rotate the account credentials; Zero-Access voicemails encrypted under the user's previous password cannot be decrypted without that old password.
                </p>
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="Enter at least 8 characters"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button onClick={() => setSelectedUserForPassword(null)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button onClick={() => void handleResetPassword()} disabled={newPasswordInput.length < 6} className="btn btn-primary">
                    Save New Password
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Extension Modal */}
          {selectedUserForNumber && (
            <div className="modal-backdrop">
              <div className="modal-content">
                <h3 style={{ marginBottom: '1rem' }}>Change Extension for @{selectedUserForNumber.username}</h3>
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Extension Number</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newNumberInput}
                    onChange={(e) => setNewNumberInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 101"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                {dialAreaCodeEnabled && (
                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <label className="form-label">Area Code (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newAreaCodeInput}
                      onChange={(e) => setNewAreaCodeInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="e.g. 212"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button onClick={() => setSelectedUserForNumber(null)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button onClick={() => void handleUpdateNumber()} disabled={!newNumberInput} className="btn btn-amber">
                    Update Extension
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: HARDWARE FLEET INSPECTOR */}
      {activeTab === 'fleet' && (
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Cpu size={18} color="var(--accent-amber)" /> Connected ESP32-S3 Hardware Fleet
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <a
                href="https://github.com/TylerHats/DecaTone/wiki/Hardware-Wiring-and-Pinouts"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
              >
                <HelpCircle size={14} /> Hardware & Wiring Wiki <ExternalLink size={12} />
              </a>
              <button onClick={() => void fetchFleet()} className="btn btn-secondary btn-sm">
                <RefreshCw size={14} /> Refresh Fleet
              </button>
            </div>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device ID</th>
                  <th>Assigned User</th>
                  <th>IP / MAC Address</th>
                  <th>Firmware</th>
                  <th>WiFi RSSI</th>
                  <th>Hook & State</th>
                  <th>Status</th>
                  <th>Remote Actions</th>
                </tr>
              </thead>
              <tbody>
                {fleet.map((p) => (
                  <tr key={p.id || p.device_id}>
                    <td><strong style={{ fontFamily: 'var(--font-mono)' }}>{p.device_id}</strong></td>
                    <td>
                      {p.assigned_username ? (
                        <span>{p.assigned_display_name || p.assigned_username} (EXT {p.assigned_phone_number})</span>
                      ) : (
                        <span style={{ color: 'var(--accent-amber)', fontStyle: 'italic' }}>Unclaimed</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                      {p.ip_address || '---'}<br />
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{p.mac_address}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>v{p.firmware_version || '1.0.0'}</td>
                    <td>{p.rssi ? `${p.rssi} dBm` : '---'}</td>
                    <td>
                      <span style={{ color: p.hook_state === 'off_hook' ? 'var(--accent-amber)' : 'var(--text-dim)', fontSize: '0.85rem' }}>
                        {p.hook_state === 'off_hook' ? 'Off Hook' : 'On Hook'} ({p.call_state})
                      </span>
                    </td>
                    <td>
                      {p.is_online ? (
                        <span className="badge badge-online"><span className="status-dot online" /> Online</span>
                      ) : (
                        <span className="badge badge-offline"><span className="status-dot offline" /> Offline</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => void handleFleetTestRing(p.device_id)}
                          disabled={!p.is_online}
                          className="btn btn-secondary btn-sm"
                          title="Test Ring"
                        >
                          <BellRing size={14} />
                        </button>
                        <button
                          onClick={() => void handleFleetReboot(p.device_id)}
                          disabled={!p.is_online}
                          className="btn btn-secondary btn-sm"
                          title="Remote Reboot"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => void handleFleetOta(p.device_id)}
                          disabled={!p.is_online}
                          className="btn btn-secondary btn-sm"
                          title="Push OTA Firmware Update"
                        >
                          <Upload size={14} />
                        </button>
                        {p.user_id && (
                          <button
                            onClick={() => void handleFleetUnpair(p.device_id)}
                            className="btn btn-danger btn-sm"
                            title="Unpair Phone"
                          >
                            Unpair
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: FIRMWARE OTA MANAGER */}
      {activeTab === 'ota' && (
        <div className="glass-card highlight-cyan">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <Smartphone size={20} color="var(--accent-cyan)" /> ESP32-S3 Over-The-Air (OTA) Firmware Manager
            </h3>
            <a
              href="https://github.com/TylerHats/DecaTone/wiki/Firmware-Flashing-and-Setup"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
            >
              <HelpCircle size={14} /> Custom Firmware Format & Wiki Guide <ExternalLink size={12} />
            </a>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Upload a custom compiled <code style={{ fontFamily: 'var(--font-mono)' }}>firmware.bin</code> binary to override the official distribution, or broadcast OTA commands to all connected phones.
          </p>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Current Distributed Version:</span>
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  v{String(firmwareInfo?.version || '1.3.0').replace(/^v/i, '')}
                  {firmwareInfo?.isCustomOverride ? (
                    <span className="badge badge-amber" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                      <Sparkles size={12} /> Custom Override Active
                    </span>
                  ) : (
                    <span className="badge badge-online" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                      Official Release
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {firmwareInfo?.isCustomOverride && (
                  <button onClick={() => void handleResetFirmwareOverride()} className="btn btn-secondary btn-sm">
                    <RotateCcw size={14} /> Revert to Official Release
                  </button>
                )}

                {firmwareInfo?.hasBinary && (
                  <button type="button" onClick={() => void handleDownloadFirmware()} className="btn btn-secondary btn-sm">
                    <Download size={14} /> Download Binary (.bin)
                  </button>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleUploadFirmware} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Firmware Version String</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={firmwareVersionInput}
                  onChange={(e) => setFirmwareVersionInput(e.target.value)}
                  placeholder="e.g. 1.3.0-custom"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Binary File (firmware.bin)</label>
                <input
                  type="file"
                  accept=".bin"
                  required
                  onChange={(e) => setFirmwareFile(e.target.files?.[0] || null)}
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" disabled={!firmwareFile || uploadingFw} className="btn btn-primary btn-lg">
                <Upload size={18} /> {uploadingFw ? 'Uploading Firmware...' : 'Upload Custom Firmware Override'}
              </button>

              <button
                type="button"
                onClick={() => void handleBroadcastOta()}
                disabled={broadcastingOta}
                className="btn btn-amber btn-lg"
              >
                <Smartphone size={18} /> {broadcastingOta ? 'Broadcasting OTA...' : 'Push OTA to All Online Phones'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: BACKUPS & RESTORE */}
      {activeTab === 'backups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-amber" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '1.15rem', margin: 0 }}>Full System Backups & Restoration (.tar.gz)</h3>
                <a
                  href="https://github.com/TylerHats/DecaTone/wiki/Backend-and-Docker-Deployment#compressed-backups--disaster-recovery"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                >
                  <HelpCircle size={14} /> Backup & Recovery Guide <ExternalLink size={12} />
                </a>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                Complete zero-loss archive of SQLite database, user settings, admin policies, custom brand assets, and encrypted voicemail recordings.
              </p>
            </div>

            <button onClick={() => void handleCreateBackup()} disabled={creatingBackup} className="btn btn-amber btn-lg">
              <FileArchive size={18} /> {creatingBackup ? 'Compressing Archive...' : 'Create Backup Archive Now'}
            </button>
          </div>

          {/* Automated Backup Settings Card */}
          <form onSubmit={handleSaveBackupSettings} className="glass-card">
            <h4 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} color="var(--accent-amber)" /> Automated Backup Schedule & Retention Policy
            </h4>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoBackupEnabled}
                    onChange={(e) => setAutoBackupEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>Enable Scheduled Automated Backups</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                      Automatically archives database, branding, and voicemails in the background.
                    </p>
                  </div>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Backup Frequency</label>
                <select
                  className="form-select"
                  value={autoBackupInterval}
                  onChange={(e) => setAutoBackupInterval(e.target.value)}
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily (Recommended)</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Scheduled Execution Time</label>
                <input
                  type="time"
                  className="form-input"
                  value={autoBackupTime}
                  onChange={(e) => setAutoBackupTime(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Backup Retention Count (Keep Last N Backups)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="form-input"
                  value={backupRetentionCount}
                  onChange={(e) => setBackupRetentionCount(parseInt(e.target.value, 10) || 10)}
                />
              </div>
            </div>

            <button type="submit" disabled={savingBackupSettings} className="btn btn-secondary btn-sm">
              <CheckCircle2 size={14} /> {savingBackupSettings ? 'Saving...' : 'Save Backup & Retention Policy'}
            </button>
          </form>

          {/* Backup Archives List */}
          <div className="glass-card">
            <h4 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Available Backup Archives</h4>
            {backups.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>No backups found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {backups.map((b) => (
                  <div
                    key={b.filename}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      flexWrap: 'wrap',
                      gap: '0.5rem'
                    }}
                  >
                    <div>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{b.filename}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                        {new Date(b.created_at).toLocaleString()} &bull; {((b.sizeBytes || 0) / 1024).toFixed(1)} KB
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void handleDownloadBackup(b.filename)}
                        disabled={downloadingBackup === b.filename}
                        className="btn btn-secondary btn-sm"
                      >
                        <Download size={14} /> {downloadingBackup === b.filename ? 'Downloading...' : 'Download'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRestoreExistingBackup(b.filename)}
                        disabled={restoring}
                        className="btn btn-amber btn-sm"
                      >
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBackup(b.filename)}
                        disabled={deletingBackup === b.filename}
                        className="btn btn-danger btn-sm"
                        title="Delete Backup Archive"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Restore Archive Form */}
          <div className="glass-card">
            <h4 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Restore Backup Archive</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Upload a previous <code style={{ fontFamily: 'var(--font-mono)' }}>.tar.gz</code> archive. User data, database records, custom brand icons, and voicemail audio will be restored.
            </p>

            <form onSubmit={handleRestoreBackup} style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="file"
                accept=".tar.gz,.db"
                required
                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                style={{ color: 'var(--text-muted)' }}
              />
              <button type="submit" disabled={!restoreFile || restoring} className="btn btn-danger btn-sm">
                <Upload size={14} /> {restoring ? 'Restoring System...' : 'Restore Backup'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 6: SELF-UPDATER */}
      {activeTab === 'updates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '1.15rem', margin: 0 }}>DecaTone System & Firmware Self-Updater</h3>
                  <a
                    href="https://github.com/TylerHats/DecaTone/wiki/Backend-and-Docker-Deployment"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
                  >
                    <HelpCircle size={14} /> Deployment & Update Wiki <ExternalLink size={12} />
                  </a>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                  Fetch system updates and ESP32-S3 firmware releases directly from the GitHub repository.
                </p>
              </div>

              <button onClick={() => void fetchUpdateCheck()} disabled={checkingUpdate} className="btn btn-secondary btn-sm">
                <RefreshCw size={14} className={checkingUpdate ? 'spin' : ''} /> {checkingUpdate ? 'Checking GitHub...' : 'Check for Updates'}
              </button>
            </div>

            <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Installed Server Version:</span>
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>
                  v{String(updateInfo?.currentVersion || '1.3.0').replace(/^v/i, '')}
                </div>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                  {updateInfo?.isDocker ? 'ESP32-S3 Firmware Channel:' : 'System Release Channel:'}
                </span>
                <select
                  className="form-select"
                  style={{ marginTop: '0.25rem', padding: '0.35rem 0.5rem' }}
                  value={updateInfo?.channel || 'stable'}
                  onChange={(e) => void handleChangeChannel(e.target.value)}
                >
                  <option value="stable">Stable Channel</option>
                  <option value="beta">Beta Channel (Tags)</option>
                  <option value="alpha">Alpha Channel (Main Commits)</option>
                </select>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Target Version:</span>
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-amber)' }}>
                  {updateInfo?.targetVersion ? `v${String(updateInfo.targetVersion).replace(/^v/i, '')}` : '---'}
                </div>
              </div>
            </div>

            {updateInfo?.isDocker ? (
              <div style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <h4 style={{ color: '#38bdf8', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Docker Container Environment Detected
                </h4>
                <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                  DecaTone is running inside a Docker container. In-app git modifications are disabled to preserve container immutability. The release channel selected above determines which firmware is offered to connected physical phones.
                </p>
                <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#a5f3fc' }}>
                  docker pull {updateInfo?.dockerImage || 'tylerhats/decatone:latest'} && docker compose up -d
                </div>
              </div>
            ) : updateInfo?.updateAvailable ? (
              <div style={{ background: 'rgba(14, 165, 233, 0.15)', border: '1px solid rgba(14, 165, 233, 0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <h4 style={{ color: '#38bdf8', marginBottom: '0.5rem' }}>Update Available!</h4>
                <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  {updateInfo?.latestRelease?.name || `Version ${updateInfo?.targetVersion}`} is ready to install.
                </p>
                <button onClick={() => void handleApplyUpdate()} disabled={applyingUpdate} className="btn btn-primary btn-lg">
                  <RefreshCw size={18} /> {applyingUpdate ? 'Updating DecaTone...' : 'Apply Update & Reboot Service'}
                </button>
              </div>
            ) : (
              <div style={{ color: '#34d399', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={16} /> DecaTone is running the latest available version on the {updateInfo?.channel || 'stable'} channel.
              </div>
            )}
          </div>

          {/* Server Auto-Update Settings */}
          <form onSubmit={handleSaveUpdateSettings} className="glass-card">
            <h4 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} color="var(--accent-cyan)" /> {updateInfo?.isDocker ? 'ESP32-S3 Firmware Auto-Update Schedule' : 'Server Auto-Update Schedule'}
            </h4>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={serverAutoUpdateEnabled}
                    onChange={(e) => setServerAutoUpdateEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>Enable Scheduled Updates</strong>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: 0 }}>
                      Periodically checks for and applies releases automatically.
                    </p>
                  </div>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Check Frequency</label>
                <select
                  className="form-select"
                  value={serverAutoUpdateFrequency}
                  onChange={(e) => setServerAutoUpdateFrequency(e.target.value)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Update Time Window</label>
                <input
                  type="time"
                  className="form-input"
                  value={serverAutoUpdateTime}
                  onChange={(e) => setServerAutoUpdateTime(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Release Channel</label>
                <select
                  className="form-select"
                  value={serverAutoUpdateChannel}
                  onChange={(e) => setServerAutoUpdateChannel(e.target.value)}
                >
                  <option value="stable">Stable</option>
                  <option value="beta">Beta</option>
                  <option value="alpha">Alpha</option>
                </select>
              </div>
            </div>

            <button type="submit" disabled={savingUpdateSettings} className="btn btn-secondary btn-sm">
              <CheckCircle2 size={14} /> {savingUpdateSettings ? 'Saving...' : 'Save Auto-Update Schedule'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 7: SETTINGS, SSL, TTS, DIAL-PLAN, MQTT & WHITELABELING */}
      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          {/* 7A: Networking, Unified TLS & Reverse Proxy Security */}
          <form onSubmit={handleSaveTls} className="glass-card highlight-cyan">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={20} color="var(--accent-cyan)" /> Networking, TLS Termination &amp; Reverse Proxy
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>
                  Run behind Traefik/Nginx/Caddy (Reverse Proxy mode), enable automatic Let’s Encrypt HTTPS, or serve an offline Local Root CA for LAN + ESP32 certificate pinning.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void fetchHealthAndSsl()} className="btn btn-secondary btn-sm">
                  <RefreshCw size={14} /> Re-Check TLS
                </button>
                {sslStatus?.restartRequired && (
                  <button
                    type="button"
                    onClick={() => void handleRestartServer()}
                    disabled={restartingServer}
                    className="btn btn-amber btn-sm"
                  >
                    <RotateCcw size={14} /> {restartingServer ? 'Restarting...' : 'Restart Server to Apply TLS'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Transport Protocol</span>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: isHttpsActive ? '#34d399' : 'var(--accent-amber)', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                  {String(detectedProto).toUpperCase()} {isHttpsActive ? '(Encrypted)' : '(Plain HTTP)'}
                </div>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Reverse Proxy Detection</span>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: isBehindProxy ? '#34d399' : 'var(--text-main)', marginTop: '0.2rem' }}>
                  {isBehindProxy ? 'Active (X-Forwarded-Proto)' : sslStatus?.trustProxyEffective ? 'Trust Proxy Enabled' : 'Direct Server Port'}
                </div>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Browser WebCrypto Context</span>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: browserSecureContext ? '#34d399' : 'var(--accent-amber)', marginTop: '0.2rem' }}>
                  {browserSecureContext ? 'Native WebCrypto + IDB' : 'HTTP JS Fallback Mode'}
                </div>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">
                  TLS Mode {sslStatus?.tlsModeEnvLocked && <span style={{ color: 'var(--accent-amber)' }}>(Env Overridden)</span>}
                </label>
                <select
                  className="form-select"
                  value={tlsMode}
                  disabled={Boolean(sslStatus?.tlsModeEnvLocked)}
                  onChange={(e) => setTlsMode(e.target.value as any)}
                >
                  <option value="proxy">Reverse Proxy / HTTP Mode (External TLS termination)</option>
                  <option value="acme">Let’s Encrypt ACME (Automatic Internet HTTPS)</option>
                  <option value="local_ca">Built-in Local Root CA (Private LAN HTTPS + ESP32 Pinning)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Express Trust Proxy {sslStatus?.trustProxyEnvLocked && <span style={{ color: 'var(--accent-amber)' }}>(Env Overridden)</span>}
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="form-input"
                    disabled={Boolean(sslStatus?.trustProxyEnvLocked)}
                    value={trustProxyInput}
                    onChange={(e) => setTrustProxyInput(e.target.value)}
                    placeholder="false, 1, or loopback,uniquelocal"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <button
                    type="button"
                    disabled={Boolean(sslStatus?.trustProxyEnvLocked)}
                    onClick={() => setTrustProxyInput(trustProxyInput === 'false' || !trustProxyInput ? '1' : 'false')}
                    className="btn btn-secondary btn-sm"
                  >
                    {trustProxyInput === 'false' || !trustProxyInput ? 'Enable (1 hop)' : 'Disable'}
                  </button>
                </div>
              </div>
            </div>

            {tlsMode === 'acme' && (
              <div style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid var(--border-subtle)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <div className="grid-2" style={{ marginBottom: '0.75rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">ACME Public Domain</label>
                    <input
                      type="text"
                      className="form-input"
                      value={acmeDomain}
                      onChange={(e) => setAcmeDomain(e.target.value)}
                      placeholder="phone.example.com"
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">ACME Contact Email</label>
                    <input
                      type="email"
                      className="form-input"
                      value={acmeEmail}
                      onChange={(e) => setAcmeEmail(e.target.value)}
                      placeholder="admin@example.com"
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <input type="checkbox" checked={acmeStaging} onChange={(e) => setAcmeStaging(e.target.checked)} />
                    Let’s Encrypt Staging CA &bull; {sslStatus?.acme?.hasCertificate ? `Expires ${new Date(sslStatus.acme.expiresAt).toLocaleDateString()} (${sslStatus.acme.daysRemaining}d)` : 'No ACME cert issued yet'}
                  </label>
                  <button type="button" onClick={() => void handleRenewAcme()} disabled={renewingAcme} className="btn btn-secondary btn-sm">
                    <RefreshCw size={14} className={renewingAcme ? 'spin' : ''} /> {renewingAcme ? 'Issuing Certificate...' : 'Issue / Renew ACME Cert Now'}
                  </button>
                </div>
                {sslStatus?.acme?.lastError && (
                  <p style={{ color: '#fda4af', fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
                    Last ACME error: {sslStatus.acme.lastError}
                  </p>
                )}
              </div>
            )}

            {tlsMode === 'local_ca' && (
              <div style={{ background: 'rgba(0,0,0,0.28)', border: '1px solid var(--border-subtle)', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                  <label className="form-label">Additional LAN Hostnames / IPs for SAN Certificate (comma-separated)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={localCaHosts}
                    onChange={(e) => setLocalCaHosts(e.target.value)}
                    placeholder="decatone.local, 192.168.1.50"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {sslStatus?.localCa?.initialized
                      ? `CA Fingerprint: ${sslStatus.localCa.fingerprintSha256}`
                      : 'Local Root CA will be generated on save'}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {sslStatus?.localCa?.initialized && (
                      <a href="/api/tls/ca.crt" download="decatone-local-ca.crt" className="btn btn-secondary btn-sm">
                        <Download size={14} /> Download Root CA (.crt)
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRegenerateLocalCa()}
                      disabled={regeneratingCa}
                      className="btn btn-secondary btn-sm"
                    >
                      <RotateCcw size={14} /> {regeneratingCa ? 'Regenerating...' : 'Regenerate Local CA'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingTls} className="btn btn-primary btn-sm">
                <CheckCircle2 size={14} /> {savingTls ? 'Applying TLS Policy...' : 'Save Networking & TLS Policy'}
              </button>
            </div>
          </form>

          {/* 7B: Dial-Plan & Extension Numbering Policy */}
          <form onSubmit={handleSaveDialPlan} className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Hash size={20} color="var(--accent-amber)" /> Dial-Plan & Extension Numbering Policy
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Configure allowed extension digit lengths, how new accounts receive numbers, and optional classic area code prefixes.
            </p>

            <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Min Extension Digits (2–15)</label>
                <input
                  type="number"
                  min="2"
                  max="15"
                  className="form-input"
                  value={dialMinLen}
                  onChange={(e) => setDialMinLen(parseInt(e.target.value, 10) || 2)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Max Extension Digits (2–15)</label>
                <input
                  type="number"
                  min="2"
                  max="15"
                  className="form-input"
                  value={dialMaxLen}
                  onChange={(e) => setDialMaxLen(parseInt(e.target.value, 10) || 4)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Extension Assignment Mode</label>
                <select
                  className="form-select"
                  value={dialAssignmentMode}
                  onChange={(e) => setDialAssignmentMode(e.target.value)}
                >
                  <option value="user_choice">User Choice (Select on Signup)</option>
                  <option value="sequential">Sequential Central-Office Allocation</option>
                  <option value="fixed_random">Random Available Extension</option>
                </select>
              </div>
            </div>

            <div className="grid-3" style={{ marginBottom: '1.25rem', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', height: '42px' }}>
                  <input
                    type="checkbox"
                    checked={dialAreaCodeEnabled}
                    onChange={(e) => setDialAreaCodeEnabled(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--accent-amber)' }}
                  />
                  <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>Enable Area Codes</span>
                </label>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Allowed Area Codes (comma-separated)</label>
                <input
                  type="text"
                  className="form-input"
                  value={dialAllowedAreaCodes}
                  onChange={(e) => setDialAllowedAreaCodes(e.target.value)}
                  placeholder="e.g. 212, 415, 312"
                  disabled={!dialAreaCodeEnabled}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Default Area Code</label>
                <input
                  type="text"
                  className="form-input"
                  value={dialDefaultAreaCode}
                  onChange={(e) => setDialDefaultAreaCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 212"
                  disabled={!dialAreaCodeEnabled}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingDialPlan} className="btn btn-amber btn-sm">
                <CheckCircle2 size={14} /> {savingDialPlan ? 'Saving Dial-Plan...' : 'Save Dial-Plan Policy'}
              </button>
            </div>
          </form>

          {/* 7C: System Voice & Dual Local Neural TTS */}
          <form onSubmit={handleSaveTts} className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.35rem' }}>
              <h3 style={{ fontSize: '1.15rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Volume2 size={20} color="var(--accent-cyan)" /> System Voice &amp; Dual Local Neural TTS
              </h3>
              <span className={`badge ${ttsStatus?.activeVoiceInstalled ? 'badge-online' : 'badge-amber'}`}>
                {ttsStatus?.activeVoiceInstalled
                  ? `Active: ${String(ttsStatus?.activeEngine || ttsEngine).toUpperCase()}`
                  : 'Download Needed for Selected Model'}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              100% offline local speech synthesis for 411 Speaking Clock, 711 Weather, 611 Line Diagnostics, and Voicemail prompts.
            </p>

            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Speech Synthesis Engine</label>
                <select
                  className="form-select"
                  value={ttsEngine}
                  onChange={(e) => {
                    const nextEng = e.target.value;
                    setTtsEngine(nextEng);
                    const match = allVoices.find((v) => v.engine === nextEng);
                    if (match) setTtsVoice(match.id);
                  }}
                >
                  <option value="piper">Piper Neural ONNX (~65 MB, Lightweight &amp; Fast — Default)</option>
                  <option value="kokoro">Kokoro-82M Neural ONNX (~86 MB, Ultra-Natural Studio Voice)</option>
                  <option value="espeak">eSpeak-NG (0 MB Built-In Retro Formant Synth)</option>
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginTop: '0.35rem' }}>
                  {ttsEngine === 'kokoro'
                    ? 'On-demand q8 ONNX weights auto-unload from RAM after 10 min idle.'
                    : ttsEngine === 'piper'
                    ? 'Recommended for Raspberry Pi & low-RAM Docker hosts.'
                    : 'Zero download instant fallback synth.'}
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Operator Voice Model</label>
                <select
                  className="form-select"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                >
                  {availableVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {ttsStatus?.downloadState?.status === 'downloading' && (
              <div style={{ marginBottom: '1rem', background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#fcd34d', marginBottom: '0.35rem' }}>
                  <span>{ttsStatus.downloadState.message || 'Downloading TTS model...'}</span>
                  <span>{ttsStatus.downloadState.progress || 0}%</span>
                </div>
                <div style={{ width: '100%', height: '7px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, ttsStatus.downloadState.progress || 0))}%`,
                      height: '100%',
                      background: 'var(--accent-amber)',
                      transition: 'width 0.25s ease'
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem', marginBottom: '1.25rem' }}>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.4rem' }}>
                Audition / Preview Operator Voice
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="form-input"
                  value={ttsPreviewText}
                  onChange={(e) => setTtsPreviewText(e.target.value)}
                  style={{ flex: '1 1 280px' }}
                />
                <button
                  type="button"
                  onClick={() => void handlePreviewTtsVoice()}
                  disabled={previewingTts || !ttsPreviewText.trim()}
                  className="btn btn-secondary btn-sm"
                >
                  <Play size={14} /> {previewingTts ? 'Synthesizing...' : 'Preview Voice'}
                </button>
              </div>
              {ttsPreviewUrl && (
                <div style={{ marginTop: '0.75rem' }}>
                  <audio controls autoPlay src={ttsPreviewUrl} style={{ height: '34px', width: '100%', maxWidth: '420px' }} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              {ttsEngine !== 'espeak' ? (
                <button
                  type="button"
                  onClick={() => void handleDownloadTtsModel()}
                  disabled={downloadingTts || ttsStatus?.downloadState?.status === 'downloading'}
                  className="btn btn-secondary btn-sm"
                >
                  <Download size={14} /> {downloadingTts || ttsStatus?.downloadState?.status === 'downloading' ? 'Downloading Weights...' : 'Download / Verify Selected Weights'}
                </button>
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>eSpeak-NG uses local OS binary</span>
              )}

              <button type="submit" disabled={savingTts} className="btn btn-primary btn-sm">
                <CheckCircle2 size={14} /> {savingTts ? 'Saving...' : 'Save TTS Voice Settings'}
              </button>
            </div>
          </form>

          {/* 7D: Home Assistant MQTT Integration */}
          <form onSubmit={handleSaveMqtt} className="glass-card">
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Radio size={20} color="var(--accent-amber)" /> Home Assistant MQTT Integration
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Publish real-time hook state, dialed digits, and incoming call sensors to Home Assistant via MQTT auto-discovery.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={mqttEnabled}
                  onChange={(e) => setMqttEnabled(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                />
                <strong style={{ color: '#fff', fontSize: '0.95rem' }}>Enable Home Assistant MQTT Bridge</strong>
              </label>
            </div>

            <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">MQTT Broker Host</label>
                <input
                  type="text"
                  className="form-input"
                  value={mqttHost}
                  onChange={(e) => setMqttHost(e.target.value)}
                  placeholder="homeassistant.local"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Broker Port</label>
                <input
                  type="text"
                  className="form-input"
                  value={mqttPort}
                  onChange={(e) => setMqttPort(e.target.value.replace(/\D/g, ''))}
                  placeholder="1883"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Dial Automation PIN</label>
                <input
                  type="text"
                  className="form-input"
                  value={mqttPin}
                  onChange={(e) => setMqttPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="512"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">MQTT Username</label>
                <input
                  type="text"
                  className="form-input"
                  value={mqttUser}
                  onChange={(e) => setMqttUser(e.target.value)}
                  placeholder="Optional broker username"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">MQTT Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={mqttPass}
                  onChange={(e) => setMqttPass(e.target.value)}
                  placeholder="Optional broker password"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingMqtt} className="btn btn-amber btn-sm">
                <CheckCircle2 size={14} /> {savingMqtt ? 'Saving MQTT...' : 'Save MQTT Integration'}
              </button>
            </div>
          </form>

          {/* 7E: Branding, SMTP & Legal Markdown Form */}
          <form onSubmit={handleSaveSettings} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <Sliders size={18} color="var(--accent-cyan)" /> Program Branding, SMTP Mail & Legal Policies
              </h3>
              <a
                href="https://github.com/TylerHats/DecaTone/wiki/User-and-Admin-Guide"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', textDecoration: 'none' }}
              >
                <HelpCircle size={14} /> Admin & Policies Guide <ExternalLink size={12} />
              </a>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <h4 style={{ fontSize: '1.05rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Globe size={18} /> Program Branding, Favicons & Navbar Icons
                </h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Customize your switchboard's brand name, header logo, browser tab favicon, and top-right program icons.
                </p>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Application Display Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={settings.app_name || ''}
                    onChange={(e) => setSettings({ ...settings, app_name: e.target.value })}
                    placeholder="e.g. DecaTone"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Brand Logo Image (PNG / JPEG / WebP)</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                    style={{ color: 'var(--text-muted)' }}
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Browser Tab Favicon (.ico / .png)</label>
                  <input
                    type="file"
                    accept="image/png,image/x-icon"
                    onChange={(e) => setFaviconFile(e.target.files?.[0] || null)}
                    style={{ color: 'var(--text-muted)' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Top-Right / Navbar Program Icon (PNG / JPEG / WebP)</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setNavbarIconFile(e.target.files?.[0] || null)}
                    style={{ color: 'var(--text-muted)' }}
                  />
                </div>
              </div>

              {/* Service Lines & HA Triggers */}
              <div className="grid-3">
                <div className="form-group">
                  <label className="form-label">411 Speaking Clock Timezone (IANA)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={settings.system_timezone || 'America/New_York'}
                    onChange={(e) => setSettings({ ...settings, system_timezone: e.target.value })}
                    placeholder="America/New_York"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">711 Weather Location</label>
                  <input
                    type="text"
                    className="form-input"
                    value={settings.weather_location || ''}
                    onChange={(e) => setSettings({ ...settings, weather_location: e.target.value })}
                    placeholder="New York"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">711 Weather Units</label>
                  <select
                    className="form-select"
                    value={settings.weather_units || 'imperial'}
                    onChange={(e) => setSettings({ ...settings, weather_units: e.target.value })}
                  >
                    <option value="imperial">Imperial (°F, mph)</option>
                    <option value="metric">Metric (°C, km/h)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Home Assistant 90x Rotary Triggers JSON (e.g. 901–909)</label>
                <input
                  type="text"
                  className="form-input"
                  value={settings.ha_rotary_triggers_json || '{"901":"Living Room Lights","902":"Goodnight Scene"}'}
                  onChange={(e) => setSettings({ ...settings, ha_rotary_triggers_json: e.target.value })}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '1rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => void handleResetBranding()}
                  className="btn btn-secondary btn-sm"
                >
                  Reset Brand Icons to Default
                </button>
              </div>
            </div>

            {/* SMTP Outbound Mail Dispatcher Configuration */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <h4 style={{ fontSize: '1.05rem', color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Mail size={18} /> SMTP Outbound Mail Server & Notifications
                </h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Configure SMTP to enable self-service password recovery, new user welcome greetings, and voicemail/missed call email alerts.
                </p>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">SMTP Host / Server</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. smtp.gmail.com or mail.example.com"
                    value={settings.smtp_host || ''}
                    onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">SMTP Port</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="587 (TLS), 465 (SSL), or 25"
                    value={settings.smtp_port || ''}
                    onChange={(e) => setSettings({ ...settings, smtp_port: e.target.value })}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">SMTP Username</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. your-email@gmail.com"
                    value={settings.smtp_user || ''}
                    onChange={(e) => setSettings({ ...settings, smtp_user: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">SMTP Password / App Key</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••••••••••"
                    value={settings.smtp_pass || ''}
                    onChange={(e) => setSettings({ ...settings, smtp_pass: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">From Header / Sender Address</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="DecaTone Switchboard <switchboard@example.com>"
                    value={settings.smtp_from || ''}
                    onChange={(e) => setSettings({ ...settings, smtp_from: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Security & Encryption</label>
                  <select
                    className="form-select"
                    value={settings.smtp_secure || 'false'}
                    onChange={(e) => setSettings({ ...settings, smtp_secure: e.target.value })}
                  >
                    <option value="false">STARTTLS / Plain (Default for Port 587 / 25)</option>
                    <option value="true">SSL / Direct TLS (Port 465)</option>
                  </select>
                </div>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>
                  Test SMTP Outbound Dispatcher
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="Enter recipient email (e.g. you@example.com)"
                    value={testEmailInput}
                    onChange={(e) => setTestEmailInput(e.target.value)}
                    style={{ maxWidth: '320px' }}
                  />
                  <button
                    type="button"
                    onClick={(e) => void handleSendTestEmail(e)}
                    disabled={sendingTestEmail || !testEmailInput.trim()}
                    className="btn btn-secondary btn-sm"
                  >
                    <Mail size={14} /> {sendingTestEmail ? 'Sending...' : 'Send Test Email'}
                  </button>
                </div>

                {smtpTestResult && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: smtpTestResult.success ? 'rgba(52, 211, 153, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                      border: `1px solid ${smtpTestResult.success ? 'rgba(52, 211, 153, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                      color: smtpTestResult.success ? '#34d399' : '#fda4af'
                    }}
                  >
                    {smtpTestResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    {smtpTestResult.message}
                  </div>
                )}
              </div>
            </div>

            {/* Legal Terms & Privacy Policy Customization */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h4 style={{ fontSize: '1.05rem', color: 'var(--accent-cyan)' }}>
                Legal Agreements & Registration Policy
              </h4>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="requireTermsToggle"
                  checked={settings.require_terms_on_signup !== 'false'}
                  onChange={(e) => setSettings({ ...settings, require_terms_on_signup: e.target.checked ? 'true' : 'false' })}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="requireTermsToggle" style={{ fontSize: '0.9rem', color: '#fff', cursor: 'pointer' }}>
                  Require users to agree to Terms & Emergency 911 Disclaimer on Registration
                </label>
              </div>

              <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Terms of Service & 911 Disclaimer (Markdown)</label>
                  <textarea
                    className="form-input"
                    rows={8}
                    value={settings.terms_of_service || ''}
                    onChange={(e) => setSettings({ ...settings, terms_of_service: e.target.value })}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Privacy Policy & Zero-Access Storage (Markdown)</label>
                  <textarea
                    className="form-input"
                    rows={8}
                    value={settings.privacy_policy || ''}
                    onChange={(e) => setSettings({ ...settings, privacy_policy: e.target.value })}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                  />
                </div>
              </div>
            </div>

            <button type="submit" disabled={savingSettings} className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-end' }}>
              {savingSettings ? 'Saving...' : 'Save Branding, SMTP & Legal Settings'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 8: SYSTEM WIPE */}
      {activeTab === 'wipe' && (
        <div className="glass-card" style={{ border: '2px solid rgba(244, 63, 94, 0.4)' }}>
          <h3 style={{ fontSize: '1.25rem', color: '#fda4af', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={22} color="#f43f5e" /> Factory Reset / System Wipe
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            This will permanently delete all user accounts, paired phones, call history, voicemails, and system preferences. DecaTone will return to its out-of-box setup state.
          </p>

          <button onClick={() => void handleSystemWipe()} className="btn btn-danger btn-lg">
            <Trash2 size={18} /> Execute Factory Reset & Wipe System
          </button>
        </div>
      )}
    </div>
  );
};
