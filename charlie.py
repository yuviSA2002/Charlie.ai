import time
import threading
import speech_recognition as sr
from faster_whisper import WhisperModel
import io
import winsound
import requests
import subprocess
import os
import site
import queue
import json
import urllib.request
from flask import Flask, send_from_directory
from flask_socketio import SocketIO

# --- Inject CUDA Paths for faster-whisper on Windows ---
for sp in site.getsitepackages():
    cuda_paths = [
        os.path.join(sp, "nvidia", "cublas", "bin"),
        os.path.join(sp, "nvidia", "cudnn", "bin")
    ]
    for p in cuda_paths:
        if os.path.exists(p):
            os.environ["PATH"] += os.pathsep + p
            try:
                os.add_dll_directory(p)
            except Exception:
                pass

# --- Flask & UI Setup ---
app = Flask(__name__, static_folder='ui')
socketio = SocketIO(app, cors_allowed_origins="*")

@app.route('/')
def index():
    return send_from_directory('ui', 'index.html')

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('ui', path)

def emit_state(state, message=""):
    socketio.emit('state_change', {'state': state, 'message': message})

# --- Config ---
WHISPER_MODEL = "small"
OLLAMA_URL = "http://localhost:11434/api/generate"
LLM_MODEL = "llama3.2"  # 3B model
TTS_MODEL = "pratham.onnx"

print("Loading Whisper Model...")
try:
    whisper_model = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
except Exception as e:
    print(f"CUDA init failed, falling back to CPU: {e}")
    whisper_model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

recognizer = sr.Recognizer()
# 1.2s pause threshold: enough to breathe, but fast enough to not feel laggy
recognizer.pause_threshold = 1.2  

SYSTEM_PROMPT = """
You are Charlie, a highly advanced, cool, and witty AI voice assistant.
Your attitude is similar to Jarvis, but much more casual.
You MUST address the user exclusively as "Boss" (बॉस). NEVER use "श्रीमान" (Sir).

CRITICAL RULES:
1. Speak in a casual mix of Hindi and English (Hinglish).
2. However, you MUST write your entire response using the Devanagari script so the TTS engine can pronounce it. 
   Example: "डोंट वरी बॉस, मैंने सिस्टम चेक कर लिया है। सब परफेक्ट है।"
3. Keep your answers extremely concise (1-2 sentences). 
"""

STOP_GENERATION = False
IS_PLAYING = False
IS_THINKING = False
tts_queue = queue.Queue()

def tts_worker():
    global STOP_GENERATION, IS_PLAYING
    while True:
        sentence = tts_queue.get()
        if sentence is None:
            break
        if STOP_GENERATION:
            tts_queue.task_done()
            continue
            
        emit_state('speaking', sentence)
        IS_PLAYING = True
        try:
            with open("temp_speech.txt", "w", encoding="utf-8") as f:
                f.write(sentence)
            subprocess.run(
                [r".\\venv\\Scripts\\piper.exe", "-m", TTS_MODEL, "-i", "temp_speech.txt", "-f", "response.wav"],
                capture_output=True, text=True
            )
            if not STOP_GENERATION:
                winsound.PlaySound("response.wav", winsound.SND_FILENAME)
        except Exception as e:
            print(f"TTS Error: {e}")
        IS_PLAYING = False
        tts_queue.task_done()
        
        # If queue is empty and LLM is done generating, it's the user's turn!
        if tts_queue.empty() and not IS_THINKING and not STOP_GENERATION:
            winsound.PlaySound("turn.wav", winsound.SND_FILENAME)

def play_acknowledgment():
    winsound.PlaySound("wake.wav", winsound.SND_FILENAME)

def inject_weather_context(text):
    """If user asks for weather, fetch it secretly and inject into prompt."""
    keywords = ["weather", "mausam", "मौसम", "temperature", "tapman", "तापमान"]
    if any(k in text.lower() for k in keywords):
        try:
            wttr = urllib.request.urlopen("https://wttr.in/?format=3", timeout=3).read().decode('utf-8')
            return text + f"\n[System Notice: The current weather is: {wttr}. Please answer the user's weather question using this real-time data.]"
        except Exception:
            pass
    return text

def process_with_llm(text):
    global STOP_GENERATION, IS_THINKING
    STOP_GENERATION = False
    IS_THINKING = True
    emit_state('thinking', "Thinking...")
    
    text = inject_weather_context(text)
    
    payload = {
        "model": LLM_MODEL,
        "prompt": f"System: {SYSTEM_PROMPT}\n\nUser: {text}\nCharlie:",
        "stream": True
    }
    
    current_sentence = ""
    try:
        response = requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120)
        response.raise_for_status()
        
        for line in response.iter_lines():
            if STOP_GENERATION:
                break
                
            if line:
                data = json.loads(line)
                chunk = data.get("response", "")
                current_sentence += chunk
                
                # Yield at sentence boundaries
                if any(punct in chunk for punct in [".", "?", "!", "\n", "|", "।"]):
                    clean_sent = current_sentence.strip()
                    if clean_sent:
                        tts_queue.put(clean_sent)
                        socketio.emit('transcript', {'text': clean_sent})
                    current_sentence = ""
                    
        if current_sentence.strip() and not STOP_GENERATION:
            tts_queue.put(current_sentence.strip())
            socketio.emit('transcript', {'text': current_sentence.strip()})
            
    except Exception as e:
        print(f"LLM Error: {e}")
        tts_queue.put("माफ़ करना बॉस, मेरे दिमाग में कुछ खराबी आ गई है।")
        
    IS_THINKING = False

def audio_loop():
    global STOP_GENERATION, IS_THINKING
    print("CHARLIE V2 AUDIO LOOP ONLINE")
    with sr.Microphone(sample_rate=16000) as source:
        print("Adjusting for ambient noise... Please stay quiet for 2 seconds.")
        recognizer.adjust_for_ambient_noise(source, duration=2)
        print("Ready. Listening for 'Hey Charlie'...")
        emit_state('idle', "Waiting for 'Hey Charlie'...")
        
        IN_CONVERSATION = False
        
        while True:
            try:
                # If Charlie is busy thinking/speaking OR we are idle -> Listen ONLY for wake word / interrupt
                if IS_PLAYING_AUDIO() or IS_THINKING or not IN_CONVERSATION:
                    audio_data = recognizer.listen(source, timeout=1, phrase_time_limit=3)
                    wav_bytes = audio_data.get_wav_data()
                    
                    segments, _ = whisper_model.transcribe(io.BytesIO(wav_bytes), language="en")
                    text = " ".join([s.text for s in segments]).lower()
                    clean_text = "".join(c for c in text if c.isalnum() or c.isspace())
                    
                    if "charlie" in clean_text:
                        STOP_GENERATION = True
                        winsound.PlaySound(None, winsound.SND_PURGE)
                        while not tts_queue.empty():
                            try: tts_queue.get_nowait(); tts_queue.task_done()
                            except queue.Empty: break
                            
                        play_acknowledgment()
                        IN_CONVERSATION = True
                
                # If Charlie finished his turn and we are IN_CONVERSATION -> Listen directly for user command!
                else:
                    emit_state('listening', "I'm listening, Boss...")
                    try:
                        # Listen for 8 seconds. If silence, timeout and end conversation.
                        command_audio = recognizer.listen(source, timeout=8, phrase_time_limit=15)
                        emit_state('thinking', "Transcribing...")
                        cmd_wav = command_audio.get_wav_data()
                        
                        # Removed language="hi" to allow Whisper to transcribe Hinglish/English perfectly
                        cmd_segments, _ = whisper_model.transcribe(io.BytesIO(cmd_wav))
                        cmd_text = " ".join([s.text for s in cmd_segments])
                        socketio.emit('transcript', {'text': f"You: {cmd_text}"})
                        
                        if cmd_text.strip():
                            threading.Thread(target=process_with_llm, args=(cmd_text,), daemon=True).start()
                        else:
                            # Ignored noise, stay in conversation loop
                            pass
                            
                    except sr.WaitTimeoutError:
                        # 8 seconds of silence, conversation ended naturally
                        IN_CONVERSATION = False
                        emit_state('idle', "Waiting for 'Hey Charlie'...")
                        winsound.PlaySound("sleep.wav", winsound.SND_FILENAME)
                        
            except sr.WaitTimeoutError:
                # Timeout while listening for wake word (happens every 1 sec to check flags)
                if not IN_CONVERSATION and not IS_THINKING and not IS_PLAYING_AUDIO():
                    emit_state('idle', "Waiting for 'Hey Charlie'...")
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error in audio loop: {e}")
                time.sleep(1)

def IS_PLAYING_AUDIO():
    return IS_PLAYING or not tts_queue.empty()

if __name__ == '__main__':
    threading.Thread(target=tts_worker, daemon=True).start()
    threading.Thread(target=audio_loop, daemon=True).start()
    
    print("==================================================")
    print("UI Server Started! Open http://localhost:5000 in your browser.")
    print("==================================================")
    
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
