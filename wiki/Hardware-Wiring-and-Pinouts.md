# Hardware Wiring and Pinouts

This page documents the complete hardware architecture, pinout assignments, and electrical interface circuits for reviving vintage rotary telephones with the **Hosyond ESP32-S3-WROOM-1** development board.

---

## 1. Complete Pinout Table

| GPIO Pin | Function | Peripheral / Connection | Electrical Characteristics |
| :--- | :--- | :--- | :--- |
| **GPIO 1** | ADC1_CH0 | **MAX4466** Electret Microphone Analog Out | 0.0V – 3.3V Analog (Internal DC baseline tracking) |
| **GPIO 4** | Input Pullup | **Handset Hook Switch** | Grounded (LOW) when handset is lifted; Open (HIGH) on cradle |
| **GPIO 5** | Input Pullup | **Rotary Dial Pulse Switch** | Normally Closed (LOW); Pulses HIGH/LOW as dial spins back |
| **GPIO 6** | Input Pullup | **Rotary Dial Off-Normal Shunt** | Grounded (LOW) continuously while dial is off its rest position |
| **GPIO 7** | Output PWM | **IRF640N MOSFET Gate** | 3.3V Logic PWM driving 15Hz–30Hz AC Bell Ringing |
| **GPIO 16** | Output | **MAX98357A I2S BCLK** | I2S Bit Clock (16kHz $\times$ 16-bit $\times$ 2 = 512kHz) |
| **GPIO 17** | Output | **MAX98357A I2S LRCK** | I2S Word Select / Frame Clock (16kHz) |
| **GPIO 18** | Output | **MAX98357A I2S DOUT** | I2S Serial Audio Data Stream Out |
| **GPIO 48** | Output | **WS2812 RGB LED** | Built-in status indication LED |
| **GPIO 0** | Input | **Boot / Setup Button** | Hold 5s on boot to trigger Captive Setup AP |

---

## 2. Handset Audio Connections

### A. Earpiece Speaker Output (MAX98357A I2S DAC / Class-D Amp)
- **VIN**: Connect to 5V (VBUS / External 5V).
- **GND**: Connect to common GND.
- **BCLK (Bit Clock)**: Connect to **GPIO 16**.
- **LRC / WS (Word Select)**: Connect to **GPIO 17**.
- **DIN (Data In)**: Connect to **GPIO 18**.
- **GAIN**: Tie to GND (default 9dB gain) or leave floating (12dB gain).
- **Speaker Out (+ / -)**: Connect to handset earpiece dynamic capsule.

### B. Microphone Input (MAX4466 Electret Pre-Amplifier)
- **VCC**: Connect to 3.3V.
- **GND**: Connect to common GND.
- **OUT**: Connect to **GPIO 1 (ADC1_CH0)**.
- **Gain Trimmer**: Set the potentiometer on the back of the MAX4466 board to roughly 50%–70% for standard conversational speech.

---

## 3. Physical Mechanical Bell Ringer Circuit

Vintage telephones require high-voltage AC resonance (~40V–90V AC at 20Hz) to swing the internal clapper between the twin brass gongs. We drive this safely using an **IRF640N N-Channel Power MOSFET** paired with an inductive flyback snubber:

```
                  +24V to +48V DC Power Supply (Ringer Rail)
                                    │
                                    ├───[ 470nF 250V AC Cap ]───┐
                                    │                           │
                               ┌────┴───────────────────────────┴────┐
                               │     Telephone Ringer Coils          │
                               │   (Red & Black / Slate leads)       │
                               └────┬────────────────────────────────┘
                                    │
                                    ├───────|<────────┐ (1N4007 Diode)
                                    │                 │
                           Drain ┌──┴──┐              │
     GPIO 7 (PWM 20Hz) ──[100Ω]──┤     │ IRF640N      │
                                 └──┬──┘ MOSFET       │
                           Source   │                 │
                                    ├─────────────────┴─ Common GND
                                   ===
```

- **MOSFET Gate Resistor**: 100$\Omega$ between GPIO 7 and Gate to suppress parasitic high-frequency ringing.
- **Gate Pull-Down**: 10k$\Omega$ between Gate and GND to keep the MOSFET off during microcontroller boot.
- **Series Capacitor**: 470nF / 250V non-polarized film capacitor in series with the bell coils to block DC current and generate pure resonant AC swings.

---

## 4. Rotary Dial Switch Contacts

Vintage dials (such as the Western Electric No. 7 / No. 9 or AE type 24) have two contact sets:
1. **Pulse Switch (GPIO 5)**: Opens and closes 1 to 10 times as the rotary wheel springs back to rest. Connected to GPIO 5 with internal pullup (`INPUT_PULLUP`).
2. **Off-Normal / Shunt Switch (GPIO 6)**: Closes as soon as the finger wheel is pulled from its rest stop, and re-opens only after the dial returns home. Connected to GPIO 6 with internal pullup (`INPUT_PULLUP`).
