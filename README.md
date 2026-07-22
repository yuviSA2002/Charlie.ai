# Charlie.ai 🤖

Charlie is an advanced, fully local, open-source AI assistant featuring a fully interactive 3D Orb UI, real-time voice transcription, and embedded media control. Built with privacy in mind, Charlie leverages local LLMs and local Speech-to-Text (STT)/Text-to-Speech (TTS) models to ensure your data never leaves your machine.

---

## 🌟 Key Features

*   **🗣️ Fully Local Voice AI:** Powered by local Whisper (STT), Ollama (LLM), and fast ONNX-based TTS models. No cloud API costs, no internet required for core intelligence.
*   **🌐 3D Orb UI:** A stunning, interactive web-based interface built with Three.js and React. The Orb reacts to Charlie's state (Idle, Listening, Thinking, Speaking) with dynamic particle effects.
*   **🎵 Integrated Media Player:** Ask Charlie to play a video or song, and he will intelligently search YouTube and stream the video directly onto an interactive 2D/3D display inside the UI, entirely bypassing browser clickjacking restrictions.
*   **🧠 Contextual Memory:** Charlie can remember tasks and facts dynamically. *(Note: Memory is stored locally and explicitly excluded from version control for your privacy).*
*   **🔇 Mute / Sleep Mode:** Hard-mute the microphone instantly using keybinds (`M`), putting the wake-word and conversation listeners to sleep.

---

## 🛠️ Architecture Stack

*   **Backend:** Python, Flask, Socket.IO
*   **Frontend:** Next.js, React, Three.js, Tailwind CSS
*   **AI Models:** 
    *   **LLM:** LLaMA 3.2 (via Ollama)
    *   **STT:** Whisper (Small)
    *   **TTS:** Custom ONNX models (`pratham.onnx`, `model.onnx`)

---

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:
1.  **Python 3.10+**
2.  **Node.js 18+**
3.  **Ollama** (Running locally with `llama3.2` installed: `ollama run llama3.2`)
4.  *(Optional but Recommended)* NVIDIA GPU with CUDA for hardware-accelerated Whisper and ONNX inference.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yuviSA2002/Charlie.ai.git
    cd Charlie.ai
    ```

2.  **Setup the Python Backend:**
    ```bash
    # Create a virtual environment
    python -m venv venv
    
    # Activate the virtual environment (Windows)
    .\venv\Scripts\activate
    
    # Install Python dependencies
    pip install -r requirements.txt
    ```
    *(Note: Ensure you have `youtube-search`, `flask-socketio`, `faster-whisper`, `numpy`, and `sounddevice` installed).*

3.  **Setup the Next.js Frontend:**
    ```bash
    cd orb-ui
    npm install
    ```

---

## 💻 Running Charlie.ai

You need to start both the Python backend server and the Next.js frontend server simultaneously.

**Terminal 1 (Backend):**
```bash
cd Charlie.ai
.\venv\Scripts\activate
python charlie.py
```

**Terminal 2 (Frontend):**
```bash
cd Charlie.ai/orb-ui
npm run dev
```

Once both servers are running, open your browser and navigate to `http://localhost:3000`. Charlie is now online and listening for your wake word!

---

## 🔒 Privacy & Security First
Charlie is designed to be a strictly local agent.
- **No API Keys:** All weather and location utilities use open APIs requiring no authentication.
- **No Cloud Tracking:** The AI runs via local Ollama models.
- **No Git Memory Leaks:** Your personal conversations and Charlie's `memory.json` are heavily ignored by `.gitignore` to prevent accidental uploads.

---

## 🤝 Contributing
Feel free to open issues, fork the repository, and submit pull requests. Let's make Charlie even smarter together!
