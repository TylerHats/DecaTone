import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Phone, RefreshCw, Hand } from 'lucide-react';

interface InteractiveRotaryDialProps {
  onDialDigit: (digit: string) => void;
  disabled?: boolean;
  activeDigit?: string | null;
}

interface DigitConfig {
  digit: string;
  letters: string;
  index: number;
  windUpAngle: number; // Clockwise degrees to reach the metal stop at ~25 deg (right side)
  restAngleDeg: number; // Fixed counter-clockwise rest position on dial
}

// Finger stop stationary position (right-lower ~3:50 clock position; 0 deg = 3:00)
const FINGER_STOP_ANGLE_DEG = 25;

// Digits 1 through 0 in authentic counter-clockwise Bell 500 layout:
// '1' near upper-right (2:10) continuing counterclockwise around top to '0' at bottom (6:05)
const DIGIT_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const LETTER_MAP: Record<string, string> = {
  '1': '',
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PRS',
  '8': 'TUV',
  '9': 'WXY',
  '0': 'OPER'
};

const DIGIT_CONFIGS: DigitConfig[] = DIGIT_ORDER.map((digit, idx) => {
  const windUpAngle = 50 + idx * 27;
  const restAngleDeg = (FINGER_STOP_ANGLE_DEG - windUpAngle + 720) % 360;
  return {
    digit,
    letters: LETTER_MAP[digit] || '',
    index: idx,
    windUpAngle,
    restAngleDeg
  };
});

export const InteractiveRotaryDial: React.FC<InteractiveRotaryDialProps> = ({
  onDialDigit,
  disabled = false
}) => {
  const [wheelRotation, setWheelRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [activeDragDigit, setActiveDragDigit] = useState<DigitConfig | null>(null);
  const [pulsesCounted, setPulsesCounted] = useState(0);
  const [totalPulsesForDigit, setTotalPulsesForDigit] = useState(0);
  const [instructionHint, setInstructionHint] = useState(
    'Drag a hole clockwise to the metal stop, tap a digit, or type 0–9'
  );

  const dialRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastRatchetAngleRef = useRef(0);
  const lastPointerAngleRef = useRef(0);
  const accumulatedRotationRef = useRef(0);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isEmittingRef = useRef(false);

  const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const emitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSpinTimers = useCallback(() => {
    if (pulseIntervalRef.current) {
      clearInterval(pulseIntervalRef.current);
      pulseIntervalRef.current = null;
    }
    if (animIntervalRef.current) {
      clearInterval(animIntervalRef.current);
      animIntervalRef.current = null;
    }
    if (snapIntervalRef.current) {
      clearInterval(snapIntervalRef.current);
      snapIntervalRef.current = null;
    }
    if (emitTimeoutRef.current) {
      clearTimeout(emitTimeoutRef.current);
      emitTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearSpinTimers();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [clearSpinTimers]);

  const initAudio = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtxRef.current = new AudioContextClass();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  };

  const playRatchetClick = useCallback(() => {
    try {
      initAudio();
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900 + Math.random() * 300, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.015);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.015);
    } catch {}
  }, []);

  const playPulseClick = useCallback(() => {
    try {
      initAudio();
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(240, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
    } catch {}
  }, []);

  const runReturnAndEmit = useCallback(
    (digitConf: DigitConfig, startAngle: number) => {
      clearSpinTimers();
      const digitToDial = digitConf.digit;
      const requiredPulses = digitToDial === '0' ? 10 : parseInt(digitToDial, 10);

      setWheelRotation(startAngle);
      setIsReturning(true);
      setTotalPulsesForDigit(requiredPulses);
      setPulsesCounted(0);
      setInstructionHint(`Sending ${requiredPulses} pulses at 10 PPS...`);

      const returnDurationMs = Math.max(240, requiredPulses * 85);
      const startTime = Date.now();
      let pulseCounter = 0;

      pulseIntervalRef.current = setInterval(() => {
        pulseCounter++;
        if (pulseCounter <= requiredPulses) {
          setPulsesCounted(pulseCounter);
          playPulseClick();
        }
      }, returnDurationMs / requiredPulses);

      animIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / returnDurationMs);
        setWheelRotation(startAngle * (1 - progress));

        if (progress >= 1) {
          clearSpinTimers();
          setWheelRotation(0);
          accumulatedRotationRef.current = 0;
          setIsReturning(false);
          setActiveDragDigit(null);
          setPulsesCounted(0);
          setTotalPulsesForDigit(0);
          setInstructionHint('Drag a hole clockwise to the metal stop, tap a digit, or type 0–9');

          if (!isEmittingRef.current) {
            isEmittingRef.current = true;
            onDialDigit(digitToDial);
            emitTimeoutRef.current = setTimeout(() => {
              isEmittingRef.current = false;
            }, 80);
          }
        }
      }, 16);
    },
    [clearSpinTimers, onDialDigit, playPulseClick]
  );

  const animateFullDialDigit = useCallback(
    (digitConf: DigitConfig) => {
      if (disabled || isReturning || isDragging || isEmittingRef.current) return;
      initAudio();
      clearSpinTimers();
      setActiveDragDigit(digitConf);
      setIsReturning(true);
      setInstructionHint(`Dialing '${digitConf.digit}'...`);
      const windStart = Date.now();
      const windMs = Math.max(120, Math.round(digitConf.windUpAngle * 0.7));
      let lastClick = 0;

      snapIntervalRef.current = setInterval(() => {
        const progress = Math.min(1, (Date.now() - windStart) / windMs);
        const angle = digitConf.windUpAngle * progress;
        setWheelRotation(angle);
        if (angle - lastClick >= 20) {
          playRatchetClick();
          lastClick = angle;
        }
        if (progress >= 1) {
          if (snapIntervalRef.current) {
            clearInterval(snapIntervalRef.current);
            snapIntervalRef.current = null;
          }
          runReturnAndEmit(digitConf, digitConf.windUpAngle);
        }
      }, 16);
    },
    [disabled, isReturning, isDragging, clearSpinTimers, playRatchetClick, runReturnAndEmit]
  );

  const getPointerAngle = (e: React.PointerEvent | PointerEvent): number => {
    if (!dialRef.current) return 0;
    const rect = dialRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  };

  const handlePointerDown = (digitConf: DigitConfig, e: React.PointerEvent) => {
    if (disabled || isReturning || isDragging || isEmittingRef.current) return;
    initAudio();

    const pointerAngle = getPointerAngle(e);
    lastPointerAngleRef.current = pointerAngle;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    accumulatedRotationRef.current = 0;
    lastRatchetAngleRef.current = 0;
    setActiveDragDigit(digitConf);
    setIsDragging(true);
    setInstructionHint(`Dialing '${digitConf.digit}': Drag clockwise to the metal stop...`);

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !activeDragDigit || isReturning) return;

    const currentPointerAngle = getPointerAngle(e);
    let stepDelta = currentPointerAngle - lastPointerAngleRef.current;

    if (stepDelta < -180) stepDelta += 360;
    if (stepDelta > 180) stepDelta -= 360;

    lastPointerAngleRef.current = currentPointerAngle;

    let newRotation = Math.max(0, accumulatedRotationRef.current + stepDelta);
    const maxRotation = activeDragDigit.windUpAngle;
    if (newRotation > maxRotation) {
      newRotation = maxRotation;
    }

    accumulatedRotationRef.current = newRotation;
    setWheelRotation(newRotation);

    if (newRotation - lastRatchetAngleRef.current >= 12) {
      playRatchetClick();
      lastRatchetAngleRef.current = newRotation;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging || !activeDragDigit || isReturning) return;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}

    clearSpinTimers();
    setIsDragging(false);
    const finalRotation = accumulatedRotationRef.current;
    const targetConf = activeDragDigit;
    const targetAngle = targetConf.windUpAngle;
    const downPos = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    const moveDist = downPos ? Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) : 99;

    // Quick click/tap without dragging rotates cleanly & dials the digit
    if (moveDist < 8 && finalRotation < 6) {
      animateFullDialDigit(targetConf);
      return;
    }

    if (finalRotation >= targetAngle * 0.75) {
      runReturnAndEmit(targetConf, targetAngle);
    } else {
      setIsReturning(true);
      setInstructionHint('Dial cancelled (drag all the way to the metal stop)');
      const startAngle = finalRotation;
      const snapStartTime = Date.now();
      snapIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - snapStartTime;
        const progress = Math.min(1, elapsed / 150);
        setWheelRotation(startAngle * (1 - progress));

        if (progress >= 1) {
          clearSpinTimers();
          setWheelRotation(0);
          accumulatedRotationRef.current = 0;
          setIsReturning(false);
          setActiveDragDigit(null);
          setInstructionHint('Drag a hole clockwise to the metal stop, tap a digit, or type 0–9');
        }
      }, 16);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) {
      const conf = DIGIT_CONFIGS.find((c) => c.digit === e.key);
      if (conf) {
        e.preventDefault();
        animateFullDialDigit(conf);
      }
    }
  };

  const dialRadius = 104;

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label="Interactive Rotary Dial"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1rem',
        userSelect: 'none',
        width: '100%',
        outline: 'none'
      }}
    >
      <div
        ref={dialRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'relative',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, #1a2234 0%, #0d121d 70%, #070a10 100%)',
          boxShadow:
            '0 15px 35px rgba(0,0,0,0.6), inset 0 2px 5px rgba(255,255,255,0.1), 0 0 0 6px #1e293b, 0 0 20px rgba(14, 165, 233, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          touchAction: 'none'
        }}
      >
        {/* Fixed Stationary Background Number Plate */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {DIGIT_CONFIGS.map((conf) => {
            const angleRad = (conf.restAngleDeg * Math.PI) / 180;
            const x = 140 + dialRadius * Math.cos(angleRad) - 18;
            const y = 140 + dialRadius * Math.sin(angleRad) - 18;

            return (
              <div
                key={`plate-${conf.digit}`}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#e2e8f0',
                  textShadow: '0 1px 3px rgba(0,0,0,0.9)'
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.2rem',
                    fontWeight: 800,
                    lineHeight: 1
                  }}
                >
                  {conf.digit}
                </span>
                {conf.letters && (
                  <span
                    style={{
                      fontSize: '0.48rem',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: '#94a3b8',
                      marginTop: '1px',
                      textTransform: 'uppercase'
                    }}
                  >
                    {conf.letters}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Rotating Transparent Finger Wheel */}
        <div
          style={{
            position: 'absolute',
            inset: '6px',
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 80%, rgba(0,0,0,0.2) 100%)',
            border: '2px solid rgba(255,255,255,0.12)',
            transform: `rotate(${wheelRotation}deg)`,
            transformOrigin: 'center center',
            zIndex: 10,
            cursor: disabled ? 'not-allowed' : isDragging ? 'grabbing' : 'grab'
          }}
        >
          {DIGIT_CONFIGS.map((conf) => {
            const angleRad = (conf.restAngleDeg * Math.PI) / 180;
            const holeRadius = dialRadius;
            const x = 134 + holeRadius * Math.cos(angleRad) - 20;
            const y = 134 + holeRadius * Math.sin(angleRad) - 20;
            const isTarget = activeDragDigit?.digit === conf.digit;

            return (
              <button
                type="button"
                key={`hole-${conf.digit}`}
                disabled={disabled}
                onPointerDown={(e) => handlePointerDown(conf, e)}
                onPointerUp={handlePointerUp}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    animateFullDialDigit(conf);
                  }
                }}
                aria-label={`Dial digit ${conf.digit}${conf.letters ? ` ${conf.letters}` : ''}`}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: isTarget
                    ? 'radial-gradient(circle, rgba(245, 158, 11, 0.45) 0%, rgba(245, 158, 11, 0.1) 80%)'
                    : 'radial-gradient(circle, rgba(0,0,0,0.4) 0%, rgba(255,255,255,0.08) 100%)',
                  border: isTarget ? '2px solid #f59e0b' : '2px solid rgba(255, 255, 255, 0.35)',
                  boxShadow: isTarget
                    ? '0 0 14px rgba(245, 158, 11, 0.6), inset 0 2px 6px rgba(0,0,0,0.8)'
                    : 'inset 0 3px 6px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.4)',
                  cursor: disabled ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    border: '1px dashed rgba(255,255,255,0.3)',
                    pointerEvents: 'none'
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Center Hub Plate */}
        <div
          style={{
            width: '94px',
            height: '94px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #2d3748 0%, #1a202c 60%, #0f172a 100%)',
            border: '3px solid #d97706',
            boxShadow:
              '0 0 18px rgba(217, 119, 6, 0.35), inset 0 2px 6px rgba(255,255,255,0.25)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            pointerEvents: 'none'
          }}
        >
          <Phone
            size={22}
            color="#fbbf24"
            style={{ filter: 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.6))' }}
          />
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 800,
              color: '#fbbf24',
              letterSpacing: '0.12em',
              marginTop: '2px'
            }}
          >
            DECATONE
          </span>
          <span
            style={{
              fontSize: '0.45rem',
              color: '#94a3b8',
              letterSpacing: '0.08em',
              marginTop: '1px'
            }}
          >
            BELL 500
          </span>
        </div>

        {/* Authentic Stationary Metal Finger Stop Bracket at Right (~25 deg / 3:50) */}
        {(() => {
          const stopRad = (FINGER_STOP_ANGLE_DEG * Math.PI) / 180;
          const stopDist = 114;
          const stopX = 140 + stopDist * Math.cos(stopRad) - 16;
          const stopY = 140 + stopDist * Math.sin(stopRad) - 7;
          return (
            <div
              title="Stationary Metal Finger Stop"
              style={{
                position: 'absolute',
                left: `${stopX}px`,
                top: `${stopY}px`,
                width: '32px',
                height: '14px',
                background:
                  'linear-gradient(135deg, #f8fafc 0%, #94a3b8 40%, #475569 80%, #1e293b 100%)',
                borderRadius: '4px',
                boxShadow: '0 4px 8px rgba(0,0,0,0.8), inset 0 1px 2px rgba(255,255,255,0.8)',
                border: '1px solid rgba(255,255,255,0.5)',
                transform: `rotate(${FINGER_STOP_ANGLE_DEG - 5}deg)`,
                zIndex: 25,
                pointerEvents: 'none'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '4px',
                  top: '3px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#e2e8f0',
                  boxShadow: 'inset 0 1px 1px #000'
                }}
              />
            </div>
          );
        })()}
      </div>

      {/* Pulse & Dial Status Feedback */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.85rem'
        }}
      >
        {isReturning ? (
          <span
            style={{
              color: 'var(--accent-amber)',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <RefreshCw size={14} className="spin" />
            Governor Pulsing: {pulsesCounted} / {totalPulsesForDigit} pulses (10 PPS)...
          </span>
        ) : isDragging ? (
          <span
            style={{
              color: 'var(--accent-cyan)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <Hand size={14} /> Rotating '{activeDragDigit?.digit}' ({Math.round(wheelRotation)}° /{' '}
            {activeDragDigit?.windUpAngle}° to stop)
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            {instructionHint}
          </span>
        )}
      </div>
    </div>
  );
};
