# openclaw-talks-back 🔱

A real-time voice AI that joins Jitsi video calls and has actual conversations.

**No cloud APIs. Runs on a laptop. Fully self-hosted.**

## What it does

- Joins a Jitsi Meet room as a participant named "Enki"
- Listens to speech via WebRTC audio capture
- Transcribes in real-time using Whisper (~0.6s latency)
- Responds with synthesized voice using Edge TTS
- All processing happens locally

## Demo

```
You: "Hello, can you hear me?"
Enki: "Hello! Nice to hear from you!"

You: "What's your name?"
Enki: "I am Enki, god of wisdom and water. I'm your AI assistant."
```

## Stack

| Component | Technology |
|-----------|------------|
| Video Conferencing | Self-hosted Jitsi Meet (Docker) |
| Bot Browser | Puppeteer (Headless Chrome) |
| Speech-to-Text | faster-whisper (tiny.en model) |
| Text-to-Speech | edge-tts (Microsoft Neural Voices) |
| Audio Routing | PulseAudio virtual sinks |

## Requirements

- Linux (tested on Ubuntu 24.04 / WSL2)
- Node.js 18+
- Python 3.10+
- Docker & Docker Compose
- PulseAudio
- FFmpeg

## Quick Start

### 1. Set up Jitsi Meet

```bash
# Clone Jitsi Docker setup
git clone https://github.com/jitsi/docker-jitsi-meet.git jitsi
cd jitsi

# Configure
cp env.example .env
# Edit .env and set:
# - JVB_ADVERTISE_IPS=127.0.0.1,<your-ip>
# - ENABLE_GUESTS=1

# Start
docker compose up -d
```

### 2. Set up the bot

```bash
# Clone this repo
git clone https://github.com/yaxzone/openclaw-talks-back.git
cd openclaw-talks-back

# Install Node dependencies
npm install

# Create Python venv and install Whisper
python3 -m venv venv
source venv/bin/activate
pip install faster-whisper edge-tts
```

### 3. Set up PulseAudio virtual sink

```bash
pactl load-module module-null-sink sink_name=VirtualMic sink_properties=device.description=VirtualMic
```

### 4. Run the bot

```bash
node voice-bot.js
```

### 5. Join the call

Open `https://localhost:8443/Enki` in your browser and start talking!

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ROOM` | `Enki` | Jitsi room name to join |
| `WHISPER_VENV` | `./venv/bin/python` | Path to Python with faster-whisper |
| `EDGE_TTS` | `edge-tts` | Path to edge-tts binary |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation including:
- System diagram
- Data flow (STT and TTS)
- Key challenges and solutions
- Performance metrics

## Key Challenges Solved

1. **ICE Connection Failures**: Bot connects via localhost but JVB advertised different IP. Fixed by adding `127.0.0.1` to `JVB_ADVERTISE_IPS`.

2. **Slow Whisper**: Model reload per-chunk was too slow. Created persistent server that keeps model in memory.

3. **TTS Audio Routing**: Chrome's fake-media-stream only sends test patterns. Used PulseAudio virtual sinks to route TTS audio into WebRTC stream.

4. **Echo Loop**: Bot was transcribing its own TTS. Added `isSpeaking` flag to skip transcription during playback.

## Performance

| Metric | Value |
|--------|-------|
| STT Latency | ~0.6s per 4s chunk |
| TTS Generation | ~1-2s |
| End-to-end | ~5-6s |
| Memory (Chrome) | ~250MB |
| Memory (Whisper) | ~200MB |

## Future Ideas

- [ ] Wake word detection ("Hey Enki")
- [ ] Streaming STT for lower latency
- [ ] Integration with LLM for intelligent responses
- [ ] Systemd service for persistence
- [ ] Multiple room support

## License

MIT

---

*Built with 🔱 — February 2026*
