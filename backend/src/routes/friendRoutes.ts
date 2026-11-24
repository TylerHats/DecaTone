import { Router, Response } from 'express';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';

const router = Router();
router.use(authenticateToken);

// List Accepted Friends (joined with directional friend_preferences + live online status)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const rows = await query<any>(
      `SELECT u.id, u.username, u.display_name, u.phone_number, u.area_code, u.avatar_url, u.is_disabled,
              f.created_at,
              COALESCE(fp.is_vip, 0) as is_vip,
              COALESCE(fp.ring_style, 'default') as ring_style,
              fp.ring_cadence_custom,
              EXISTS(SELECT 1 FROM phones p WHERE p.user_id = u.id AND p.is_online = 1) as is_online
       FROM friends f
       JOIN users u ON (u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
       LEFT JOIN friend_preferences fp ON fp.user_id = ? AND fp.friend_id = u.id
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
       ORDER BY u.display_name ASC`,
      [currentUserId, currentUserId, currentUserId, currentUserId]
    );

    const friends = rows.map(r => ({
      ...r,
      is_vip: r.is_vip ? 1 : 0,
      isVip: !!r.is_vip,
      ring_style: r.ring_style || 'default',
      ringStyle: r.ring_style || 'default',
      ring_cadence_custom: r.ring_cadence_custom || null,
      ringCadenceCustom: r.ring_cadence_custom || null,
      is_online: !!r.is_online,
      isOnline: !!r.is_online
    }));

    return res.json({ friends });
  } catch (err: any) {
    console.error('Fetch friends error:', err);
    return res.status(500).json({ error: 'Failed to fetch friends list' });
  }
});

// Update Per-Friend Directional Preferences (VIP DND bypass, Distinctive Ring Style & Custom Cadence)
router.put('/:friendId/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const friendId = parseInt(req.params.friendId, 10);
    if (isNaN(friendId)) {
      return res.status(400).json({ error: 'Invalid friend ID' });
    }

    const friendship = await queryOne<any>(
      `SELECT id FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
      [currentUserId, friendId, friendId, currentUserId]
    );

    if (!friendship) {
      return res.status(404).json({ error: 'Friend not found' });
    }

    const existing = await queryOne<any>(
      'SELECT * FROM friend_preferences WHERE user_id = ? AND friend_id = ?',
      [currentUserId, friendId]
    );

    const { isVip, is_vip, ringStyle, ring_style, ringCadenceCustom, ring_cadence_custom } = req.body;

    const nextIsVip =
      isVip !== undefined
        ? (isVip ? 1 : 0)
        : is_vip !== undefined
        ? (is_vip ? 1 : 0)
        : (existing?.is_vip ?? 0);

    const nextRingStyle = String(ringStyle ?? ring_style ?? existing?.ring_style ?? 'default');
    const nextCadence =
      ringCadenceCustom !== undefined
        ? (ringCadenceCustom || null)
        : ring_cadence_custom !== undefined
        ? (ring_cadence_custom || null)
        : (existing?.ring_cadence_custom || null);

    await execute(
      `INSERT OR REPLACE INTO friend_preferences (user_id, friend_id, is_vip, ring_style, ring_cadence_custom)
       VALUES (?, ?, ?, ?, ?)`,
      [currentUserId, friendId, nextIsVip, nextRingStyle, nextCadence]
    );

    return res.json({
      message: 'Friend ring and VIP settings updated!',
      preferences: {
        friendId,
        isVip: !!nextIsVip,
        ringStyle: nextRingStyle,
        ringCadenceCustom: nextCadence
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update friend preferences' });
  }
});

// List Incoming and Outgoing Friend Requests
router.get('/requests', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;

    const incoming = await query<any>(
      `SELECT fr.id, fr.created_at, u.id as sender_id, u.username, u.display_name, u.phone_number, u.avatar_url
       FROM friend_requests fr
       JOIN users u ON u.id = fr.sender_id
       WHERE fr.receiver_id = ? AND fr.status = 'pending'
       ORDER BY fr.id DESC`,
      [currentUserId]
    );

    const outgoing = await query<any>(
      `SELECT fr.id, fr.created_at, u.id as receiver_id, u.username, u.display_name, u.phone_number, u.avatar_url
       FROM friend_requests fr
       JOIN users u ON u.id = fr.receiver_id
       WHERE fr.sender_id = ? AND fr.status = 'pending'
       ORDER BY fr.id DESC`,
      [currentUserId]
    );

    return res.json({ incoming, outgoing });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch friend requests' });
  }
});

// Send Friend Request
router.post('/request', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { target } = req.body;
    if (!target) {
      return res.status(400).json({ error: 'Username or phone number required' });
    }

    const cleanTarget = String(target).trim();
    const targetUser = await queryOne<any>(
      'SELECT id, username, display_name, phone_number FROM users WHERE (username = ? OR phone_number = ?) COLLATE NOCASE',
      [cleanTarget, cleanTarget]
    );

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.id === req.user!.id) {
      return res.status(400).json({ error: 'You cannot send a friend request to yourself' });
    }

    const existingFriend = await queryOne(
      `SELECT id FROM friends 
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
      [req.user!.id, targetUser.id, targetUser.id, req.user!.id]
    );

    if (existingFriend) {
      return res.status(400).json({ error: 'You are already friends with this user' });
    }

    const existingReq = await queryOne<any>(
      `SELECT id, sender_id, receiver_id, status FROM friend_requests 
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
       LIMIT 1`,
      [req.user!.id, targetUser.id, targetUser.id, req.user!.id]
    );

    if (existingReq) {
      if (existingReq.status === 'pending') {
        if (existingReq.sender_id === req.user!.id) {
          return res.status(400).json({ error: 'Friend request already sent' });
        } else {
          await execute('UPDATE friend_requests SET status = "accepted" WHERE id = ?', [existingReq.id]);
          await execute('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")', [req.user!.id, targetUser.id]);
          return res.json({ message: `Friend request accepted! You and ${targetUser.display_name || targetUser.username} are now friends.` });
        }
      }

      // Re-open declined or previously removed friendship request cleanly without UNIQUE constraint failure
      await execute(
        'UPDATE friend_requests SET sender_id = ?, receiver_id = ?, status = "pending", created_at = CURRENT_TIMESTAMP WHERE id = ?',
        [req.user!.id, targetUser.id, existingReq.id]
      );
      return res.json({ message: `Friend request sent to ${targetUser.display_name || targetUser.username}!` });
    }

    await execute(
      'INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, "pending")',
      [req.user!.id, targetUser.id]
    );

    return res.json({ message: `Friend request sent to ${targetUser.display_name || targetUser.username}!` });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// Accept or Decline Request
router.post('/respond', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId, action } = req.body;
    if (!requestId || !['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Valid requestId and action (accept/decline) required' });
    }

    const request = await queryOne<any>(
      'SELECT id, sender_id, receiver_id FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = "pending"',
      [requestId, req.user!.id]
    );

    if (!request) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    if (action === 'accept') {
      await execute('UPDATE friend_requests SET status = "accepted" WHERE id = ?', [requestId]);
      await execute(
        'INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")',
        [request.sender_id, request.receiver_id]
      );
      return res.json({ message: 'Friend request accepted!' });
    } else {
      await execute('UPDATE friend_requests SET status = "declined" WHERE id = ?', [requestId]);
      return res.json({ message: 'Friend request declined' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to respond to friend request' });
  }
});

// Remove Friend
router.delete('/:friendId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const friendId = parseInt(req.params.friendId, 10);
    const userId = req.user!.id;

    await execute(
      'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friendId, friendId, userId]
    );
    await execute(
      'DELETE FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
      [userId, friendId, friendId, userId]
    );
    await execute(
      'DELETE FROM friend_preferences WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [userId, friendId, friendId, userId]
    );
    await execute('DELETE FROM speed_dials WHERE user_id = ? AND target_user_id = ?', [userId, friendId]);

    return res.json({ message: 'Friend removed' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove friend' });
  }
});

// Search Users
router.get('/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim().length < 2) {
      return res.json({ users: [] });
    }

    const term = `%${q.trim()}%`;
    const users = await query<any>(
      `SELECT id, username, display_name, phone_number, area_code, avatar_url
       FROM users
       WHERE (username LIKE ? OR display_name LIKE ? OR phone_number LIKE ?) AND id != ? AND is_disabled = 0
       LIMIT 20`,
      [term, term, term, req.user!.id]
    );

    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
