import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Lock, CheckCircle2, AlertCircle, ArrowRight, ShieldAlert, Key } from 'lucide-react';
import { useBranding } from '../context/BrandingContext';
import {
  clearUnlockedKey,
  generateUserKeyBundle,
  unwrapBundle96WithRecoveryKey,
  wrapBundle96WithPassword,
  wrapBundle96WithRecoveryKey
} from '../services/e2eeCrypto';

export const ResetPasswordPage: React.FC = () => {
  const { appName, logoUrl } = useBranding();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [verifying, setVerifying] = useState(true);
  const [valid, setValid] = useState(false);
  const [username, setUsername] = useState('');
  const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
  const [expectedPublicKey, setExpectedPublicKey] = useState<string | null>(null);
  const [recoveryEncryptedPrivateKey, setRecoveryEncryptedPrivateKey] = useState<string | null>(null);
  const [recoveryKeySalt, setRecoveryKeySalt] = useState<string | null>(null);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [preservedVault, setPreservedVault] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setVerifying(false);
      setValid(false);
      setError('No password reset token provided.');
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok && data.valid) {
          setValid(true);
          setUsername(data.username || '');
          setHasRecoveryKey(Boolean(data.hasRecoveryKey && data.recoveryEncryptedPrivateKey && data.recoveryKeySalt));
          setExpectedPublicKey(data.encryptionPublicKey || null);
          setRecoveryEncryptedPrivateKey(data.recoveryEncryptedPrivateKey || null);
          setRecoveryKeySalt(data.recoveryKeySalt || null);
        } else {
          setValid(false);
          setError(data.error || 'This password reset link is invalid or has expired.');
        }
      } catch {
        setValid(false);
        setError('Failed to verify password reset token.');
      } finally {
        setVerifying(false);
      }
    };

    void verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      let keyBundle: {
        encryptionPublicKey: string;
        encryptedPrivateKey: string;
        keySalt: string;
        recoveryKeySalt?: string;
        recoveryEncryptedPrivateKey?: string;
      };
      let usedRecovery = false;

      if (hasRecoveryKey && recoveryKeyInput.trim() && recoveryKeySalt && recoveryEncryptedPrivateKey) {
        const bundle96 = await unwrapBundle96WithRecoveryKey(
          recoveryKeyInput.trim(),
          recoveryKeySalt,
          recoveryEncryptedPrivateKey,
          expectedPublicKey
        );
        const pwWrapped = await wrapBundle96WithPassword(bundle96, newPassword);
        const recWrapped = await wrapBundle96WithRecoveryKey(bundle96, recoveryKeyInput.trim());
        keyBundle = {
          ...pwWrapped,
          ...recWrapped
        };
        usedRecovery = true;
      } else {
        keyBundle = await generateUserKeyBundle(newPassword);
      }

      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          newPassword,
          encryptionPublicKey: keyBundle.encryptionPublicKey,
          encryptedPrivateKey: keyBundle.encryptedPrivateKey,
          keySalt: keyBundle.keySalt,
          ...(keyBundle.recoveryEncryptedPrivateKey && keyBundle.recoveryKeySalt
            ? {
                recoveryEncryptedPrivateKey: keyBundle.recoveryEncryptedPrivateKey,
                recoveryKeySalt: keyBundle.recoveryKeySalt
              }
            : {})
        })
      });

      const data = await res.json();
      if (!res.ok) {
        clearUnlockedKey();
        throw new Error(data.error || 'Failed to reset password');
      }

      clearUnlockedKey();
      setPreservedVault(usedRecovery);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '480px', margin: '3rem auto', padding: '0 1rem' }}>
      <div className="glass-card" style={{ padding: '2.5rem 2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <img
            src={logoUrl || '/branding/logo.png'}
            alt={appName}
            style={{
              height: '56px',
              width: '56px',
              borderRadius: '12px',
              objectFit: 'contain',
              marginBottom: '1rem',
              filter: 'drop-shadow(0 4px 12px rgba(14,165,233,0.3))'
            }}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = '/branding/logo.png';
            }}
          />
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Create New Password</h2>
          {username && (
            <p style={{ color: 'var(--accent-cyan)', fontSize: '0.9rem', fontWeight: 500 }}>
              Resetting password for @{username}
            </p>
          )}
        </div>

        {verifying ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            Verifying security token...
          </div>
        ) : error && !valid ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                color: '#fda4af',
                padding: '1rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <AlertCircle size={20} color="#f43f5e" /> {error}
            </div>

            <Link to="/forgot-password" className="btn btn-secondary" style={{ marginTop: '0.5rem' }}>
              Request a New Reset Link
            </Link>
          </div>
        ) : success ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'rgba(52, 211, 153, 0.15)',
                border: '1px solid rgba(52, 211, 153, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto'
              }}
            >
              <CheckCircle2 size={28} color="#34d399" />
            </div>

            <h3 style={{ fontSize: '1.15rem', color: '#fff' }}>
              {preservedVault ? 'Password Reset — Voicemail Vault Preserved!' : 'Password & E2EE Keys Rotated!'}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {preservedVault
                ? 'Your existing Zero-Access P-256 identity key was unwrapped with your Recovery Key and re-protected under your new password. Existing voicemails remain readable.'
                : 'Your password and Zero-Access P-256 encryption keypair have been updated. Sign in to resume receiving encrypted voicemails.'}
            </p>

            <Link to="/login" className="btn btn-primary btn-lg" style={{ marginTop: '0.5rem' }}>
              Sign In to Switchboard <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            {hasRecoveryKey ? (
              <div
                style={{
                  background: 'rgba(14, 165, 233, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#bae6fd',
                  padding: '0.85rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  lineHeight: 1.45
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, color: '#fff', marginBottom: '0.4rem' }}>
                  <Key size={15} color="#38bdf8" /> Zero-Access Recovery Key Detected
                </div>
                Enter your saved Recovery Key below to preserve access to existing encrypted voicemails. Leaving it blank generates a new P-256 keypair and permanently locks out older voicemails.
              </div>
            ) : (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: '#fde68a',
                  padding: '0.8rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                  lineHeight: 1.45,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.55rem'
                }}
              >
                <ShieldAlert size={18} color="#fbbf24" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Zero-Access Encryption Notice:</strong> No Recovery Key is set for this account. Resetting your password generates a fresh P-256 keypair, so older Zero-Access voicemails encrypted under your previous password cannot be decrypted.
                </div>
              </div>
            )}

            {hasRecoveryKey && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Recovery Key (Optional — Preserves Old Voicemails)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="XXXX-XXXX-XXXX-XXXX-..."
                  value={recoveryKeyInput}
                  onChange={(e) => setRecoveryKeyInput(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            )}

            {error && (
              <div
                style={{
                  background: 'rgba(244, 63, 94, 0.15)',
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                  color: '#fda4af',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">New Password (8+ characters)</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="form-input"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                />
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.85rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-dim)'
                  }}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Confirm New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="password"
                  required
                  minLength={8}
                  className="form-input"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                />
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.85rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-dim)'
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || newPassword.length < 8 || newPassword !== confirmPassword}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: '0.35rem' }}
            >
              {submitting
                ? recoveryKeyInput.trim()
                  ? 'Re-Wrapping Vault & Saving...'
                  : 'Generating Keypair & Saving...'
                : 'Save New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
