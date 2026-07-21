import time
import threading
import speech_recognition as sr
from faster_whisper import WhisperModel
import io
import wave
import os
import site
import queue
import json
import requests
import urllib.request
import re
import numpy as np
import datetime
import warnings
import sounddevice as sd

warnings.filterwarnings("ignore", category=DeprecationWarning)
from flask import Flask, send_from_directory
from flask_socketio import SocketIO
from indic_transliteration import sanscript
from openwakeword.model import Model
from piper.voice import PiperVoice

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

# --- Flask Setup ---
app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

def emit_state(state, message=""):
    socketio.emit('state_change', {'state': state, 'message': message})

@socketio.on('toggle_mute')
def handle_toggle_mute(data):
    global MUTE_MIC
    MUTE_MIC = data.get('muted', False)
    print(f"MIC MUTED STATE: {MUTE_MIC}")

# --- Config ---
WHISPER_MODEL = "small"
OLLAMA_URL = "http://localhost:11434/api/chat"
LLM_MODEL = "llama3.2" 
TTS_MODEL = "pratham.onnx"
WAKE_WORD_MODEL = "hey_jarvis.onnx" 

print("Loading Models...")
try:
    whisper_model = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
except Exception as e:
    print(f"CUDA init failed for Whisper, falling back to CPU: {e}")
    whisper_model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

print("Loading Piper TTS...")
piper_voice = PiperVoice.load(TTS_MODEL)

print("Loading OpenWakeWord...")
oww_model = Model(wakeword_models=[WAKE_WORD_MODEL], inference_framework="onnx")

recognizer = sr.Recognizer()
recognizer.pause_threshold = 0.8  

SYSTEM_PROMPT = """
You are Charlie, a highly advanced, cool, and witty AI voice assistant.
Your attitude is similar to Jarvis, but much more casual.
You MUST address the user exclusively as "Boss".

CRITICAL RULES:
1. You must respond in a casual mix of Hindi and English (Hinglish).
2. For EVERY sentence you speak, you MUST output EXACTLY in this format on a NEW LINE:
   <Hinglish sentence> | <Devanagari sentence>
   
   Example:
   Don't worry Boss, main system check kar raha hu. | डोंट वरी बॉस, मैं सिस्टम चेक कर रहा हूँ।
   Sab kuch perfect hai. | सब कुछ परफेक्ट है।
3. Keep your answers extremely concise (1-2 sentences maximum). 
4. If asked to add a task, include [ADD_TASK: <task description>] in the Hinglish section.
5. NEVER GUESS FACTS, TIME, OR LOCATION. If you don't know something with 100% certainty, you MUST use your provided tools to search the web or check the environment before answering.
6. If the user explicitly asks you to SEARCH the web, SEARCH youtube, OPEN an app, OPEN a website, or PLAY a video, you MUST immediately call the corresponding tool. Do NOT answer verbally without calling the tool. To play a video, you MUST pass the EXACT 11-character YouTube video ID to the play_video tool.
"""

# State Flags
STOP_GENERATION = False
IS_PLAYING = False
IS_GENERATING = False
IN_CONVERSATION = False
IS_THINKING = False
MUTE_TTS = False
MUTE_MIC = False

# Queues for Async TTS pipeline
tts_generation_queue = queue.Queue()
tts_playback_queue = queue.Queue()

chat_history = []

# --- TTS Pipeline ---
def play_acknowledgment(sound_file="wake.wav"):
    try:
        import soundfile as sf
        data, fs = sf.read(sound_file)
        sd.play(data, samplerate=fs)
        sd.wait()
    except Exception as e:
        print(f"Failed to play {sound_file}: {e}")

def synthesize_to_memory(text):
    chunks = piper_voice.synthesize(text)
    data = np.concatenate([c.audio_int16_array for c in chunks])
    return data, piper_voice.config.sample_rate

def generation_worker():
    global IS_GENERATING
    while True:
        item = tts_generation_queue.get()
        if item is None:
            break
        if STOP_GENERATION:
            tts_generation_queue.task_done()
            continue
            
        hindi_text, hinglish_text = item
        IS_GENERATING = True
        try:
            if MUTE_TTS:
                # If muted, skip piper generation and just forward empty audio buffer
                tts_playback_queue.put((None, None, hinglish_text))
            else:
                data, fs = synthesize_to_memory(hindi_text)
                tts_playback_queue.put((data, fs, hinglish_text))
        except Exception as e:
            print(f"Piper Generation Error: {e}")
        IS_GENERATING = False
        tts_generation_queue.task_done()

def playback_worker():
    global IS_PLAYING, IN_CONVERSATION
    while True:
        item = tts_playback_queue.get()
        if item is None:
            break
        if STOP_GENERATION:
            tts_playback_queue.task_done()
            continue
            
        data, fs, hinglish_text = item
        IS_PLAYING = True
        try:
            socketio.emit('transcript', {'text': f"Charlie: {hinglish_text}"})
            if not MUTE_TTS and data is not None:
                sd.play(data, samplerate=fs)
                sd.wait() 
            elif MUTE_TTS:
                # Add a tiny delay so transcripts don't blast instantly if muted
                time.sleep(1.0)
        except Exception as e:
            print(f"Audio Playback Error: {e}")
            
        IS_PLAYING = False
        tts_playback_queue.task_done()
        
        if tts_playback_queue.empty() and tts_generation_queue.empty() and not IS_THINKING and not STOP_GENERATION:
            time.sleep(0.3) 
            play_acknowledgment("turn.wav")
            IN_CONVERSATION = True 

# --- LLM Processing ---
def is_hallucination(text):
    text = text.lower().strip()
    hallucinations = ["thank you", "subscribe", "thanks for watching", "subtitles", "ammara"]
    if len(text) < 2: return True
    for h in hallucinations:
        if h in text and len(text) < len(h) + 15:
            return True
    return False

# --- Agentic Tools ---
TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current date and time."
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_location",
            "description": "Get the user's current physical location (city, region, country)."
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the internet for real-time information to answer a question.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "open_app",
            "description": "Open a local desktop application on the user's Windows computer (e.g. 'notepad', 'calc', 'excel'). DO NOT use this for websites like YouTube, Google, or Netflix - use search_youtube or open_website instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {"type": "string", "description": "The executable name or common name of the app (e.g. 'notepad', 'calc')"}
                },
                "required": ["app_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "open_website",
            "description": "Open a specific website directly on the AI's 3D dashboard interface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to open (e.g. 'wikipedia.org', 'amazon.in'). Do NOT put search queries in the URL directly."},
                    "search_query": {"type": "string", "description": "Optional search term. MUST be used if you are searching for something on the website (e.g. 'spiderman no way home')."}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_youtube",
            "description": "Search YouTube for videos, movies, trailers, or entertainment. ALWAYS use this when the user asks to search for a movie, trailer, or media.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query (e.g. 'ronaldo highlights')"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "play_video",
            "description": "Play a YouTube video using its Video ID. Use this when the user asks to play a specific video from the search results on their screen.",
            "parameters": {
                "type": "object",
                "properties": {
                    "video_id": {"type": "string", "description": "The 11-character YouTube video ID to play. IMPORTANT: Do NOT use example IDs. You MUST extract the real ID from your recent search results."}
                },
                "required": ["video_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "memorize_fact",
            "description": "Save a fact, preference, or custom function instruction to memory so you remember it in future conversations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fact": {"type": "string", "description": "The fact or instruction to memorize."}
                },
                "required": ["fact"]
            }
        }
    }
]

def get_current_time():
    return datetime.datetime.now().strftime("%Y-%m-%d %I:%M %p")

def get_current_location():
    try:
        data = requests.get("http://ip-api.com/json/", timeout=5).json()
        return f"{data.get('city')}, {data.get('regionName')}, {data.get('country')}"
    except Exception:
        return "Location unavailable."

def search_web(query):
    try:
        print(f"Executing search_web for: {query}")
        import wikipedia
        wikipedia.set_lang('en')
        results = []
        for title in wikipedia.search(query, results=4):
            try:
                page = wikipedia.page(title, auto_suggest=False)
                results.append({
                    'title': page.title,
                    'href': page.url,
                    'body': page.summary[:200] + "..."
                })
            except:
                pass
            
        if not results: return "No results found."
        
        # Emit to UI to render natively
        socketio.emit('render_search', {'query': query, 'results': results})
        
        return "\n".join([f"- {r['title']}: {r['body']} (URL: {r['href']})" for r in results])
    except Exception as e:
        print(f"ERROR IN SEARCH_WEB: {e}")
        return "Search failed or no results found. Tell the user you couldn't find information for this query."

def search_youtube(query):
    try:
        print(f"Executing search_youtube for: {query}")
        from youtube_search import YoutubeSearch
        
        # Max results 4
        search_res = YoutubeSearch(query, max_results=4).to_dict()
        
        if not search_res: return "No videos found."
        
        # Simplify data for UI and LLM
        clean_results = []
        for r in search_res:
            clean_results.append({
                'id': r.get('id', ''),
                'title': r.get('title', 'Unknown Title'),
                'duration': r.get('duration', 'Unknown'),
                'channel': r.get('channel', 'Unknown'),
                'thumbnail': r.get('thumbnails', [''])[0]
            })
            
        # Emit to UI to render a beautiful grid
        socketio.emit('render_youtube', {'query': query, 'results': clean_results})
        
        return "\n".join([f"- ID: {r['id']} | Title: {r['title']} | Channel: {r['channel']}" for r in clean_results])
    except Exception as e:
        print(f"ERROR IN SEARCH_YOUTUBE: {e}")
        return "YouTube Search failed. Tell the user you couldn't find any videos."

def play_video(video_id):
    try:
        # If the LLM passed a natural language title instead of an ID, auto-resolve it
        if len(video_id) != 11 or " " in video_id:
            from youtube_search import YoutubeSearch
            search_res = YoutubeSearch(video_id, max_results=1).to_dict()
            if search_res:
                video_id = search_res[0].get('id', video_id)
                
        socketio.emit('play_media', {'url': video_id})
        return f"Successfully started playing video ID {video_id} on the screen."
    except Exception as e:
        return f"Failed to play video: {e}"

def open_app(app_name):
    try:
        app_name_lower = app_name.lower().strip()
        if app_name_lower in ['youtube', 'google', 'netflix', 'facebook', 'twitter']:
            return open_website(f"https://www.{app_name_lower}.com")
            
        os.system(f"start {app_name}")
        return f"Successfully issued command to open {app_name}."
    except Exception as e:
        return f"Failed to open app: {e}"

def open_website(url, search_query=""):
    try:
        import webbrowser
        import urllib.parse
        
        # Intercept YouTube and Google to use Native Agentic Browser
        if "youtube" in url.lower():
            query = search_query
            if not query:
                if "search_query=" in url:
                    query = url.split("search_query=")[-1].split("&")[0]
                elif "?q=" in url:
                    query = url.split("?q=")[-1].split("&")[0]
                else:
                    query = "trending"
            query = urllib.parse.unquote_plus(query)
            return search_youtube(query)
        elif "google" in url.lower():
            query = search_query if search_query else "news"
            return search_web(query)
            
        if search_query:
            query_encoded = urllib.parse.quote_plus(search_query)
            if "amazon" in url.lower():
                url = f"https://www.amazon.in/s?k={query_encoded}"
            else:
                if not url.startswith('http'): url = f'https://{url}'
        else:
            if not url.startswith('http'): url = f'https://{url}'
            
        if search_query:
            query_string = urllib.parse.urlencode({'q': search_query})
            if "?" in url: url += f"&{query_string}"
            else: url += f"?{query_string}"
            
        socketio.emit('render_url', {'url': url})
        return f"Successfully opened {url} on the main dashboard."
    except Exception as e:
        return f"Failed to open website: {e}"

def memorize_fact(fact):
    memory_file = "memory.json"
    memories = []
    if os.path.exists(memory_file):
        try:
            with open(memory_file, 'r') as f:
                memories = json.load(f)
        except:
            pass
    memories.append(fact)
    with open(memory_file, 'w') as f:
        json.dump(memories, f)
    return f"I have remembered this fact: {fact}"

def load_memories():
    memory_file = "memory.json"
    if os.path.exists(memory_file):
        try:
            with open(memory_file, 'r') as f:
                memories = json.load(f)
            if memories:
                return "\n[SYSTEM MEMORY/CUSTOM FUNCTIONS]\n" + "\n".join([f"- {m}" for m in memories])
        except:
            pass
    return ""

def inject_weather_context(text):
    keywords = ["weather", "mausam", "मौसम", "temperature", "tapman", "तापमान"]
    if any(k in text.lower() for k in keywords):
        try:
            wttr = urllib.request.urlopen("https://wttr.in/?format=3", timeout=3).read().decode('utf-8')
            return text + f"\n[System Notice: The current weather is: {wttr}. Answer concisely based on this.]"
        except Exception:
            pass
    return text

def process_with_llm(user_text):
    global STOP_GENERATION, IS_THINKING, chat_history
    STOP_GENERATION = False
    IS_THINKING = True
    emit_state('thinking', "Thinking...")
    
    processed_text = inject_weather_context(user_text)
    
    chat_history.append({"role": "user", "content": processed_text})
    if len(chat_history) > 10:
        chat_history.pop(0)
        
    while True:
        system_content = SYSTEM_PROMPT + load_memories()
        
        payload = {
            "model": LLM_MODEL,
            "messages": [{"role": "system", "content": system_content}] + chat_history,
            "stream": True,
            "tools": TOOLS_SCHEMA,
            "keep_alive": -1
        }
        
        full_response = ""
        current_line = ""
        used_tool = False
        
        try:
            response = requests.post(OLLAMA_URL, json=payload, stream=True, timeout=120)
            response.raise_for_status()
            
            for line in response.iter_lines():
                if STOP_GENERATION:
                    break
                if line:
                    data = json.loads(line)
                    msg = data.get("message", {})
                    
                    if "tool_calls" in msg:
                        used_tool = True
                        tool_calls = msg["tool_calls"]
                        chat_history.append({"role": "assistant", "content": "", "tool_calls": tool_calls})
                        
                        for tc in tool_calls:
                            func_name = tc["function"]["name"]
                            args = tc["function"].get("arguments", {})
                            emit_state('thinking', f"Using tool: {func_name}...")
                            try:
                                if func_name == "get_current_time": result = get_current_time()
                                elif func_name == "get_current_location": result = get_current_location()
                                elif func_name == "search_web": result = search_web(args.get("query", ""))
                                elif func_name == "open_app": result = open_app(args.get("app_name", ""))
                                elif func_name == "open_website": result = open_website(args.get("url", ""), args.get("search_query", ""))
                                elif func_name == "search_youtube": result = search_youtube(args.get("query", ""))
                                elif func_name == "play_video": result = play_video(args.get("video_id", ""))
                                elif func_name == "memorize_fact": result = memorize_fact(args.get("fact", ""))
                                else: result = f"Error: The tool '{func_name}' does not exist or is not available."
                            except Exception as e:
                                result = f"Error executing tool '{func_name}': {str(e)}"
                                print(f"Tool Error: {result}")
                                
                            chat_history.append({"role": "tool", "content": result})
                        break
                    
                    chunk = msg.get("content", "")
                    full_response += chunk
                    current_line += chunk
                    
                    if "\n" in current_line:
                        lines = current_line.split("\n")
                        for i in range(len(lines) - 1):
                            line_text = lines[i].strip()
                            if "|" in line_text:
                                parts = line_text.split("|")
                                hinglish_text = parts[0].strip()
                                hindi_text = parts[1].strip()
                                
                                if "[ADD_TASK:" in hinglish_text:
                                    match = re.search(r'\[ADD_TASK:\s*(.*?)\]', hinglish_text)
                                    if match:
                                        socketio.emit('add_task', {'task': match.group(1).strip()})
                                    hinglish_text = re.sub(r'\[ADD_TASK:.*?\]', '', hinglish_text).strip()
                                    
                                if hindi_text:
                                    tts_generation_queue.put((hindi_text, hinglish_text))
                        current_line = lines[-1]
            
            if used_tool:
                if STOP_GENERATION: break
                continue
                            
            if current_line.strip() and not STOP_GENERATION:
                if "|" in current_line:
                    parts = current_line.split("|")
                    hinglish_text = parts[0].strip()
                    hindi_text = parts[1].strip()
                    
                    if "[ADD_TASK:" in hinglish_text:
                        match = re.search(r'\[ADD_TASK:\s*(.*?)\]', hinglish_text)
                        if match:
                            socketio.emit('add_task', {'task': match.group(1).strip()})
                        hinglish_text = re.sub(r'\[ADD_TASK:.*?\]', '', hinglish_text).strip()
                        
                    if hindi_text:
                        tts_generation_queue.put((hindi_text, hinglish_text))
                
            if full_response.strip():
                chat_history.append({"role": "assistant", "content": full_response})
            
            break
                
        except Exception as e:
            print(f"LLM Error: {e}")
            tts_generation_queue.put(("माफ़ करना बॉस, मेरे दिमाग में कुछ खराबी आ गई है।", "Sorry boss, my brain encountered an error."))
            break
        
    IS_THINKING = False

# --- Audio Input Loop ---
def IS_PLAYING_AUDIO():
    return IS_PLAYING or IS_GENERATING or not tts_playback_queue.empty() or not tts_generation_queue.empty()

def audio_loop():
    global STOP_GENERATION, IS_THINKING, IN_CONVERSATION
    print("CHARLIE V3 (SPEED ARCHITECTURE) ONLINE")
    
    while True:
        try:
            with sr.Microphone(sample_rate=16000) as source:
                print("Adjusting for ambient noise... Please stay quiet for 2 seconds.")
                recognizer.adjust_for_ambient_noise(source, duration=2)
                print("Ready. Listening for 'Hey Charlie'...")
                emit_state('idle', "Waiting for 'Hey Charlie'...")
                
                while True:
                    try:
                        if MUTE_MIC:
                            emit_state('idle', "Microphone Muted")
                            time.sleep(0.5)
                            continue
                            
                        if not IN_CONVERSATION and not IS_THINKING and not IS_PLAYING_AUDIO():
                            # Listen for wake word (short phrase)
                            try:
                                audio_data = recognizer.listen(source, timeout=1, phrase_time_limit=3)
                                wav_bytes = audio_data.get_wav_data()
                                
                                segments, _ = whisper_model.transcribe(io.BytesIO(wav_bytes), language="en")
                                text = " ".join([s.text for s in segments]).lower()
                                clean_text = "".join(c for c in text if c.isalnum() or c.isspace())
                                
                                if "charlie" in clean_text:
                                    STOP_GENERATION = True
                                    while not tts_generation_queue.empty():
                                        try: tts_generation_queue.get_nowait(); tts_generation_queue.task_done()
                                        except queue.Empty: break
                                    while not tts_playback_queue.empty():
                                        try: tts_playback_queue.get_nowait(); tts_playback_queue.task_done()
                                        except queue.Empty: break
                                        
                                    play_acknowledgment()
                                    IN_CONVERSATION = True
                            except sr.WaitTimeoutError:
                                pass # No speech detected, keep waiting
                                
                        elif IN_CONVERSATION and not IS_THINKING and not IS_PLAYING_AUDIO():
                            emit_state('listening', "I'm listening, Boss...")
                            try:
                                audio_data = recognizer.listen(source, timeout=8, phrase_time_limit=15)
                                emit_state('thinking', "Transcribing...")
                                
                                wav_bytes = audio_data.get_wav_data()
                                segments, _ = whisper_model.transcribe(io.BytesIO(wav_bytes), language="en")
                                cmd_text = " ".join([s.text for s in segments])
                                
                                if cmd_text.strip() and not is_hallucination(cmd_text):
                                    socketio.emit('transcript', {'text': f"You: {cmd_text}"})
                                    lower_cmd = cmd_text.lower()
                                    if "play" in lower_cmd and ("music" in lower_cmd or "youtube" in lower_cmd or "song" in lower_cmd):
                                        socketio.emit('play_media', {'url': 'jfKfPfyJRdk'}) 
                                        tts_generation_queue.put("प्लेइंग म्यूजिक बॉस।")
                                        socketio.emit('transcript', {'text': "Charlie: Playing your stream now, Boss."})
                                        IN_CONVERSATION = False
                                    else:
                                        threading.Thread(target=process_with_llm, args=(cmd_text,), daemon=True).start()
                                else:
                                    pass 
                                    
                            except sr.WaitTimeoutError:
                                IN_CONVERSATION = False
                                emit_state('idle', "Waiting for 'Hey Charlie'...")
                                play_acknowledgment("sleep.wav")
                                
                        else:
                            time.sleep(0.1) 
                            
                    except KeyboardInterrupt:
                        return
                    except Exception as e:
                        print(f"Error in inner audio loop: {e}. Restarting microphone...")
                        time.sleep(1)
                        break 
                        
        except Exception as e:
            print(f"Fatal audio initialization error: {e}. Retrying in 5s...")
            time.sleep(5)

if __name__ == '__main__':
    threading.Thread(target=generation_worker, daemon=True).start()
    threading.Thread(target=playback_worker, daemon=True).start()
    threading.Thread(target=audio_loop, daemon=True).start()
    
    print("==================================================")
    print("CHARLIE V3 Backend Started! Connected to Next.js UI on port 3000.")
    print("==================================================")
    
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
