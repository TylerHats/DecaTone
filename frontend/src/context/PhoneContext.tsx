import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

export interface PhoneDevice {
  deviceId: string;
  isOnline: boolean;
  hookState: 'on_hook' | 'off_hook';
  callState: 'idle' | 'dialing' | 'ringing' | 'connected' | 'busy';
  earpieceVolume: number;
  micSensitivity: number;
  audioProfile?: string;
  sidetoneLevel?: number;
  ringStyle: string;
  ringCadenceCustom: string;
  ringTimeoutSec: number;
  hardwareProfile?: string;
  bellFrequencyHz?: number;
  hookFlashEnabled?: boolean;
  intercomEnabled?: boolean;
  firmwareVersion?: string;
  rssi?: number;
  ipAddress?: string;
  lastSeen?: string;
}

export interface ActiveCallState {
  callId?: string;
  state: 'idle' | 'dialing' | 'ringing' | 'connected' | 'busy' | 'voicemail';
  callerNumber?: string;
  callerName?: string;
  calleeNumber?: string;
  calleeName?: string;
  startedAt?: number;
  durationSec?: number;
}

interface PhoneContextType {
  phone: PhoneDevice | null;
  activeCall: ActiveCallState | null;
  currentDialBuffer: string;
  loading: boolean;
  claimPhone: (deviceId: string) => Promise<boolean>;
  unclaimPhone: () => Promise<void>;
  updateSettings: (settings: Partial<PhoneDevice>) => Promise<boolean>;
  testRing: () => Promise<boolean>;
  dialNumber: (destination: string) => Promise<boolean>;
  hangup: () => Promise<void>;
  refreshPhone: () => Promise<void>;
}

const PhoneContext = createContext<PhoneContextType | undefined>(undefined);

export const PhoneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [phone, setPhone] = useState<PhoneDevice | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [currentDialBuffer, setCurrentDialBuffer] = useState('');
  const [loading, setLoading] = useState(true);

  const refreshPhone = useCallback(async () => {
    if (!token || !user) {
      setPhone(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/phone/settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPhone(data);
      } else {
        setPhone(null);
      }
    } catch (e) {
      console.error('Failed to load phone:', e);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  // Connect WebSocket for live telephony switch events
  useEffect(() => {
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/phone`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connectWs = () => {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'web_client_init' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'phone_status_change') {
            setPhone(prev => prev && prev.deviceId === msg.deviceId ? { ...prev, isOnline: msg.isOnline } : prev);
          } else if (msg.type === 'phone_hook_change') {
            setPhone(prev => prev ? { ...prev, hookState: msg.hookState } : prev);
            if (msg.hookState === 'on_hook') {
              setCurrentDialBuffer('');
              setActiveCall(null);
            }
          } else if (msg.type === 'phone_dialing_digit') {
            setCurrentDialBuffer(msg.currentBuffer || '');
          } else if (msg.type === 'call_state_change') {
            setActiveCall({
              callId: msg.callId,
              state: msg.state,
              callerNumber: msg.callerNumber,
              callerName: msg.callerName,
              calleeNumber: msg.calleeNumber,
              calleeName: msg.calleeName,
              startedAt: Date.now()
            });
          } else if (msg.type === 'call_ended') {
            setActiveCall(null);
            setCurrentDialBuffer('');
            refreshPhone();
          } else if (msg.type === 'voicemail_recording_started') {
            setActiveCall({
              callId: msg.callId,
              state: 'voicemail',
              callerNumber: msg.callerNumber,
              calleeNumber: msg.calleeNumber,
              startedAt: Date.now()
            });
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        reconnectTimeout = setTimeout(connectWs, 3000);
      };
    };

    connectWs();
    refreshPhone();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [token, refreshPhone]);

  const claimPhone = async (deviceId: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch('/api/phone/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ deviceId })
      });
      if (res.ok) {
        await refreshPhone();
        return true;
      }
    } catch (e) {}
    return false;
  };

  const unclaimPhone = async () => {
    if (!token) return;
    await fetch('/api/phone/unclaim', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    setPhone(null);
  };

  const updateSettings = async (settings: Partial<PhoneDevice>): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch('/api/phone/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        await refreshPhone();
        return true;
      }
    } catch (e) {}
    return false;
  };

  const testRing = async (): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch('/api/phone/test-ring', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  };

  const dialNumber = async (destination: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch('/api/phone/dial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ calleeNumber: destination })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  };

  const hangup = async () => {
    setActiveCall(null);
    setCurrentDialBuffer('');
  };

  return (
    <PhoneContext.Provider
      value={{
        phone,
        activeCall,
        currentDialBuffer,
        loading,
        claimPhone,
        unclaimPhone,
        updateSettings,
        testRing,
        dialNumber,
        hangup,
        refreshPhone
      }}
    >
      {children}
    </PhoneContext.Provider>
  );
};

export const usePhone = () => {
  const context = useContext(PhoneContext);
  if (!context) throw new Error('usePhone must be used within a PhoneProvider');
  return context;
};
