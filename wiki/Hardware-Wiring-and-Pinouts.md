# Hardware Wiring and Pinouts

This guide covers the teardown and electrical conversion of vintage rotary phones to work with DecaTone.

---

## 1. Bill of Materials (BOM)

| Component | Description | Recommended Source / Part |
| :--- | :--- | :--- |
| **Microcontroller** | ESP32-S3 Dual Type-C Board with 8MB PSRAM / 16MB Flash | Hosyond ESP32-S3-WROOM-1 |
| **Audio DAC / Amp** | I2S Mono 3W Class-D Amplifier | MAX98357A Breakout |
| **Microphone Amp** | Electret Mic Pre-Amplifier Board | MAX4466 Adjustable Gain Board |
| **Bell MOSFET** | N-Channel Power MOSFET (200V / 18A) | IRF640N (TO-220) |
| **Voltage Booster** | Step-Up DC-DC Boost Converter (5V to 24V–48V) | XL6009 or MT3608 Module |
| **Bell Capacitor** | Metallized Polyester Film Capacitor | ~470nF (0.47µF) 100V–250V |
| **Protection Diode**| Fast / General Rectifier Diode | 1N4007 or UF4007 |
| **Pull-down Resistor** | Gate Discharge Resistor | 10kΩ 1/4W Resistor |
| **Power Supply** | 5V 2.5A–3A Power Adapter | USB-C 5V Supply or Internal 5V Buck |

---

## 2. GPIO Pinout Table

```
================================================================================
ESP32-S3 Pin   Direction   Peripheral Connection
================================================================================
GPIO 1         INPUT       MAX4466 Analog Mic Output (ADC1_CH0)
GPIO 4         INPUT       Handset Hook Switch (Active LOW to GND, Pull-up)
GPIO 5         INPUT       Rotary Dial Pulse Switch (Active LOW to GND, Pull-up)
GPIO 6         INPUT       Rotary Dial Off-Normal Switch (Active LOW to GND, Pull-up)
GPIO 7         OUTPUT      IRF640N MOSFET Gate (20Hz PWM for Bell Ringer)
GPIO 16        OUTPUT      MAX98357A I2S BCLK (Bit Clock)
GPIO 17        OUTPUT      MAX98357A I2S LRCK (Word Select)
GPIO 18        OUTPUT      MAX98357A I2S DOUT (Serial Data)
GPIO 48        OUTPUT      Built-in WS2812 RGB Status LED
GPIO 0         INPUT       Boot Button (Hold 5s to launch AP Setup)
5V0 / VIN      POWER       Regulated 5V DC In
GND            GROUND      Common Ground Rail
================================================================================
```

---

## 3. Step-by-Step Conversion Guide

### Step 1: Disassembling the Vintage Phone
1. Unscrew the bottom chassis screws to remove the plastic/bakelite housing.
2. Identify the internal wires:
   - **Handset Cable (4 wires)**: 2 wires for the earpiece speaker, 2 wires for the carbon/electret microphone.
   - **Hook Switch (2 or 3 leaf contacts)**: Identify the contact pair that closes/opens when the cradle is pressed.
   - **Rotary Dial (4 wires)**: 2 wires for the pulse contact (pulsing 10 times per second), 2 wires for the shunt/off-normal contact.
   - **Bell Solenoids (2 coil wires)**: Connected to the physical bells and clapper.

### Step 2: Wiring the Handset
- Remove the old carbon microphone cartridge and insert the **MAX4466** microphone module into the handset mouthpiece cavity (or wire the handset lines to the MAX4466 OUT and VCC/GND inside the chassis).
- Connect the handset earpiece wires across **SPK+** and **SPK-** on the **MAX98357A** amplifier.

### Step 3: Wiring the Rotary Dial & Hook Switch
- Wire one side of the Hook Switch to **GPIO 4**, other side to **GND**.
- Wire one side of the Dial Pulse Switch to **GPIO 5**, other side to **GND**.
- Wire one side of the Dial Off-Normal Switch to **GPIO 6**, other side to **GND**.

### Step 4: Building the Bell Ringer Circuit
1. Adjust your DC-DC boost converter output to **24V–36V DC** using a multimeter.
2. Wire the positive boosted rail to one side of the bell ringer coil.
3. Wire the **~470nF film capacitor** in parallel directly across the bell ringer coil terminals.
4. Wire a **1N4007 flyback diode** (cathode to +24V, anode to MOSFET Drain) to protect against inductive flyback spikes.
5. Connect the other side of the coil to the **Drain** pin of the **IRF640N** MOSFET.
6. Connect the **Source** pin of the MOSFET to **GND**.
7. Connect **GPIO 7** from the ESP32-S3 to the **Gate** pin through a 100Ω series resistor, with a **10kΩ pull-down resistor** from Gate to GND.
