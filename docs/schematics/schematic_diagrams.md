# DecaTone Hardware Wiring & Schematics

This document details the complete electronic connections for converting a vintage rotary telephone (Western Electric 500, Automatic Electric, GPO 706/746, or similar) into a DecaTone VoIP terminal using a **Hosyond ESP32-S3-WROOM-1** (8MB PSRAM / 16MB Flash).

---

## 1. Complete System Schematic Diagram

```
+---------------------------------------------------------------------------------------------------+
|                                     DECATONE HARDWARE SCHEMATIC                                   |
+---------------------------------------------------------------------------------------------------+

                          +-----------------------------+
                          |   Hosyond ESP32-S3 Dev Board|
                          |   (8MB PSRAM / 16MB Flash)  |
                          +-----------------------------+
                                       |
    [5V Power Supply] -----------------+ 5V (Pin 5V0)
    [GND Ground Rail] -----------------+ GND (Pin GND)
                                       |
    +----------------------------------+------------------------------------+
    |                 |                |                 |                  |
    | (GPIO 4)        | (GPIO 5)       | (GPIO 6)        | (GPIO 7)         | (GPIO 1)
    v                 v                v                 v                  v
+-----------+   +-----------+    +-----------+    +-------------+     +-------------+
| Hook Sw.  |   | Dial Pulse|    | Dial Shunt|    | Bell Driver |     | Mic Pre-Amp |
| (Handset) |   | (Normally |    | (Off-Norm |    | (IRF640N    |     | (MAX4466    |
| Connects  |   |  Closed/  |    |  Switch)  |    |  N-MOSFET)  |     |  Electret)  |
| to GND    |   |  Open)    |    |  to GND   |    |  20Hz PWM   |     |  ADC1_CH0   |
+-----------+   +-----------+    +-----------+    +-------------+     +-------------+
    |                 |                |                 |                  |
    +--------+--------+----------------+                 |                  |
             |                                           v                  |
            GND                                  [Ringer Circuit]           |
                                                 (24V-48V Boost +           |
                                                  470nF Film Cap +          |
                                                  Flyback Diode)            |
                                                         |                  |
                                                         v                  v
                                                [Mechanical Bells]   [Handset Mic]

                                       |
    +----------------------------------+
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
| **5V0 / VIN** | Power Input | External 5V Regulated | Powers ESP32-S3, MAX98357A, and MAX4466. |
| **GND** | Ground Rail | Common System Ground | Shared ground between logic and high-voltage booster. |
| **GPIO 1** | ADC1_CH0 | MAX4466 Microphone OUT | Handset microphone analog input (0–3.3V). |
| **GPIO 4** | RTC / GPIO | Hook Switch (Handset) | Grounded when handset is lifted off cradle (`INPUT_PULLUP`). |
| **GPIO 5** | RTC / GPIO | Rotary Dial Pulse Contact | Pulses to GND as the rotary dial spins back (`INPUT_PULLUP`). |
| **GPIO 6** | RTC / GPIO | Rotary Dial Off-Normal | Grounded while the dial wheel is actively rotating (`INPUT_PULLUP`). |
| **GPIO 7** | PWM Output | IRF640N Gate Driver | 20Hz–25Hz AC modulation to ring physical telephone bells. |
| **GPIO 16** | I2S BCLK | MAX98357A BCLK | Bit Clock for I2S digital audio output. |
| **GPIO 17** | I2S LRCK | MAX98357A LRCK (WS) | Left/Right Word Select Clock. |
| **GPIO 18** | I2S DOUT | MAX98357A DIN | Serial Data stream to handset earpiece amplifier. |
| **GPIO 48** | RGB Control | WS2812 RGB LED | Onboard multi-color status indicator. |
| **GPIO 0** | Boot Button | Tactile Switch | Press and hold 5 seconds to launch setup AP. |

---

## 3. Detailed Circuit Subsystems

### A. Mechanical Bell Ringer & IRF640N MOSFET Driver
Rotary telephone bells contain high-impedance dual electromagnetic coils (~1kΩ to 4kΩ) designed to resonate at 20Hz AC.

```
       +24V to +48V DC (From Boost Converter)
             |
             +--------------------+
             |                    |
             |              +-----+-----+
             |              |  ~470nF   |  (Film Capacitor across coil
             |              |  Film Cap |   for AC resonant ringing)
             |              +-----+-----+
             |                    |
        +----+----+               |
        | Ringer  |---------------+
        |  Coils  |
        +----+----+
             |
             +--------------------+
             |                    |
            ---                  ---
      1N4007 \ / Flyback          |  (Snubber / Clamping Protection)
        Diode ---                ---
             |                    |
             +--------------------+
             |
           |--+  (Drain)
GPIO 7 --->|     IRF640N N-Channel MOSFET
 (Gate)    |--+  (Source)
             |
             v
            GND
```

> [!TIP]
> Place a 10kΩ pull-down resistor from the MOSFET Gate to GND so the bell never rings spuriously while the microcontroller boots.

---

### B. MAX98357A I2S Earpiece Audio DAC
```
ESP32-S3                  MAX98357A Breakout            Handset Earpiece
+---------+               +------------------+          +---------------+
| GPIO 16 |-------------->| BCLK             |          |               |
| GPIO 17 |-------------->| LRCK             |          | 8Ω to 150Ω    |
| GPIO 18 |-------------->| DIN          SPK+|--------->| Earpiece      |
| 5V      |-------------->| VIN          SPK-|--------->| Speaker       |
| GND     |-------------->| GND              |          |               |
+---------+               | GAIN (Leave open)|          +---------------+
                          | SD_MODE (Open)   |
                          +------------------+
```

---

### C. MAX4466 Microphone Pre-Amplifier
```
ESP32-S3                  MAX4466 Breakout              Handset Mic
+---------+               +------------------+          +---------------+
| 3V3/5V  |-------------->| VCC              |          |               |
| GND     |-------------->| GND              |          | Electret /    |
| GPIO 1  |<--------------| OUT              |<---------| Dynamic Mic   |
+---------+               +------------------+          +---------------+
```

---

### D. Rotary Dial & Hook Switch Wiring
```
Hook Switch:
  Handset Cradle Wire 1 ---> ESP32-S3 GPIO 4
  Handset Cradle Wire 2 ---> GND

Rotary Dial Pulse Switch:
  Dial Pulse Wire 1      ---> ESP32-S3 GPIO 5
  Dial Pulse Wire 2      ---> GND

Rotary Dial Off-Normal (Shunt) Switch:
  Shunt Wire 1           ---> ESP32-S3 GPIO 6
  Shunt Wire 2           ---> GND
```
