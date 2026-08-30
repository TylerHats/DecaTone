import mqtt, { MqttClient } from 'mqtt';
import { query, queryOne, execute } from '../db/connection';
import { phoneSwitchService } from './phoneSwitchService';
import { TtsAudioService } from './ttsAudioService';
import { serviceLinesService } from './serviceLinesService';

export class HomeAssistantMqttService {
  private client: MqttClient | null = null;
  private isConnected = false;

  public async init() {
    try {
      const settings = await this.getMqttSettings();
      if (settings.enabled !== 'true' || !settings.host) {
        console.log('[Home Assistant MQTT] MQTT integration is disabled in system settings.');
        return;
      }

      this.connect(settings);
    } catch (err) {
      console.error('[Home Assistant MQTT] Init error:', err);
    }
  }

  public async getMqttSettings(): Promise<{ enabled: string; host: string; port: number; user: string; pass: string; pin: string }> {
    const rows = await query<{ key: string; value: string }>(
      'SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?, ?, ?)',
      ['mqtt_enabled', 'mqtt_host', 'mqtt_port', 'mqtt_user', 'mqtt_pass', 'mqtt_ha_pin']
    );

    const map: Record<string, string> = {};
    rows.forEach(r => { map[r.key] = r.value; });

    return {
      enabled: map['mqtt_enabled'] || 'false',
      host: map['mqtt_host'] || 'localhost',
      port: parseInt(map['mqtt_port'] || '1883', 10),
      user: map['mqtt_user'] || '',
      pass: map['mqtt_pass'] || '',
      pin: map['mqtt_ha_pin'] || '512'
    };
  }

  public async updateSettings(settings: { enabled: boolean; host: string; port: number; user?: string; pass?: string; pin?: string }) {
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['mqtt_enabled', settings.enabled ? 'true' : 'false']);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['mqtt_host', settings.host.trim()]);
    await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['mqtt_port', String(settings.port)]);
    if (settings.user !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['mqtt_user', settings.user.trim()]);
    }
    if (settings.pass !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['mqtt_pass', settings.pass.trim()]);
    }
    if (settings.pin !== undefined) {
      await execute('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['mqtt_ha_pin', settings.pin.trim()]);
    }

    if (this.client) {
      this.client.end(true);
      this.client = null;
      this.isConnected = false;
    }

    if (settings.enabled && settings.host) {
      this.connect({
        enabled: 'true',
        host: settings.host,
        port: settings.port,
        user: settings.user || '',
        pass: settings.pass || '',
        pin: settings.pin || '512'
      });
    }
  }

  private connect(settings: { enabled: string; host: string; port: number; user: string; pass: string; pin: string }) {
    const brokerUrl = `mqtt://${settings.host}:${settings.port}`;
    console.log(`[Home Assistant MQTT] Connecting to broker: ${brokerUrl}...`);

    this.client = mqtt.connect(brokerUrl, {
      username: settings.user || undefined,
      password: settings.pass || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 10000
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('🏠 [Home Assistant MQTT] Connected to MQTT Broker! Auto-Discovery enabled.');

      // Subscribe to command topics
      this.client?.subscribe('decatone/+/+/set', (err) => {
        if (err) console.error('[Home Assistant MQTT] Subscription error:', err);
      });

      // Discover all registered phones
      this.discoverAllPhones();
    });

    this.client.on('message', async (topic: string, payload: Buffer) => {
      try {
        const parts = topic.split('/'); // e.g. ['decatone', 'DT-1234', 'ring', 'set']
        if (parts.length === 4 && parts[0] === 'decatone' && parts[3] === 'set') {
          const deviceId = parts[1];
          const entity = parts[2];
          const val = payload.toString().trim();
          await this.handleMqttCommand(deviceId, entity, val);
        }
      } catch (err) {
        console.error('[Home Assistant MQTT] Message handling error:', err);
      }
    });

    this.client.on('error', (err) => {
      console.error('[Home Assistant MQTT] Connection Error:', err.message);
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });
  }

  private async handleMqttCommand(deviceId: string, entity: string, value: string) {
    console.log(`[Home Assistant MQTT] Command received: ${deviceId} -> ${entity} = ${value}`);

    if (entity === 'ring') {
      const phone = await queryOne<any>('SELECT ring_style, ring_cadence_custom FROM phones WHERE device_id = ?', [deviceId]);
      phoneSwitchService.sendTestRing(deviceId, phone?.ring_style || 'traditional', phone?.ring_cadence_custom || '2000,4000');
    } else if (entity === 'ring_enabled') {
      const isEnabled = value.toUpperCase() === 'ON' || value === '1' || value.toLowerCase() === 'true';
      await execute('UPDATE phones SET ring_enabled = ? WHERE device_id = ?', [isEnabled ? 1 : 0, deviceId]);
      this.publishState(`decatone/${deviceId}/ring_enabled/state`, isEnabled ? 'ON' : 'OFF');
    } else if (entity === 'audio_profile') {
      await execute('UPDATE phones SET audio_profile = ? WHERE device_id = ?', [value.trim(), deviceId]);
      phoneSwitchService.pushDeviceSettings(deviceId, { audioProfile: value.trim() });
      this.publishState(`decatone/${deviceId}/audio_profile/state`, value.trim());
    } else if (entity === 'volume') {
      const vol = parseInt(value, 10);
      if (!isNaN(vol)) {
        await execute('UPDATE phones SET earpiece_volume = ? WHERE device_id = ?', [vol, deviceId]);
        phoneSwitchService.pushDeviceSettings(deviceId, { earpieceVolume: vol });
        this.publishState(`decatone/${deviceId}/volume/state`, String(vol));
      }
    } else if (entity === 'mic_gain') {
      const gain = parseInt(value, 10);
      if (!isNaN(gain)) {
        await execute('UPDATE phones SET mic_sensitivity = ? WHERE device_id = ?', [gain, deviceId]);
        phoneSwitchService.pushDeviceSettings(deviceId, { micSensitivity: gain });
        this.publishState(`decatone/${deviceId}/mic_gain/state`, String(gain));
      }
    } else if (entity === 'sidetone') {
      const side = parseInt(value, 10);
      if (!isNaN(side)) {
        await execute('UPDATE phones SET sidetone_level = ? WHERE device_id = ?', [side, deviceId]);
        phoneSwitchService.pushDeviceSettings(deviceId, { sidetoneLevel: side });
        this.publishState(`decatone/${deviceId}/sidetone/state`, String(side));
      }
    } else if (entity === 'announce') {
      // Play TTS speech direct to earpiece
      const client = phoneSwitchService.getPhoneClient(deviceId);
      if (client?.ws) {
        const pcm = TtsAudioService.synthesizeSpeech(value);
        serviceLinesService.startRawPcmPlaybackSession(deviceId, pcm, client.ws);
      }
    }
  }

  /**
   * Home Assistant MQTT Discovery Registration for a Phone
   */
  public async registerPhoneDiscovery(phone: any, user?: any) {
    if (!this.client || !this.isConnected) return;

    const deviceId = phone.device_id;
    const cleanId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const label = phone.phone_label || 'Phone';
    const phoneName = user?.display_name || user?.username ? `${user.display_name || user.username}'s ${label}` : `DecaTone ${label} (${deviceId})`;

    const haDevice = {
      identifiers: [`decatone_${cleanId}`],
      name: phoneName,
      model: phone.hardware_profile || 'Vintage Model 500',
      manufacturer: 'DecaTone Open Source VoIP',
      sw_version: phone.firmware_version || '1.2.0'
    };

    // 1. Button: Ring Vintage Bell
    const ringConfig = {
      name: `${phoneName} Ring Bell`,
      unique_id: `decatone_${cleanId}_ring`,
      command_topic: `decatone/${deviceId}/ring/set`,
      icon: 'mdi:bell-ring',
      device: haDevice
    };
    this.publishJson(`homeassistant/button/decatone_${cleanId}_ring/config`, ringConfig);

    // 2. Binary Sensor: Handset Cradle Hook State
    const hookConfig = {
      name: `${phoneName} Handset Hook`,
      unique_id: `decatone_${cleanId}_hook`,
      state_topic: `decatone/${deviceId}/hook/state`,
      payload_on: 'OFF_HOOK',
      payload_off: 'ON_HOOK',
      icon: 'mdi:phone-classic',
      device: haDevice
    };
    this.publishJson(`homeassistant/binary_sensor/decatone_${cleanId}_hook/config`, hookConfig);

    // 3. Switch: Ring on Incoming Call
    const ringEnabledConfig = {
      name: `${phoneName} Ring on Incoming`,
      unique_id: `decatone_${cleanId}_ring_enabled`,
      state_topic: `decatone/${deviceId}/ring_enabled/state`,
      command_topic: `decatone/${deviceId}/ring_enabled/set`,
      payload_on: 'ON',
      payload_off: 'OFF',
      icon: 'mdi:bell',
      device: haDevice
    };
    this.publishJson(`homeassistant/switch/decatone_${cleanId}_ring_enabled/config`, ringEnabledConfig);

    // 4. Select: Audio Profile
    const profileConfig = {
      name: `${phoneName} Audio Profile`,
      unique_id: `decatone_${cleanId}_profile`,
      state_topic: `decatone/${deviceId}/audio_profile/state`,
      command_topic: `decatone/${deviceId}/audio_profile/set`,
      options: ['vintage_pots', 'early_bell', 'modern_hd'],
      icon: 'mdi:equalizer',
      device: haDevice
    };
    this.publishJson(`homeassistant/select/decatone_${cleanId}_profile/config`, profileConfig);

    // 5. Sensor: Last Dialed Number
    const dialedConfig = {
      name: `${phoneName} Last Dialed Number`,
      unique_id: `decatone_${cleanId}_last_dialed`,
      state_topic: `decatone/${deviceId}/last_dialed/state`,
      icon: 'mdi:dialpad',
      device: haDevice
    };
    this.publishJson(`homeassistant/sensor/decatone_${cleanId}_last_dialed/config`, dialedConfig);

    // 6. Number: Earpiece Volume Slider (0-100)
    const volumeConfig = {
      name: `${phoneName} Earpiece Volume`,
      unique_id: `decatone_${cleanId}_volume`,
      state_topic: `decatone/${deviceId}/volume/state`,
      command_topic: `decatone/${deviceId}/volume/set`,
      min: 0,
      max: 100,
      step: 1,
      icon: 'mdi:volume-high',
      device: haDevice
    };
    this.publishJson(`homeassistant/number/decatone_${cleanId}_volume/config`, volumeConfig);

    // 7. Number: Mic Gain Slider (0-100)
    const micConfig = {
      name: `${phoneName} Microphone Sensitivity`,
      unique_id: `decatone_${cleanId}_mic_gain`,
      state_topic: `decatone/${deviceId}/mic_gain/state`,
      command_topic: `decatone/${deviceId}/mic_gain/set`,
      min: 0,
      max: 100,
      step: 1,
      icon: 'mdi:microphone',
      device: haDevice
    };
    this.publishJson(`homeassistant/number/decatone_${cleanId}_mic_gain/config`, micConfig);

    // 8. Number: Sidetone Level Slider (0-100)
    const sidetoneConfig = {
      name: `${phoneName} Sidetone Level`,
      unique_id: `decatone_${cleanId}_sidetone`,
      state_topic: `decatone/${deviceId}/sidetone/state`,
      command_topic: `decatone/${deviceId}/sidetone/set`,
      min: 0,
      max: 100,
      step: 1,
      icon: 'mdi:hearing',
      device: haDevice
    };
    this.publishJson(`homeassistant/number/decatone_${cleanId}_sidetone/config`, sidetoneConfig);

    // Publish Initial States
    this.publishState(`decatone/${deviceId}/hook/state`, phone.hook_state === 'off_hook' ? 'OFF_HOOK' : 'ON_HOOK');
    this.publishState(`decatone/${deviceId}/ring_enabled/state`, phone.ring_enabled !== 0 ? 'ON' : 'OFF');
    this.publishState(`decatone/${deviceId}/audio_profile/state`, phone.audio_profile || 'vintage_pots');
    this.publishState(`decatone/${deviceId}/volume/state`, String(phone.earpiece_volume ?? 80));
    this.publishState(`decatone/${deviceId}/mic_gain/state`, String(phone.mic_sensitivity ?? 80));
    this.publishState(`decatone/${deviceId}/sidetone/state`, String(phone.sidetone_level ?? 10));
    this.publishState(`decatone/${deviceId}/last_dialed/state`, 'Idle');

    console.log(`[Home Assistant MQTT] Auto-Discovery published for ${phoneName} (${deviceId})`);
  }


  public publishHookState(deviceId: string, isOffHook: boolean) {
    if (!this.isConnected) return;
    this.publishState(`decatone/${deviceId}/hook/state`, isOffHook ? 'OFF_HOOK' : 'ON_HOOK');
  }

  public publishLastDialedNumber(deviceId: string, numberStr: string) {
    if (!this.isConnected) return;
    this.publishState(`decatone/${deviceId}/last_dialed/state`, numberStr);
  }

  public publishLastDialed(deviceId: string, numberStr: string) {
    this.publishLastDialedNumber(deviceId, numberStr);
  }

  public async discoverAllPhones() {
    const phones = await query<any>('SELECT * FROM phones');
    for (const phone of phones) {
      let user: any = null;
      if (phone.user_id) {
        user = await queryOne<any>('SELECT id, username, display_name, phone_number FROM users WHERE id = ?', [phone.user_id]);
      }
      await this.registerPhoneDiscovery(phone, user);
    }
  }

  private publishJson(topic: string, data: any) {
    if (this.client && this.isConnected) {
      this.client.publish(topic, JSON.stringify(data), { retain: true });
    }
  }

  private publishState(topic: string, state: string) {
    if (this.client && this.isConnected) {
      this.client.publish(topic, state, { retain: false });
    }
  }
}

export const homeAssistantMqttService = new HomeAssistantMqttService();
