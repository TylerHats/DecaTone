import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, X, Clock, HelpCircle, Activity, Sparkles, Hash, UserPlus, Radio, PauseCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { softphone, SoftphoneCallState } from '../services/WebAudioSoftphone';

interface WebPhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNumber?: string;
}

export const WebPhoneModal: React.FC<WebPhoneModalProps> = ({ isOpen, onClose, initialNumber = '' }) => {
  const { user } = useAuth();

  const [dialString, setDialString] = useState(initialNumber);
  const [callState, setCallState] = useState<SoftphoneCallState>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [callInfo, setCallInfo] = useState<{ number: string; name?: string }>({ number: '' });
  const [inviteInput, setInviteInput] = useState('');
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [audioProfile, setAudioProfileState] = useState<'vintage_pots' | 'early_1930s' | 'modern_hd'>('vintage_pots');

  const audioContextRef = useRef<AudioContext | null>(null);
  const callTimerRef = useRef<any>(null);

  useEffect(() => {
    if (initialNumber) {
      setDialString(initialNumber);
    }
  }, [initialNumber]);

  useEffect(() => {
    softphone.setEvents({
      onStateChange: (state) => {
        setCallState(state);
      },
      onCallConnected: (info) => {
        setCallInfo(info);
      },
      onCallEnded: () => {
        setCallState('ended');
      }
    });
  }, []);

  useEffect(() => {
    if (callState === 'connected') {
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      setCallDuration(0);
    }

    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [callState]);

  const initAudio = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const playTone = (f1: number, f2: number, durationMs = 180) => {
    try {
      initAudio();
      if (!audioContextRef.current) return;

      const ctx = audioContextRef.current;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = f1;
      osc2.frequency.value = f2;

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + durationMs / 1000);
      osc2.stop(ctx.currentTime + durationMs / 1000);
    } catch (e) {}
  };

  const playDtmfDigit = (digit: string) => {
    const dtmfFreqs: Record<string, [number, number]> = {
      '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
      '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
      '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
      '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
    };

    if (dtmfFreqs[digit]) {
      playTone(dtmfFreqs[digit][0], dtmfFreqs[digit][1], 150);
    }
  };

  const handleDigitClick = (digit: string) => {
    playDtmfDigit(digit);
    if (callState === 'connected') {
      softphone.sendInCallDigit(digit);
    } else {
      setDialString(prev => prev + digit);
    }
  };

  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    softphone.setMuted(newMuted);
    handleDigitClick('2'); // In-call Digit 2 toggles mute on the switchboard
  };

  const handleParkCall = () => {
    handleDigitClick('8'); // In-call Digit 8 parks the call
  };

  const handleAddParticipant = () => {
    if (!inviteInput.trim()) return;
    const targetExt = inviteInput.trim();
    // In-call group invite: Digit '3' followed by target extension
    handleDigitClick('3');
    setTimeout(() => {
      for (let i = 0; i < targetExt.length; i++) {
        setTimeout(() => {
          handleDigitClick(targetExt[i]);
        }, i * 150);
      }
    }, 300);
    setShowInviteInput(false);
    setInviteInput('');
  };

  const handleBackspace = () => {
    setDialString(prev => prev.slice(0, -1));
  };

  const handleStartCall = async () => {
    if (!dialString.trim()) return;
    initAudio();

    const targetNumber = dialString.trim();
    setCallInfo({ number: targetNumber, name: `Line ${targetNumber}` });
    await softphone.call(targetNumber, user?.id);
  };

  const handleEndCall = () => {
    softphone.endCall();
    setCallState('idle');
    setDialString('');
    setIsMuted(false);
    setShowInviteInput(false);
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" style={{ zIndex: 1000 }}>
      <div className="modal-content glass-card" style={{ maxWidth: '420px', width: '100%', padding: '1.75rem', position: 'relative' }}>
        {/* Close Button */}
        <button
          onClick={() => {
            handleEndCall();
            onClose();
          }}
          className="btn btn-secondary btn-icon"
          style={{ position: 'absolute', top: '1rem', right: '1rem', width: '32px', height: '32px' }}
        >
          <X size={16} />
        </button>

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'inline-flex', padding: '0.75rem', borderRadius: '50%', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', marginBottom: '0.5rem' }}>
            <Phone size={24} />
          </div>
          <h2 style={{ fontSize: '1.35rem', margin: 0, fontWeight: 700 }}>In-Browser Softphone</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0 0' }}>
            Two-way 16kHz audio softphone with direct service lines and dial codes
          </p>
        </div>

        {/* Call Status Display */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            textAlign: 'center',
            marginBottom: '1.25rem'
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
            {callState === 'idle' ? 'Ready to Dial' : callState === 'dialing' ? 'Dialing...' : callState === 'ringing' ? 'Ringing Remote Line...' : callState === 'connected' ? 'Call Connected (Live 2-Way Audio)' : callState === 'parked' ? 'Call Parked on Hold' : 'Call Terminated'}
          </div>

          <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', minHeight: '2.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {callState === 'idle' ? (dialString || '—') : callInfo.number}
          </div>

          {callState === 'connected' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#34d399', marginTop: '0.25rem' }}>
              <Clock size={14} /> {formatTimer(callDuration)}
            </div>
          )}
        </div>

        {/* Audio Filter Profile Selector */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.6rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Sparkles size={13} color="var(--accent-amber)" /> DSP Filter:
          </span>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            {[
              { id: 'vintage_pots', label: 'Vintage POTS' },
              { id: 'early_1930s', label: '1930s Bell' },
              { id: 'modern_hd', label: 'Modern HD' }
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setAudioProfileState(p.id as any);
                  softphone.setAudioProfile(p.id as any);
                }}
                className="btn btn-sm"
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  background: audioProfile === p.id ? 'var(--accent-cyan)' : 'transparent',
                  color: audioProfile === p.id ? '#0f172a' : 'var(--text-muted)',
                  border: `1px solid ${audioProfile === p.id ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                  fontWeight: audioProfile === p.id ? 700 : 500
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dialpad Matrix */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem', marginBottom: '1.25rem' }}>
          {[
            { digit: '1', sub: '' },
            { digit: '2', sub: 'MUTE' },
            { digit: '3', sub: 'INVITE' },
            { digit: '4', sub: 'GHI' },
            { digit: '5', sub: 'JKL' },
            { digit: '6', sub: 'MNO' },
            { digit: '7', sub: 'PQRS' },
            { digit: '8', sub: 'PARK' },
            { digit: '9', sub: 'WXYZ' },
            { digit: '*', sub: 'TONE' },
            { digit: '0', sub: 'VM/REJ' },
            { digit: '#', sub: 'HEX' }
          ].map(item => (
            <button
              key={item.digit}
              type="button"
              onClick={() => handleDigitClick(item.digit)}
              className="btn btn-secondary"
              style={{
                height: '54px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.25rem',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>{item.digit}</span>
              {item.sub && <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>{item.sub}</span>}
            </button>
          ))}
        </div>

        {/* In-Call Controls when Connected */}
        {callState === 'connected' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {showInviteInput ? (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter Extension (e.g. 1002)"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
                <button onClick={handleAddParticipant} className="btn btn-primary btn-sm">
                  Add
                </button>
                <button onClick={() => setShowInviteInput(false)} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className={`btn ${isMuted ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                >
                  {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  {isMuted ? 'Unmute (2)' : 'Mute (2)'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowInviteInput(true)}
                  className="btn btn-secondary btn-sm"
                >
                  <UserPlus size={14} /> Add (3)
                </button>

                <button
                  type="button"
                  onClick={handleParkCall}
                  className="btn btn-secondary btn-sm"
                >
                  <PauseCircle size={14} /> Park (8)
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleEndCall}
              className="btn btn-danger"
              style={{ width: '100%', height: '44px', fontWeight: 700 }}
            >
              <PhoneOff size={18} /> End Call
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={handleBackspace}
              disabled={!dialString}
              className="btn btn-secondary"
              style={{ flex: 1 }}
            >
              Backspace
            </button>
            <button
              type="button"
              onClick={handleStartCall}
              disabled={!dialString}
              className="btn btn-primary"
              style={{ flex: 2, height: '44px', fontWeight: 700 }}
            >
              <Phone size={18} /> Call Line
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

