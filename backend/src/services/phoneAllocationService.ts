import crypto from 'crypto';
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
  '0', '00', '000', '099', '111', '119', '300', '411', '567', '611', '711',
  '911', '999', '112', '9911', '069', '072', '073', '078', '079',
  '1', '2', '3', '4', '5', '6', '7', '8', '9'
];

export const RESERVED_PREFIXES = ['0'];

export function isReservedNumberOrPrefix(numberStr: string): boolean {
  if (!numberStr) return true;
  const clean = numberStr.trim();
  if (!/^\d+$/.test(clean)) return true;
  if (RESERVED_NUMBERS.includes(clean)) return true;
  for (const pfx of RESERVED_PREFIXES) {
    if (clean.startsWith(pfx)) return true;
  }
  if (
    clean.startsWith('111') ||
    clean.startsWith('112') ||
    clean.startsWith('119') ||
    clean.startsWith('300') ||
    clean.startsWith('411') ||
    clean.startsWith('567') ||
    clean.startsWith('711') ||
    clean.startsWith('911') ||
    clean.startsWith('999')
  ) {
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
  const minLen = Math.max(2, parseInt(map['phone_number_min_length'] || String(baseLen), 10) || 4);
  const maxLen = Math.max(minLen, parseInt(map['phone_number_max_length'] || String(minLen), 10) || minLen);
  const assignmentMode =
    (map['number_assignment_mode'] as any) ||
    (map['allow_user_number_choice'] === 'false' ? 'sequential' : 'user_choice');
  const allowUserChoice = assignmentMode === 'user_choice';

  const areaCodeEnabled = map['area_code_enabled'] === 'true';
  const rawAreaCodes = map['area_codes_list'] || '555,212,312,415,800';
  const allowedAreaCodes = rawAreaCodes.split(',').map((s) => s.trim()).filter(Boolean);
  const defaultAreaCode = map['default_area_code'] || (allowedAreaCodes.length > 0 ? allowedAreaCodes[0] : undefined);

  return {
    numberLength: minLen,
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
  const clean = numberStr.trim();
  if (!/^\d+$/.test(clean)) {
    return { valid: false, error: 'Phone number must contain only numeric digits (0-9)' };
  }
  if (clean.length < config.minNumberLength || clean.length > config.maxNumberLength) {
    if (config.minNumberLength === config.maxNumberLength) {
      return { valid: false, error: `Phone number must be exactly ${config.minNumberLength} digits` };
    }
    return { valid: false, error: `Phone number must be between ${config.minNumberLength} and ${config.maxNumberLength} digits` };
  }
  if (clean.startsWith('0')) {
    return { valid: false, error: 'Phone numbers cannot start with 0 (reserved for operator & feature codes)' };
  }
  if (isReservedNumberOrPrefix(clean)) {
    return { valid: false, error: `Number ${clean} or its prefix is reserved for telephony or emergency services` };
  }
  return { valid: true };
}

export async function isNumberAvailable(phoneNumber: string, areaCode?: string | null): Promise<boolean> {
  if (isReservedNumberOrPrefix(phoneNumber)) {
    return false;
  }

  let row;
  if (areaCode !== undefined && areaCode !== null && String(areaCode).trim() !== '') {
    row = await queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM users WHERE phone_number = ? AND COALESCE(area_code, '') = ?",
      [phoneNumber, String(areaCode).trim()]
    );
  } else {
    row = await queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM users WHERE phone_number = ? AND (area_code IS NULL OR area_code = '')",
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
    ? (preferredAreaCode || config.defaultAreaCode || '').trim() || undefined
    : undefined;

  const minLen = Math.max(2, config.minNumberLength || 4);
  const maxLen = Math.max(minLen, config.maxNumberLength || minLen);
  const isFixedLength = minLen === maxLen;

  // Fetch all occupied numbers in this scope in one query (avoids O(10^n) SQL round-trips)
  const existingRows = targetAreaCode
    ? await query<{ phone_number: string }>(
        "SELECT phone_number FROM users WHERE COALESCE(area_code, '') = ?",
        [targetAreaCode]
      )
    : await query<{ phone_number: string }>(
        "SELECT phone_number FROM users WHERE area_code IS NULL OR area_code = ''"
      );
  const occupied = new Set(existingRows.map((r) => String(r.phone_number || '').trim()));

  // Mode 1: Fixed Random (when min === max)
  if (config.assignmentMode === 'fixed_random' && isFixedLength) {
    const minVal = Math.pow(10, minLen - 1);
    const maxVal = Math.pow(10, minLen) - 1;

    for (let attempts = 0; attempts < 500; attempts++) {
      const candidate = String(crypto.randomInt(minVal, maxVal + 1));
      if (!isReservedNumberOrPrefix(candidate) && !occupied.has(candidate)) {
        return { phoneNumber: candidate, areaCode: targetAreaCode };
      }
    }
  }

  // Mode 2: Sequential Allocation (starting from 10...0 at minLength)
  const minStart = Math.pow(10, minLen - 1);
  const maxEnd = Math.pow(10, maxLen) - 1;

  for (let candidateNum = minStart; candidateNum <= maxEnd; candidateNum++) {
    const candidate = String(candidateNum);
    if (!isReservedNumberOrPrefix(candidate) && !occupied.has(candidate)) {
      return { phoneNumber: candidate, areaCode: targetAreaCode };
    }
  }

  const fallback = '2' + String(Date.now()).slice(-(minLen - 1));
  return { phoneNumber: fallback, areaCode: targetAreaCode };
}
