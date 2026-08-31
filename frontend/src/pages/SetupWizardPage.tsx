import React, { useState } from 'react';
import { Phone, Shield, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';

export const SetupWizardPage: React.FC = () => {
  const { login } = useAuth();
  const { appName, logoUrl, refreshBranding } = useBranding();

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('System Administrator');
  const [adminPhoneNumber, setAdminPhoneNumber] = useState('1000');
  const [appNameInput, setAppNameInput] = useState('DecaTone');
  const [phoneNumberMinLength, setPhoneNumberMinLength] = useState('4');
  const [phoneNumberMaxLength, setPhoneNumberMaxLength] = useState('7');
  const [assignmentMode, setAssignmentMode] = useState('user_choice');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName,
          adminPhoneNumber,
          appName: appNameInput,
          phoneNumberLength: phoneNumberMinLength,
          phoneNumberMinLength,
          phoneNumberMaxLength,
          assignmentMode
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');

      await refreshBranding();
      login(data.token, data.user);
      window.location.href = '/onboarding';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '3rem auto', width: '100%' }}>
      <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src={logoUrl}
            alt={appName}
            style={{ width: '64px', height: '64px', borderRadius: '14px', marginBottom: '1rem', boxShadow: '0 0 20px rgba(14,165,233,0.3)' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/assets/logo.png'; }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Welcome to DecaTone</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Initial Setup: Create master administrator & dial plan</p>
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
              <label className="form-label">Admin Password</label>
              <input
                type="password"
                className="form-input"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
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
              />
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
            <h4 style={{ fontSize: '0.95rem', color: '#38bdf8', marginBottom: '1rem' }}>Dial Plan & Number Policy</h4>

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

          <button type="submit" disabled={submitting} className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '1.5rem' }}>
            {submitting ? 'Initializing Switchboard...' : 'Initialize DecaTone System'}
          </button>
        </form>
      </div>
    </div>
  );
};
