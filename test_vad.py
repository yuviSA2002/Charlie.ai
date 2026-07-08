import speech_recognition as sr
from faster_whisper import WhisperModel
import io

print("Loading Whisper...")
whisper_model = WhisperModel("small", device="cuda", compute_type="float16")

recognizer = sr.Recognizer()

with sr.Microphone(sample_rate=16000) as source:
    print("Adjusting for ambient noise...")
    recognizer.adjust_for_ambient_noise(source, duration=2)
    print(f"Energy threshold set to {recognizer.energy_threshold}")
    print("Listening...")
    
    # Just listen once for a test
    try:
        audio_data = recognizer.listen(source, timeout=5, phrase_time_limit=5)
        print("Transcribing...")
        wav_bytes = audio_data.get_wav_data()
        segments, info = whisper_model.transcribe(io.BytesIO(wav_bytes), language="en")
        text = " ".join([segment.text for segment in segments])
        print(f"Heard: {text}")
    except sr.WaitTimeoutError:
        print("No speech detected.")
