import React, { useState, useEffect } from 'react';
import { PhoneCall, PhoneOff, PhoneForwarded, ShieldCheck, ShieldAlert, Radio, Lock } from 'lucide-react';
import { usePhone } from '../context/PhoneContext';

export const CallModal: React.FC = () => {
  const {
    activeCall,
    incomingCall,
    e2eeSafetyCode,
    e2eeSecurityMode,
    isWebPhoneModalOpen,
    hangup,
    answerCall,
    declineCallToVoicemail
  } = usePhone();
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (activeCall?.state === 'connected') {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCall?.state]);

  const hasActiveCall = Boolean(activeCall && activeCall.state !== 'idle');
  const hasIncomingCall = Boolean(incomingCall);

  if (isWebPhoneModalOpen || (!hasIncomingCall && !hasActiveCall)) return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const effectiveState = hasIncomingCall ? 'ringing' : activeCall?.state || 'ringing';
  const isRinging = effectiveState === 'ringing';
  const isConnected = effectiveState === 'connected';
  const isVoicemail = effectiveState === 'voicemail' || Boolean(activeCall?.isVoicemail);
  const isParked = effectiveState === 'parked';

  const displayName =
    incomingCall?.callerName ||
    activeCall?.callerName ||
    activeCall?.calleeName ||
    'DecaTone Call';
  const displayExt =
    incomingCall?.callerNumber ||
    activeCall?.callerNumber ||
    activeCall?.calleeNumber ||
    '---';

  const isSystemLine =
    Boolean(activeCall?.isSystemLine) ||
    isVoicemail ||
    e2eeSecurityMode === 'system' ||
    e2eeSecurityMode === 'voicemail';

  const isMismatch = !isSystemLine && e2eeSecurityMode === 'e2ee_mismatch';
  const isVerifiedE2ee = !isSystemLine && (e2eeSecurityMode === 'e2ee_verified' || e2eeSecurityMode === 'e2ee');
  const isUnverifiedE2ee = !isSystemLine && e2eeSecurityMode === 'e2ee_unverified';

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
        <h2 style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>{displayName}</h2>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent-amber)',
            fontSize: '1.1rem',
            marginBottom: '0.75rem'
          }}
        >
          EXT {displayExt}
        </div>

        {/* State description */}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
          {isRinging && 'Incoming Call • Lift physical handset or answer in browser'}
          {isConnected && (
            <span style={{ color: '#34d399', fontWeight: 600 }}>
              Connected • {formatDuration(callDuration)}
            </span>
          )}
          {isParked && (
            <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>
              Call Parked on Hold • Dial 8 or lift another phone to resume
            </span>
          )}
          {isVoicemail && 'Zero-Access Encrypted Voicemail Box'}
          {effectiveState === 'dialing' && 'Dialing remote extension...'}
        </div>

        {/* Security & E2EE Verification Status */}
        <div
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.3rem',
            background: isMismatch ? 'rgba(244, 63, 94, 0.14)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isMismatch ? 'rgba(244, 63, 94, 0.45)' : 'var(--border-subtle)'}`,
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            marginBottom: '1.75rem'
          }}
        >
          {isSystemLine ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-cyan)' }}>
              <Radio size={14} /> Switchboard System Line
            </span>
          ) : isMismatch ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#fda4af', fontWeight: 700 }}>
              <ShieldAlert size={14} color="#f43f5e" /> Warning: E2EE Identity Key Mismatch
            </span>
          ) : isVerifiedE2ee ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#34d399', fontWeight: 600 }}>
                <ShieldCheck size={14} color="#34d399" /> Verified E2EE (ECDH P-256 + Signed Identity)
              </span>
              {e2eeSafetyCode && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--accent-amber)', fontWeight: 700 }}>
                  Safety Code: {e2eeSafetyCode}
                </span>
              )}
            </>
          ) : isUnverifiedE2ee ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#fbbf24', fontWeight: 600 }}>
                <ShieldAlert size={14} color="#f59e0b" /> E2EE Encrypted (Unverified / Legacy Device)
              </span>
              {e2eeSafetyCode && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--accent-amber)', fontWeight: 700 }}>
                  Verify Safety Code: {e2eeSafetyCode}
                </span>
              )}
            </>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Lock size={14} color="#38bdf8" /> Negotiating E2EE Key Exchange...
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          {isRinging && (
            <button
              onClick={async () => {
                await answerCall(incomingCall?.callId || activeCall?.callId);
              }}
              className="btn btn-primary btn-lg"
              style={{
                minWidth: '175px',
                background: '#10b981',
                borderColor: '#059669',
                color: '#fff'
              }}
            >
              <PhoneCall size={18} /> Answer in Browser
            </button>
          )}

          <button
            onClick={() =>
              isRinging
                ? void declineCallToVoicemail(incomingCall?.callId || activeCall?.callId)
                : void hangup()
            }
            className="btn btn-danger btn-lg"
            style={{ minWidth: '175px' }}
          >
            <PhoneOff size={18} /> {isRinging ? 'Decline / Send to Voicemail' : 'End Call'}
          </button>
        </div>
      </div>
    </div>
  );
};
