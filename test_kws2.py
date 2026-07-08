import pyaudio
from pocketsphinx import Decoder

config = Decoder.default_config()
config.set_string('-keyphrase', 'hey charlie')
config.set_float('-kws_threshold', 1e-15)

try:
    decoder = Decoder(config)
    print("PocketSphinx Decoder initialized successfully.")
except Exception as e:
    print(f"Error initializing Decoder: {e}")
    # Fallback without default config
    decoder = Decoder(lm=False, keyphrase='hey charlie', kws_threshold=1e-15)
