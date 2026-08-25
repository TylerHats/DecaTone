import React, { useState, useEffect } from 'react';
import {
  Shield, Users, Cpu, Database, RefreshCw, Upload, Download, Trash2, Key,
  Lock, AlertTriangle, CheckCircle2, Sliders, BellRing, Smartphone, Server,
  Globe, Mail, FileArchive, ArrowUpRight
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

  // Updates
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  // Settings
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

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
    fetchUpdateCheck();
    fetchSettings();
    fetchHealth();
  }, []);

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phoneNumber: newNumberInput, areaCode: newAreaCodeInput })
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: 'User extension updated' });
        setSelectedUserForNumber(null);
        fetchUsers();
      } else {
        setToast({ type: 'error', text: data.error });
      }
    } catch (e) {}
  };

  const handleDeleteUser = async (userId: number) => {
    if (!window.confirm('Permanently delete this user and their call history?')) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
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
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setToast({ type: 'success', text: `Test ring signal dispatched to ${deviceId}` });
      else setToast({ type: 'error', text: 'Device offline' });
    } catch (e) {}
  };

  const handleFleetReboot = async (deviceId: string) => {
    try {
      const res = await fetch(`/api/admin/fleet/${deviceId}/reboot`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setToast({ type: 'success', text: `Reboot command sent to ${deviceId}` });
      else setToast({ type: 'error', text: 'Device offline' });
    } catch (e) {}
  };

  const handleFleetUnpair = async (deviceId: string) => {
    if (!window.confirm(`Unpair ${deviceId} from its assigned user?`)) return;
    try {
      await fetch(`/api/admin/fleet/${deviceId}/unpair`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchFleet();
      fetchUsers();
    } catch (e) {}
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
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
        setFirmwareFile(null);
        fetchFirmwareInfo();
      } else {
        setToast({ type: 'error', text: data.error });
      }
    } catch (e) {}
    setUploadingFw(false);
  };

  // Backups Actions
  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await fetch('/api/admin/backups/create', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setToast({ type: 'success', text: 'Compressed backup archive created!' });
        fetchBackups();
        fetchMetrics();
      }
    } catch (e) {}
    setCreatingBackup(false);
  };

  const handleRestoreBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreFile && !window.confirm('Proceed with backup restoration? Current database will be updated.')) return;

    setRestoring(true);
    const formData = new FormData();
    if (restoreFile) formData.append('backup_file', restoreFile);

    try {
      const res = await fetch('/api/admin/backups/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setToast({ type: 'success', text: data.message });
        setRestoreFile(null);
        fetchMetrics();
        fetchUsers();
        fetchFleet();
      } else {
        setToast({ type: 'error', text: data.error });
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

      await refreshBranding();
      setToast({ type: 'success', text: 'System settings & whitelabel configuration saved!' });
    } catch (e) {}
    setSavingSettings(false);
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={18} color="var(--accent-amber)" /> Connected ESP32-S3 Hardware Fleet
            </h3>
            <button onClick={fetchFleet} className="btn btn-secondary btn-sm">
              <RefreshCw size={14} /> Refresh Fleet
            </button>
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
          <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Smartphone size={20} color="var(--accent-cyan)" /> ESP32-S3 Over-The-Air (OTA) Firmware Manager
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Upload a compiled <code style={{ fontFamily: 'var(--font-mono)' }}>firmware.bin</code> binary to publish a new firmware release. Connected ESP32-S3 boards will automatically receive the OTA update notification.
          </p>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Current Published Version:</span>
                <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)', fontWeight: '700' }}>
                  v{firmwareInfo?.version || '1.0.0'}
                </div>
              </div>

              {firmwareInfo?.hasBinary && (
                <a href="/api/firmware/download/latest" download="firmware.bin" className="btn btn-secondary btn-sm">
                  <Download size={14} /> Download Current Binary (.bin)
                </a>
              )}
            </div>
          </div>

          <form onSubmit={handleUploadFirmware} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Firmware Version String</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={firmwareVersionInput}
                  onChange={(e) => setFirmwareVersionInput(e.target.value)}
                  placeholder="e.g. 1.1.0"
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

            <button type="submit" disabled={!firmwareFile || uploadingFw} className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }}>
              <Upload size={18} /> {uploadingFw ? 'Uploading Firmware...' : 'Publish & Broadcast OTA Update'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 5: BACKUPS & RESTORE */}
      {activeTab === 'backups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card highlight-amber" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem' }}>Compressed System Backups (.tar.gz)</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Bundles SQLite database, custom branding, and voicemail audio files with schema version tracking.
              </p>
            </div>

            <button onClick={handleCreateBackup} disabled={creatingBackup} className="btn btn-amber btn-lg">
              <FileArchive size={18} /> {creatingBackup ? 'Compressing Archive...' : 'Create Backup Archive'}
            </button>
          </div>

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
              Upload a previous <code style={{ fontFamily: 'var(--font-mono)' }}>.tar.gz</code> archive. Database migrations will execute automatically.
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
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem' }}>DecaTone System Self-Updater</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Fetch updates and new releases directly from GitHub repository.
              </p>
            </div>

            <button onClick={fetchUpdateCheck} disabled={checkingUpdate} className="btn btn-secondary btn-sm">
              <RefreshCw size={14} /> {checkingUpdate ? 'Checking GitHub...' : 'Check for Updates'}
            </button>
          </div>

          <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Installed Version:</span>
              <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', fontWeight: '700', color: '#fff' }}>
                v{updateInfo?.currentVersion || '1.0.0'}
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Release Channel:</span>
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

          {updateInfo?.updateAvailable ? (
            <div style={{ background: 'rgba(14, 165, 233, 0.15)', border: '1px solid rgba(14, 165, 233, 0.3)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
              <h4 style={{ color: '#38bdf8', marginBottom: '0.5rem' }}>Update Available!</h4>
              <p style={{ color: 'var(--text-main)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                {updateInfo?.latestRelease?.name || `Version ${updateInfo?.targetVersion}`} is ready to install.
              </p>
              <button onClick={handleApplyUpdate} disabled={applyingUpdate} className="btn btn-primary btn-lg">
                <RefreshCw size={18} /> {applyingUpdate ? 'Updating DecaTone...' : 'Apply Update & Reboot Container'}
              </button>
            </div>
          ) : (
            <div style={{ color: '#34d399', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} /> DecaTone is running the latest available version on the {updateInfo?.channel} channel.
            </div>
          )}
        </div>
      )}

      {/* TAB 7: SETTINGS & WHITELABELING */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Sliders size={18} color="var(--accent-cyan)" /> System Settings & Phone Policy
          </h3>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Application Branding Name</label>
              <input
                type="text"
                className="form-input"
                value={settings.app_name || ''}
                onChange={(e) => setSettings({ ...settings, app_name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Custom Logo Image (PNG / SVG)</label>
              <input
                type="file"
                accept="image/png,image/svg+xml"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                style={{ color: 'var(--text-muted)' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Extension Digits Length</label>
              <select
                className="form-select"
                value={settings.phone_number_length || '3'}
                onChange={(e) => setSettings({ ...settings, phone_number_length: e.target.value })}
              >
                <option value="2">2 Digits (10-99)</option>
                <option value="3">3 Digits (100-999)</option>
                <option value="4">4 Digits (1000-9999)</option>
                <option value="5">5 Digits (10000-99999)</option>
                <option value="7">7 Digits (Standard Local Phone Number)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Area Code Support</label>
              <select
                className="form-select"
                value={settings.area_code_enabled || 'false'}
                onChange={(e) => setSettings({ ...settings, area_code_enabled: e.target.value })}
              >
                <option value="false">Disabled (Extension Only)</option>
                <option value="true">Enabled (Area Code + Extension)</option>
              </select>
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
