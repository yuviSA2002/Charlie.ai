const socket = io();

const orb = document.getElementById('orb');
const statusText = document.getElementById('status-text');
const transcriptText = document.getElementById('transcript');

// Available states: idle, listening, thinking, speaking
function setOrbState(state, message = "") {
    // Remove all state classes
    orb.classList.remove('idle', 'listening', 'thinking', 'speaking');
    
    // Add new state class
    orb.classList.add(state);
    
    // Update text
    statusText.innerText = state.toUpperCase();
    
    if (message) {
        transcriptText.innerText = message;
        transcriptText.style.opacity = 1;
    }
}

socket.on('connect', () => {
    console.log('Connected to Charlie Backend');
    setOrbState('idle', 'Waiting for command...');
});

socket.on('disconnect', () => {
    console.log('Disconnected from Charlie Backend');
    setOrbState('idle', 'Backend Offline. Please start charlie.py');
    document.getElementById('status-text').innerText = "DISCONNECTED";
    document.getElementById('status-text').style.color = "red";
});

socket.on('state_change', (data) => {
    console.log("State changed to:", data.state);
    setOrbState(data.state, data.message);
});

socket.on('transcript', (data) => {
    transcriptText.innerText = `"${data.text}"`;
});
