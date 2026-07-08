import numpy as np
from scipy.io import wavfile

sample_rate = 44100

def generate_sweep(freq_start, freq_end, duration_ms, filename, fade_out=True):
    duration_s = duration_ms / 1000.0
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False)
    
    # Generate exponential frequency sweep
    audio = np.sin(2 * np.pi * np.linspace(freq_start, freq_end, len(t)) * t)
    
    # Envelope shaping (sharp attack, smooth fade out)
    envelope = np.ones_like(t)
    if fade_out:
        envelope = np.exp(-t * (5 / duration_s)) # Decay
    else:
        # Fade in
        envelope = 1 - np.exp(-t * (10 / duration_s))
        
    audio = audio * envelope * 0.5 # 50% volume to prevent clipping
    
    # Convert to 16-bit PCM
    audio_int16 = (audio * 32767).astype(np.int16)
    wavfile.write(filename, sample_rate, audio_int16)
    print(f"Generated {filename}")

# Wake sound: Fast ascending blip (e.g. 800Hz to 1600Hz)
generate_sweep(600, 1800, 150, "wake.wav", fade_out=True)

# Turn-over sound (When Charlie finishes speaking): Soft high-pitched ping
generate_sweep(1200, 1400, 100, "turn.wav", fade_out=True)

# Sleep sound: Descending blip (e.g. 1200Hz to 400Hz)
generate_sweep(1400, 600, 200, "sleep.wav", fade_out=True)
