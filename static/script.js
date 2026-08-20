const terminalOutput = document.getElementById('terminal-output');
const commandInput = document.getElementById('command-input');
const voiceBtn = document.getElementById('voice-btn');
const reactorContainer = document.querySelector('.reactor-container');
const coreStatus = document.querySelector('.core-status');
const visualizer = document.getElementById('visualizer');
const wakeWordToggle = document.getElementById('wake-word-toggle');
const wakeWordStatus = document.getElementById('wake-word-status');

// Initialize clock
function updateClock() {
    const now = new Date();
    // Indian Standard Time (IST) is Asia/Kolkata
    const timeString = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
    document.getElementById('clock').textContent = `IST ${timeString}`;
}
setInterval(updateClock, 1000);
updateClock();

// Initialize visualizer bars
const numBars = 20;
for (let i = 0; i < numBars; i++) {
    const bar = document.createElement('div');
    bar.className = 'vis-bar';
    bar.style.height = '10%';
    visualizer.appendChild(bar);
}
const bars = document.querySelectorAll('.vis-bar');

function animateVisualizer(isActive) {
    // Legacy simulated visualizer (used only for loading states)
    bars.forEach(bar => {
        if (isActive) {
            const h = Math.random() * 90 + 10;
            bar.style.height = `${h}%`;
        } else {
            bar.style.height = '10%';
        }
    });
}
let visInterval = setInterval(() => animateVisualizer(false), 100);

// --- REAL-TIME WEB AUDIO API VISUALIZER ---
let audioCtx = null;
let analyser = null;
let source = null;
let animationId = null;

async function playTTS(text) {
    if (!text) return;
    
    // Stop simulated visualizer
    clearInterval(visInterval);
    
    try {
        const response = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
        if (!response.ok) throw new Error('TTS fetch failed');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        const audio = new Audio(url);
        
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64; // Gives 32 frequency bins, we need 20 for the bars
        }
        
        // Resume AudioContext if suspended (browser autoplay policy)
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        
        // Disconnect old source if exists
        if (source) {
            source.disconnect();
        }
        
        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        function draw() {
            animationId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);
            
            bars.forEach((bar, index) => {
                // Map the 32 bins to our 20 bars
                let value = dataArray[index] || 0;
                let percent = Math.max(10, (value / 255) * 100);
                bar.style.height = `${percent}%`;
            });
        }
        
        audio.onended = () => {
            cancelAnimationFrame(animationId);
            bars.forEach(bar => bar.style.height = '10%');
            visInterval = setInterval(() => animateVisualizer(false), 100);
            URL.revokeObjectURL(url);
        };
        
        audio.play();
        draw();
        
    } catch (e) {
        console.error("Audio Playback Error:", e);
        visInterval = setInterval(() => animateVisualizer(false), 100);
    }
}

// Terminal logging function (with typing effect for AURA)
async function appendToTerminal(text, type = 'system') {
    if (!text) return; // guard against undefined/null
    
    // Clean up markdown
    text = text.replace(/\*\*(.*?)\*\*/g, '$1'); // bold
    text = text.replace(/(^|\n|\s)\*(?=\s)/g, '$1•'); // bullet points
    text = text.replace(/\*(.*?)\*/g, '$1'); // italics

    const div = document.createElement('div');
    
    if (type === 'user') {
        div.className = 'user-msg';
        div.textContent = `> ${text}`;
        terminalOutput.appendChild(div);
    } else if (type === 'error') {
        div.className = 'error-msg';
        div.textContent = `[ERROR] ${text}`;
        terminalOutput.appendChild(div);
    } else {
        // AURA typing effect
        div.className = 'aura-msg';
        terminalOutput.appendChild(div);
        
        // Disable input while typing
        commandInput.disabled = true;
        
        let i = 0;
        return new Promise(resolve => {
            function typeChar() {
                if (i < text.length) {
                    div.textContent += text.charAt(i);
                    i++;
                    terminalOutput.scrollTop = terminalOutput.scrollHeight;
                    setTimeout(typeChar, 10);
                } else {
                    commandInput.disabled = false;
                    commandInput.focus();
                    resolve();
                }
            }
            typeChar();
        });
    }
    
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Load Chat History
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const history = await response.json();
        
        // history is a plain array of {role, content}
        if (Array.isArray(history) && history.length > 0) {
            terminalOutput.innerHTML = '';
            
            for (const msg of history) {
                const div = document.createElement('div');
                if (msg.role === 'user') {
                    div.className = 'user-msg';
                    div.textContent = `> ${msg.content}`;
                } else {
                    div.className = 'aura-msg';
                    let content = msg.content || '';
                    content = content.replace(/\*\*(.*?)\*\*/g, '$1');
                    content = content.replace(/(^|\n|\s)\*(?=\s)/g, '$1•');
                    content = content.replace(/\*(.*?)\*/g, '$1');
                    div.textContent = content;
                }
                terminalOutput.appendChild(div);
            }
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Send Text Command
commandInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const text = commandInput.value.trim();
        if (!text) return;
        
        if (text.toLowerCase() === 'clear') {
            terminalOutput.innerHTML = '';
            commandInput.value = '';
            return;
        }
        
        if (text.toLowerCase() === 'diagnostics') {
            commandInput.value = '';
            appendToTerminal(text, 'user');
            await appendToTerminal('Running full system diagnostics...', 'system');
            await new Promise(r => setTimeout(r, 500));
            await appendToTerminal('Neural Mesh: INTEGRITY 100%', 'aura');
            await appendToTerminal('Sensor Array: ONLINE', 'aura');
            await appendToTerminal('Core Grid: STABLE', 'aura');
            return;
        }

        commandInput.value = '';
        commandInput.disabled = true;
        appendToTerminal(text, 'user');
        
        // Activate visualizer while waiting
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(true), 100);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });
            const data = await response.json();
            
            // Stop visualizer
            clearInterval(visInterval);
            visInterval = setInterval(() => animateVisualizer(false), 100);
            
            if (data.response) {
                // Fetch and play actual TTS audio while typing the text out
                playTTS(data.response);
                await appendToTerminal(data.response, 'aura');
            } else {
                appendToTerminal('No response received.', 'error');
            }
            
        } catch (error) {
            clearInterval(visInterval);
            visInterval = setInterval(() => animateVisualizer(false), 100);
            appendToTerminal('CONNECTION FAILED', 'error');
        }

        commandInput.disabled = false;
        commandInput.focus();
    }
});

// Voice Command
voiceBtn.addEventListener('click', async () => {
    if (reactorContainer.classList.contains('listening')) return;
    
    reactorContainer.classList.add('listening');
    coreStatus.textContent = 'LISTENING...';
    commandInput.disabled = true;
    
    // Activate visualizer
    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    try {
        const response = await fetch('/api/voice/listen', { method: 'POST' });
        const data = await response.json();
        
        // Reset reactor state
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;

        if (data.status === 'success') {
            if (data.transcription) {
                appendToTerminal(data.transcription, 'user');
                playTTS(data.response);
                await appendToTerminal(data.response, 'aura');
            } else {
                await appendToTerminal('No speech detected.', 'system');
            }
        } else {
            await appendToTerminal(data.message || 'VOICE ERROR', 'error');
        }
    } catch (error) {
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        appendToTerminal('MIC CONNECTION FAILED', 'error');
    }
});

// Init
setTimeout(loadHistory, 1500);

// --- Wake Word Logic ---
let wakeWordActive = false;
let wakeWordPaused = false;
let wakeRecognition = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    wakeRecognition = new SpeechRecognition();
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true; // Use interim results for faster trigger
    wakeRecognition.lang = 'en-US';

    wakeRecognition.onresult = async (event) => {
        if (!wakeWordActive) return;
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const rawTranscript = event.results[i][0].transcript.toLowerCase();
            const transcript = rawTranscript.replace(/[^a-z0-9\s]/g, '').trim();
            
            const wakeWordRegex = /(hey|hi|hello|ok|okay|hay)\s+(aura|ara|ora|laura|hera|arah|era)\b/i;
            let isWakeWord = false;
            let command = "";
            
            if (transcript.includes('hey aura')) {
                isWakeWord = true;
                command = transcript.substring(transcript.indexOf('hey aura') + 8).trim();
            } else {
                const match = transcript.match(wakeWordRegex);
                if (match) {
                    isWakeWord = true;
                    command = transcript.substring(match.index + match[0].length).trim();
                }
            }
                               
            if (isWakeWord && event.results[i].isFinal) {
                // Temporarily pause wake word listening so they don't clash
                wakeWordPaused = true;
                wakeRecognition.stop();
                
                if (command.length > 2) {
                    await handleFluentCommand(command);
                } else {
                    // Trigger the wake and listen cycle
                    await handleWakeWordTrigger();
                }
                break; // Stop processing further results in this batch
            }
        }
    };

    wakeRecognition.onerror = (event) => {
        if (event.error !== 'aborted' && wakeWordActive) {
            console.error('Wake word recognition error:', event.error);
            if (event.error === 'not-allowed') {
                appendToTerminal('Wake word error: Microphone permission denied.', 'error');
                wakeWordActive = false;
                wakeWordStatus.textContent = 'OFF';
                wakeWordStatus.className = 'status-idle';
                wakeWordToggle.style.boxShadow = 'none';
            } else if (event.error === 'network') {
                // Silent failure on network, will try to restart
            } else {
                appendToTerminal('Wake word error: ' + event.error, 'error');
            }
            
            // Try to restart if it failed and should be active
            setTimeout(() => {
                if (wakeWordActive) {
                    try { wakeRecognition.start(); } catch (e) {}
                }
            }, 1000);
        }
    };

    wakeRecognition.onend = () => {
        // Automatically restart if it ends (browsers sometimes kill continuous recognition)
        if (wakeWordActive && !wakeWordPaused) {
            try { wakeRecognition.start(); } catch (e) {}
        }
    };
}

wakeWordToggle.addEventListener('click', () => {
    if (!wakeRecognition) {
        appendToTerminal("Your browser does not support the Web Speech API required for Wake Word.", "error");
        return;
    }

    wakeWordActive = !wakeWordActive;
    
    if (wakeWordActive) {
        wakeWordStatus.textContent = 'ACTIVE';
        wakeWordStatus.className = 'status-active';
        wakeWordToggle.style.boxShadow = 'inset 0 0 10px rgba(0, 255, 255, 0.2)';
        try { wakeRecognition.start(); } catch(e) {}
        appendToTerminal('Wake word "Hey Aura" activated.', 'system');
    } else {
        wakeWordStatus.textContent = 'OFF';
        wakeWordStatus.className = 'status-idle';
        wakeWordToggle.style.boxShadow = 'none';
        try { wakeRecognition.stop(); } catch(e) {}
        appendToTerminal('Wake word deactivated.', 'system');
    }
});

async function handleFluentCommand(command) {
    if (reactorContainer.classList.contains('listening')) return;
    
    // UI Updates
    reactorContainer.classList.add('listening');
    coreStatus.textContent = 'PROCESSING...';
    commandInput.disabled = true;
    
    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    appendToTerminal('hey aura ' + command, 'user');

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: command, use_voice_output: true })
        });
        const data = await response.json();
        
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;

        if (data.response) {
            playTTS(data.response);
            await appendToTerminal(data.response, 'aura');
        } else {
            appendToTerminal('No response received.', 'error');
        }
    } catch (error) {
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        appendToTerminal('CONNECTION FAILED', 'error');
    }

    // Restart wake word recognition if still enabled
    wakeWordPaused = false;
    if (wakeWordActive) {
        try { wakeRecognition.start(); } catch(e) {}
    }
}

async function handleWakeWordTrigger() {
    if (reactorContainer.classList.contains('listening')) return;
    
    // UI Updates
    reactorContainer.classList.add('listening');
    coreStatus.textContent = 'LISTENING...';
    commandInput.disabled = true;
    
    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    appendToTerminal('hey aura', 'user');

    try {
        const response = await fetch('/api/voice/wake_and_listen', { method: 'POST' });
        const data = await response.json();
        
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;

        if (data.status === 'success') {
            if (data.transcription) {
                appendToTerminal(data.transcription, 'user');
                playTTS(data.response);
                await appendToTerminal(data.response, 'aura');
            } else {
                await appendToTerminal('No speech detected.', 'system');
            }
        } else {
            await appendToTerminal(data.message || 'VOICE ERROR', 'error');
        }
    } catch (error) {
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        appendToTerminal('WAKE WORD CONNECTION FAILED', 'error');
    }

    // Restart wake word recognition if still enabled
    wakeWordPaused = false;
    if (wakeWordActive) {
        try { wakeRecognition.start(); } catch(e) {}
    }
}

// --- Live Telemetry ---
async function updateTelemetry() {
    try {
        const response = await fetch('/api/telemetry');
        if (!response.ok) return;
        const data = await response.json();
        
        // Update Neural Load (CPU)
        document.getElementById('load-val').textContent = `${data.cpu}%`;
        document.querySelector('.diagnostics-panel .diag-item:nth-child(2) .diag-fill').style.width = `${data.cpu}%`;
        
        // Update Memory
        document.getElementById('mem-val').textContent = `${data.memory}%`;
        document.querySelector('.diagnostics-panel .diag-item:nth-child(3) .diag-fill').style.width = `${data.memory}%`;
        
        // Update Uplink
        const uplinkVal = document.getElementById('uplink-val');
        uplinkVal.textContent = `${data.uplink}%`;
        const uplinkFill = document.querySelector('.diagnostics-panel .diag-item:nth-child(4) .diag-fill');
        uplinkFill.style.width = `${data.uplink}%`;
        
        // Dynamic styling for uplink
        if (data.uplink < 50) {
            uplinkVal.className = 'warning-text';
            uplinkFill.className = 'diag-fill warning-fill';
        } else {
            uplinkVal.className = '';
            uplinkFill.className = 'diag-fill';
        }
        
        // Update Power Cell
        document.getElementById('power-val').textContent = `${data.power}%`;
        const powerFill = document.querySelector('.diagnostics-panel .diag-item:nth-child(5) .diag-fill');
        powerFill.style.width = `${data.power}%`;
        
        if (data.power <= 20) {
            document.getElementById('power-val').className = 'warning-text';
            powerFill.className = 'diag-fill warning-fill';
        } else {
            document.getElementById('power-val').className = '';
            powerFill.className = 'diag-fill';
        }
        
        // Update Bottom Right Telemetry Panel
        if (data.latency) {
            document.getElementById('latency-val').textContent = data.latency;
            document.getElementById('nodes-val').textContent = data.nodes;
            
            // Format tasks to be 2 digits (e.g. 07, or 145)
            const tasksStr = data.tasks < 10 ? `0${data.tasks}` : `${data.tasks}`;
            document.getElementById('tasks-val').textContent = tasksStr;
            
            document.getElementById('threats-val').textContent = data.threats;
        }

        // Update Hardware Thermals
        if (data.cpu_temp !== undefined) {
            document.getElementById('cpu-temp-val').textContent = `${data.cpu_temp} °C`;
            document.getElementById('cpu-fan-val').textContent = `${data.cpu_fan} RPM`;
            document.getElementById('gpu-temp-val').textContent = `${data.gpu_temp} °C`;
            document.getElementById('gpu-fan-val').textContent = data.gpu_fan;
            document.getElementById('gpu-mem-val').textContent = data.gpu_mem;
            
            // Add warning classes for high temps
            if (data.cpu_temp > 75) {
                document.getElementById('cpu-temp-val').className = 'status-active warning-text glow-text';
            } else {
                document.getElementById('cpu-temp-val').className = 'status-active glow-text';
            }
            if (data.gpu_temp > 80) {
                document.getElementById('gpu-temp-val').className = 'status-active warning-text glow-text';
            } else {
                document.getElementById('gpu-temp-val').className = 'status-active glow-text';
            }
        }
        
    } catch (error) {
        console.error("Failed to fetch telemetry", error);
    }
    setTimeout(updateTelemetry, 3000);
}

// Start polling
updateTelemetry();

// --- Notification Polling for Scheduled Briefings ---
async function pollNotifications() {
    try {
        const response = await fetch('/api/notifications');
        if (!response.ok) return;
        const data = await response.json();
        
        if (data.has_notification && data.message) {
            // AURA has sent a spontaneous message (e.g. morning briefing)
            playTTS(data.message);
            await appendToTerminal(data.message, 'aura');
        }
    } catch (e) {
        // Silent fail on network error
    }
}

// Check for notifications every 5 seconds
setInterval(pollNotifications, 5000);

// --- Header Navigation Buttons ---
document.getElementById('nav-systems')?.addEventListener('click', async () => {
    // Send a system status command behind the scenes
    await handleFluentCommand('give me a system status update');
});

document.getElementById('nav-modules')?.addEventListener('click', async () => {
    // Send a modules command behind the scenes
    await handleFluentCommand('list all available tools');
});

document.getElementById('nav-command')?.addEventListener('click', () => {
    // Focus the terminal input and scroll to it
    const cmdInput = document.getElementById('command-input');
    if (cmdInput) {
        cmdInput.focus();
        cmdInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
});

// --- Active Modules Buttons ---
document.getElementById('mod-voice')?.addEventListener('click', async () => {
    await handleFluentCommand('test voice core and sound output');
});

document.getElementById('mod-threat')?.addEventListener('click', async () => {
    await handleFluentCommand('run a basic threat scan on the system');
});

document.getElementById('mod-schedule')?.addEventListener('click', async () => {
    await handleFluentCommand('what is on my schedule?');
});

document.getElementById('mod-home')?.addEventListener('click', async () => {
    await handleFluentCommand('scan the home grid network');
});

document.getElementById('mod-archive')?.addEventListener('click', async () => {
    await handleFluentCommand('sync archive memory');
});
