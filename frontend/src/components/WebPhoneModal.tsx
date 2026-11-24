import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  X,
  Clock,
  Sparkles,
  UserPlus,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  ShieldAlert,
  Radio,
  Lock,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePhone } from '../context/PhoneContext';
import {
  softphone,
  SoftphoneCallState,
  SoftphoneSecurityMode,
  AudioProfileType
} from '../services/WebAudioSoftphone';

interface WebPhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNumber?: string;
}

export const WebPhoneModal: React.FC<WebPhoneModalProps> = ({
  isOpen,
  onClose,
  initialNumber = ''
}) => {
  const { user } = useAuth();
  const { setWebPhoneModalOpen } = usePhone();

  useEffect(() => {
    setWebPhoneModalOpen(isOpen);
    return () => setWebPhoneModalOpen(false);
  }, [isOpen, setWebPhoneModalOpen]);

  const [dialString, setDialString] = useState(initialNumber);
  const [callState, setCallState] = useState<SoftphoneCallState>(() => softphone.getCallState());
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(() => softphone.isMicrophoneMuted());
  const [callInfo, setCallInfo] = useState<{
    number: string;
    name?: string;
    isSystemLine?: boolean;
    isVoicemail?: boolean;
  }>({ number: '' });
  const [inviteInput, setInviteInput] = useState('');
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [audioProfile, setAudioProfileState] = useState<AudioProfileType>(() =>
    softphone.getAudioProfile()
  );
  const [speakerVolume, setSpeakerVolumeState] = useState<number>(() =>
    softphone.getSpeakerVolume()
  );
  const [micSensitivity, setMicSensitivityState] = useState<number>(() =>
    softphone.getMicSensitivity()
  );
  const [inboundNorm, setInboundNorm] = useState<boolean>(() =>
    softphone.getInboundNormalizationEnabled()
  );
  const [safetyCode, setSafetyCode] = useState<string | null>(() => softphone.getSafetyCode());
  const [securityMode, setSecurityMode] = useState<SoftphoneSecurityMode>(() =>
    softphone.getSecurityMode()
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inviteTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (initialNumber) {
      setDialString(initialNumber);
    }
  }, [initialNumber]);

  useEffect(() => {
    const unsubscribe = softphone.subscribe({
      onStateChange: (state) => {
        setCallState(state);
        if (state === 'idle') {
          setSafetyCode(null);
          setSecurityMode('none');
        }
      },
      onCallConnected: (info) => {
        setErrorMsg(null);
        setCallInfo(info);
      },
      onCallEnded: () => {
        setCallState('ended');
        setSafetyCode(null);
        setSecurityMode('none');
      },
      onE2eeEstablished: (code, mode) => {
        setSafetyCode(code);
        setSecurityMode(mode || (code ? 'e2ee_verified' : 'none'));
      },
      onMuteChange: (muted) => {
        setIsMuted(muted);
      },
      onError: (err) => {
        setErrorMsg(err);
      }
    });

    return () => {
      unsubscribe();
      for (const t of inviteTimeoutsRef.current) {
        clearTimeout(t);
      }
      inviteTimeoutsRef.current = [];
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (callState === 'connected' || callState === 'voicemail' || callState === 'parked') {
      if (!callTimerRef.current) {
        callTimerRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);
      }
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      setCallDuration(0);
    }

    return () => {
      if ((callState === 'idle' || callState === 'ended') && callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [callState]);

  const initAudio = () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
  };

  const playTone = (f1: number, f2: number, durationMs = 150) => {
    try {
      initAudio();
      if (!audioContextRef.current) return;

      const ctx = audioContextRef.current;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = f1;
      osc2.frequency.value = f2;

      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + durationMs / 1000);
      osc2.stop(ctx.currentTime + durationMs / 1000);
    } catch {
      // Ignore audio context errors
    }
  };

  const playDtmfDigit = (digit: string) => {
    const dtmfFreqs: Record<string, [number, number]> = {
      '1': [697, 1209],
      '2': [697, 1336],
      '3': [697, 1477],
      '4': [770, 1209],
      '5': [770, 1336],
      '6': [770, 1477],
      '7': [852, 1209],
      '8': [852, 1336],
      '9': [852, 1477],
      '*': [941, 1209],
      '0': [941, 1336],
      '#': [941, 1477]
    };

    if (dtmfFreqs[digit]) {
      playTone(dtmfFreqs[digit][0], dtmfFreqs[digit][1], 140);
    }
  };

  const isInActiveSession =
    callState === 'connected' || callState === 'voicemail' || callState === 'parked';

  const handleDigitClick = (digit: string) => {
    playDtmfDigit(digit);
    if (isInActiveSession) {
      if (digit === '2' && callState === 'connected' && !showInviteInput) {
        const nextMuted = !isMuted;
        setIsMuted(nextMuted);
        softphone.setMuted(nextMuted);
      }
      softphone.sendInCallDigit(digit);
    } else {
      setDialString((prev) => prev + digit);
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    softphone.setMuted(nextMuted);
    playDtmfDigit('2');
    softphone.sendInCallDigit('2');
  };

  const handleParkOrUnparkCall = () => {
    playDtmfDigit('8');
    softphone.sendInCallDigit('8');
  };

  const handleAddParticipant = () => {
    if (!inviteInput.trim()) return;
    const targetExt = inviteInput.trim();
    playDtmfDigit('3');
    softphone.sendInCallDigit('3');

    const outerTimeout = setTimeout(() => {
      for (let i = 0; i < targetExt.length; i++) {
        const t = setTimeout(() => {
          playDtmfDigit(targetExt[i]);
          softphone.sendInCallDigit(targetExt[i]);
        }, i * 150);
        inviteTimeoutsRef.current.push(t);
      }
    }, 300);
    inviteTimeoutsRef.current.push(outerTimeout);

    setShowInviteInput(false);
    setInviteInput('');
  };

  const handleBackspace = () => {
    setDialString((prev) => prev.slice(0, -1));
  };

  const handleStartCall = async () => {
    if (!dialString.trim()) return;
    setErrorMsg(null);
    initAudio();

    const targetNumber = dialString.trim();
    setCallInfo({ number: targetNumber, name: `Line ${targetNumber}` });
    await softphone.call(targetNumber, user?.id);
  };

  const handleEndCall = () => {
    softphone.endCall('hangup');
    setCallState('idle');
    setDialString('');
    setIsMuted(false);
    setShowInviteInput(false);
    setSafetyCode(null);
    setSecurityMode('none');
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const isSystemLine =
    securityMode === 'system' ||
    securityMode === 'voicemail' ||
    Boolean(callInfo.isSystemLine) ||
    Boolean(callInfo.isVoicemail);

  return (
    <div className="modal-backdrop" style={{ zIndex: 1000 }}>
      <div
        className="modal-content glass-card"
        style={{
          maxWidth: '440px',
          width: '100%',
          padding: '1.5rem',
          position: 'relative',
          maxHeight: '94vh',
          overflowY: 'auto'
        }}
      >
        {/* Close Button */}
        <button
          onClick={() => {
            handleEndCall();
            onClose();
          }}
          className="btn btn-secondary btn-icon"
          title="Close Web Softphone"
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#f8fafc',
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: '8px',
            cursor: 'pointer',
            zIndex: 10
          }}
        >
          <X size={18} color="#f8fafc" strokeWidth={2.5} />
        </button>

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '0.9rem' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: '0.65rem',
              borderRadius: '50%',
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              marginBottom: '0.4rem'
            }}
          >
            <Phone size={22} />
          </div>
          <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700 }}>In-Browser Softphone</h2>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              marginTop: '0.4rem',
              padding: '0.18rem 0.65rem',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fda4af',
              fontSize: '0.7rem',
              fontWeight: 600
            }}
          >
            <ShieldAlert size={12} /> No 911 / Emergency Calling
          </div>
        </div>

        {errorMsg && (
          <div
            style={{
              background: 'rgba(244, 63, 94, 0.14)',
              border: '1px solid rgba(244, 63, 94, 0.35)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.55rem 0.75rem',
              marginBottom: '0.85rem',
              color: '#fda4af',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem'
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Call Status Display */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem',
            textAlign: 'center',
            marginBottom: '0.9rem'
          }}
        >
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.2rem'
            }}
          >
            {callState === 'idle'
              ? 'Ready to Dial'
              : callState === 'dialing'
              ? 'Dialing...'
              : callState === 'ringing'
              ? 'Ringing Remote Line...'
              : callState === 'connected'
              ? 'Call Connected (Live 2-Way Audio)'
              : callState === 'voicemail'
              ? 'Voicemail Line Active'
              : callState === 'parked'
              ? 'Call Parked on Hold'
              : 'Call Terminated'}
          </div>

          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: '#fff',
              minHeight: '2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {callState === 'idle' ? dialString || '—' : callInfo.number || dialString || 'Active'}
          </div>

          {isInActiveSession && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.82rem',
                color: callState === 'parked' ? 'var(--accent-amber)' : '#34d399',
                marginTop: '0.2rem'
              }}
            >
              <Clock size={13} /> {formatTimer(callDuration)}
            </div>
          )}

          {/* E2EE Verification Badge */}
          {callState !== 'idle' && callState !== 'ended' && (
            <div style={{ marginTop: '0.45rem', fontSize: '0.72rem' }}>
              {isSystemLine ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    color: 'var(--accent-cyan)'
                  }}
                >
                  <Radio size={12} /> Switchboard System Line
                </span>
              ) : securityMode === 'e2ee_mismatch' ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    color: '#fda4af',
                    fontWeight: 700
                  }}
                >
                  <AlertCircle size={13} color="#f43f5e" /> Warning: E2EE Identity Key Mismatch
                </span>
              ) : (securityMode === 'e2ee_verified' || securityMode === 'e2ee') && safetyCode ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      color: '#34d399',
                      fontWeight: 600
                    }}
                  >
                    <ShieldCheck size={13} /> Verified E2EE (Signed Identity • AES-256-GCM)
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--accent-amber)',
                      fontWeight: 700
                    }}
                  >
                    Safety Code: {safetyCode}
                  </span>
                </div>
              ) : securityMode === 'e2ee_unverified' && safetyCode ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      color: '#fbbf24',
                      fontWeight: 600
                    }}
                  >
                    <ShieldAlert size={13} color="#f59e0b" /> E2EE Encrypted (Unverified / Legacy Device)
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--accent-amber)',
                      fontWeight: 700
                    }}
                  >
                    Verify Safety Code: {safetyCode}
                  </span>
                </div>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    color: 'var(--text-muted)'
                  }}
                >
                  <Lock size={12} /> Negotiating E2EE (ECDH P-256)...
                </span>
              )}
            </div>
          )}
        </div>

        {/* Audio Filter Profile & Gain Controls */}
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.55rem 0.7rem',
            marginBottom: '0.9rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
            <span
              style={{
                fontSize: '0.73rem',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
            >
              <Sparkles size={13} color="var(--accent-amber)" /> DSP Filter:
            </span>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {[
                { id: 'vintage_pots', label: 'Vintage POTS' },
                { id: 'early_1930s', label: '1930s Bell' },
                { id: 'modern_hd', label: 'Modern HD' }
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setAudioProfileState(p.id as AudioProfileType);
                    softphone.setAudioProfile(p.id as AudioProfileType);
                  }}
                  className="btn btn-sm"
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 7px',
                    background: audioProfile === p.id ? 'var(--accent-cyan)' : 'transparent',
                    color: audioProfile === p.id ? '#0f172a' : 'var(--text-muted)',
                    border: `1px solid ${
                      audioProfile === p.id ? 'var(--accent-cyan)' : 'var(--border-subtle)'
                    }`,
                    fontWeight: audioProfile === p.id ? 700 : 500
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <Volume2 size={11} /> Speaker
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{speakerVolume}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={speakerVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSpeakerVolumeState(val);
                  softphone.setSpeakerVolume(val);
                }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  <Mic size={11} /> Mic Gain
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{micSensitivity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={micSensitivity}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setMicSensitivityState(val);
                  softphone.setMicSensitivity(val);
                }}
              />
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              cursor: 'pointer'
            }}
          >
            <span>Inbound Leveler / Compressor</span>
            <input
              type="checkbox"
              checked={inboundNorm}
              onChange={(e) => {
                setInboundNorm(e.target.checked);
                softphone.setInboundNormalizationEnabled(e.target.checked);
              }}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
          </label>
        </div>

        {/* Dialpad Matrix */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.55rem',
            marginBottom: '1rem'
          }}
        >
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
            { digit: '0', sub: 'VM/OPER' },
            { digit: '#', sub: 'HEX' }
          ].map((item) => (
            <button
              key={item.digit}
              type="button"
              onClick={() => handleDigitClick(item.digit)}
              className="btn btn-secondary"
              style={{
                height: '50px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.2rem',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                {item.digit}
              </span>
              {item.sub && (
                <span
                  style={{
                    fontSize: '0.58rem',
                    color: 'var(--text-dim)',
                    letterSpacing: '0.05em'
                  }}
                >
                  {item.sub}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Call Action Controls */}
        {callState === 'connected' || callState === 'parked' || callState === 'voicemail' || callState === 'dialing' || callState === 'ringing' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {callState === 'parked' && (
              <button
                type="button"
                onClick={handleParkOrUnparkCall}
                className="btn btn-amber"
                style={{ width: '100%', height: '42px', fontWeight: 700 }}
              >
                <PlayCircle size={16} /> Unpark / Resume Call (8)
              </button>
            )}

            {callState === 'connected' && (
              <>
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
                    <button
                      onClick={() => setShowInviteInput(false)}
                      className="btn btn-secondary btn-sm"
                    >
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
                      onClick={handleParkOrUnparkCall}
                      className="btn btn-secondary btn-sm"
                    >
                      <PauseCircle size={14} /> Park (8)
                    </button>
                  </div>
                )}
              </>
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
