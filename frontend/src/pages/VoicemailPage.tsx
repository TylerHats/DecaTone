import React, { useState, useEffect } from 'react';
import { Voicemail, Play, Trash2, Download, Phone, CheckCircle2, Clock, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface VoicemailItem {
  id: number;
  caller_number: string;
  caller_username?: string;
  caller_display_name?: string;
  audio_url: string;
  duration_sec: number;
  is_read: number;
  created_at: string;
}

export const VoicemailPage: React.FC = () => {
  const { refreshUser } = useAuth();
  const [voicemails, setVoicemails] = useState<VoicemailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPlayingId, setCurrentPlayingId] = useState<number | null>(null);

  const token = localStorage.getItem('decatone_token');

  useEffect(() => {
    fetchVoicemails();
  }, []);

  const fetchVoicemails = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/voicemail', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setVoicemails(data.voicemails || []);
      }
    } catch (e) {}
    setLoading(false);
  };

  const handleMarkRead = async (id: number) => {
    try {
      await fetch(`/api/voicemail/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      setVoicemails(prev => prev.map(v => v.id === id ? { ...v, is_read: 1 } : v));
      await refreshUser();
    } catch (e) {}
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this voicemail message?')) return;
    try {
      const res = await fetch(`/api/voicemail/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setVoicemails(prev => prev.filter(v => v.id !== id));
        await refreshUser();
      }
    } catch (e) {}
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Voicemail Inbox</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Listen to recorded messages from callers when you were away or on the line.
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
          Tip: Dial <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>0</strong> on your rotary phone to listen via handset!
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>Loading voicemails...</div>
      ) : voicemails.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <Voicemail size={48} color="var(--accent-cyan)" style={{ marginBottom: '1rem', opacity: 0.8 }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Voicemails</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
            Your mailbox is empty. Incoming messages will appear here automatically.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {voicemails.map((vm) => (
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
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
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)' }}>EXT {vm.caller_number}</span>
                      &bull;
                      <span>{new Date(vm.created_at).toLocaleString()}</span>
                      &bull;
                      <span>{vm.duration_sec}s</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {!vm.is_read && (
                    <button
                      onClick={() => handleMarkRead(vm.id)}
                      className="btn btn-secondary btn-sm"
                      title="Mark as Read"
                    >
                      <CheckCircle2 size={14} color="#34d399" /> Mark Read
                    </button>
                  )}

                  <a
                    href={vm.audio_url}
                    download={`voicemail_${vm.caller_number}_${vm.id}.wav`}
                    className="btn btn-secondary btn-sm"
                    title="Download Audio File"
                  >
                    <Download size={14} /> Download
                  </a>

                  <button
                    onClick={() => handleDelete(vm.id)}
                    className="btn btn-danger btn-sm"
                    title="Delete Voicemail"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>

              {/* In-Browser Audio Player */}
              <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
                <audio
                  controls
                  src={vm.audio_url}
                  style={{ width: '100%', height: '36px' }}
                  onPlay={() => !vm.is_read && handleMarkRead(vm.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
