import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Phone, Lock, User, Sparkles, Hash } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { appName, logoUrl } = useBranding();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      login(data.token, data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '4rem auto', width: '100%' }}>
      <div className="glass-card highlight-cyan" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src={logoUrl}
            alt={appName}
            style={{ width: '64px', height: '64px', borderRadius: '14px', marginBottom: '1rem', boxShadow: '0 0 20px rgba(14,165,233,0.3)' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/assets/logo.png'; }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Welcome to {appName}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Sign in to manage your rotary line</p>
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
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. rotary_fan"
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.75rem' }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={submitting} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            {submitting ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Don't have an extension? <Link to="/register">Create Account</Link>
        </div>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { login } = useAuth();
  const { appName, logoUrl } = useBranding();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [requestedNumber, setRequestedNumber] = useState('');
  const [requestedAreaCode, setRequestedAreaCode] = useState('');
  const [numberConfig, setNumberConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/number-options')
      .then(res => res.json())
      .then(data => {
        setNumberConfig(data.config);
        if (data.suggestedNumber) setRequestedNumber(data.suggestedNumber);
        if (data.suggestedAreaCode) setRequestedAreaCode(data.suggestedAreaCode);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          displayName,
          requestedPhoneNumber: requestedNumber,
          requestedAreaCode
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      login(data.token, data.user);
      navigate('/onboarding');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '480px', margin: '3rem auto', width: '100%' }}>
      <div className="glass-card highlight-amber" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src={logoUrl}
            alt={appName}
            style={{ width: '64px', height: '64px', borderRadius: '14px', marginBottom: '1rem', boxShadow: '0 0 20px rgba(245,158,11,0.3)' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/assets/logo.png'; }}
          />
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Join {appName}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Claim your vintage extension & VoIP switchboard</p>
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
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. vintage_bell"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice's Rotary Desk"
            />
          </div>

          {/* Phone Number / Extension Selector */}
          <div className="form-group">
            <label className="form-label">
              <span>Assigned Phone Extension</span>
              {numberConfig?.allowUserChoice && (
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-amber)' }}>User Customizable</span>
              )}
            </label>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {numberConfig?.areaCodeEnabled && (
                <select
                  className="form-select"
                  style={{ width: '110px', fontFamily: 'var(--font-mono)' }}
                  value={requestedAreaCode}
                  onChange={(e) => setRequestedAreaCode(e.target.value)}
                >
                  {numberConfig.allowedAreaCodes.map((ac: string) => (
                    <option key={ac} value={ac}>({ac})</option>
                  ))}
                </select>
              )}

              <input
                type="text"
                className="form-input"
                required
                readOnly={!numberConfig?.allowUserChoice}
                value={requestedNumber}
                onChange={(e) => setRequestedNumber(e.target.value.replace(/\D/g, ''))}
                placeholder={numberConfig ? `${numberConfig.numberLength} digits` : '101'}
                style={{ fontFamily: 'var(--font-mono)', fontWeight: '700', letterSpacing: '0.05em' }}
              />
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              This is the extension other users dial on their rotary phones to call you.
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: '1.75rem' }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button type="submit" disabled={submitting} className="btn btn-amber btn-lg" style={{ width: '100%' }}>
            {submitting ? 'Creating Extension...' : 'Claim Extension & Setup Phone'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Already have an account? <Link to="/login">Sign In</Link>
        </div>
      </div>
    </div>
  );
};
