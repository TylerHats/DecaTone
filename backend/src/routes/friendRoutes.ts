import { Router, Response } from 'express';
import { execute, query, queryOne } from '../db/connection';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';

const router = Router();
router.use(authenticateToken);

// List Accepted Friends
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const friends = await query<any>(
      `SELECT u.id, u.username, u.display_name, u.phone_number, u.area_code, u.avatar_url,
              p.is_online, p.hook_state, p.call_state,
              f.created_at as friendship_date
       FROM friends f
       JOIN users u ON (u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END)
       LEFT JOIN phones p ON p.user_id = u.id
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
       ORDER BY u.display_name ASC, u.username ASC`,
      [currentUserId, currentUserId, currentUserId]
    );

    return res.json({ friends });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list friends' });
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
    const { target } = req.body; // username or phone number
    if (!target) {
      return res.status(400).json({ error: 'Username or phone number required' });
    }

    const cleanTarget = target.trim();
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

    // Check if already friends
    const existingFriend = await queryOne(
      `SELECT id FROM friends 
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
      [req.user!.id, targetUser.id, targetUser.id, req.user!.id]
    );

    if (existingFriend) {
      return res.status(400).json({ error: 'You are already friends with this user' });
    }

    // Check if request already pending
    const existingReq = await queryOne(
      `SELECT id, sender_id FROM friend_requests 
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND status = 'pending'`,
      [req.user!.id, targetUser.id, targetUser.id, req.user!.id]
    );

    if (existingReq) {
      if (existingReq.sender_id === req.user!.id) {
        return res.status(400).json({ error: 'Friend request already sent' });
      } else {
        // Automatically accept reverse request
        await execute('UPDATE friend_requests SET status = "accepted" WHERE id = ?', [existingReq.id]);
        await execute('INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")', [req.user!.id, targetUser.id]);
        return res.json({ message: `Friend request accepted! You and ${targetUser.display_name || targetUser.username} are now friends.` });
      }
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
    const { requestId, action } = req.body; // action: 'accept' | 'decline'
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
      `DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [userId, friendId, friendId, userId]
    );

    // Also remove from speed dials if present
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
