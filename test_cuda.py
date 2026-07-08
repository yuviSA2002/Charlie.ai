import os
import site
import io
from faster_whisper import WhisperModel

for sp in site.getsitepackages():
    cuda_paths = [
        os.path.join(sp, "nvidia", "cublas", "bin"),
        os.path.join(sp, "nvidia", "cudnn", "bin")
    ]
    for p in cuda_paths:
        if os.path.exists(p):
            print(f"Adding CUDA path: {p}")
            os.environ["PATH"] += os.pathsep + p
            try:
                os.add_dll_directory(p)
            except Exception:
                pass

print("Loading Whisper...")
whisper_model = WhisperModel("small", device="cuda", compute_type="float16")

import numpy as np
# Dummy audio array (1 second of silence)
dummy_audio = np.zeros(16000, dtype=np.float32)

print("Transcribing dummy audio to test GPU...")
segments, info = whisper_model.transcribe(dummy_audio, language="en")
text = " ".join([segment.text for segment in segments])
print("SUCCESS! Output:", text)
