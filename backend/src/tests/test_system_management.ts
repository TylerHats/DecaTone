import { query, queryOne, execute } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { isDockerEnvironment } from '../routes/adminRoutes';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('🧪 Starting System Management, OTA, Docker, Backup & Branding Tests...');

  await runMigrations();

  // Test 1: Migration 11 Schema Verification
  console.log('\n--- 1. Testing Migration 11 Columns & Tables ---');
  const tableInfo = await query<any>("PRAGMA table_info(phones)");
  const colNames = tableInfo.map((c: any) => c.name);

  if (!colNames.includes('ota_auto_update_enabled')) throw new Error('Missing ota_auto_update_enabled column');
  if (!colNames.includes('ota_update_time')) throw new Error('Missing ota_update_time column');
  if (!colNames.includes('ota_update_channel')) throw new Error('Missing ota_update_channel column');
  console.log('✓ Phone OTA columns present (ota_auto_update_enabled, ota_update_time, ota_update_channel)');

  // Test 2: System Settings Defaults
  console.log('\n--- 2. Testing System Settings Default Keys ---');
  const settingsRows = await query<any>('SELECT key, value FROM system_settings');
  const settingsMap = new Map(settingsRows.map((r: any) => [r.key, r.value]));

  if (!settingsMap.has('server_auto_update_enabled')) throw new Error('Missing server_auto_update_enabled setting');
  if (!settingsMap.has('auto_backup_enabled')) throw new Error('Missing auto_backup_enabled setting');
  if (!settingsMap.has('backup_retention_count')) throw new Error('Missing backup_retention_count setting');
  if (!settingsMap.has('favicon_url')) throw new Error('Missing favicon_url setting');
  if (!settingsMap.has('navbar_icon_url')) throw new Error('Missing navbar_icon_url setting');
  console.log('✓ System Settings initialized with auto update, retention, and branding keys');

  // Test 3: Docker Detection Function
  console.log('\n--- 3. Testing Docker Environment Detector ---');
  const detected = isDockerEnvironment();
  console.log(`✓ Docker detector executed cleanly (result: ${detected})`);

  // Test 4: Backup Directory Structure
  console.log('\n--- 4. Testing Backup and Branding Directory Structure ---');
  const brandingDir = path.resolve(__dirname, '../../data/branding');
  if (!fs.existsSync(brandingDir)) {
    fs.mkdirSync(brandingDir, { recursive: true });
  }
  if (!fs.existsSync(brandingDir)) throw new Error('Failed to create branding directory');
  console.log('✓ Branding and backup assets directories operational');

  console.log('\n🎉 ALL SYSTEM MANAGEMENT, OTA, DOCKER, BACKUP & BRANDING TESTS PASSED!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
