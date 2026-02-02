const puppeteer = require('puppeteer');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const ROOM = process.env.ROOM || 'Enki';
const AUDIO_DIR = '/tmp/jitsi-audio';
const TTS_DIR = '/tmp/jitsi-tts';
const WHISPER_VENV = process.env.WHISPER_VENV || './venv/bin/python';
const EDGE_TTS = process.env.EDGE_TTS || 'edge-tts';

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
if (!fs.existsSync(TTS_DIR)) fs.mkdirSync(TTS_DIR, { recursive: true });

// Start transcription server
console.log(`[${new Date().toISOString()}] Starting transcription server...`);
const transcribeProc = spawn(WHISPER_VENV, ['transcribe-server.py'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
});

let transcribeReady = false;
let pendingTranscriptions = [];
let isSpeaking = false;  // Prevent hearing ourselves

transcribeProc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    console.log(`[Whisper] ${msg}`);
    if (msg.includes('Model ready')) transcribeReady = true;
});

transcribeProc.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text && text.length > 0 && !isSpeaking) {
        console.log(`[${new Date().toISOString()}] HEARD: "${text}"`);
        pendingTranscriptions.push(text);
    }
});

// Generate TTS using edge-tts (better quality than espeak)
async function speakTTS(text) {
    const timestamp = Date.now();
    const mp3File = `${TTS_DIR}/tts_${timestamp}.mp3`;
    const wavFile = `${TTS_DIR}/tts_${timestamp}.wav`;
    
    try {
        isSpeaking = true;
        
        // Generate with edge-tts (uses Microsoft's neural voices)
        execSync(`${EDGE_TTS} --text "${text.replace(/"/g, '\\"')}" --write-media "${mp3File}"`, { stdio: 'pipe' });
        
        // Convert to WAV for PulseAudio
        execSync(`ffmpeg -y -i "${mp3File}" "${wavFile}" 2>/dev/null`, { stdio: 'pipe' });
        
        // Play to VirtualMic sink
        const play = spawn('paplay', ['--device=VirtualMic', wavFile]);
        
        play.on('close', () => {
            isSpeaking = false;
            try { fs.unlinkSync(mp3File); } catch {}
            try { fs.unlinkSync(wavFile); } catch {}
        });
        
        console.log(`[${new Date().toISOString()}] Speaking: "${text.substring(0, 50)}..."`);
        return true;
    } catch (e) {
        isSpeaking = false;
        console.log(`[TTS] Error:`, e.message);
        return false;
    }
}

async function run() {
    console.log(`[${new Date().toISOString()}] Starting voice bot...`);
    
    while (!transcribeReady) await new Promise(r => setTimeout(r, 500));
    console.log(`[${new Date().toISOString()}] Transcription ready!`);
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--use-fake-ui-for-media-stream',
            '--ignore-certificate-errors',
            '--disable-gpu',
            '--autoplay-policy=no-user-gesture-required'
        ],
        env: {
            ...process.env,
            PULSE_SOURCE: 'VirtualMic.monitor',
            DISPLAY: ':99'
        }
    });
    
    const page = await browser.newPage();
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions('https://localhost:8443', ['microphone', 'camera', 'notifications']);
    
    await page.exposeFunction('onAudioData', async (base64Audio, timestamp) => {
        if (isSpeaking) return;  // Don't transcribe while speaking
        
        const buffer = Buffer.from(base64Audio, 'base64');
        const webmFile = `${AUDIO_DIR}/chunk_${timestamp}.webm`;
        const wavFile = `${AUDIO_DIR}/chunk_${timestamp}.wav`;
        fs.writeFileSync(webmFile, buffer);
        
        try {
            execSync(`ffmpeg -y -i "${webmFile}" -ar 16000 -ac 1 "${wavFile}" 2>/dev/null`);
            transcribeProc.stdin.write(wavFile + '\n');
            fs.unlinkSync(webmFile);
        } catch (e) {}
    });
    
    const url = `https://localhost:8443/${ROOM}#config.prejoinConfig.enabled=false&config.startWithAudioMuted=false&userInfo.displayName=%22Enki%22`;
    
    console.log(`[${new Date().toISOString()}] Joining room: ${ROOM}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('Nav:', e.message));
    
    await new Promise(r => setTimeout(r, 10000));
    
    await page.evaluate(() => {
        if (APP.conference && APP.conference.isLocalAudioMuted()) {
            APP.conference.muteAudio(false);
        }
    }).catch(() => {});
    
    await page.evaluate(() => {
        if (APP.conference && APP.conference._room) {
            APP.conference._room.sendTextMessage('🔱 Enki voice bot online!');
        }
    }).catch(() => {});
    
    console.log(`[${new Date().toISOString()}] Bot joined`);
    
    // Initial greeting
    setTimeout(() => speakTTS("Hello! I am Enki. I can hear you now."), 3000);
    
    let iteration = 0;
    
    while (true) {
        await new Promise(r => setTimeout(r, 3000));
        iteration++;
        
        // Set up recorders
        await page.evaluate(() => {
            try {
                const room = APP.conference?._room;
                if (!room) return;
                
                const participants = room.getParticipants();
                window.audioRecorders = window.audioRecorders || {};
                window.audioChunks = window.audioChunks || {};
                
                for (const p of participants) {
                    const pid = p.getId();
                    if (window.audioRecorders[pid]) continue;
                    
                    for (const track of p.getTracks()) {
                        if (track.getType() !== 'audio') continue;
                        const mediaTrack = track.track || track.getTrack();
                        if (!mediaTrack) continue;
                        
                        const stream = new MediaStream([mediaTrack]);
                        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                        window.audioRecorders[pid] = recorder;
                        window.audioChunks[pid] = [];
                        
                        recorder.ondataavailable = (e) => {
                            if (e.data.size > 0) window.audioChunks[pid].push(e.data);
                        };
                        
                        recorder.onstop = async () => {
                            if (window.audioChunks[pid].length === 0) return;
                            const blob = new Blob(window.audioChunks[pid], { type: 'audio/webm' });
                            window.audioChunks[pid] = [];
                            if (blob.size < 500) return;
                            
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const base64 = reader.result.split(',')[1];
                                window.onAudioData(base64, Date.now());
                            };
                            reader.readAsDataURL(blob);
                        };
                        
                        recorder.start();
                        setInterval(() => {
                            if (recorder.state === 'recording') {
                                recorder.stop();
                                setTimeout(() => recorder.start(), 100);
                            }
                        }, 4000);
                    }
                }
            } catch (e) {}
        }).catch(() => {});
        
        // Process transcriptions
        if (pendingTranscriptions.length > 0 && !isSpeaking) {
            const heard = pendingTranscriptions.join(' ');
            pendingTranscriptions = [];
            
            let response = `I heard you say: ${heard}`;
            
            const lower = heard.toLowerCase();
            if (lower.includes('hello') || lower.includes('hi ') || lower === 'hi') {
                response = "Hello! Nice to hear from you!";
            } else if (lower.includes('how are you')) {
                response = "I'm doing great! It's amazing that we can talk like this.";
            } else if (lower.includes('test')) {
                response = "Test received loud and clear!";
            } else if (lower.includes('your name') || lower.includes("who are you")) {
                response = "I am Enki, god of wisdom and water. I'm your AI assistant.";
            } else if (lower.includes('thank')) {
                response = "You're welcome!";
            }
            
            console.log(`[${new Date().toISOString()}] Responding: "${response}"`);
            
            await page.evaluate((text) => {
                APP.conference._room.sendTextMessage(text);
            }, response).catch(() => {});
            
            await speakTTS(response);
        }
        
        if (iteration % 20 === 0) {
            const status = await page.evaluate(() => {
                const room = APP.conference?._room;
                const pc = room?.jvbJingleSession?.peerconnection?.peerconnection;
                return {
                    participants: room?.getParticipants()?.length || 0,
                    recorders: Object.keys(window.audioRecorders || {}).length,
                    ice: pc?.iceConnectionState
                };
            }).catch(() => ({}));
            console.log(`[${new Date().toISOString()}] Status: ${JSON.stringify(status)}`);
        }
    }
}

run().catch(console.error);
