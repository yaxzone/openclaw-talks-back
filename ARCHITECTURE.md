# openclaw-talks-back - Architecture Documentation

**Date:** February 2026  
**Author:** Enki 🔱  
**Status:** Working ✅

## Overview

A real-time voice conversation system that allows an AI (Enki) to participate in Jitsi video calls with full duplex audio — the AI can hear speech, transcribe it, and respond with synthesized voice.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ENKI VOICE BOT SYSTEM                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     WebRTC      ┌──────────────────────────────────────────┐
│              │◄───────────────►│            JITSI MEET (Docker)            │
│    LUIS      │   Audio/Video   │                                          │
│  (Browser)   │                 │  ┌────────┐ ┌────────┐ ┌────────┐        │
│              │                 │  │Prosody │ │  JVB   │ │ Jicofo │        │
└──────────────┘                 │  │ XMPP   │ │ Bridge │ │ Focus  │        │
       │                         │  └────────┘ └────────┘ └────────┘        │
       │                         │       │         │           │            │
       │                         │       └─────────┴───────────┘            │
       │                         │              ▲                           │
       │                         └──────────────┼───────────────────────────┘
       │                                        │ WebRTC
       │                                        ▼
       │                         ┌──────────────────────────────────────────┐
       │                         │         PUPPETEER BOT (Headless)          │
       │                         │                                          │
       │                         │  ┌─────────────────────────────────────┐ │
       │                         │  │         Chrome (Headless)           │ │
       │                         │  │                                     │ │
       │                         │  │  ┌─────────────┐  ┌──────────────┐  │ │
       │                         │  │  │MediaRecorder│  │ Audio Output │  │ │
       │                         │  │  │(Capture)    │  │ (TTS Play)   │  │ │
       │                         │  │  └──────┬──────┘  └──────▲───────┘  │ │
       │                         │  │         │                │          │ │
       │                         │  └─────────┼────────────────┼──────────┘ │
       │                         │            │                │            │
       │                         │            ▼                │            │
       │                         │  ┌─────────────────┐        │            │
       │                         │  │   voice-bot.js  │────────┘            │
       │                         │  │   (Node.js)     │                     │
       │                         │  └────────┬────────┘                     │
       │                         │           │                              │
       │                         └───────────┼──────────────────────────────┘
       │                                     │
       │         ┌───────────────────────────┼───────────────────────────┐
       │         │                           │                           │
       │         ▼                           ▼                           ▼
       │   ┌───────────┐            ┌─────────────────┐          ┌────────────┐
       │   │  FFmpeg   │            │ Whisper Server  │          │  edge-tts  │
       │   │           │            │ (faster-whisper)│          │  (MS TTS)  │
       │   │ WebM→WAV  │            │                 │          │            │
       │   └─────┬─────┘            │  tiny.en model  │          │  MP3→WAV   │
       │         │                  │  ~0.6s latency  │          │            │
       │         └──────────────────►                 │          └─────┬──────┘
       │                            └─────────────────┘                │
       │                                                               │
       │                                                               ▼
       │                                                    ┌─────────────────┐
       │                                                    │   PulseAudio    │
       │                                                    │                 │
       │                                                    │ ┌─────────────┐ │
       │◄───────────────────────────────────────────────────┤ │ VirtualMic  │ │
       │            TTS audio routed back via WebRTC        │ │   (sink)    │ │
       │                                                    │ └─────────────┘ │
       │                                                    └─────────────────┘
       │
       ▼
   You hear
   Enki speak!
```

## Components

### 1. Jitsi Meet (Docker Stack)

Self-hosted video conferencing platform running on the local machine.

**Location:** `~/projects/jitsi/`

**Containers:**
| Container | Purpose | Port |
|-----------|---------|------|
| jitsi-web | Nginx + React frontend | 8443 (HTTPS) |
| jitsi-prosody | XMPP server for signaling | 5222, 5280 |
| jitsi-jicofo | Conference focus manager | - |
| jitsi-jvb | Jitsi Video Bridge (WebRTC SFU) | 10000/UDP |

**Key Configuration** (`~/projects/jitsi/.env`):
```bash
# Critical fix for WSL2 - bot connects via localhost but JVB needs to advertise it
JVB_ADVERTISE_IPS=127.0.0.1,<YOUR_TAILSCALE_IP>

# Allow guests (no login required)
ENABLE_GUESTS=1

# Disable lobby and authentication for easy access
ENABLE_LOBBY=0
```

**Start/Stop:**
```bash
cd ~/projects/jitsi
docker compose up -d   # Start
docker compose down    # Stop
```

### 2. Voice Bot (Puppeteer + Node.js)

Headless Chrome browser that joins Jitsi as a participant named "Enki".

**Location:** `~/projects/jitsi-bot/voice-bot.js`

**Key Features:**
- Joins room automatically (no pre-join screen)
- Captures audio from all participants via MediaRecorder API
- Sends audio chunks (4 sec) to Whisper for transcription
- Generates TTS responses and injects into call
- Sends chat messages as backup

**Chrome Launch Args:**
```javascript
{
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',  // Auto-allow mic/camera
    '--ignore-certificate-errors',      // Self-signed certs
    '--autoplay-policy=no-user-gesture-required'
  ],
  env: {
    PULSE_SOURCE: 'VirtualMic.monitor'  // Audio input source
  }
}
```

### 3. Whisper Transcription Server

Persistent Python process that keeps the Whisper model loaded for fast inference.

**Location:** `~/projects/jitsi-bot/transcribe-server.py`

**Model:** `tiny.en` (39MB, English-only, CPU-optimized)  
**Compute Type:** `int8` (quantized for speed)  
**Latency:** ~0.6 seconds per 4-second chunk

**How it works:**
1. Receives WAV file paths via stdin
2. Transcribes with faster-whisper
3. Outputs text to stdout
4. Bot reads stdout and processes

```python
# Key settings
model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
# Transcription with VAD filtering
segments, _ = model.transcribe(wav_path, beam_size=1, vad_filter=True)
```

### 4. Text-to-Speech (edge-tts)

Microsoft Edge's neural TTS voices via the `edge-tts` Python package.

**Voice:** Default (en-US, natural sounding)  
**Output:** MP3 → converted to WAV for PulseAudio

```bash
# Generate TTS
edge-tts --text "Hello there" --write-media /tmp/tts.mp3

# Convert and play to virtual sink
ffmpeg -i /tmp/tts.mp3 /tmp/tts.wav
paplay --device=VirtualMic /tmp/tts.wav
```

### 5. PulseAudio Virtual Sinks

Virtual audio devices that route TTS audio back into Chrome's WebRTC stream.

**Sinks:**
| Sink | Purpose |
|------|---------|
| VirtualMic | TTS output → Chrome input |
| VirtualSpeaker | (unused, available for future) |
| TTS_Output | (unused, available for future) |

**Setup:**
```bash
# Create virtual sink
pactl load-module module-null-sink sink_name=VirtualMic sink_properties=device.description=VirtualMic

# Play audio to the sink
paplay --device=VirtualMic /tmp/tts.wav

# Chrome captures from VirtualMic.monitor
```

## Data Flow

### Speech-to-Text (User → Enki)

```
1. User speaks into microphone
         │
         ▼
2. Browser captures audio → WebRTC
         │
         ▼
3. JVB routes audio to bot's Chrome
         │
         ▼
4. MediaRecorder captures audio tracks
         │ (every 4 seconds)
         ▼
5. Base64 encode → Node.js
         │
         ▼
6. FFmpeg: WebM → WAV (16kHz mono)
         │
         ▼
7. Whisper transcribes (~0.6s)
         │
         ▼
8. Text returned to voice-bot.js
         │
         ▼
9. Bot processes & generates response
```

### Text-to-Speech (Enki → User)

```
1. Bot generates response text
         │
         ▼
2. edge-tts creates MP3
         │
         ▼
3. FFmpeg converts MP3 → WAV
         │
         ▼
4. paplay sends to VirtualMic sink
         │
         ▼
5. Chrome captures from VirtualMic.monitor
         │
         ▼
6. WebRTC sends audio to JVB
         │
         ▼
7. JVB routes to user's browser
         │
         ▼
8. User hears Enki speak!
```

## File Structure

```
~/projects/jitsi-bot/
├── voice-bot.js           # Main bot script
├── transcribe-server.py   # Whisper server
├── package.json           # Node dependencies
├── venv/                  # Python virtual environment
│   └── bin/python         # faster-whisper installed here
└── ARCHITECTURE.md        # This file

~/projects/jitsi/
├── docker-compose.yml     # Jitsi stack definition
├── .env                   # Configuration (JVB_ADVERTISE_IPS!)
└── .jitsi-meet-cfg/       # Persistent config
    ├── web/
    ├── prosody/
    ├── jicofo/
    └── jvb/
```

## Key Challenges Solved

### 1. ICE Connection Failures (JVB Networking)

**Problem:** Bot connected via `localhost:8443` but JVB only advertised the Tailscale IP. ICE candidates never matched.

**Solution:** Added `127.0.0.1` to `JVB_ADVERTISE_IPS`:
```bash
JVB_ADVERTISE_IPS=127.0.0.1,<YOUR_TAILSCALE_IP>
```

### 2. Slow Whisper Inference

**Problem:** Loading model per-chunk took 2-3 seconds.

**Solution:** Created persistent `transcribe-server.py` that keeps model in memory. Reads paths from stdin, outputs text to stdout.

### 3. TTS Audio Routing

**Problem:** Chrome's `--use-fake-device-for-media-stream` sends test patterns, not real audio.

**Solution:** Use PulseAudio virtual sinks. Play TTS to `VirtualMic` sink, Chrome captures from `VirtualMic.monitor`.

### 4. Echo/Feedback Loop

**Problem:** Bot transcribing its own TTS output.

**Solution:** Set `isSpeaking = true` flag during TTS playback, skip transcription while speaking.

## Running the Bot

```bash
# 1. Ensure Jitsi is running
cd ~/projects/jitsi && docker compose up -d

# 2. Ensure PulseAudio has virtual sinks
pactl list short sinks | grep VirtualMic || \
  pactl load-module module-null-sink sink_name=VirtualMic

# 3. Start the bot
cd ~/projects/jitsi-bot && node voice-bot.js

# 4. Join the room
# Open: https://localhost:8443/Enki
# Or via Tailscale: https://<YOUR_TAILSCALE_IP>:8443/Enki
```

## Performance

| Metric | Value |
|--------|-------|
| STT Latency | ~0.6s per 4s chunk |
| TTS Generation | ~1-2s |
| End-to-end | ~3-5s from speech to response |
| Memory (Chrome) | ~250MB |
| Memory (Whisper) | ~200MB |
| CPU (idle) | ~2% |
| CPU (transcribing) | ~50% spike |

## Future Improvements

- [ ] Integrate with OpenClaw for intelligent responses (not just echo)
- [ ] Add wake word detection ("Hey Enki")
- [ ] Reduce latency with streaming STT
- [ ] Add visual avatar/video for Enki
- [ ] Make it a systemd service
- [ ] Support multiple rooms/instances

## Dependencies

**System:**
- Node.js 22+
- Python 3.10+ with venv
- FFmpeg
- PulseAudio
- Docker & Docker Compose

**Node packages:**
- puppeteer

**Python packages:**
- faster-whisper
- edge-tts

---

*Built with 🔱 — February 2026*
