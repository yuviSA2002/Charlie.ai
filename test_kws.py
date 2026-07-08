from pocketsphinx import LiveSpeech

try:
    speech = LiveSpeech(keyphrase='hey charlie', kws_threshold=1e-15)
    print("LiveSpeech initialized successfully.")
except Exception as e:
    print(f"Error: {e}")
