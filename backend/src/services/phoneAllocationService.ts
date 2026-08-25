import { query, queryOne } from '../db/connection';

export interface PhoneConfig {
  numberLength: number;
  areaCodeEnabled: boolean;
  allowedAreaCodes: string[];
  defaultAreaCode: string;
  allowUserChoice: boolean;
  assignmentMode: 'user_choice' | 'sequential' | 'random';
}

export async function getPhoneConfig(): Promise<PhoneConfig> {
  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM system_settings WHERE key IN (?, ?, ?, ?, ?, ?)', [
    'phone_number_length',
    'area_code_enabled',
    'area_codes_list',
    'default_area_code',
    'allow_user_number_choice',
    'number_assignment_mode'
  ]);

  const map: Record<string, string> = {};
  rows.forEach(r => { map[r.key] = r.value; });

  const numberLength = parseInt(map['phone_number_length'] || '3', 10);
  const areaCodeEnabled = map['area_code_enabled'] === 'true';
  const rawAreaCodes = map['area_codes_list'] || '555,212,312,415,800';
  const allowedAreaCodes = rawAreaCodes.split(',').map(s => s.trim()).filter(Boolean);
  const defaultAreaCode = map['default_area_code'] || (allowedAreaCodes[0] || '555');
  const allowUserChoice = map['allow_user_number_choice'] !== 'false';
  const assignmentMode = (map['number_assignment_mode'] as any) || 'user_choice';

  return {
    numberLength,
    areaCodeEnabled,
    allowedAreaCodes,
    defaultAreaCode,
    allowUserChoice,
    assignmentMode
  };
}

export async function isNumberAvailable(phoneNumber: string, areaCode?: string): Promise<boolean> {
  const existing = await queryOne('SELECT id FROM users WHERE phone_number = ?', [phoneNumber]);
  return !existing;
}

export async function generateAvailableNumber(config: PhoneConfig, requestedAreaCode?: string): Promise<{ phoneNumber: string; areaCode?: string }> {
  const minNum = Math.pow(10, config.numberLength - 1);
  const maxNum = Math.pow(10, config.numberLength) - 1;
  const areaCode = config.areaCodeEnabled ? (requestedAreaCode || config.defaultAreaCode) : undefined;

  if (config.assignmentMode === 'sequential') {
    for (let num = minNum; num <= maxNum; num++) {
      const numStr = String(num);
      const avail = await isNumberAvailable(numStr, areaCode);
      if (avail) {
        return { phoneNumber: numStr, areaCode };
      }
    }
  }

  // Random search
  for (let attempt = 0; attempt < 500; attempt++) {
    const randomVal = Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum;
    const numStr = String(randomVal);
    const avail = await isNumberAvailable(numStr, areaCode);
    if (avail) {
      return { phoneNumber: numStr, areaCode };
    }
  }

  // Fallback sequential search
  for (let num = minNum; num <= maxNum; num++) {
    const numStr = String(num);
    const avail = await isNumberAvailable(numStr, areaCode);
    if (avail) {
      return { phoneNumber: numStr, areaCode };
    }
  }

  throw new Error('All phone numbers within the current range are currently assigned');
}
