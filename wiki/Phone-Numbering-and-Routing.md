# Phone Numbering, Routing and Dial Codes

This guide details DecaTone's extension allocation, rotary speed dialing, in-call keypad commands, and special shortcodes.

---

## 1. Extension Schema & Numbering

Administrators can configure the telephone number rules under **Admin Center &rarr; Settings**:

- **Extension Length**: Configurable between 3 digits (`100`–`999`), 4 digits (`1000`–`9999`), 5 digits, or 7 digits.
- **Area Code Policy**: Optional area code support (e.g. `(555) 102`).
- **Assignment Modes**:
  - **User Choice**: Users choose their own available number during registration.
  - **Sequential**: System auto-assigns numbers sequentially.
  - **Random**: System auto-assigns a random available extension.

---

## 2. Rotary Speed Dial (Slots 1–9)

Users can map single rotary digits **1 through 9** to their favorite contacts under the **Friends & Speed Dial** menu:
- Lift the handset (dial tone starts).
- Dial digit `1` (or any slot 1–9).
- If no additional digits follow within 1.2 seconds, the call is placed immediately.

---

## 3. In-Call Dialed Commands

While on an active call, rotary dialed digits perform rapid in-call actions without needing a hook-flash:

| Dialed Digit | Function | Behavior |
| :--- | :--- | :--- |
| **`0`** | **Reject Call Waiting** | Rejects a secondary incoming call waiting alert directly to voicemail. |
| **`1`** | **Accept Call Waiting / Voicemail Intercept** | Accepts a secondary call waiting alert, or intercepts a live caller who is currently leaving a voicemail message. |
| **`2`** | **Mute / Unmute Microphone** | Toggles your handset microphone on/off with an in-ear confirmation chirp. |
| **`3 + [Target Extension]`** | **Multi-Party Conference Invite** | Dials and invites a third, fourth, or fifth caller into the existing group conversation (up to 5 concurrent callers). |

> [!NOTE]
> For multi-party conference calls, only the person dialing `3 + [Extension]` needs to be friends with the invited caller.

---

## 4. Special Dial Codes & Control Shortcodes

| Dialed Code | Function | Description |
| :--- | :--- | :--- |
| **`0`** (from idle) | **Voicemail Inbox** | Connects to your personal voicemail inbox. After a 2-second timeout, plays unread messages through the earpiece. |
| **`072`** | **Enable Do Not Disturb** | Turns on DND from the physical phone. Plays confirmation tone and hangs up. |
| **`073`** | **Disable Do Not Disturb** | Turns off DND from the physical phone. Restores normal bell ringing. |
| **`411`** | **Switchboard Info Line** | Plays switchboard system status, time, and your current extension number. |
| **`999`** | **Echo / Audio Loopback Test** | Records and echoes back your voice after 2 seconds to test microphone and earpiece levels. |

---

## 5. Call Privacy & Do Not Disturb (DND)

- **Allow Anyone**: Any user on the switchboard can ring your phone.
- **Friends Only**: Only accepted friends can ring your physical bell. Unapproved callers route directly to voicemail.
- **Do Not Disturb (DND)**: All non-VIP calls route directly to voicemail without ringing the bells.
- **Emergency Repeated Call Breakthrough**: If the same friend calls twice within **3 minutes (180s)** during quiet hours, their second call breaks through DND and rings the physical bell.
- **VIP Status**: Friends marked as VIP will always bypass DND and quiet hours.
