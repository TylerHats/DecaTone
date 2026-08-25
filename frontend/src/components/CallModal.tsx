import React, { useState, useEffect } from 'react';
import { PhoneCall, PhoneOff, PhoneForwarded, Volume2, ShieldCheck, User } from 'lucide-react';
import { usePhone } from '../context/PhoneContext';

export const CallModal: React.FC = () => {
  const { activeCall, hangup } = usePhone();
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    let interval: any = null;
    if (activeCall?.state === 'connected') {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCall?.state]);

  if (!activeCall || activeCall.state === 'idle') return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isRinging = activeCall.state === 'ringing';
  const isConnected = activeCall.state === 'connected';
  const isVoicemail = activeCall.state === 'voicemail';

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ textAlign: 'center' }}>
        {/* Animated Status Icon */}
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            margin: '0 auto 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isRinging
              ? 'rgba(244, 63, 94, 0.2)'
              : isConnected
              ? 'rgba(16, 185, 129, 0.2)'
              : 'rgba(245, 158, 11, 0.2)',
            border: `2px solid ${
              isRinging ? '#f43f5e' : isConnected ? '#10b981' : '#f59e0b'
            }`,
            boxShadow: `0 0 25px ${
              isRinging
                ? 'rgba(244, 63, 94, 0.4)'
                : isConnected
                ? 'rgba(16, 185, 129, 0.4)'
                : 'rgba(245, 158, 11, 0.4)'
            }`,
            animation: isRinging ? 'pulse-ring 1.2s infinite' : 'none'
          }}
        >
          {isRinging ? (
            <PhoneCall size={36} color="#f43f5e" />
          ) : isConnected ? (
            <PhoneCall size={36} color="#10b981" />
          ) : (
            <PhoneForwarded size={36} color="#f59e0b" />
          )}
        </div>

        {/* Call Header */}
        <h2 style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>
          {activeCall.callerName || activeCall.calleeName || 'DecaTone Call'}
        </h2>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
          EXT {activeCall.callerNumber || activeCall.calleeNumber}
        </div>

        {/* State description */}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
          {isRinging && 'Incoming Call &bull; Physical Bell is Ringing (Lift handset to answer)'}
          {isConnected && (
            <span style={{ color: '#34d399', fontWeight: '600' }}>
              Connected &bull; {formatDuration(callDuration)} (Encrypted Stream)
            </span>
          )}
          {isVoicemail && 'Routing to Voicemail Box...'}
        </div>

        {/* Security & Codec Info */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'rgba(255,255,255,0.04)',
            padding: '0.35rem 0.85rem',
            borderRadius: 'var(--radius-full)',
            fontSize: '0.75rem',
            color: 'var(--text-dim)',
            marginBottom: '2rem'
          }}
        >
          <ShieldCheck size={14} color="#34d399" /> End-to-End Encrypted Session &bull; MAX98357A / MAX4466
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
          <button
            onClick={hangup}
            className="btn btn-danger btn-lg"
            style={{ minWidth: '160px' }}
          >
            <PhoneOff size={18} /> End Call / Hang Up
          </button>
        </div>
      </div>
    </div>
  );
};
