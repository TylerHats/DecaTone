import React, { useState, useRef, useEffect } from 'react';
import { Phone, RefreshCw } from 'lucide-react';

interface InteractiveRotaryDialProps {
  onDialDigit: (digit: string) => void;
  disabled?: boolean;
  activeDigit?: string | null;
}

export const InteractiveRotaryDial: React.FC<InteractiveRotaryDialProps> = ({
  onDialDigit,
  disabled = false,
  activeDigit = null
}) => {
  const [rotation, setRotation] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const [pulsingDigit, setPulsingDigit] = useState<string | null>(null);
  const [pulsesCounted, setPulsesCounted] = useState(0);

  // Digits arranged clockwise: 1, 2, 3, 4, 5, 6, 7, 8, 9, 0
  // Standard rotary angle positions (relative to finger stop at ~135 degrees):
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const digitAngles: Record<string, number> = {
    '1': 45,
    '2': 75,
    '3': 105,
    '4': 135,
    '5': 165,
    '6': 195,
    '7': 225,
    '8': 255,
    '9': 285,
    '0': 315
  };

  const handleDigitClick = (digit: string) => {
    if (disabled || isRotating) return;

    setIsRotating(true);
    setPulsingDigit(digit);

    // Calculate rotation angle to reach finger stop at ~130 deg
    const targetAngle = (digits.indexOf(digit) + 1) * 30;
    setRotation(targetAngle);

    // Return spring animation
    setTimeout(() => {
      setRotation(0);
      const pulses = digit === '0' ? 10 : parseInt(digit, 10);
      setPulsesCounted(pulses);

      setTimeout(() => {
        onDialDigit(digit);
        setIsRotating(false);
        setPulsingDigit(null);
        setPulsesCounted(0);
      }, 350);
    }, 450);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', userSelect: 'none' }}>
      <div
        style={{
          position: 'relative',
          width: '280px',
          height: '280px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, #1a2234 0%, #0d121d 70%, #070a10 100%)',
          boxShadow: '0 15px 35px rgba(0,0,0,0.6), inset 0 2px 5px rgba(255,255,255,0.1), 0 0 0 6px #1e293b, 0 0 20px rgba(14, 165, 233, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {/* Fixed Background Number Plate */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {digits.map((digit, idx) => {
            const angleDeg = 35 + idx * 28;
            const angleRad = (angleDeg * Math.PI) / 180;
            const radius = 100;
            const x = 140 + radius * Math.cos(angleRad) - 18;
            const y = 140 + radius * Math.sin(angleRad) - 18;

            return (
              <div
                key={digit}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.2rem',
                  fontWeight: '700',
                  color: '#94a3b8',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)'
                }}
              >
                {digit}
              </div>
            );
          })}
        </div>

        {/* Rotating Finger Wheel (Wheel with finger holes) */}
        <div
          style={{
            position: 'absolute',
            inset: '10px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
            border: '2px solid rgba(255,255,255,0.06)',
            transform: `rotate(${rotation}deg)`,
            transition: isRotating && rotation === 0 ? 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)' : 'transform 0.3s ease-out',
            zIndex: 10
          }}
        >
          {digits.map((digit, idx) => {
            const angleDeg = 35 + idx * 28;
            const angleRad = (angleDeg * Math.PI) / 180;
            const radius = 90;
            const x = 130 + radius * Math.cos(angleRad) - 20;
            const y = 130 + radius * Math.sin(angleRad) - 20;

            return (
              <button
                key={digit}
                onClick={() => handleDigitClick(digit)}
                disabled={disabled || isRotating}
                aria-label={`Dial digit ${digit}`}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: pulsingDigit === digit ? 'radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, transparent 80%)' : 'radial-gradient(circle, rgba(0,0,0,0.7) 0%, rgba(14, 165, 233, 0.15) 100%)',
                  border: '2px solid rgba(255, 255, 255, 0.25)',
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                  padding: 0
                }}
                onMouseEnter={(e) => {
                  if (!disabled && !isRotating) {
                    e.currentTarget.style.borderColor = '#0ea5e9';
                    e.currentTarget.style.boxShadow = '0 0 12px rgba(14,165,233,0.5)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  e.currentTarget.style.boxShadow = 'inset 0 2px 6px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5)';
                }}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
              </button>
            );
          })}
        </div>

        {/* Center Vintage Hub Wheel */}
        <div
          style={{
            width: '90px',
            height: '90px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #2d3748 0%, #1a202c 60%, #0f172a 100%)',
            border: '3px solid #d97706',
            boxShadow: '0 0 15px rgba(217, 119, 6, 0.3), inset 0 2px 6px rgba(255,255,255,0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            pointerEvents: 'none'
          }}
        >
          <Phone size={24} color="#fbbf24" style={{ filter: 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.6))' }} />
          <span style={{ fontSize: '0.65rem', fontWeight: '800', color: '#fbbf24', letterSpacing: '0.1em', marginTop: '2px' }}>DECATONE</span>
        </div>

        {/* Metal Finger Stop Bracket at bottom right */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            right: '48px',
            width: '28px',
            height: '10px',
            background: 'linear-gradient(180deg, #cbd5e1 0%, #64748b 100%)',
            borderRadius: '4px',
            boxShadow: '0 3px 6px rgba(0,0,0,0.6)',
            transform: 'rotate(-25deg)',
            zIndex: 25,
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Pulse & Dial Status Feedback */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        {isRotating ? (
          <span style={{ color: 'var(--accent-amber)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <RefreshCw size={14} className="spin" /> Dialing Digit '{pulsingDigit}' ({pulsesCounted} pulses)...
          </span>
        ) : (
          <span>Click any finger hole or rotate the dial to send pulses</span>
        )}
      </div>
    </div>
  );
};
