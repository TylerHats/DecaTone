import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef
} from 'react';
import { useAuth } from './AuthContext';
import { softphone, SoftphoneSecurityMode } from '../services/WebAudioSoftphone';
import { hasRawKeyInMemory, isPrivateKeyUnlocked, wrapUserKeyForDevice } from '../services/e2eeCrypto';

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
  hookFlashEnabled?: boolean;
  intercomEnabled?: boolean;
  callForwardingEnabled?: boolean;
  callForwardEnabled?: boolean;
  forwardToNumber?: string;
  callForwardNumber?: string;
  otaAutoUpdateEnabled?: boolean;
  otaUpdateTime?: string;
  otaUpdateChannel?: string;
  firmwareVersion?: string;
  rssi?: number;
  ipAddress?: string;
  lastSeen?: string;
  devicePublicKey?: string | null;
  hasVmKey?: boolean;
}

export interface ActiveCallState {
  callId?: string;
  state: 'idle' | 'dialing' | 'ringing' | 'connected' | 'busy' | 'voicemail' | 'parked';
  callerNumber?: string;
  callerName?: string;
  calleeNumber?: string;
  calleeName?: string;
  isSystemLine?: boolean;
  isVoicemail?: boolean;
  startedAt?: number;
  durationSec?: number;
}

export interface IncomingCallNotification {
  callId: string;
  callerNumber: string;
  callerName?: string;
}

export interface CalibrationProgress {
  deviceId: string;
  freq: number;
  percent: number;
}

export interface PhoneContextType {
  phone: PhoneDevice | null;
  phones: PhoneDevice[];
  selectedPhoneId: string | null;
  settings: PhoneDevice | null;
  activeCall: ActiveCallState | null;
  incomingCall: IncomingCallNotification | null;
  currentDialBuffer: string;
  calibrationProgress: CalibrationProgress | null;
  e2eeSafetyCode: string | null;
  e2eeSecurityMode: SoftphoneSecurityMode;
  loading: boolean;
  isWebPhoneModalOpen: boolean;
  setWebPhoneModalOpen: (open: boolean) => void;
  webPhoneInitialNumber: string;
  setWebPhoneInitialNumber: (num: string) => void;
  openWebPhoneWithNumber: (num: string) => void;
  phonesNeedingPasswordSync: boolean;
  syncDeviceVmKeys: () => Promise<void>;
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
  claimPhoneByCode: (pairingCode: string, label?: string) => Promise<boolean>;
  unclaimPhone: () => Promise<boolean>;
  unclaimDevice: (deviceId: string) => Promise<boolean>;
  dialNumber: (destination: string) => Promise<boolean>;
  hangup: () => Promise<void>;
  answerCall: (callId?: string) => Promise<void>;
  answerIncomingCall: () => Promise<void>;
  declineCallToVoicemail: (callId?: string) => Promise<void>;
  dismissIncomingCall: () => void;
}

const PhoneContext = createContext<PhoneContextType | undefined>(undefined);

function isSystemServiceNumber(num?: string): boolean {
  if (!num) return false;
  return ['0', '00', '099', '111', '119', '300', '411', '567', '611', '711', '069', '072', '073', '078', '079'].includes(
    num
  );
}

export const PhoneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isVaultUnlocked } = useAuth();
  const userId = user?.id;

  const [phones, setPhones] = useState<PhoneDevice[]>([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallNotification | null>(null);
  const [currentDialBuffer, setCurrentDialBuffer] = useState('');
  const [calibrationProgress, setCalibrationProgress] = useState<CalibrationProgress | null>(null);
  const [e2eeSafetyCode, setE2eeSafetyCode] = useState<string | null>(null);
  const [e2eeSecurityMode, setE2eeSecurityMode] = useState<SoftphoneSecurityMode>('none');
  const [loading, setLoading] = useState(true);
  const [isWebPhoneModalOpen, setWebPhoneModalOpen] = useState(false);
  const [webPhoneInitialNumber, setWebPhoneInitialNumber] = useState('');

  const syncedVmKeyDevicesRef = useRef<Set<string>>(new Set());
  const phonesRef = useRef<PhoneDevice[]>([]);
  const monitorWsRef = useRef<WebSocket | null>(null);
  const monitorDeviceIdRef = useRef<string>('');

  useEffect(() => {
    phonesRef.current = phones;
  }, [phones]);

  const openWebPhoneWithNumber = useCallback((num: string) => {
    setWebPhoneInitialNumber(num);
    setWebPhoneModalOpen(true);
  }, []);

  const uploadWrappedVmKeyForDevice = useCallback(
    async (deviceId: string, devicePublicKey?: string | null) => {
      if (!userId || !deviceId || !devicePublicKey || !hasRawKeyInMemory()) return;
      try {
        const wrappedVmKey = await wrapUserKeyForDevice(devicePublicKey);
        if (!wrappedVmKey) return;
        const res = await fetch(`/api/phone/${encodeURIComponent(deviceId)}/vm-key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ wrappedVmKey })
        });
        if (res.ok) {
          syncedVmKeyDevicesRef.current.add(deviceId);
        }
      } catch (err) {
        console.warn('[PhoneContext] Failed to sync wrapped VM key for device:', err);
      }
    },
    [userId]
  );

  const fetchPhones = useCallback(async () => {
    if (!userId) {
      setPhones([]);
      setSelectedPhoneId(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/phone/list', {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        const rawList: any[] = Array.isArray(data) ? data : data.phones || [];
        const list: PhoneDevice[] = rawList.map((p: any) => ({
          ...p,
          hookFlashEnabled:
            p.hookFlashEnabled !== undefined
              ? Boolean(p.hookFlashEnabled)
              : p.hook_flash_enabled !== undefined
              ? Boolean(p.hook_flash_enabled)
              : true,
          intercomEnabled:
            p.intercomEnabled !== undefined
              ? Boolean(p.intercomEnabled)
              : p.intercom_enabled !== undefined
              ? Boolean(p.intercom_enabled)
              : true,
          callForwardingEnabled:
            p.callForwardingEnabled !== undefined
              ? Boolean(p.callForwardingEnabled)
              : p.callForwardEnabled !== undefined
              ? Boolean(p.callForwardEnabled)
              : p.call_forwarding_enabled !== undefined
              ? Boolean(p.call_forwarding_enabled)
              : false,
          forwardToNumber: p.forwardToNumber ?? p.callForwardNumber ?? p.forward_to_number ?? '',
          hasVmKey: Boolean(p.hasVmKey ?? p.hasWrappedVmKey ?? p.wrapped_vm_key)
        }));
        setPhones(list);
        if (list.length > 0) {
          setSelectedPhoneId((prev) =>
            prev && list.some((p: PhoneDevice) => p.deviceId === prev) ? prev : list[0].deviceId
          );
        } else {
          setSelectedPhoneId(null);
        }
      }
    } catch (e) {
      console.error('Failed to load phones:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const syncDeviceVmKeys = useCallback(async () => {
    if (!userId || !hasRawKeyInMemory()) return;
    for (const p of phonesRef.current) {
      if (p.devicePublicKey && p.hasVmKey === false && !syncedVmKeyDevicesRef.current.has(p.deviceId)) {
        await uploadWrappedVmKeyForDevice(p.deviceId, p.devicePublicKey);
      }
    }
    await fetchPhones();
  }, [userId, uploadWrappedVmKeyForDevice, fetchPhones]);

  useEffect(() => {
    if (!isVaultUnlocked || !userId || !hasRawKeyInMemory()) return;
    for (const p of phones) {
      if (p.devicePublicKey && p.hasVmKey === false && !syncedVmKeyDevicesRef.current.has(p.deviceId)) {
        void uploadWrappedVmKeyForDevice(p.deviceId, p.devicePublicKey);
      }
    }
  }, [isVaultUnlocked, phones, userId, uploadWrappedVmKeyForDevice]);

  const phonesNeedingPasswordSync = useMemo(() => {
    if (!userId || hasRawKeyInMemory()) return false;
    return phones.some(
      (p) => Boolean(p.devicePublicKey) && p.hasVmKey === false && !syncedVmKeyDevicesRef.current.has(p.deviceId)
    );
  }, [userId, phones, isVaultUnlocked]);

  useEffect(() => {
    const unsubscribe = softphone.subscribe({
      onE2eeEstablished: (safetyCode, mode) => {
        setE2eeSafetyCode(safetyCode);
        setE2eeSecurityMode(mode || (safetyCode ? 'e2ee_verified' : 'none'));
      },
      onCallConnected: (info) => {
        setIncomingCall(null);
        setActiveCall((prev) => ({
          callId: info.callId || prev?.callId,
          state: info.isVoicemail ? 'voicemail' : 'connected',
          callerNumber: prev?.callerNumber || info.number,
          callerName: prev?.callerName || info.name,
          calleeNumber: prev?.calleeNumber || info.number,
          calleeName: prev?.calleeName || info.name,
          isSystemLine: info.isSystemLine,
          isVoicemail: info.isVoicemail,
          startedAt: prev?.startedAt || Date.now()
        }));
      },
      onStateChange: (st) => {
        if (st === 'parked' || st === 'voicemail' || st === 'connected') {
          setActiveCall((prev) => (prev ? { ...prev, state: st } : { state: st, startedAt: Date.now() }));
        } else if (st === 'ended') {
          setActiveCall(null);
        }
      }
    });
    return unsubscribe;
  }, []);

  // Connect monitoring WebSocket using HttpOnly session cookie (no localStorage JWT)
  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    const monitorDeviceId = `WEB-MON-${userId}-${Math.floor(1000 + Math.random() * 9000)}`;
    monitorDeviceIdRef.current = monitorDeviceId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/phone`;

    const clearHeartbeat = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };

    const connectWs = () => {
      if (disposed) return;

      ws = new WebSocket(wsUrl);
      monitorWsRef.current = ws;

      ws.onopen = () => {
        if (disposed || !ws) return;
        ws.send(
          JSON.stringify({
            type: 'web_client_init',
            deviceId: monitorDeviceId,
            monitorOnly: true,
            userId
          })
        );
        clearHeartbeat();
        heartbeatInterval = setInterval(() => {
          if (!disposed && ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'heartbeat', deviceId: monitorDeviceId }));
            } catch {
              // Ignore
            }
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        if (disposed || typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'phone_status_change') {
            const exists = phonesRef.current.some((p) => p.deviceId === msg.deviceId);
            if (!exists && msg.deviceId) {
              void fetchPhones();
            } else {
              setPhones((prev) =>
                prev.map((p) => (p.deviceId === msg.deviceId ? { ...p, isOnline: msg.isOnline } : p))
              );
            }
          } else if (msg.type === 'phone_hook_change') {
            setPhones((prev) =>
              prev.map((p) => (p.deviceId === msg.deviceId ? { ...p, hookState: msg.hookState } : p))
            );
            if (msg.hookState === 'on_hook') {
              setCurrentDialBuffer('');
              if (softphone.getCallState() === 'idle') {
                setActiveCall(null);
              }
            }
          } else if (msg.type === 'phone_dialing_digit') {
            setCurrentDialBuffer(msg.currentBuffer || '');
          } else if (msg.type === 'calibration_progress') {
            setCalibrationProgress({
              deviceId: msg.deviceId || '',
              freq: Number(msg.freq) || 20.0,
              percent: Number(msg.percent) || 0
            });
          } else if (msg.type === 'incoming_call') {
            if (!msg.calleeUserId || msg.calleeUserId === userId) {
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
            const sysLine = Boolean(msg.isSystemLine) || isSystemServiceNumber(msg.calleeNumber);
            setActiveCall((prev) => ({
              callId: msg.callId || prev?.callId,
              state: msg.state,
              callerNumber: msg.callerNumber ?? prev?.callerNumber,
              callerName: msg.callerName ?? prev?.callerName,
              calleeNumber: msg.calleeNumber ?? prev?.calleeNumber,
              calleeName: msg.calleeName ?? prev?.calleeName,
              isSystemLine: sysLine,
              isVoicemail: msg.state === 'voicemail' || Boolean(msg.isVoicemail),
              startedAt: prev?.state === msg.state && prev?.startedAt ? prev.startedAt : Date.now()
            }));
          } else if (msg.type === 'call_ended') {
            setActiveCall(null);
            setIncomingCall(null);
            setCurrentDialBuffer('');
            setE2eeSafetyCode(null);
            setE2eeSecurityMode('none');
            void fetchPhones();
          } else if (msg.type === 'voicemail_recording_started') {
            setIncomingCall(null);
            setActiveCall({
              callId: msg.callId,
              state: 'voicemail',
              callerNumber: msg.callerNumber,
              calleeNumber: msg.calleeNumber,
              isVoicemail: true,
              startedAt: Date.now()
            });
          }
        } catch {
          // Ignore
        }
      };

      ws.onclose = () => {
        clearHeartbeat();
        if (monitorWsRef.current === ws) {
          monitorWsRef.current = null;
        }
        if (!disposed) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      };
    };

    connectWs();
    void fetchPhones();

    return () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      monitorWsRef.current = null;
    };
  }, [userId, fetchPhones]);

  const phone = useMemo(
    () => phones.find((p) => p.deviceId === selectedPhoneId) || phones[0] || null,
    [phones, selectedPhoneId]
  );

  const selectPhone = useCallback((deviceId: string) => {
    setSelectedPhoneId(deviceId);
  }, []);

  const updatePhoneSettings = useCallback(
    async (deviceId: string, newSettings: Partial<PhoneDevice>): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/phone/settings/${encodeURIComponent(deviceId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(newSettings)
        });
        if (res.ok) {
          await fetchPhones();
          return true;
        }
      } catch {
        // Ignore
      }
      return false;
    },
    [userId, fetchPhones]
  );

  const updateSettings = useCallback(
    async (newSettings: Partial<PhoneDevice>): Promise<boolean> => {
      if (!phone) return false;
      return updatePhoneSettings(phone.deviceId, newSettings);
    },
    [phone, updatePhoneSettings]
  );

  const testRingDevice = useCallback(
    async (deviceId: string, ringStyle?: string, ringCadence?: string): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/phone/test-ring/${encodeURIComponent(deviceId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ringStyle, ringCadence })
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const testRing = useCallback(
    async (ringStyle?: string, ringCadence?: string): Promise<boolean> => {
      if (!phone) return false;
      return testRingDevice(phone.deviceId, ringStyle, ringCadence);
    },
    [phone, testRingDevice]
  );

  const rebootDevice = useCallback(
    async (deviceId: string): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/phone/reboot/${encodeURIComponent(deviceId)}`, {
          method: 'POST',
          credentials: 'include'
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const rebootPhone = useCallback(async (): Promise<boolean> => {
    if (!phone) return false;
    return rebootDevice(phone.deviceId);
  }, [phone, rebootDevice]);

  const claimPhone = useCallback(
    async (deviceId: string, label = 'Main Phone'): Promise<boolean> => {
      if (!userId) return false;
      const res = await fetch('/api/phone/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ deviceId, phoneLabel: label, label })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to claim phone');
      }

      const devPubKey = data.devicePublicKey || data.phone?.devicePublicKey;
      const targetDevId = data.phone?.deviceId || data.deviceId || deviceId;
      if (devPubKey && targetDevId && isPrivateKeyUnlocked()) {
        await uploadWrappedVmKeyForDevice(targetDevId, devPubKey);
      }

      await fetchPhones();
      return true;
    },
    [userId, fetchPhones, uploadWrappedVmKeyForDevice]
  );

  const claimPhoneByCode = useCallback(
    async (pairingCode: string, label = 'Main Phone'): Promise<boolean> => {
      if (!userId) return false;
      const cleanCode = pairingCode.trim();
      const res = await fetch('/api/phone/claim-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pairingCode: cleanCode, phoneLabel: label })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to claim phone');
      }

      const devPubKey = data.devicePublicKey || data.phone?.devicePublicKey;
      const targetDevId = data.phone?.deviceId || data.deviceId;
      if (devPubKey && targetDevId && isPrivateKeyUnlocked()) {
        await uploadWrappedVmKeyForDevice(targetDevId, devPubKey);
      }

      await fetchPhones();
      return true;
    },
    [userId, fetchPhones, uploadWrappedVmKeyForDevice]
  );

  const unclaimDevice = useCallback(
    async (deviceId: string): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch(`/api/phone/unclaim/${encodeURIComponent(deviceId)}`, {
          method: 'POST',
          credentials: 'include'
        });
        if (res.ok) {
          syncedVmKeyDevicesRef.current.delete(deviceId);
          await fetchPhones();
          return true;
        }
      } catch {
        // Ignore
      }
      return false;
    },
    [userId, fetchPhones]
  );

  const unclaimPhone = useCallback(async (): Promise<boolean> => {
    if (!phone) return false;
    return unclaimDevice(phone.deviceId);
  }, [phone, unclaimDevice]);

  const dialNumber = useCallback(
    async (destination: string): Promise<boolean> => {
      if (!userId) return false;
      try {
        const res = await fetch('/api/phone/dial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ destination })
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const hangup = useCallback(async (): Promise<void> => {
    if (softphone.getCallState() !== 'idle') {
      softphone.endCall('hangup');
    }
    setIncomingCall(null);
    setActiveCall(null);
    setE2eeSafetyCode(null);
    setE2eeSecurityMode('none');

    if (!userId) return;
    try {
      await fetch('/api/phone/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ callId: activeCall?.callId || incomingCall?.callId })
      });
    } catch {
      // Ignore
    }
  }, [userId, activeCall?.callId, incomingCall?.callId]);

  const answerCall = useCallback(
    async (explicitCallId?: string): Promise<void> => {
      const targetCallId = explicitCallId || incomingCall?.callId || activeCall?.callId;
      if (!targetCallId) return;

      const callerNumber = incomingCall?.callerNumber || activeCall?.callerNumber || 'Remote Line';
      const callerName = incomingCall?.callerName || activeCall?.callerName;

      try {
        await softphone.answer(targetCallId, userId);
        setIncomingCall(null);
        setActiveCall({
          callId: targetCallId,
          state: 'connected',
          callerNumber,
          callerName,
          startedAt: Date.now()
        });
      } catch {
        if (userId) {
          await fetch('/api/phone/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ callId: targetCallId })
          }).catch(() => {});
        }
        setIncomingCall(null);
      }
    },
    [incomingCall, activeCall, userId]
  );

  const declineCallToVoicemail = useCallback(
    async (explicitCallId?: string): Promise<void> => {
      const targetCallId = explicitCallId || incomingCall?.callId;
      if (!targetCallId) {
        setIncomingCall(null);
        return;
      }
      if (monitorWsRef.current && monitorWsRef.current.readyState === WebSocket.OPEN) {
        monitorWsRef.current.send(
          JSON.stringify({
            type: 'call_decline_to_voicemail',
            deviceId: monitorDeviceIdRef.current,
            callId: targetCallId
          })
        );
      } else {
        softphone.declineToVoicemail(targetCallId);
      }
      setIncomingCall(null);
    },
    [incomingCall?.callId]
  );

  const dismissIncomingCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  const value = useMemo<PhoneContextType>(
    () => ({
      phone,
      phones,
      selectedPhoneId,
      settings: phone,
      activeCall,
      incomingCall,
      currentDialBuffer,
      calibrationProgress,
      e2eeSafetyCode,
      e2eeSecurityMode,
      loading,
      isWebPhoneModalOpen,
      setWebPhoneModalOpen,
      webPhoneInitialNumber,
      setWebPhoneInitialNumber,
      openWebPhoneWithNumber,
      phonesNeedingPasswordSync,
      syncDeviceVmKeys,
      fetchPhones,
      fetchSettings: fetchPhones,
      refreshPhone: fetchPhones,
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
      answerCall,
      answerIncomingCall: answerCall,
      declineCallToVoicemail,
      dismissIncomingCall
    }),
    [
      phone,
      phones,
      selectedPhoneId,
      activeCall,
      incomingCall,
      currentDialBuffer,
      calibrationProgress,
      e2eeSafetyCode,
      e2eeSecurityMode,
      loading,
      isWebPhoneModalOpen,
      webPhoneInitialNumber,
      openWebPhoneWithNumber,
      phonesNeedingPasswordSync,
      syncDeviceVmKeys,
      fetchPhones,
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
      answerCall,
      declineCallToVoicemail,
      dismissIncomingCall
    ]
  );

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
};

export const usePhone = (): PhoneContextType => {
  const context = useContext(PhoneContext);
  if (!context) {
    throw new Error('usePhone must be used within a PhoneProvider');
  }
  return context;
};
