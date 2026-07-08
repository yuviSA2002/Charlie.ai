import sys
from pocketsphinx import Decoder
try:
    decoder = Decoder(lm=False, keyphrase='hey charlie', kws_threshold=1e-15)
    print("PocketSphinx Decoder kwargs initialized successfully.")
except Exception as e:
    print(f"Error initializing Decoder: {e}")
    sys.exit(1)
