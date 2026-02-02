#!/usr/bin/env python3
"""Simple transcription server that keeps Whisper model loaded"""
import sys
import os
import time

print("Loading Whisper model...", file=sys.stderr)
from faster_whisper import WhisperModel
model = WhisperModel("tiny", device="cpu", compute_type="int8")
print("Model ready!", file=sys.stderr)

# Read wav file paths from stdin, output transcriptions
for line in sys.stdin:
    wav_file = line.strip()
    if not wav_file or not os.path.exists(wav_file):
        print("")  # Empty line for invalid input
        sys.stdout.flush()
        continue
    
    try:
        start = time.time()
        segments, info = model.transcribe(wav_file, beam_size=5)
        text = " ".join([s.text for s in segments]).strip()
        elapsed = time.time() - start
        print(f"{text}", flush=True)
        print(f"Transcribed in {elapsed:.2f}s: {text[:50]}...", file=sys.stderr)
    except Exception as e:
        print("", flush=True)
        print(f"Error: {e}", file=sys.stderr)
