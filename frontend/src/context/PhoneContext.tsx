import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { softphone } from '../services/WebAudioSoftphone';

export interface PhoneDevice {
  id?: number;
  deviceId: string;
  phoneLabel: string;
  ringEnabled: boolean;
  isOnline: boolean;
  hookState: 'on_hook' | 'off_hook';
  callState: 'idle' | 'dialing' | 'ringing' | 'connected' | 'busy' | 'screening';
  earpieceVolume: number;
  micSensitivity: number;
  audioProfile?: string;
  sidetoneLevel?: number;
  ringStyle: string;
  ringCadenceCustom: string;
  ringTimeoutSec: number;
  hardwareProfile?: string;
  bellFrequencyHz?: number;
  otaAutoUpdateEnabled?: boolean;
  otaUpdateTime?: string;
  otaUpdateChannel?: string;
  firmwareVersion?: string;
  rssi?: number;
  ipAddress?: string;
  lastSeen?: string;
}

export interface ActiveCallState {
  callId?: string;
  state: 'idle' | 'dialing' | 'ringing' | 'connected' | 'busy' | 'voicemail' | 'parked';
  callerNumber?: string;
  callerName?: string;
  calleeNumber?: string;
  calleeName?: string;
  startedAt?: number;
  durationSec?: number;
}

export interface IncomingCallNotification {
  callId: string;
  callerNumber: string;
  callerName?: string;
}

export interface PhoneContextType {
  phone: PhoneDevice | null;
  phones: PhoneDevice[];
  selectedPhoneId: string | null;
  settings: PhoneDevice | null;
  activeCall: ActiveCallState | null;
  incomingCall: IncomingCallNotification | null;
  currentDialBuffer: string;
  loading: boolean;
  fetchPhones: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  refreshPhone: () => Promise<void>;
  selectPhone: (deviceId: string) => void;
  updateSettings: (settings: Partial<PhoneDevice>) => Promise<boolean>;
  updatePhoneSettings: (deviceId: string, settings: Partial<PhoneDevice>) => Promise<boolean>;
  testRing: (ringStyle?: string, ringCadence?: string) => Promise<boolean>;
  testRingDevice: (deviceId: string, ringStyle?: string, ringCadence?: string) => Promise<boolean>;
  rebootPhone: () => Promise<boolean>;
  rebootDevice: (deviceId: string) => Promise<boolean>;
  claimPhone: (deviceId: string, label?: string) => Promise<boolean>;
  claimPhoneByCode: (wordPrefix: string, numericCode: string, label?: string) => Promise<boolean>;
  unclaimPhone: () => Promise<boolean>;
  unclaimDevice: (deviceId: string) => Promise<boolean>;
  dialNumber: (destination: string) => Promise<boolean>;
  hangup: () => Promise<void>;
  answerIncomingCall: () => Promise<void>;
  dismissIncomingCall: () => void;
}

const PhoneContext = createContext<PhoneContextType | undefined>(undefined);

export const PhoneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [phones, setPhones] = useState<PhoneDevice[]>([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallNotification | null>(null);
  const [currentDialBuffer, setCurrentDialBuffer] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchPhones = useCallback(async () => {
    if (!token || !user) {
      setPhones([]);
      setSelectedPhoneId(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/phone/list', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const list: PhoneDevice[] = Array.isArray(data) ? data : (data.phones || []);
        setPhones(list);
        if (list.length > 0) {
          setSelectedPhoneId(prev => (prev && list.some((p: PhoneDevice) => p.deviceId === prev) ? prev : list[0].deviceId));
        } else {
          setSelectedPhoneId(null);
        }
      }
    } catch (e) {
      console.error('Failed to load phones:', e);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  const refreshPhone = fetchPhones;
  const fetchSettings = fetchPhones;

  const phone = phones.find(p => p.deviceId === selectedPhoneId) || phones[0] || null;

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
        ws?.send(JSON.stringify({ type: 'web_client_init', userId: user?.id }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'phone_status_change') {
            setPhones(prev => prev.map(p => p.deviceId === msg.deviceId ? { ...p, isOnline: msg.isOnline } : p));
          } else if (msg.type === 'phone_hook_change') {
            setPhones(prev => prev.map(p => p.deviceId === msg.deviceId ? { ...p, hookState: msg.hookState } : p));
            if (msg.hookState === 'on_hook') {
              setCurrentDialBuffer('');
              setActiveCall(null);
            }
          } else if (msg.type === 'phone_dialing_digit') {
            setCurrentDialBuffer(msg.currentBuffer || '');
          } else if (msg.type === 'incoming_call') {
            if (msg.calleeUserId === user?.id) {
              setIncomingCall({
                callId: msg.callId,
                callerNumber: msg.callerNumber,
                callerName: msg.callerName
              });
            }
          } else if (msg.type === 'call_state_change') {
            if (msg.state === 'connected') {
              setIncomingCall(null);
            }
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
            setIncomingCall(null);
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
    fetchPhones();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [token, user, fetchPhones]);

  const selectPhone = (deviceId: string) => {
    setSelectedPhoneId(deviceId);
  };

  const updatePhoneSettings = async (deviceId: string, newSettings: Partial<PhoneDevice>): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(`/api/phone/settings/${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(newSettings)
      });
      if (res.ok) {
        await fetchPhones();
        return true;
      }
    } catch (e) {}
    return false;
  };

  const updateSettings = async (newSettings: Partial<PhoneDevice>): Promise<boolean> => {
    if (!phone) return false;
    return updatePhoneSettings(phone.deviceId, newSettings);
  };

  const testRingDevice = async (deviceId: string, ringStyle?: string, ringCadence?: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(`/api/phone/test-ring/${encodeURIComponent(deviceId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ringStyle, ringCadence })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  };

  const testRing = async (ringStyle?: string, ringCadence?: string): Promise<boolean> => {
    if (!phone) return false;
    return testRingDevice(phone.deviceId, ringStyle, ringCadence);
  };

  const rebootDevice = async (deviceId: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(`/api/phone/reboot/${encodeURIComponent(deviceId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  };

  const rebootPhone = async (): Promise<boolean> => {
    if (!phone) return false;
    return rebootDevice(phone.deviceId);
  };

  const claimPhone = async (deviceId: string, label = 'Main Phone'): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch('/api/phone/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ deviceId, phoneLabel: label })
      });
      if (res.ok) {
        await fetchPhones();
        return true;
      }
      const data = await res.json();
      throw new Error(data.error || 'Failed to claim phone');
    } catch (err) {
      throw err;
    }
  };

  const claimPhoneByCode = async (wordPrefix: string, numericCode: string, label = 'Main Phone'): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch('/api/phone/claim-by-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ wordPrefix, numericCode, phoneLabel: label })
      });
      if (res.ok) {
        await fetchPhones();
        return true;
      }
      const data = await res.json();
      throw new Error(data.error || 'Failed to claim phone');
    } catch (err) {
      throw err;
    }
  };

  const unclaimDevice = async (deviceId: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(`/api/phone/unclaim/${encodeURIComponent(deviceId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await fetchPhones();
        return true;
      }
    } catch (e) {}
    return false;
  };

  const unclaimPhone = async (): Promise<boolean> => {
    if (!phone) return false;
    return unclaimDevice(phone.deviceId);
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
        body: JSON.stringify({ destination })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  };

  const hangup = async (): Promise<void> => {
    if (!token) return;
    try {
      await fetch('/api/phone/hangup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) {}
  };

  const answerIncomingCall = async () => {
    if (incomingCall) {
      await softphone.answerIncoming(incomingCall.callId, user?.id);
      setIncomingCall(null);
    }
  };

  const dismissIncomingCall = () => {
    setIncomingCall(null);
  };

  return (
    <PhoneContext.Provider
      value={{
        phone,
        phones,
        selectedPhoneId,
        settings: phone,
        activeCall,
        incomingCall,
        currentDialBuffer,
        loading,
        fetchPhones,
        fetchSettings,
        refreshPhone,
        selectPhone,
        updateSettings,
        updatePhoneSettings,
        testRing,
        testRingDevice,
        rebootPhone,
        rebootDevice,
        claimPhone,
        claimPhoneByCode,
        unclaimPhone,
        unclaimDevice,
        dialNumber,
        hangup,
        answerIncomingCall,
        dismissIncomingCall
      }}
    >
      {children}
    </PhoneContext.Provider>
  );
};

export const usePhone = (): PhoneContextType => {
  const context = useContext(PhoneContext);
  if (!context) {
    throw new Error('usePhone must be used within a PhoneProvider');
  }
  return context;
};
