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
  const [appNameInput, setAppNameInput] = useState('DecaTone');
  const [phoneNumberLength, setPhoneNumberLength] = useState('3');
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
          appName: appNameInput,
          phoneNumberLength
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
    <div style={{ maxWidth: '520px', margin: '3rem auto', width: '100%' }}>
      <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src={logoUrl}
            alt={appName}
            style={{ width: '64px', height: '64px', borderRadius: '14px', marginBottom: '1rem', boxShadow: '0 0 20px rgba(14,165,233,0.3)' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/assets/logo.png'; }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Welcome to DecaTone</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Initial Setup: Create the master administrator account</p>
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

          <div className="grid-2" style={{ marginTop: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
            <div className="form-group">
              <label className="form-label">App Title</label>
              <input
                type="text"
                className="form-input"
                value={appNameInput}
                onChange={(e) => setAppNameInput(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Extension Length</label>
              <select
                className="form-select"
                value={phoneNumberLength}
                onChange={(e) => setPhoneNumberLength(e.target.value)}
              >
                <option value="3">3 Digits (100-999)</option>
                <option value="4">4 Digits (1000-9999)</option>
                <option value="5">5 Digits (10000-99999)</option>
              </select>
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '1rem' }}>
            {submitting ? 'Initializing Switchboard...' : 'Initialize DecaTone System'}
          </button>
        </form>
      </div>
    </div>
  );
};
