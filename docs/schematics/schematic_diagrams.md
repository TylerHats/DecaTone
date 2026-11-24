# DecaTone Hardware Wiring & Schematics

This document details the complete electronic connections for converting a vintage rotary telephone (Western Electric 500/2500/302, Automatic Electric, British GPO 706/746, Kellogg, or similar) into an End-to-End Encrypted DecaTone VoIP terminal using a **Hosyond ESP32-S3-WROOM-1** (8MB Octal PSRAM / 16MB Flash).

> [!CAUTION]
> **Emergency Services (E911 / 999 / 112) Notice:** A vintage rotary telephone modified with DecaTone operates exclusively over your private local/self-hosted IP switchboard. It is **NOT** connected to the Public Switched Telephone Network (PSTN) and **CANNOT** place emergency calls (911, 999, 112), especially during power or internet outages. Always keep a cellular or PSTN telephone accessible for emergencies.

---

## 1. Complete System Schematic Diagram

```
+------------------------------------------------------------------------------------------------------+
|                                      DECATONE HARDWARE SCHEMATIC                                     |
+------------------------------------------------------------------------------------------------------+

                           +----------------------------------+
                           |   Hosyond ESP32-S3 Dev Board     |
                           |   (8MB Octal PSRAM / 16MB Flash) |
                           +----------------------------------+
                                            |
     [5V Power Supply] ---------------------+ 5V (Pin 5V0)
     [GND Ground Rail] ---------------------+ GND (Pin GND)
                                            |
     +------------------+-------------------+------------------+----------------------+
     |                  |                   |                  |                      |
     | (GPIO 4)         | (GPIO 5)          | (GPIO 6)         | (GPIO 7 & GPIO 15)   | (GPIO 1)
     v                  v                   v                  v                      v
+-----------+    +-------------+     +-------------+    +----------------+     +-------------+
| Hook Sw.  |    | Dial Pulse  |     | Dial Shunt  |    | DRV8871 / Dual |     | Mic Pre-Amp |
| (Handset) |    | (Normally   |     | (Off-Normal |    | Logic MOSFET   |     | (MAX4466    |
| Connects  |    |  Closed /   |     |  Switch)    |    | Full H-Bridge  |     |  Electret)  |
| to GND    |    |  Open)      |     |  to GND     |    | IN1=7, IN2=15  |     |  ADC1_CH0   |
+-----------+    +-------------+     +-------------+    +----------------+     +-------------+
     |                  |                   |                  |                      |
     +--------+---------+-------------------+                  v                      |
              |                                       [AC Ringer Output]              |
             GND                                      (28V-45V Boost VM +             |
                                                       0.47uF-1.0uF 250V              |
                                                       Film Series Cap)               |
                                                               |                      |
                                                               v                      v
                                                     [Polarized Twin-Gong]     [Handset Mic]
                                                     [Mechanical Bells]

                                            |
     +--------------------------------------+
     |
     | (GPIO 16) -> BCLK (Bit Clock)
     | (GPIO 17) -> LRCK / WS (Word Select)
     | (GPIO 18) -> DOUT (Data Out)
     v
+-------------------------------+
| MAX98357A I2S Mono Amplifier  |
+-------------------------------+
     |
     v
[Handset Speaker Earpiece]
```

---

## 2. Pin Mapping Table (Hosyond ESP32-S3)

| ESP32-S3 Pin | Function | Hardware Peripheral | Description |
| :--- | :--- | :--- | :--- |
| **5V0 / VIN** | Power Input | External 5V Regulated (≥1.5A) | Powers ESP32-S3, MAX98357A, MAX4466, and HV Boost input. |
| **GND** | Ground Rail | Common System Ground | Shared ground between 3.3V logic and 28V–45V ringer boost converter. |
| **GPIO 1** | ADC1_CH0 | MAX4466 Microphone OUT | Handset microphone analog input (0–3.3V DC-biased @ 1.65V). |
| **GPIO 4** | RTC / GPIO | Hook Switch (Handset) | Grounded when handset is lifted off cradle (`INPUT_PULLUP`, 30ms debounce). |
| **GPIO 5** | RTC / GPIO | Rotary Dial Pulse Contact | Pulses to GND as rotary dial returns (`INPUT_PULLUP`). |
| **GPIO 6** | RTC / GPIO | Rotary Dial Off-Normal | Grounded while the dial wheel is displaced (`INPUT_PULLUP`). |
| **GPIO 7** | Digital Out | **DRV8871 H-Bridge `IN1`** | Complementary AC ringer phase A (16.6Hz–50Hz, `LOW` when idle). |
| **GPIO 15** | Digital Out | **DRV8871 H-Bridge `IN2`** | Complementary AC ringer phase B (180° inverted from `IN1`, `LOW` when idle). |
| **GPIO 16** | I2S BCLK | MAX98357A BCLK | 16kHz Bit Clock for I2S digital audio output. |
| **GPIO 17** | I2S LRCK | MAX98357A LRCK (WS) | Left/Right Word Select Clock. |
| **GPIO 18** | I2S DOUT | MAX98357A DIN | Serial Data stream to handset earpiece amplifier. |
| **GPIO 48** | RGB Control | WS2812 RGB LED | Onboard multi-color status indicator. |
| **GPIO 0** | Boot Button | Tactile Switch (`INPUT_PULLUP`) | Hold continuously for **5 seconds** for Factory Reset & WPA2 Setup AP. |

---

## 3. Detailed Circuit Subsystems

### A. Mechanical Bell Ringer — 3.3V Logic-Level DRV8871 / Dual MOSFET H-Bridge AC Driver

> [!IMPORTANT]
> **Why an H-Bridge Is Required (Do NOT Use a Single IRF640N):**
> 1. Polarized twin-gong telephone ringers (Western Electric C4A, British GPO 706/746, Kellogg harmonic ringers) use a **permanent-magnet biased armature** that swings left on positive coil current and right on negative coil current. A single-ended transistor only pulls current in one direction and cannot strike both gongs.
> 2. Standard high-voltage power MOSFETs like the `IRF640N` require $V_{GS} = 10\text{V}$ for full enhancement and barely conduct when driven directly from a 3.3V ESP32-S3 GPIO.
>
> Driving a **DRV8871** (6.5V–45V, 3.6A H-Bridge with native 3.3V CMOS inputs, internal shoot-through dead-time, and integrated freewheeling diodes) with complementary signals on **GPIO 7 (`IN1`)** and **GPIO 15 (`IN2`)** produces a clean **56V–88V peak-to-peak bipolar AC waveform** from a compact 28V–44V DC boost module!

```
                      +28V to +42V DC (From MT3608 / XL6009 / HV Boost Module)
                                   |
                                   v
                        +---------------------+
                        |       VM / V+       |
ESP32-S3 GPIO 7  ------>| IN1            OUT1 |-------+----[ 0.47uF - 1.0uF 250V ]----+
   (10k to GND)         |                     |       |    (Polypropylene Film Cap)   |
                        |   DRV8871 H-Bridge  |       |                               v
ESP32-S3 GPIO 15 ------>| IN2   Driver IC     |       |                       +---------------+
   (10k to GND)         |                     |       |                       | Polarized     |
                        | ILIM           OUT2 |-------------------------------| Dual-Gong     |
                        |  |             GND  |                               | Ringer Coils  |
                        +--+--------------+---+                               | (1kΩ - 4kΩ)   |
                           |              |                                   +---------------+
                        [68kΩ]            |
                           |              |
                           +--------------+---> Common GND
```

#### Operating States & Safety Notes:
- **Standby / Idle (`GPIO 7 = LOW`, `GPIO 15 = LOW`)**: Both `OUT1` and `OUT2` enter High-Impedance (`Hi-Z`) coast mode, drawing **0 mA** coil current with zero heat dissipation.
- **Active Ringing (`16.6 Hz – 50 Hz`)**: Firmware alternates `(IN1=HIGH, IN2=LOW)` and `(IN1=LOW, IN2=HIGH)` with break-before-make pin ordering, reversing current through the ringer coils every half-cycle (`25 ms` at `20 Hz`).
- **Series Film Capacitor (`0.47µF – 1.0µF`, ≥250V Polypropylene)**: Preserves authentic central-office AC impedance matching and guarantees zero steady-state DC coil current even if the MCU halts during debug. (Reuse the vintage Western Electric `0.47µF` capacitor on the telephone network block or fit a fresh MKP film capacitor.)
- **Alternative Discrete Dual MOSFET H-Bridge**: Builders constructing a discrete bridge should use **3.3V logic-level** complementary half-bridges (e.g., two `AO4606` / `IRLZ44N` logic-level $V_{GS(th)} < 2.0\text{V}$ N-MOSFETs + high-side P-MOSFETs with NPN level shifters, or an `L298N` / `TB6612` / `DRV8833` rated for the chosen supply voltage) with `10kΩ` pull-downs on both `GPIO 7` and `GPIO 15`.

---

### B. MAX98357A I2S Earpiece Audio DAC
```
ESP32-S3                  MAX98357A Breakout            Handset Earpiece
+---------+               +------------------+          +---------------+
| GPIO 16 |-------------->| BCLK             |          |               |
| GPIO 17 |-------------->| LRCK             |          | 8Ω to 150Ω    |
| GPIO 18 |-------------->| DIN          SPK+|--------->| Earpiece      |
| 5V      |-------------->| VIN          SPK-|--------->| Receiver      |
| GND     |-------------->| GND              |          |               |
+---------+               | GAIN (Leave open)|          +---------------+
                          | SD_MODE (Open)   |
                          +------------------+
```

> [!TIP]
> Original Western Electric U1 / HA1 receiver capsules have ~130Ω AC impedance and sound crisp and warm directly across `SPK+` and `SPK-` without needing an impedance-matching transformer.

---

### C. MAX4466 Microphone Pre-Amplifier
```
ESP32-S3                  MAX4466 Breakout              Handset Transmitter
+---------+               +------------------+          +-------------------+
| 3V3     |-------------->| VCC (Use 3.3V!)  |          |                   |
| GND     |-------------->| GND              |          | Electret Capsule  |
| GPIO 1  |<--------------| OUT              |<---------| (Replaces T1      |
+---------+               +------------------+          |  Carbon Button)   |
                                                        +-------------------+
```

> [!NOTE]
> Power the **MAX4466 `VCC` from `3V3`** (not `5V`) so its quiescent `VCC / 2` DC bias sits cleanly at `1.65V` (mid-scale `2048` on the ESP32-S3 12-bit ADC1_CH0 input) and never exceeds the ESP32-S3 `3.3V` GPIO rating.

---

### D. Rotary Dial & Hook Switch Wiring
```
Hook Switch (30ms Software Stable-State Debounced):
  Handset Cradle Contact 1 ---> ESP32-S3 GPIO 4
  Handset Cradle Contact 2 ---> GND

Rotary Dial Pulse Switch (Normally Closed, Opens on Return Pulses):
  Dial Pulse Wire 1        ---> ESP32-S3 GPIO 5
  Dial Pulse Wire 2        ---> GND

Rotary Dial Off-Normal (Shunt) Switch (Closes While Finger Wheel Is Displaced):
  Dial Shunt Wire 1        ---> ESP32-S3 GPIO 6
  Dial Shunt Wire 2        ---> GND
```
