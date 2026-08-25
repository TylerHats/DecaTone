# Phone Numbering, Speed Dial & Routing

This guide details DecaTone's flexible extension allocation, rotary speed dialing, and call routing logic.

---

## 1. Extension Allocation Rules (Admin Configurable)

Administrators can configure the telephone number schema under **Admin Center &rarr; Settings & SSL**:

1. **Extension Length**:
   - `3 Digits`: Ranges from `100` to `999` (Default).
   - `4 Digits`: Ranges from `1000` to `9999`.
   - `5 Digits`: Ranges from `10000` to `99999`.
   - `7 Digits`: Standard local telephone format (e.g. `555-0192`).
2. **Area Code Policy**:
   - **Disabled**: Direct extension-to-extension dialing (e.g. dial `102` to ring Bob).
   - **Enabled**: Full `(Area Code) + Extension` support with customizable allowed area codes (e.g. `555`, `212`, `415`, `800`).
3. **Number Assignment Mode**:
   - **User Choice**: Users can choose their own extension during registration (subject to length and uniqueness checks).
   - **Sequential**: The system automatically assigns the next available sequential number (e.g. 100, 101, 102...).
   - **Random**: The system assigns a random available extension within the allowed digit range.

---

## 2. Rotary Single-Digit Speed Dial (Slots 1–9)

Users can map digits **1 through 9** to their favorite friends or extensions under the **Friends & Speed Dial** menu:

- **How it works**:
  - Lift the handset (dial tone starts).
  - Dial digit `1` (or any configured slot 1–9).
  - The switchboard waits 1.2 seconds for any additional digits; if no further digits follow, it instantly calls the speed-dial contact!

---

## 3. Special Shortcodes

| Dialed Number | Destination | Description |
| :--- | :--- | :--- |
| **`0`** | Voicemail Inbox | Connects directly to the user's interactive voicemail inbox. Plays recent messages through the earpiece. |
| **`1` – `9`** | Speed Dial | Calls the assigned contact for that slot. |
| **`100` – `999`** | User Extension | Rings the specific user's rotary phone. |

---

## 4. Call Privacy Filters

Users can set their call reception privacy under **Hardware & Audio &rarr; Privacy**:

1. **Allow Anyone**: Any user registered on the DecaTone switch can ring the user's bell.
2. **Friends Only**: Only accepted friends can ring the bell. Unapproved callers are redirected immediately to voicemail.
3. **Do Not Disturb (DND)**: All incoming calls bypass ringing and route directly to voicemail.
