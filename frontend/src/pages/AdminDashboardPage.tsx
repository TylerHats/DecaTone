import React, { useState, useEffect } from 'react';
import {
  Shield, Users, Cpu, Database, RefreshCw, Upload, Download, Trash2, Key,
  Lock, AlertTriangle, CheckCircle2, Sliders, BellRing, Smartphone, Server,
  Globe, Mail, FileArchive, ArrowUpRight, Clock, ExternalLink, HelpCircle, BookOpen, Sparkles, RotateCcw
} from 'lucide-react';
import { useBranding } from '../context/BrandingContext';

export const AdminDashboardPage: React.FC = () => {
  const { appName, logoUrl, refreshBranding } = useBranding();

  const [activeTab, setActiveTab] = useState<'metrics' | 'users' | 'fleet' | 'ota' | 'backups' | 'updates' | 'settings' | 'wipe'>('metrics');

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
  const [firmwareVersionInput, setFirmwareVersionInput] = useState('1.1.0');
  const [uploadingFw, setUploadingFw] = useState(false);

  // Backups
  const [backups, setBackups] = useState<any[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
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

  // Diagnostics
  const [healthInfo, setHealthInfo] = useState<any>(null);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const token = localStorage.getItem('decatone_token');

  useEffect(() => {
    fetchMetrics();
    fetchUsers();
    fetchFleet();
    fetchFirmwareInfo();
    fetchBackups();
    fetchBackupSettings();
    fetchUpdateCheck();
    fetchUpdateSettings();
    fetchSettings();
    fetchHealth();
  }, []);

  const fetchBackupSettings = async () => {
    try {
      const res = await fetch('/api/admin/backups/settings', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setAutoBackupEnabled(data.autoBackupEnabled);
        setAutoBackupInterval(data.autoBackupInterval);
        setAutoBackupTime(data.autoBackupTime);
        setBackupRetentionCount(data.backupRetentionCount);
      }
    } catch (e) {}
  };

  const fetchUpdateSettings = async () => {
    try {
      const res = await fetch('/api/admin/update/settings', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setServerAutoUpdateEnabled(data.autoUpdateEnabled);
        setServerAutoUpdateChannel(data.autoUpdateChannel);
        setServerAutoUpdateTime(data.autoUpdateTime);
        setServerAutoUpdateFrequency(data.autoUpdateFrequency);
      }
    } catch (e) {}
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/admin/metrics', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.stats);
      }
    } catch (e) {}
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) {}
  };

  const fetchFleet = async () => {
    try {
      const res = await fetch('/api/admin/fleet', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setFleet(data.phones || []);
      }
    } catch (e) {}
  };

  const fetchFirmwareInfo = async () => {
    try {
      const res = await fetch('/api/firmware/info');
      if (res.ok) {
        const data = await res.json();
        setFirmwareInfo(data);
      }
    } catch (e) {}
  };

  const fetchBackups = async () => {
    try {
      const res = await fetch('/api/admin/backups', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      }
    } catch (e) {}
  };

  const fetchUpdateCheck = async () => {
    setCheckingUpdate(true);
    try {
      const res = await fetch('/api/admin/update/check', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
      }
    } catch (e) {}
    setCheckingUpdate(false);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || {});
      }
    } catch (e) {}
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealthInfo(data);
      }
    } catch (e) {}
  };

  // User Actions
  const handleUpdateRole = async (userId: number, role: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role })
      });
      if (res.ok) {
        setToast({ type: 'success', text: 'User role updated' });
        fetchUsers();
      }
    } catch (e) {}
  };

  const handleToggleDisable = async (userId: number, currentDisabled: boolean) => {
    const reason = !currentDisabled ? prompt('Enter reason for disabling account:') : '';
    if (!currentDisabled && reason === null) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isDisabled: !currentDisabled, disabledReason: reason })
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (e) {}
  };

  const handleResetPassword = async () => {
    if (!selectedUserForPassword || !newPasswordInput) return;
    try {
      const res = await fetch(`/api/admin/users/${selectedUserForPassword.id}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword: newPasswordInput })
      });
      if (res.ok) {
        setToast({ type: 'success', text: `Password for @${selectedUserForPassword.username} has been reset` });
        setSelectedUserForPassword(null);
        setNewPasswordInput('');
      }
    } catch (e) {}
  };

  const handleUpdateNumber = async () => {
    if (!selectedUserForNumber || !newNumberInput) return;
    try {
      const res = await fetch(`/api/admin/users/${selectedUserForNumber.id}/phone-number`, {
        method: 'PUT',
        body: JSON.stringify({ phoneNumber: newNumberInput, areaCode: newAreaCodeInput })
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: "success", text: "User extension updated" });
        setSelectedUserForNumber(null);
        fetchUsers();
      } else {
        setToast({ type: "error", text: data.error });
      }
    } catch (e) {}
  };

  const handleDeleteUser = async (userId: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUsers();
        fetchMetrics();
      }
    } catch (e) {}
  };

  // Fleet Actions
  const handleFleetTestRing = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${deviceId}/test-ring`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setToast({ type: "success", text: `Test ring signal dispatched to ${deviceId}` });
      else setToast({ type: "error", text: "Device offline" });
    } catch (e) {}
  };

  const handleFleetReboot = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${deviceId}/reboot`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setToast({ type: "success", text: `Reboot command sent to ${deviceId}` });
      else setToast({ type: "error", text: "Device offline" });
    } catch (e) {}
  };

  const handleFleetUnpair = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${deviceId}/unpair`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setToast({ type: "success", text: `Device ${deviceId} unpaired successfully` });
        fetchFleet();
        fetchUsers();
      }
    } catch (e) {}
  };

  // OTA Firmware Actions
  const handleUploadFirmware = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firmwareFile) return;

    setUploadingFw(true);
    const formData = new FormData();
    formData.append("firmware", firmwareFile);
    formData.append("version", firmwareVersionInput);

    try {
      const res = await fetch("/api/admin/firmware/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: "success", text: data.message });
        setFirmwareFile(null);
        fetchFirmwareInfo();
      } else {
        setToast({ type: "error", text: data.error });
      }
    } catch (e) {}
    setUploadingFw(false);
  };

  // Backups Actions
  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await fetch("/api/admin/backups/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setToast({ type: "success", text: "Compressed backup archive created!" });
        fetchBackups();
        fetchMetrics();
      }
    } catch (e) {}
    setCreatingBackup(false);
  };

  const handleRestoreBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreFile && !window.confirm("Proceed with backup restoration? Current database will be updated.")) return;

    setRestoring(true);
    const formData = new FormData();
    if (restoreFile) formData.append("backup_file", restoreFile);

    try {
      const res = await fetch("/api/admin/backups/restore", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: "success", text: data.message });
        setRestoreFile(null);
        fetchMetrics();
        fetchUsers();
        fetchFleet();
      } else {
        setToast({ type: "error", text: data.error });
      }
    } catch (e) {}
    setRestoring(false);
  };

  // Self-Updater Actions
  const handleChangeChannel = async (channel: string) => {
    try {
      await fetch('/api/admin/update/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel })
      });
      fetchUpdateCheck();
    } catch (e) {}
  };

  const handleApplyUpdate = async () => {
    if (!window.confirm('Apply update? DecaTone will update in-container and reboot in 5 seconds.')) return;
    setApplyingUpdate(true);
    try {
      const res = await fetch('/api/admin/update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetVersion: updateInfo?.targetVersion })
      });
      const data = await res.json();
      setToast({ type: 'success', text: data.message });
    } catch (e) {}
  };

  // Backups Settings Action
  const handleSaveBackupSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBackupSettings(true);
    try {
      const res = await fetch('/api/admin/backups/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          autoBackupEnabled,
          autoBackupInterval,
          autoBackupTime,
          backupRetentionCount
        })
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
      } else {
        setToast({ type: 'error', text: data.error });
      }
    } catch (e) {}
    setSavingBackupSettings(false);
  };

  // Server Auto-Update Settings Action
  const handleSaveUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUpdateSettings(true);
    try {
      const res = await fetch('/api/admin/update/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          autoUpdateEnabled: serverAutoUpdateEnabled,
          autoUpdateChannel: serverAutoUpdateChannel,
          autoUpdateTime: serverAutoUpdateTime,
          autoUpdateFrequency: serverAutoUpdateFrequency
        })
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
        fetchUpdateCheck();
      } else {
        setToast({ type: 'error', text: data.error });
      }
    } catch (e) {}
    setSavingUpdateSettings(false);
  };

  // Broadcast OTA to fleet
  const handleBroadcastOta = async () => {
    if (!window.confirm('Broadcast OTA update command to all currently online physical rotary phones?')) return;
    setBroadcastingOta(true);
    try {
      const res = await fetch('/api/admin/firmware/ota-broadcast', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
      } else {
        setToast({ type: 'error', text: data.error });
      }
    } catch (e) {}
    setBroadcastingOta(false);
  };

  const handleResetFirmwareOverride = async () => {
    if (!window.confirm('Clear custom firmware override and revert to the official release binary?')) return;
    try {
      const res = await fetch('/api/admin/firmware/reset-override', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
        fetchFirmwareInfo();
      }
    } catch (e) {}
  };

  // Settings Actions
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      // 1. Save system settings
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings })
      });

      // 2. Upload Logo if selected
      if (logoFile) {
        const formData = new FormData();
        formData.append('logo', logoFile);
        await fetch('/api/admin/branding/logo', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        setLogoFile(null);
      }

      // 3. Upload Favicon if selected
      if (faviconFile) {
        const formData = new FormData();
        formData.append('favicon', faviconFile);
        await fetch('/api/admin/branding/favicon', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        setFaviconFile(null);
      }

      // 4. Upload Navbar Icon if selected
      if (navbarIconFile) {
        const formData = new FormData();
        formData.append('navbar_icon', navbarIconFile);
        await fetch('/api/admin/branding/navbar-icon', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        setNavbarIconFile(null);
      }

      await refreshBranding();
      setToast({ type: 'success', text: 'System settings & brand assets saved!' });
    } catch (e) {}
    setSavingSettings(false);
  };

  const handleResetBranding = async () => {
    if (!window.confirm('Reset brand logo, favicons, and program icons to factory defaults?')) return;
    try {
      const res = await fetch('/api/admin/branding/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await refreshBranding();
        setToast({ type: 'success', text: 'Branding assets reset to default' });
      }
    } catch (e) {}
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailInput.trim()) return;

    setSendingTestEmail(true);
    setSmtpTestResult(null);

    try {
      const res = await fetch('/api/admin/smtp/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ testEmail: testEmailInput.trim() })
      });

      const data = await res.json();
      if (res.ok) {
        setSmtpTestResult({ success: true, message: data.message });
      } else {
        setSmtpTestResult({ success: false, message: data.error || 'SMTP test failed' });
      }
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message || 'SMTP connection failed' });
    } finally {
      setSendingTestEmail(false);
    }
  };

  // Factory Reset
  const handleSystemWipe = async () => {
    const conf1 = prompt('⚠️ WARNING: This will PERMANENTLY ERASE all users, phones, call logs, and data. Type "ERASE" to confirm:');
    if (conf1 !== 'ERASE') return;

    try {
      const res = await fetch('/api/admin/system/wipe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        alert('DecaTone has been wiped to factory defaults. Redirecting to setup wizard...');
        localStorage.removeItem('decatone_token');
        window.location.href = '/';
      }
    } catch (e) {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Admin Header */}
      <div className="glass-card highlight-amber" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Shield size={26} color="var(--accent-amber)" /> DecaTone Admin Center
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            System metrics, phone fleet management, OTA firmware updates, backups, and whitelabeling.
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
            background: toast.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            border: `1px solid ${toast.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            color: toast.type === 'success' ? '#34d399' : '#fda4af'
          }}
        >
          {toast.text}
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
                  <span style={{ color: 'var(--text-muted)' }}>Uploads & Media Directory</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{((metrics?.uploadsSizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
              </div>
            </div>

            <div className="glass-card">
              <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Network & Reverse Proxy Diagnostics</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Detected Protocol</span>
                  <strong style={{ color: 'var(--accent-cyan)' }}>{healthInfo?.detectedProtocol || 'http'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Reverse Proxy Detected</span>
                  <span style={{ color: healthInfo?.isBehindProxy ? '#34d399' : 'var(--text-dim)' }}>
                    {healthInfo?.isBehindProxy ? 'Yes (SSL Termination Handled by Proxy)' : 'No (Direct Server Connection)'}
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
                      <strong>{u.display_name || u.username}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>@{u.username}</div>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-amber)' }}>
                        EXT {u.phone_number || '---'}
                      </span>
                    </td>
                    <td>
                      <select
                        className="form-select"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '90px' }}
                        value={u.role}
                        onChange={(e) => handleUpdateRole(u.id, e.target.value)}
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
                            setNewNumberInput(u.phone_number || '');
                            setNewAreaCodeInput(u.area_code || '');
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
                          onClick={() => handleToggleDisable(u.id, !!u.is_disabled)}
                          className="btn btn-secondary btn-sm"
                          title={u.is_disabled ? 'Enable Account' : 'Disable Account'}
                        >
                          <Lock size={14} color={u.is_disabled ? '#34d399' : '#f59e0b'} />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id)}
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
                <h3 style={{ marginBottom: '1rem' }}>Reset Password for @{selectedUserForPassword.username}</h3>
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="Enter at least 6 characters"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button onClick={() => setSelectedUserForPassword(null)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button onClick={handleResetPassword} disabled={newPasswordInput.length < 6} className="btn btn-primary">
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
                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button onClick={() => setSelectedUserForNumber(null)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button onClick={handleUpdateNumber} disabled={!newNumberInput} className="btn btn-amber">
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
              <button onClick={fetchFleet} className="btn btn-secondary btn-sm">
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
                  <tr key={p.id}>
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
                          onClick={() => handleFleetTestRing(p.device_id)}
                          disabled={!p.is_online}
                          className="btn btn-secondary btn-sm"
                          title="Test Ring"
                        >
                          <BellRing size={14} />
                        </button>
                        <button
                          onClick={() => handleFleetReboot(p.device_id)}
                          disabled={!p.is_online}
                          className="btn btn-secondary btn-sm"
                          title="Remote Reboot"
                        >
                          <RefreshCw size={14} />
                        </button>
                        {p.user_id && (
                          <button
                            onClick={() => handleFleetUnpair(p.device_id)}
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
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  v{firmwareInfo?.version || '1.2.0'}
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
                  <button onClick={handleResetFirmwareOverride} className="btn btn-secondary btn-sm">
                    <RotateCcw size={14} /> Revert to Official Release
                  </button>
                )}

                {firmwareInfo?.hasBinary && (
                  <a href="/api/firmware/download/latest" download="firmware.bin" className="btn btn-secondary btn-sm">
                    <Download size={14} /> Download Binary (.bin)
                  </a>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleUploadFirmware} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Firmware Version String (e.g. Custom Build)</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={firmwareVersionInput}
                  onChange={(e) => setFirmwareVersionInput(e.target.value)}
                  placeholder="e.g. 1.2.0-custom"
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
                onClick={handleBroadcastOta}
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
                Complete zero-loss archive of SQLite database, user settings, admin policies, custom brand assets, and voicemail recordings.
              </p>
            </div>

            <button onClick={handleCreateBackup} disabled={creatingBackup} className="btn btn-amber btn-lg">
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
                        {new Date(b.created_at).toLocaleString()} &bull; {(b.sizeBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <a href={`/api/admin/backups/download/${b.filename}`} className="btn btn-secondary btn-sm">
                        <Download size={14} /> Download
                      </a>
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
              Upload a previous <code style={{ fontFamily: 'var(--font-mono)' }}>.tar.gz</code> archive. 100% of user data, database records, custom brand icons, and voicemail audio will be restored.
            </p>

            <form onSubmit={handleRestoreBackup} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
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

              <button onClick={fetchUpdateCheck} disabled={checkingUpdate} className="btn btn-secondary btn-sm">
                <RefreshCw size={14} /> {checkingUpdate ? 'Checking GitHub...' : 'Check for Updates'}
              </button>
            </div>

            <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Installed Server Version:</span>
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#fff' }}>
                  v{updateInfo?.currentVersion || '1.0.0'}
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
                  onChange={(e) => handleChangeChannel(e.target.value)}
                >
                  <option value="stable">Stable Channel</option>
                  <option value="beta">Beta Channel (Tags)</option>
                  <option value="alpha">Alpha Channel (Main Commits)</option>
                </select>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Target Version:</span>
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-amber)' }}>
                  {updateInfo?.targetVersion || '---'}
                </div>
              </div>
            </div>

            {/* Docker Environment Notice */}
            {updateInfo?.isDocker ? (
              <div style={{ background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <h4 style={{ color: '#38bdf8', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🐳 Docker Environment Detected
                </h4>
                <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                  DecaTone is running inside a Docker container. In-app git modifications are safely disabled to preserve container immutability. The release channel selected above determines which firmware is offered to connected physical phones.
                </p>
                <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#a5f3fc' }}>
                  docker pull {updateInfo?.dockerImage || 'ghcr.io/tylerhats/decatone:latest'} && docker compose up -d
                </div>
              </div>
            ) : updateInfo?.updateAvailable ? (
              <div style={{ background: 'rgba(14, 165, 233, 0.15)', border: '1px solid rgba(14, 165, 233, 0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                <h4 style={{ color: '#38bdf8', marginBottom: '0.5rem' }}>Update Available!</h4>
                <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  {updateInfo?.latestRelease?.name || `Version ${updateInfo?.targetVersion}`} is ready to install.
                </p>
                <button onClick={handleApplyUpdate} disabled={applyingUpdate} className="btn btn-primary btn-lg">
                  <RefreshCw size={18} /> {applyingUpdate ? 'Updating DecaTone...' : 'Apply Update & Reboot Service'}
                </button>
              </div>
            ) : (
              <div style={{ color: '#34d399', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={16} /> DecaTone is running the latest available version on the {updateInfo?.channel} channel.
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

      {/* TAB 7: SETTINGS & WHITELABELING */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <Sliders size={18} color="var(--accent-cyan)" /> System Settings, Icons & Branding
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

          {/* Program Icons & Custom Branding Section */}
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
                <label className="form-label">Brand Logo Image (Header / Login)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Browser Tab Favicon (.png / .ico)</label>
                <input
                  type="file"
                  accept="image/png,image/x-icon,image/svg+xml"
                  onChange={(e) => setFaviconFile(e.target.files?.[0] || null)}
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Top-Right / Navbar Program Icon (.png / .svg)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(e) => setNavbarIconFile(e.target.files?.[0] || null)}
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '1rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={handleResetBranding}
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

            {/* Test Email Dispatcher Diagnostic Box */}
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '1rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#fff', marginBottom: '0.5rem' }}>
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
                  onClick={handleSendTestEmail}
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
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Privacy Policy & Zero-Access Storage (Markdown)</label>
                <textarea
                  className="form-input"
                  rows={8}
                  value={settings.privacy_policy || ''}
                  onChange={(e) => setSettings({ ...settings, privacy_policy: e.target.value })}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>
            </div>
          </div>

          <button type="submit" disabled={savingSettings} className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-end' }}>
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
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

          <button onClick={handleSystemWipe} className="btn btn-danger btn-lg">
            <Trash2 size={18} /> Execute Factory Reset & Wipe System
          </button>
        </div>
      )}
    </div>
  );
};
