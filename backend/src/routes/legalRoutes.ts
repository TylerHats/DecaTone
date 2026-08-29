import { Router, Request, Response } from 'express';
import { queryOne } from '../db/connection';

const router = Router();

// Public endpoint: Get legal configuration and documents
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const termsRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['terms_of_service']);
    const privacyRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['privacy_policy']);
    const requireTermsRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['require_terms_on_signup']);

    return res.json({
      requireTermsOnSignup: requireTermsRow?.value !== 'false',
      terms: termsRow?.value || '',
      privacy: privacyRow?.value || ''
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch legal configuration' });
  }
});

// Public endpoint: Get Terms of Service
router.get('/terms', async (_req: Request, res: Response) => {
  try {
    const row = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['terms_of_service']);
    return res.json({ terms: row?.value || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch terms of service' });
  }
});

// Public endpoint: Get Privacy Policy
router.get('/privacy', async (_req: Request, res: Response) => {
  try {
    const row = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['privacy_policy']);
    return res.json({ privacy: row?.value || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch privacy policy' });
  }
});

export default router;
