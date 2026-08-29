import { query, queryOne } from '../db/connection';

export interface PhoneConfig {
  numberLength: number;
  minNumberLength: number;
  maxNumberLength: number;
  allowUserChoice: boolean;
  assignmentMode: 'user_choice' | 'fixed_random' | 'sequential';
  areaCodeEnabled: boolean;
  allowedAreaCodes: string[];
  defaultAreaCode?: string;
}

export const RESERVED_NUMBERS = [
  '0', '00', '099', '119', '411', '711', '911', '611', '999', '112', '069', '072', '073'
];

export const RESERVED_PREFIXES = ['0'];

export function isReservedNumberOrPrefix(numberStr: string): boolean {
  if (!numberStr) return true;
  if (RESERVED_NUMBERS.includes(numberStr)) return true;
  for (const pfx of RESERVED_PREFIXES) {
    if (numberStr.startsWith(pfx)) return true;
  }
  // Reserved 3-digit service prefixes
  if (numberStr.startsWith('411') || numberStr.startsWith('711') || numberStr.startsWith('119') || numberStr.startsWith('911')) {
    return true;
  }
  return false;
}

export async function getPhoneConfig(): Promise<PhoneConfig> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key IN (
      'phone_number_length',
      'phone_number_min_length',
      'phone_number_max_length',
      'allow_user_number_choice',
      'number_assignment_mode',
      'area_code_enabled',
      'area_codes_list',
      'default_area_code'
    )`
  );

  const map: Record<string, string> = {};
  rows.forEach((r) => {
    map[r.key] = r.value;
  });

  const baseLen = parseInt(map['phone_number_length'] || '4', 10);
  const minLen = parseInt(map['phone_number_min_length'] || String(baseLen), 10);
  const maxLen = parseInt(map['phone_number_max_length'] || String(baseLen), 10);
  const assignmentMode = (map['number_assignment_mode'] as any) || (map['allow_user_number_choice'] === 'false' ? 'sequential' : 'user_choice');
  const allowUserChoice = assignmentMode === 'user_choice';

  const areaCodeEnabled = map['area_code_enabled'] === 'true';
  const rawAreaCodes = map['area_codes_list'] || '555,212,312,415,800';
  const allowedAreaCodes = rawAreaCodes.split(',').map((s) => s.trim()).filter(Boolean);
  const defaultAreaCode = map['default_area_code'] || (allowedAreaCodes.length > 0 ? allowedAreaCodes[0] : undefined);

  return {
    numberLength: baseLen,
    minNumberLength: minLen,
    maxNumberLength: maxLen,
    allowUserChoice,
    assignmentMode,
    areaCodeEnabled,
    allowedAreaCodes,
    defaultAreaCode
  };
}

export function validateChosenNumber(numberStr: string, config: PhoneConfig): { valid: boolean; error?: string } {
  if (!numberStr) return { valid: false, error: 'Phone number is required' };
  if (!/^\d+$/.test(numberStr)) {
    return { valid: false, error: 'Phone number must contain only numeric digits (0-9)' };
  }
  if (numberStr.length < config.minNumberLength || numberStr.length > config.maxNumberLength) {
    if (config.minNumberLength === config.maxNumberLength) {
      return { valid: false, error: `Phone number must be exactly ${config.minNumberLength} digits` };
    }
    return { valid: false, error: `Phone number must be between ${config.minNumberLength} and ${config.maxNumberLength} digits` };
  }
  if (numberStr.startsWith('0')) {
    return { valid: false, error: 'Phone numbers cannot start with 0 (reserved for operator & feature codes)' };
  }
  if (isReservedNumberOrPrefix(numberStr)) {
    return { valid: false, error: `Number ${numberStr} or its prefix is reserved for telephony services (0, 119, 411, 711)` };
  }
  return { valid: true };
}

export async function isNumberAvailable(phoneNumber: string, areaCode?: string | null): Promise<boolean> {
  if (isReservedNumberOrPrefix(phoneNumber)) {
    return false;
  }

  let row;
  if (areaCode) {
    row = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE phone_number = ? AND (area_code = ? OR area_code IS NULL)',
      [phoneNumber, areaCode]
    );
  } else {
    row = await queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE phone_number = ?',
      [phoneNumber]
    );
  }
  return (row?.count || 0) === 0;
}

export async function generateAvailableNumber(
  config: PhoneConfig,
  preferredAreaCode?: string | null
): Promise<{ phoneNumber: string; areaCode?: string }> {
  const targetAreaCode = config.areaCodeEnabled
    ? preferredAreaCode || config.defaultAreaCode
    : undefined;

  const minLen = config.minNumberLength || 4;
  const maxLen = config.maxNumberLength || minLen;
  const isFixedLength = minLen === maxLen;

  // Mode 1: Fixed Random (only permitted when min === max)
  if (config.assignmentMode === 'fixed_random' && isFixedLength) {
    const minVal = Math.pow(10, minLen - 1);
    const maxVal = Math.pow(10, minLen) - 1;

    for (let attempts = 0; attempts < 500; attempts++) {
      const candidate = String(Math.floor(minVal + Math.random() * (maxVal - minVal + 1)));
      if (!isReservedNumberOrPrefix(candidate)) {
        const available = await isNumberAvailable(candidate, targetAreaCode);
        if (available) {
          return { phoneNumber: candidate, areaCode: targetAreaCode };
        }
      }
    }
  }

  // Mode 2: Sequential Allocation (starting from 10...0 at minLength)
  const minStart = Math.pow(10, minLen - 1);
  const maxEnd = Math.pow(10, maxLen) - 1;

  for (let candidateNum = minStart; candidateNum <= maxEnd; candidateNum++) {
    const candidate = String(candidateNum);
    if (!isReservedNumberOrPrefix(candidate)) {
      const available = await isNumberAvailable(candidate, targetAreaCode);
      if (available) {
        return { phoneNumber: candidate, areaCode: targetAreaCode };
      }
    }
  }

  // Fallback timestamp suffix
  const fallback = String(Date.now()).slice(-minLen);
  return { phoneNumber: fallback, areaCode: targetAreaCode };
}
