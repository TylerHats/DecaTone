import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Voicemail,
  Trash2,
  Download,
  CheckCircle2,
  Lock,
  Unlock,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  Play
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { decryptVoicemailPayload } from '../services/e2eeCrypto';

interface VoicemailItem {
  id: number;
  caller_number: string;
  caller_username?: string;
  caller_display_name?: string;
  duration_sec: number;
  is_read: number;
  is_encrypted?: number | boolean;
  created_at: string;
}

export const VoicemailPage: React.FC = () => {
  const { user, isVaultUnlocked, unlockE2ee, refreshUser } = useAuth();
  const [voicemails, setVoicemails] = useState<VoicemailItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [vaultPassword, setVaultPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const [audioBlobUrls, setAudioBlobUrls] = useState<Record<number, string>>({});
  const [autoPlayIds, setAutoPlayIds] = useState<Record<number, boolean>>({});
  const [decryptingIds, setDecryptingIds] = useState<Record<number, boolean>>({});
  const [decryptErrors, setDecryptErrors] = useState<Record<number, string>>({});
  const objectUrlsRef = useRef<Map<number, string>>(new Map());

  const revokeAllUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      revokeAllUrls();
    };
  }, [revokeAllUrls]);

  const fetchVoicemails = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/voicemail', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setVoicemails(data.voicemails || []);
      }
    } catch {
      // Ignore network errors
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchVoicemails();
  }, [fetchVoicemails]);

  const handleMarkRead = useCallback(
    async (id: number) => {
      if (!user?.id) return;
      try {
        const res = await fetch(`/api/voicemail/${id}/read`, {
          method: 'PUT',
          credentials: 'include'
        });
        if (res.ok) {
          setVoicemails((prev) => prev.map((v) => (v.id === id ? { ...v, is_read: 1 } : v)));
          await refreshUser();
        }
      } catch {}
    },
    [user?.id, refreshUser]
  );

  // Lazy client-side decryption triggered only when user clicks Play / Decrypt on a specific message
  const decryptSingleVoicemail = useCallback(
    async (vm: VoicemailItem, shouldAutoPlay = true) => {
      if (!user?.id || objectUrlsRef.current.has(vm.id)) return;

      setDecryptingIds((prev) => ({ ...prev, [vm.id]: true }));
      setDecryptErrors((prev) => {
        const next = { ...prev };
        delete next[vm.id];
        return next;
      });

      try {
        const res = await fetch(`/api/voicemail/${vm.id}/encrypted`, { credentials: 'include' });
        let wavBlob: Blob;

        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('audio/')) {
            wavBlob = await res.blob();
          } else {
            const payload = await res.json();
            if (payload.ephemeralPublicKey && (payload.ciphertextBase64 || payload.ciphertext)) {
              const wavBuffer = await decryptVoicemailPayload({
                ephemeralPublicKey: payload.ephemeralPublicKey,
                iv: payload.iv,
                tag: payload.tag,
                ciphertextBase64: payload.ciphertextBase64 ?? payload.ciphertext
              });
              wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
            } else if (payload.wavBase64) {
              const bin = window.atob(payload.wavBase64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              wavBlob = new Blob([bytes], { type: 'audio/wav' });
            } else {
              const audioRes = await fetch(`/api/voicemail/${vm.id}/audio`, { credentials: 'include' });
              if (!audioRes.ok) {
                throw new Error('Could not retrieve voicemail audio');
              }
              wavBlob = await audioRes.blob();
            }
          }
        } else if (res.status === 404) {
          const audioRes = await fetch(`/api/voicemail/${vm.id}/audio`, { credentials: 'include' });
          if (!audioRes.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Encrypted voicemail payload not found');
          }
          wavBlob = await audioRes.blob();
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to load encrypted voicemail');
        }

        const prevUrl = objectUrlsRef.current.get(vm.id);
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }
        const blobUrl = URL.createObjectURL(wavBlob);
        objectUrlsRef.current.set(vm.id, blobUrl);
        if (shouldAutoPlay) {
          setAutoPlayIds((prev) => ({ ...prev, [vm.id]: true }));
        }
        setAudioBlobUrls((prev) => ({ ...prev, [vm.id]: blobUrl }));
      } catch (err: any) {
        setDecryptErrors((prev) => ({
          ...prev,
          [vm.id]: err?.message || 'Unable to decrypt voicemail with current key'
        }));
      } finally {
        setDecryptingIds((prev) => ({ ...prev, [vm.id]: false }));
      }
    },
    [user?.id]
  );

  const handleUnlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPassword) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      await unlockE2ee(vaultPassword);
      setVaultPassword('');
      setDecryptErrors({});
    } catch (err: any) {
      setUnlockError(err?.message || 'Incorrect password or unable to unlock vault');
    } finally {
      setUnlocking(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!user?.id) return;
    if (!window.confirm('Delete this voicemail message permanently?')) return;
    try {
      const res = await fetch(`/api/voicemail/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        const existingUrl = objectUrlsRef.current.get(id);
        if (existingUrl) {
          URL.revokeObjectURL(existingUrl);
          objectUrlsRef.current.delete(id);
        }
        setAudioBlobUrls((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setVoicemails((prev) => prev.filter((v) => v.id !== id));
        await refreshUser();
      }
    } catch {}
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            Voicemail Inbox
            {isVaultUnlocked && (
              <span className="badge badge-online" style={{ fontSize: '0.7rem' }}>
                <ShieldCheck size={12} /> Zero-Access Vault Unlocked
              </span>
            )}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Messages are sealed with ECDH P-256 + AES-256-GCM and decrypted locally in your browser on play.
          </p>
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle)',
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            color: 'var(--text-muted)'
          }}
        >
          Tip: Dial <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>0</strong> on your rotary phone or softphone to listen via handset!
        </div>
      </div>

      {!isVaultUnlocked && (
        <div className="glass-card highlight-amber" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', marginBottom: '1rem' }}>
            <div
              style={{
                padding: '0.6rem',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: 'var(--accent-amber)',
                flexShrink: 0
              }}
            >
              <Lock size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Unlock Zero-Access Vault</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                Your private decryption key is locked. Enter your account password to unwrap your P-256 key locally and play or download encrypted voicemails.
              </p>
            </div>
          </div>

          {unlockError && (
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                color: '#fda4af',
                padding: '0.65rem 0.9rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                marginBottom: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <AlertCircle size={15} /> {unlockError}
            </div>
          )}

          <form onSubmit={handleUnlockVault} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="password"
              className="form-input"
              placeholder="Enter account password to unlock..."
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              required
              style={{ flex: '1 1 240px' }}
            />
            <button type="submit" disabled={unlocking} className="btn btn-amber">
              <Unlock size={16} /> {unlocking ? 'Unwrapping P-256 Key...' : 'Unlock Voicemails'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>Loading your encrypted mailbox...</p>
        </div>
      ) : voicemails.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <Voicemail size={48} color="var(--text-dim)" style={{ margin: '0 auto 1rem' }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Voicemail Messages</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            When callers reach your line while you're away or on Do Not Disturb, their encrypted messages will appear here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {voicemails.map((vm) => {
            const blobUrl = audioBlobUrls[vm.id];
            const isDecrypting = Boolean(decryptingIds[vm.id]);
            const decryptErr = decryptErrors[vm.id];

            return (
              <div
                key={vm.id}
                className={`glass-card ${vm.is_read ? '' : 'highlight-cyan'}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  padding: '1.25rem'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.75rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: vm.is_read ? 'rgba(255,255,255,0.05)' : 'rgba(14, 165, 233, 0.2)',
                        border: `1px solid ${vm.is_read ? 'var(--border-subtle)' : 'var(--accent-cyan)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Voicemail size={20} color={vm.is_read ? '#94a3b8' : '#38bdf8'} />
                    </div>

                    <div>
                      <strong style={{ fontSize: '1.05rem', color: '#fff' }}>
                        {vm.caller_display_name || vm.caller_username || `EXT ${vm.caller_number}`}
                      </strong>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-dim)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          flexWrap: 'wrap'
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>
                          EXT {vm.caller_number}
                        </span>
                        &bull;
                        <span>{new Date(vm.created_at).toLocaleString()}</span>
                        &bull;
                        <span>{vm.duration_sec}s</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {!vm.is_read && (
                      <button
                        onClick={() => void handleMarkRead(vm.id)}
                        className="btn btn-secondary btn-sm"
                        title="Mark as Read"
                      >
                        <CheckCircle2 size={14} color="#34d399" /> Mark Read
                      </button>
                    )}

                    {blobUrl && (
                      <a
                        href={blobUrl}
                        download={`voicemail_${vm.caller_number}_${vm.id}.wav`}
                        className="btn btn-secondary btn-sm"
                        title="Download Decrypted WAV File"
                      >
                        <Download size={14} /> Download .WAV
                      </a>
                    )}

                    <button
                      onClick={() => void handleDelete(vm.id)}
                      className="btn btn-danger btn-sm"
                      title="Delete Voicemail"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>

                {/* Lazy Zero-Access Playback Player */}
                <div
                  style={{
                    background: 'rgba(0,0,0,0.4)',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-sm)'
                  }}
                >
                  {!isVaultUnlocked ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        color: 'var(--text-muted)',
                        fontSize: '0.85rem',
                        padding: '0.35rem 0'
                      }}
                    >
                      <Lock size={14} color="var(--accent-amber)" /> Unlock your Zero-Access Vault above to decrypt and play this message.
                    </div>
                  ) : isDecrypting ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        color: 'var(--accent-cyan)',
                        fontSize: '0.85rem',
                        padding: '0.35rem 0'
                      }}
                    >
                      <RefreshCw size={14} className="spin" /> Decrypting Zero-Access ECIES payload locally...
                    </div>
                  ) : decryptErr ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        flexWrap: 'wrap',
                        color: '#fda4af',
                        fontSize: '0.83rem'
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <AlertCircle size={14} /> {decryptErr}
                      </span>
                      <button
                        type="button"
                        onClick={() => void decryptSingleVoicemail(vm, true)}
                        className="btn btn-secondary btn-sm"
                      >
                        Retry Decrypt
                      </button>
                    </div>
                  ) : blobUrl ? (
                    <audio
                      controls
                      autoPlay={Boolean(autoPlayIds[vm.id])}
                      src={blobUrl}
                      style={{ width: '100%', height: '36px' }}
                      onPlay={() => {
                        if (!vm.is_read) {
                          void handleMarkRead(vm.id);
                        }
                      }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => void decryptSingleVoicemail(vm, true)}
                        className="btn btn-primary btn-sm"
                      >
                        <Play size={14} /> Decrypt &amp; Play Voicemail
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
