import pyaudio
import numpy as np
import wave
import time

FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1024

audio = pyaudio.PyAudio()

print("Available audio devices:")
for i in range(audio.get_device_count()):
    dev = audio.get_device_info_by_index(i)
    if dev['maxInputChannels'] > 0:
        print(f"[{i}] {dev['name']}")

print("\nStarting recording test for 3 seconds...")
try:
    stream = audio.open(format=FORMAT, channels=CHANNELS,
                        rate=RATE, input=True,
                        frames_per_buffer=CHUNK)
    
    frames = []
    for _ in range(0, int(RATE / CHUNK * 3)):
        data = stream.read(CHUNK, exception_on_overflow=False)
        frames.append(data)
        
    print("Recording finished successfully.")
    
    stream.stop_stream()
    stream.close()
    audio.terminate()
except Exception as e:
    print(f"Error during audio test: {e}")
