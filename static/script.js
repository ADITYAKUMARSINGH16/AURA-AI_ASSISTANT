// ═══════════════════════════════════════════════════════════
// AUDIO ENGINE (Web Audio API Synthesizer)
// ═══════════════════════════════════════════════════════════
class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.ctx.destination);
    }
    
    playTyping() {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800 + Math.random() * 400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.05);
    }

    playHum() {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 55; // Deep bass hum
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        // subtle LFO for breathing effect
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.2; // slow breathe
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.02;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start();
    }

    playClick() {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }
}

let audioSys = null;

// Initialize Audio Engine on first interaction to comply with autoplay policies
document.addEventListener('click', () => {
    if (!audioSys) {
        audioSys = new AudioEngine();
        audioSys.playHum();
    }
}, { once: true });

// ═══════════════════════════════════════════════════════════
// UI & BOOT LOGIC
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    startBootSequence();
});

function startBootSequence() {
    const bootOverlay = document.getElementById('boot-overlay');
    const bootProgress = document.getElementById('boot-progress-bar');
    const bootLinesContainer = document.getElementById('boot-lines');
    
    const bootLines = [
        { text: '> AURA KERNEL v2.0 loading...', delay: 200 },
        { text: '> Neural mesh handshake ............... ', suffix: '<span class="bok">[OK]</span>', delay: 300 },
        { text: '> Voice core calibrated ............... ', suffix: '<span class="bok">[OK]</span>', delay: 250 },
        { text: '> Sensor array online ................. ', suffix: '<span class="bok">[OK]</span>', delay: 300 },
        { text: '> Threat assessment ................... ', suffix: '<span class="bok">[CLEAR]</span>', delay: 250 },
        { text: '> All subsystems nominal.', delay: 200 }
    ];
    
    let lineIndex = 0;
    
    function renderLine() {
        if (lineIndex >= bootLines.length) {
            if(bootProgress) bootProgress.style.width = '100%';
            setTimeout(() => {
                if(bootOverlay) {
                    bootOverlay.classList.add('dismissed');
                    setTimeout(() => bootOverlay.style.display = 'none', 500);
                }
                document.querySelectorAll('.hud-overlay').forEach((el, idx) => {
                    setTimeout(() => el.classList.add('visible'), idx * 300);
                });
                initParticles();
                animateOverlays();
            }, 500);
            return;
        }

        const l = bootLines[lineIndex];
        const div = document.createElement('div');
        div.className = 'bline';
        div.innerHTML = l.text + (l.suffix || '');
        if(bootLinesContainer) bootLinesContainer.appendChild(div);
        if(audioSys) audioSys.playTyping();

        if(bootProgress) bootProgress.style.width = ((lineIndex + 1) / bootLines.length * 100) + '%';
        
        lineIndex++;
        setTimeout(renderLine, l.delay);
    }
    
    // Total cinematic duration ~3s
    setTimeout(renderLine, 800);
}

// ═══════════════════════════════════════════════════════════
// PARTICLE CANVAS BACKGROUND
// ═══════════════════════════════════════════════════════════
function initParticles() {
    const canvas = document.getElementById('particle-bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    
    window.addEventListener('resize', () => {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    });

    let mouseX = w / 2;
    let mouseY = h / 2;
    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    const particles = [];
    const numParticles = 60;
    
    for(let i=0; i<numParticles; i++) {
        particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            radius: Math.random() * 2 + 1
        });
    }

    function animate() {
        requestAnimationFrame(animate);
        ctx.clearRect(0, 0, w, h);
        
        ctx.fillStyle = 'rgba(0, 240, 255, 0.3)';
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.1)';
        
        for(let i=0; i<numParticles; i++) {
            const p = particles[i];
            // Parallax offset
            const dxParallax = (mouseX - w / 2) * 0.005;
            const dyParallax = (mouseY - h / 2) * 0.005;
            
            p.x += p.vx + dxParallax;
            p.y += p.vy + dyParallax;
            
            if(p.x < 0) p.x = w;
            if(p.x > w) p.x = 0;
            if(p.y < 0) p.y = h;
            if(p.y > h) p.y = 0;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            
            for(let j=i+1; j<numParticles; j++) {
                const p2 = particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if(dist < 120) {
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
            
            // Magnetic repulsion from mouse
            const mdx = p.x - mouseX;
            const mdy = p.y - mouseY;
            const mDist = Math.sqrt(mdx*mdx + mdy*mdy);
            if (mDist < 150) {
                const force = (150 - mDist) / 150;
                p.x += (mdx / mDist) * force * 2;
                p.y += (mdy / mDist) * force * 2;
            }
        }
    }
    animate();
}

// ═══════════════════════════════════════════════════════════
// HUD OVERLAYS SCRAMBLE & GEOLOCATION
// ═══════════════════════════════════════════════════════════
function animateOverlays() {
    const lat = document.getElementById('hud-lat');
    const lng = document.getElementById('hud-lng');
    let targetLat = '28.6139° N';
    let targetLng = '77.2090° E';
    
    // Attempt Geolocation
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const latNum = Math.abs(pos.coords.latitude).toFixed(4);
                const lngNum = Math.abs(pos.coords.longitude).toFixed(4);
                const latDir = pos.coords.latitude >= 0 ? 'N' : 'S';
                const lngDir = pos.coords.longitude >= 0 ? 'E' : 'W';
                targetLat = `${latNum}° ${latDir}`;
                targetLng = `${lngNum}° ${lngDir}`;
                scramble(lat, targetLat, 1000);
                scramble(lng, targetLng, 1000);
            },
            (err) => console.warn("Geolocation blocked/failed, using fallback.")
        );
    }
    
    function scramble(el, targetStr, duration) {
        if (!el) return;
        const chars = '0123456789°NSWE';
        let iterations = 0;
        const maxIterations = duration / 30;
        
        const interval = setInterval(() => {
            el.innerText = targetStr.split('').map((char, index) => {
                if(index < (iterations / maxIterations) * targetStr.length) return targetStr[index];
                if(char === ' ' || char === '.') return char;
                return chars[Math.floor(Math.random() * chars.length)];
            }).join('');
            
            if(iterations >= maxIterations) {
                clearInterval(interval);
                el.innerText = targetStr;
            }
            iterations++;
        }, 30);
    }
    
    setTimeout(() => scramble(lat, targetLat, 1000), 200);
    setTimeout(() => scramble(lng, targetLng, 1000), 400);
}

const terminalOutput = document.getElementById('terminal-output');
const chatOutput = document.getElementById('chat-output');
const commandInput = document.getElementById('command-input');
const voiceBtn = document.getElementById('voice-btn');
const reactorContainer = document.querySelector('.reactor-container');
const coreStatus = document.querySelector('.core-status');
const visualizer = document.getElementById('visualizer');
const wakeWordToggle = document.getElementById('wake-word-toggle');
const wakeWordStatus = document.getElementById('wake-word-status');

// Toggle between Terminal and Chat modes
let currentMode = 'terminal';
const btnModeTerm = document.getElementById('btn-mode-term');
const btnModeChat = document.getElementById('btn-mode-chat');

btnModeTerm.addEventListener('click', () => {
    currentMode = 'terminal';
    btnModeTerm.classList.add('active');
    btnModeChat.classList.remove('active');
    terminalOutput.style.display = 'flex';
    chatOutput.style.display = 'none';
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
});

btnModeChat.addEventListener('click', () => {
    currentMode = 'chat';
    btnModeChat.classList.add('active');
    btnModeTerm.classList.remove('active');
    chatOutput.style.display = 'flex';
    terminalOutput.style.display = 'none';
    chatOutput.scrollTop = chatOutput.scrollHeight;
});

// Initialize clock
function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
    const clk = document.getElementById('hud-sys-clock');
    if(clk) {
        clk.textContent = timeString;
        clk.classList.add('flash-cyan');
        setTimeout(() => clk.classList.remove('flash-cyan'), 150);
    }
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════════════════════
// NOTIFICATION TOASTS
// ═══════════════════════════════════════════════════════════
const toastContainer = document.getElementById('toast-container');

function showToast(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : ''}`;
    
    toast.innerHTML = `
        <div class="toast-title">${title}</div>
        <div class="toast-msg">${message}</div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Auto dismiss
    setTimeout(() => {
        toast.style.animation = 'toast-slide-out 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
    
    // Click to dismiss
    toast.addEventListener('click', () => {
        toast.style.animation = 'toast-slide-out 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 300);
    });
}

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
const modalOverlay = document.getElementById('shortcuts-modal');
const btnShortcuts = document.getElementById('btn-shortcuts');
const btnCloseShortcuts = document.getElementById('close-shortcuts');

function toggleShortcuts() {
    modalOverlay.classList.toggle('active');
}

btnShortcuts.addEventListener('click', toggleShortcuts);
btnCloseShortcuts.addEventListener('click', () => modalOverlay.classList.remove('active'));

document.addEventListener('keydown', (e) => {
    // ESC to close modal
    if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
        modalOverlay.classList.remove('active');
        return;
    }
    
    // Ctrl + L: Clear terminal/chat
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        terminalOutput.innerHTML = '';
        chatOutput.innerHTML = '';
        showToast('SYSTEM', 'Console cleared.', 'info');
    }
    
    // Ctrl + M: Toggle Voice Core
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        voiceBtn.click();
    }
});

// ═══════════════════════════════════════════════════════════
// WAVEFORM VISUALIZER
// ═══════════════════════════════════════════════════════════
const numBars = 20;
for (let i = 0; i < numBars; i++) {
    const bar = document.createElement('div');
    bar.className = 'vis-bar';
    bar.style.height = '10%';
    bar.style.animationDelay = `${i * 0.05}s`;
    visualizer.appendChild(bar);
}
const bars = document.querySelectorAll('.vis-bar');

function animateVisualizer(isActive) {
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

let audioCtx = null;
let analyser = null;
let source = null;
let animationId = null;
let currentAudio = null;

async function playTTS(text) {
    if (!text) return;
    
    clearInterval(visInterval);
    
    try {
        await fetch('/api/voice/speaking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_speaking: true})
        });

        const response = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
        if (!response.ok) throw new Error('TTS fetch failed');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        if (currentAudio) {
            currentAudio.pause();
        }
        const audio = new Audio(url);
        currentAudio = audio;
        
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
        }
        
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        if (source) source.disconnect();
        
        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        function draw() {
            animationId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);
            
            bars.forEach((bar, index) => {
                let value = dataArray[index] || 0;
                let percent = Math.max(10, (value / 255) * 100);
                bar.style.height = `${percent}%`;
            });
        }
        
        audio.onended = async () => {
            cancelAnimationFrame(animationId);
            bars.forEach(bar => bar.style.height = '10%');
            visInterval = setInterval(() => animateVisualizer(false), 100);
            URL.revokeObjectURL(url);
            currentAudio = null;
            await fetch('/api/voice/speaking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({is_speaking: false})
            });
            // Check if we should continue conversation
            if (window._continueConversation) {
                window._continueConversation = false;
                voiceBtn.click();
            }
        };
        
        audio.play();
        draw();
        
    } catch (e) {
        console.error("Audio Playback Error:", e);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        await fetch('/api/voice/speaking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_speaking: false})
        });
    }
}

// ═══════════════════════════════════════════════════════════
// CHAT & TERMINAL LOGIC
// ═══════════════════════════════════════════════════════════
async function appendToTerminal(text, type = 'system') {
    if (!text) return;
    

    text = text.replace(/\*\*(.*?)\*\*/g, '$1');
    text = text.replace(/(^|\n|\s)\*(?=\s)/g, '$1•');
    text = text.replace(/\*(.*?)\*/g, '$1');

    // 1. Append to Terminal View
    const termDiv = document.createElement('div');
    if (type === 'user') {
        termDiv.className = 'user-msg';
        termDiv.textContent = `> ${text}`;
    } else if (type === 'error') {
        termDiv.className = 'error-msg';
        termDiv.textContent = `[ERROR] ${text}`;
    } else {
        termDiv.className = 'aura-msg';
        termDiv.textContent = text;
    }
    terminalOutput.appendChild(termDiv);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;

    // 2. Append to Chat View
    if (type !== 'system' || true) { // Also show system msgs in chat for continuity
        const chatDiv = document.createElement('div');
        chatDiv.className = `chat-bubble bubble-${type === 'error' ? 'error' : type === 'user' ? 'user' : 'aura'}`;
        chatDiv.textContent = text;
        chatOutput.appendChild(chatDiv);
        chatOutput.scrollTop = chatOutput.scrollHeight;
    }
}

async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const history = await response.json();
        
        if (Array.isArray(history) && history.length > 0) {
            terminalOutput.innerHTML = '';
            chatOutput.innerHTML = '';
            
            for (const msg of history) {
                let content = msg.content || '';
                await appendToTerminal(content, msg.role === 'user' ? 'user' : 'aura');
            }
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// ═══════════════════════════════════════════════════════════
// COMMAND INPUT & VOICE & ATTACHMENTS
// ═══════════════════════════════════════════════════════════

const btnAttach = document.getElementById('btn-attach');
const fileUpload = document.getElementById('file-upload');
const attachmentPreview = document.getElementById('attachment-preview');
let pendingAttachments = { images: [], file_texts: [] };

if(btnAttach && fileUpload) {
    btnAttach.addEventListener('click', () => fileUpload.click());
    
    fileUpload.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for(let file of files) {
            if(file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const b64 = ev.target.result.split(',')[1];
                    pendingAttachments.images.push(b64);
                    rebuildAttachmentPreview();
                };
                reader.readAsDataURL(file);
            } else {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    pendingAttachments.file_texts.push({ name: file.name, content: ev.target.result });
                    rebuildAttachmentPreview();
                };
                reader.readAsText(file);
            }
        }
        fileUpload.value = ''; // Reset
    });
}

function rebuildAttachmentPreview() {
    if(!attachmentPreview) return;
    attachmentPreview.innerHTML = '';
    pendingAttachments.images.forEach((b64, i) => {
        const pill = document.createElement('div');
        pill.className = 'attach-pill';
        pill.innerHTML = `<img src="data:image/jpeg;base64,${b64}"> <span>Image</span> <button class="attach-remove" data-type="image" data-index="${i}">×</button>`;
        attachmentPreview.appendChild(pill);
        pill.querySelector('.attach-remove').addEventListener('click', () => {
            pendingAttachments.images.splice(i, 1);
            rebuildAttachmentPreview();
        });
    });
    pendingAttachments.file_texts.forEach((fileObj, i) => {
        const pill = document.createElement('div');
        pill.className = 'attach-pill';
        pill.innerHTML = `📄 <span>${fileObj.name}</span> <button class="attach-remove" data-type="text" data-index="${i}">×</button>`;
        attachmentPreview.appendChild(pill);
        pill.querySelector('.attach-remove').addEventListener('click', () => {
            pendingAttachments.file_texts.splice(i, 1);
            rebuildAttachmentPreview();
        });
    });
}

function clearAttachments() {
    pendingAttachments = { images: [], file_texts: [] };
    if(attachmentPreview) attachmentPreview.innerHTML = '';
}
commandInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const text = commandInput.value.trim();
        if (!text) return;
        
        if (text.toLowerCase() === 'clear') {
            terminalOutput.innerHTML = '';
            chatOutput.innerHTML = '';
            commandInput.value = '';
            return;
        }

        commandInput.value = '';
        commandInput.disabled = true;
        await appendToTerminal(text, 'user');
        
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(true), 100);

        try {
            const payload = { 
                message: text,
                images: pendingAttachments.images.length > 0 ? pendingAttachments.images : null,
                file_texts: pendingAttachments.file_texts.length > 0 ? pendingAttachments.file_texts : null
            };
            clearAttachments();

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            
            clearInterval(visInterval);
            visInterval = setInterval(() => animateVisualizer(false), 100);
            
            if (data.response) {
                playTTS(data.response);
                await appendToTerminal(data.response, 'aura');
            } else {
                await appendToTerminal('No response received.', 'error');
            }
        } catch (error) {
            clearInterval(visInterval);
            visInterval = setInterval(() => animateVisualizer(false), 100);
            await appendToTerminal('CONNECTION FAILED', 'error');
            showToast('CONNECTION ERROR', 'Failed to reach backend.', 'error');
        }

        commandInput.disabled = false;
        commandInput.focus();
    }
});

voiceBtn.addEventListener('click', async () => {
    // If already playing audio, stop it (barge-in)
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.dispatchEvent(new Event('ended')); // Trigger cleanup
        fetch('/api/voice/stop', { method: 'POST' });
    }

    if (reactorContainer.classList.contains('listening')) return;
    
    reactorContainer.classList.add('listening');
    coreStatus.textContent = 'LISTENING...';
    commandInput.disabled = true;
    showToast('MIC ACTIVE', 'Voice core listening...', 'info');
    
    // Start Live Mic Visualization
    startMicVisualization();
    
    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    try {
        const response = await fetch('/api/voice/listen', { method: 'POST' });
        const data = await response.json();
        
        reactorContainer.classList.remove('listening');
        stopMicVisualization();
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;

        if (data.status === 'success') {
            if (data.transcription) {
                await appendToTerminal(data.transcription, 'user');
                window._continueConversation = data.continue || false;
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
        stopMicVisualization();
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        await appendToTerminal('MIC CONNECTION FAILED', 'error');
    }
});

// Live Mic Visualization Logic
let micStream = null;
let micAudioCtx = null;
let micAnalyser = null;
let micDataArray = null;
let micAnimFrame = null;

async function startMicVisualization() {
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = micAudioCtx.createMediaStreamSource(micStream);
        micAnalyser = micAudioCtx.createAnalyser();
        micAnalyser.fftSize = 64; // Match TTS fftSize for bar counts
        source.connect(micAnalyser);
        micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
        
        const soundWave = document.querySelector('.sound-wave');
        function renderMic() {
            if(!reactorContainer.classList.contains('listening')) return;
            micAnimFrame = requestAnimationFrame(renderMic);
            micAnalyser.getByteFrequencyData(micDataArray);
            
            // Draw to the waveform panel bars
            bars.forEach((bar, index) => {
                let value = micDataArray[index] || 0;
                let percent = Math.max(10, (value / 255) * 100);
                bar.style.height = `${percent}%`;
            });

            let sum = 0;
            for(let i=0; i<micDataArray.length; i++) sum += micDataArray[i];
            let avg = sum / micDataArray.length;
            let scale = 1 + (avg / 255) * 0.8; // Scale up to 1.8x
            
            // Adjust the CSS animation intensity based on volume
            if (soundWave) {
                soundWave.style.transform = `scale(${scale})`;
                soundWave.style.borderColor = `rgba(255, 51, 85, ${0.5 + (avg/255)*0.5})`;
            }
        }
        renderMic();
    } catch(err) {
        console.warn("Mic visualization failed, falling back to CSS", err);
    }
}

function stopMicVisualization() {
    if (micAnimFrame) cancelAnimationFrame(micAnimFrame);
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (micAudioCtx && micAudioCtx.state !== 'closed') micAudioCtx.close();
    
    // Reset waveform bars
    bars.forEach(bar => bar.style.height = '10%');
    
    const soundWave = document.querySelector('.sound-wave');
    if (soundWave) {
        soundWave.style.transform = '';
        soundWave.style.borderColor = '';
    }
}

// ═══════════════════════════════════════════════════════════
// SYSTEM CHARTS LOGIC
// ═══════════════════════════════════════════════════════════
const historySize = 30;
const chartData = {
    cpu: Array(historySize).fill(0),
    mem: Array(historySize).fill(0),
    net: Array(historySize).fill(0)
};

function drawChart(canvasId, dataArray, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Fit canvas to element size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    ctx.beginPath();
    ctx.moveTo(0, h);
    
    const step = w / (historySize - 1);
    
    for(let i = 0; i < historySize; i++) {
        const val = dataArray[i]; // 0 to 100
        const x = i * step;
        const y = h - (val / 100 * h);
        
        ctx.lineTo(x, y);
    }
    
    ctx.lineTo(w, h);
    ctx.closePath();
    
    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Stroke line
    ctx.beginPath();
    for(let i = 0; i < historySize; i++) {
        const val = dataArray[i];
        const x = i * step;
        const y = h - (val / 100 * h);
        if(i===0) ctx.moveTo(x,y);
        else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

// ═══════════════════════════════════════════════════════════
// LIVE TELEMETRY
// ═══════════════════════════════════════════════════════════
async function updateTelemetry() {
    try {
        const response = await fetch('/api/telemetry');
        if (!response.ok) return;
        const data = await response.json();
        
        // Update raw numbers left panel
        document.getElementById('load-val').textContent = `${data.cpu}%`;
        document.querySelector('.diagnostics-panel .diag-item:nth-child(2) .diag-fill').style.width = `${data.cpu}%`;
        
        document.getElementById('mem-val').textContent = `${data.memory}%`;
        document.querySelector('.diagnostics-panel .diag-item:nth-child(3) .diag-fill').style.width = `${data.memory}%`;
        
        // Update UPLINK block in hud-tr
        const uplinkVal = document.getElementById('hud-signal');
        if(uplinkVal) {
            let sigStr = "";
            let p = Math.round((data.uplink / 100) * 8);
            for(let i=0; i<8; i++) sigStr += (i<p) ? "█" : "░";
            uplinkVal.textContent = sigStr + ` ${data.uplink}%`;
        }
        
        const diagUplinkFill = document.querySelector('.diagnostics-panel .diag-item:nth-child(4) .diag-fill');
        if(diagUplinkFill) diagUplinkFill.style.width = `${data.uplink}%`;
        
        document.getElementById('power-val').textContent = `${data.power}%`;
        document.querySelector('.diagnostics-panel .diag-item:nth-child(5) .diag-fill').style.width = `${data.power}%`;
        
        // Update Thermals Panel
        if(data.cpu_temp !== undefined) {
            document.getElementById('cpu-temp-val').textContent = `${data.cpu_temp}°C`;
            const cpuTempFill = document.getElementById('cpu-temp-fill');
            if(cpuTempFill) {
                cpuTempFill.style.width = `${Math.min(100, data.cpu_temp)}%`;
                cpuTempFill.style.background = data.cpu_temp > 85 ? 'var(--error)' : data.cpu_temp > 70 ? 'var(--purple)' : 'var(--cyan)';
            }
        }
        
        if(data.cpu_fan !== undefined) {
            document.getElementById('cpu-fan-val').textContent = `${data.cpu_fan} RPM`;
            const cpuFanFill = document.getElementById('cpu-fan-fill');
            if(cpuFanFill) cpuFanFill.style.width = `${Math.min(100, (data.cpu_fan / 5000) * 100)}%`;
        }
        
        if(data.gpu_temp !== undefined) {
            document.getElementById('gpu-temp-val').textContent = `${data.gpu_temp}°C`;
            const gpuTempFill = document.getElementById('gpu-temp-fill');
            if(gpuTempFill) {
                gpuTempFill.style.width = `${Math.min(100, data.gpu_temp)}%`;
                gpuTempFill.style.background = data.gpu_temp > 85 ? 'var(--error)' : data.gpu_temp > 70 ? 'var(--purple)' : 'var(--cyan)';
            }
        }
        
        if(data.gpu_mem !== undefined) {
            document.getElementById('gpu-mem-val').textContent = data.gpu_mem;
            // Rough parsing of "X / Y MB" to get a percentage
            let memParts = data.gpu_mem.split('/');
            if(memParts.length === 2) {
                let used = parseInt(memParts[0]);
                let total = parseInt(memParts[1]);
                if(!isNaN(used) && !isNaN(total) && total > 0) {
                    const gpuMemFill = document.getElementById('gpu-mem-fill');
                    if(gpuMemFill) gpuMemFill.style.width = `${(used/total)*100}%`;
                }
            }
        }
        
        if(data.gpu_fan !== undefined) {
            document.getElementById('gpu-fan-val').textContent = data.gpu_fan;
        }
        
        // Update Chart Data
        chartData.cpu.push(data.cpu); chartData.cpu.shift();
        chartData.mem.push(data.memory); chartData.mem.shift();
        
        // Fake network latency volatility for chart aesthetics
        let latencyVal = parseInt(data.latency.replace('ms',''));
        if(isNaN(latencyVal)) latencyVal = 10;
        let fakeNetLoad = Math.min(100, Math.max(0, latencyVal * 2 + (Math.random()*20 - 10)));
        chartData.net.push(fakeNetLoad); chartData.net.shift();
        
        // Draw Charts
        document.getElementById('chart-cpu-val').textContent = `${data.cpu}%`;
        drawChart('chart-cpu', chartData.cpu, '#00f0ff'); // cyan
        
        document.getElementById('chart-mem-val').textContent = `${data.memory}%`;
        drawChart('chart-mem', chartData.mem, '#a855f7'); // purple
        
        document.getElementById('chart-net-val').textContent = data.latency;
        drawChart('chart-net', chartData.net, '#00ff88'); // green
        
    } catch (error) {
        console.error("Failed to fetch telemetry", error);
    }
    setTimeout(updateTelemetry, 3000);
}

// ═══════════════════════════════════════════════════════════
// THREAT DETECTION
// ═══════════════════════════════════════════════════════════
async function fetchThreats() {
    try {
        const res = await fetch('/api/threats');
        if (res.ok) {
            const data = await res.json();
            const box = document.getElementById('threat-box');
            const val = document.getElementById('threat-val');
            const msg = document.getElementById('threat-msg');
            
            if(data.status === 'ELEVATED') {
                if(val.textContent !== 'ELEVATED') {
                    showToast('SECURITY ALERT', 'Anomalous login activity detected!', 'error');
                    if(box) {
                        box.style.borderColor = 'var(--error)';
                        box.style.boxShadow = '0 0 20px var(--error)';
                    }
                    if(val) {
                        val.textContent = 'ELEVATED';
                        val.style.color = 'var(--error)';
                    }
                }
            } else {
                if(box) {
                    box.style.borderColor = '';
                    box.style.boxShadow = '';
                }
                if(val) {
                    val.textContent = 'CLEAR';
                    val.style.color = 'var(--cyan)';
                }
            }
            if(msg) msg.textContent = data.message;
        }
    } catch(e) {}
    setTimeout(fetchThreats, 10000);
}

// ═══════════════════════════════════════════════════════════
// QUICK ACTIONS
// ═══════════════════════════════════════════════════════════
async function handleFluentCommand(command) {
    if (reactorContainer.classList.contains('listening')) return;
    
    reactorContainer.classList.add('listening');
    coreStatus.textContent = 'PROCESSING...';
    commandInput.disabled = true;
    
    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    await appendToTerminal(`[SYSTEM ACTION] ${command}`, 'user');

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
            
            // If the command was to read screen, refresh the thumbnail
            if (command.includes('read my screen')) {
                const img = document.getElementById('screen-preview-img');
                const span = document.querySelector('#screen-preview-container span');
                if(img) {
                    img.src = `/captures/last_screen.png?t=${new Date().getTime()}`;
                    img.style.display = 'block';
                    if(span) span.style.display = 'none';
                }
            }
        } else {
            await appendToTerminal('No response received.', 'error');
        }
    } catch (error) {
        reactorContainer.classList.remove('listening');
        coreStatus.textContent = 'ONLINE';
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        await appendToTerminal('CONNECTION FAILED', 'error');
    }
}

document.getElementById('qa-read-screen').addEventListener('click', () => handleFluentCommand('read my screen'));
document.getElementById('qa-lock').addEventListener('click', () => handleFluentCommand('lock the system'));
document.getElementById('qa-web').addEventListener('click', () => handleFluentCommand('search the web for the latest news'));
document.getElementById('qa-scan').addEventListener('click', () => handleFluentCommand('run a basic threat scan on the system'));

// Media Control Fake Bindings (Since API might not be fully configured)
document.getElementById('sp-play').addEventListener('click', () => handleFluentCommand('toggle media playback'));
document.getElementById('sp-next').addEventListener('click', () => handleFluentCommand('play next track'));
document.getElementById('sp-prev').addEventListener('click', () => handleFluentCommand('play previous track'));

// Ripple Effect
document.querySelectorAll('.qa-btn, .sp-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        let ripple = document.createElement('span');
        ripple.className = 'ripple';
        this.appendChild(ripple);
        let rect = this.getBoundingClientRect();
        let size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = e.clientX - rect.left - size/2 + 'px';
        ripple.style.top = e.clientY - rect.top - size/2 + 'px';
        setTimeout(() => ripple.remove(), 600);
    });
});

// Lightbox logic
document.getElementById('screen-preview-container')?.addEventListener('click', () => {
    const img = document.getElementById('screen-preview-img');
    const lightbox = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-img');
    if (img && img.style.display !== 'none' && lightbox && lightboxImg) {
        lightboxImg.src = img.src;
        lightbox.style.display = 'flex';
    }
});
document.getElementById('lightbox-overlay')?.addEventListener('click', function() {
    this.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════
// DRAG AND DROP PANELS
// ═══════════════════════════════════════════════════════════
const panels = document.querySelectorAll('.panel[draggable="true"]');
const columns = document.querySelectorAll('.left-col, .right-col');
let draggedPanel = null;

panels.forEach(panel => {
    panel.addEventListener('dragstart', function(e) {
        draggedPanel = this;
        setTimeout(() => this.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
    });
    
    panel.addEventListener('dragend', function() {
        draggedPanel = null;
        this.classList.remove('dragging');
    });
});

columns.forEach(col => {
    col.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if(!draggedPanel) return;
        
        // Find the panel we are hovering over
        const afterElement = getDragAfterElement(col, e.clientY);
        if (afterElement == null) {
            col.appendChild(draggedPanel);
        } else {
            col.insertBefore(draggedPanel, afterElement);
        }
    });
});

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.panel:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ═══════════════════════════════════════════════════════════
// THEME SWITCHER
// ═══════════════════════════════════════════════════════════
const themeDots = document.querySelectorAll('.theme-dot');
const savedTheme = localStorage.getItem('aura-theme');
if (savedTheme) {
    document.documentElement.className = savedTheme;
}

themeDots.forEach(dot => {
    // highlight selected dot
    if(dot.dataset.theme === (savedTheme || "")) {
        dot.style.borderColor = getComputedStyle(dot).backgroundColor;
    }

    dot.addEventListener('click', function() {
        const theme = this.dataset.theme;
        document.documentElement.className = theme;
        localStorage.setItem('aura-theme', theme);
        
        themeDots.forEach(d => {
            if(d === this) {
                d.style.borderColor = getComputedStyle(d).backgroundColor;
            } else {
                d.style.borderColor = 'transparent';
            }
        });
    });
});

// ═══════════════════════════════════════════════════════════
// SCHEDULE & REMINDERS
// ═══════════════════════════════════════════════════════════
async function fetchSchedule() {
    try {
        const res = await fetch('/api/schedule');
        if(!res.ok) return;
        const data = await res.json();
        
        const list = document.getElementById('schedule-list');
        if(!list) return;
        list.innerHTML = '';
        
        if (data.length === 0) {
            list.innerHTML = '<div style="font-size: 10px; color: var(--text-dim);">No scheduled events.</div>';
        } else {
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'schedule-item';
                div.innerHTML = `<span>${item.time}</span><span>${item.event}</span>`;
                list.appendChild(div);
            });
        }
    } catch(e) {}
    setTimeout(fetchSchedule, 30000);
}

document.getElementById('btn-add-sched')?.addEventListener('click', async () => {
    const time = document.getElementById('sched-time').value.trim();
    const event = document.getElementById('sched-event').value.trim();
    if(!time || !event) return;
    
    try {
        const res = await fetch('/api/schedule', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({time, event})
        });
        const data = await res.json();
        if(data.status === 'success') {
            document.getElementById('sched-time').value = '';
            document.getElementById('sched-event').value = '';
            showToast('SCHEDULE UPDATED', `Added: ${event}`, 'info');
            fetchSchedule();
        }
    } catch(e) {}
});

// ═══════════════════════════════════════════════════════════
// MEMORY VIEWER
// ═══════════════════════════════════════════════════════════
let memoryCache = {};

async function fetchMemory() {
    try {
        const res = await fetch('/api/memory');
        if(!res.ok) return;
        memoryCache = await res.json();
        renderMemory();
    } catch(e) {}
}

function renderMemory() {
    const list = document.getElementById('memory-list');
    const search = document.getElementById('memory-search');
    if(!list || !search) return;
    
    const query = search.value.toLowerCase();
    list.innerHTML = '';
    
    const keys = Object.keys(memoryCache).filter(k => 
        k.toLowerCase().includes(query) || 
        String(memoryCache[k]).toLowerCase().includes(query)
    );
    
    if (keys.length === 0) {
        list.innerHTML = '<div style="font-size: 10px; color: var(--text-dim);">Archive is empty or no match.</div>';
    } else {
        keys.forEach(k => {
            const div = document.createElement('div');
            div.className = 'memory-item';
            div.innerHTML = `
                <div class="memory-key">${k}</div>
                <div class="memory-val">${memoryCache[k]}</div>
                <div class="memory-del" data-key="${k}">×</div>
            `;
            list.appendChild(div);
        });
        
        // Bind delete buttons
        document.querySelectorAll('.memory-del').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const key = e.target.dataset.key;
                try {
                    const res = await fetch(`/api/memory/${encodeURIComponent(key)}`, {method: 'DELETE'});
                    if(res.ok) {
                        delete memoryCache[key];
                        renderMemory();
                        showToast('MEMORY PURGED', `Key: ${key}`, 'warning');
                    }
                } catch(err) {}
            });
        });
    }
}

document.getElementById('memory-search')?.addEventListener('input', renderMemory);

// ═══════════════════════════════════════════════════════════
// NETWORK GRID LOGIC
// ═══════════════════════════════════════════════════════════
let networkNodes = [];
async function fetchNetworkScan() {
    try {
        const btn = document.getElementById('btn-net-scan');
        if(btn) btn.textContent = 'SCANNING...';
        const res = await fetch('/api/network/scan');
        if(!res.ok) throw new Error();
        const data = await res.json();
        
        networkNodes = data.nodes || [];
        renderNetworkCanvas();
        if(btn) btn.textContent = 'SCAN';
    } catch(e) {
        const btn = document.getElementById('btn-net-scan');
        if(btn) btn.textContent = 'SCAN';
    }
}

function renderNetworkCanvas() {
    const canvas = document.getElementById('network-canvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Fit canvas to element size
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
    
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    ctx.clearRect(0, 0, w, h);
    
    // Draw radar rings
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.lineWidth = 1;
    for(let r=20; r<100; r+=25) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.stroke();
    }
    
    // Draw central node (PC)
    ctx.fillStyle = 'var(--cyan)';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'var(--cyan)';
    
    // Draw discovered nodes
    const computedStyle = getComputedStyle(document.documentElement);
    const purple = computedStyle.getPropertyValue('--purple').trim() || '#a855f7';
    
    ctx.shadowBlur = 5;
    ctx.shadowColor = purple;
    
    networkNodes.forEach((node, i) => {
        // Distribute in a circle
        const angle = (i / networkNodes.length) * Math.PI * 2;
        const dist = 30 + Math.random() * 50;
        const nx = cx + Math.cos(angle) * dist;
        const ny = cy + Math.sin(angle) * dist;
        
        // Draw line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)'; // dim purple
        ctx.stroke();
        
        // Draw node
        ctx.beginPath();
        ctx.arc(nx, ny, 3, 0, Math.PI*2);
        ctx.fillStyle = purple;
        ctx.fill();
        
        // Draw IP text
        ctx.font = '8px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.shadowBlur = 0;
        ctx.fillText(node.ip, nx + 5, ny + 3);
    });
}

document.getElementById('btn-net-scan')?.addEventListener('click', fetchNetworkScan);
window.addEventListener('resize', () => { if(networkNodes.length) renderNetworkCanvas(); });

// ═══════════════════════════════════════════════════════════
// PROCESS MANAGER
// ═══════════════════════════════════════════════════════════
async function fetchProcesses() {
    try {
        const res = await fetch('/api/processes');
        if(!res.ok) return;
        const data = await res.json();
        
        const list = document.getElementById('process-list');
        if(!list) return;
        list.innerHTML = '';
        
        if (data.processes && data.processes.length > 0) {
            data.processes.forEach(p => {
                const div = document.createElement('div');
                div.className = 'process-item';
                div.innerHTML = `
                    <div class="process-info">
                        <span class="process-name">${p.name} (PID: ${p.pid})</span>
                        <span class="process-stats">CPU: ${p.cpu.toFixed(1)}% | MEM: ${p.mem.toFixed(1)}%</span>
                    </div>
                    <button class="btn-kill" data-pid="${p.pid}">KILL</button>
                `;
                list.appendChild(div);
            });
            
            // Bind kill buttons
            document.querySelectorAll('.btn-kill').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const pid = e.target.dataset.pid;
                    try {
                        const kRes = await fetch('/api/processes/kill', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({pid: parseInt(pid)})
                        });
                        const kData = await kRes.json();
                        if(kData.status === 'success') {
                            showToast('PROCESS TERMINATED', `PID: ${pid}`, 'warning');
                            fetchProcesses(); // refresh list immediately
                        } else {
                            showToast('TERMINATION FAILED', kData.message, 'error');
                        }
                    } catch(err) {}
                });
            });
        }
    } catch(e) {}
    setTimeout(fetchProcesses, 5000);
}

// Init
setTimeout(loadHistory, 1500);
updateTelemetry();
fetchSchedule();
fetchMemory();
fetchNetworkScan();
fetchProcesses();

// ═══════════════════════════════════════════════════════════
// WAKE WORD & NOTIFICATIONS 
// ═══════════════════════════════════════════════════════════
const notifDrawer = document.getElementById('notif-drawer');
const notifBell = document.getElementById('notif-bell');
const notifBadge = document.getElementById('notif-badge');
const notifList = document.getElementById('notif-list');
let unreadNotifs = 0;

notifBell?.addEventListener('click', () => {
    notifDrawer?.classList.add('open');
    unreadNotifs = 0;
    if(notifBadge) {
        notifBadge.style.display = 'none';
        notifBadge.textContent = '0';
    }
});

document.getElementById('close-drawer')?.addEventListener('click', () => {
    notifDrawer?.classList.remove('open');
});

// ═══════════════════════════════════════════════════════════
// NOTIFICATION POLLING
// ═══════════════════════════════════════════════════════════
async function pollNotifications() {
    try {
        const response = await fetch('/api/notifications');
        if (!response.ok) return;
        const data = await response.json();
        
        if (data.has_notification && data.message) {
            if (data.message === '__WAKE_WORD__') {
                if (voiceBtn) voiceBtn.click();
                return;
            }
            playTTS(data.message);
            await appendToTerminal(data.message, 'aura');
            showToast('AURA NOTIFICATION', data.message.substring(0, 50) + '...', 'info');
            
            const notifList = document.getElementById('notif-list');
            if(notifList) {
                const item = document.createElement('div');
                item.className = 'notif-item';
                const timeStr = new Date().toLocaleTimeString();
                item.innerHTML = `<div class="notif-time">${timeStr}</div><div>${data.message}</div>`;
                notifList.prepend(item);
                
                if(!notifDrawer.classList.contains('open')) {
                    unreadNotifs++;
                    if(notifBadge) {
                        notifBadge.style.display = 'block';
                        notifBadge.textContent = unreadNotifs;
                    }
                }
            }
        }
    } catch (e) {}
}
setInterval(pollNotifications, 5000);

let wakeWordActive = false;
let wakeRecognition = null;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    wakeRecognition = new SpeechRecognition();
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true;
    wakeRecognition.lang = 'en-US';

    wakeRecognition.onresult = async (event) => {
        if (!wakeWordActive) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const rawTranscript = event.results[i][0].transcript.toLowerCase();
            if (rawTranscript.includes('hey aura') && event.results[i].isFinal) {
                wakeRecognition.stop();
                voiceBtn.click();
                break;
            }
        }
    };
    wakeRecognition.onerror = () => {
        if(wakeWordActive) setTimeout(() => { try{wakeRecognition.start()}catch(e){} }, 1000);
    };
    wakeRecognition.onend = () => {
        if(wakeWordActive) try{wakeRecognition.start()}catch(e){}
    };
}

wakeWordToggle.addEventListener('click', () => {
    wakeWordActive = !wakeWordActive;
    if (wakeWordActive) {
        wakeWordStatus.textContent = 'ACTIVE';
        wakeWordStatus.className = 'status-active';
        try { wakeRecognition.start(); } catch(e) {}
        showToast('MODULE ACTIVE', 'Wake word "Hey Aura" enabled.', 'info');
    } else {
        wakeWordStatus.textContent = 'OFF';
        wakeWordStatus.className = 'status-idle';
        try { wakeRecognition.stop(); } catch(e) {}
        showToast('MODULE OFFLINE', 'Wake word disabled.', 'warning');
    }
});
fetchThreats();

// -----------------------------------------------------------
// FILE EXPLORER
// -----------------------------------------------------------
let currentFsPath = "";
async function fetchFileSystem(path = "") {
    try {
        const res = await fetch(`/api/fs?path=${encodeURIComponent(path)}`);
        if(res.ok) {
            const data = await res.json();
            if(data.status === 'success') {
                currentFsPath = data.current;
                document.getElementById('fs-path').textContent = currentFsPath || 'ROOT';
                
                const list = document.getElementById('fs-list');
                if(!list) return;
                list.innerHTML = "";
                
                data.items.forEach(item => {
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.alignItems = 'center';
                    div.style.gap = '8px';
                    div.style.padding = '4px 8px';
                    div.style.background = 'rgba(0,240,255,0.05)';
                    div.style.border = '1px solid var(--border)';
                    div.style.cursor = 'pointer';
                    div.style.fontSize = '11px';
                    
                    const icon = item.is_dir ? '📁' : '📄';
                    div.innerHTML = `<span>${icon}</span><span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</span>`;
                    
                    div.addEventListener('click', () => {
                        if(item.is_dir) {
                            fetchFileSystem(item.path);
                        } else {
                            showToast('FILE SELECTED', item.name, 'info');
                        }
                    });
                    
                    div.addEventListener('mouseenter', () => div.style.background = 'var(--cyan-dim)');
                    div.addEventListener('mouseleave', () => div.style.background = 'rgba(0,240,255,0.05)');
                    
                    list.appendChild(div);
                });
            } else {
                showToast('FS ERROR', data.message, 'error');
            }
        }
    } catch(e) {}
}

document.getElementById('fs-up-btn')?.addEventListener('click', () => {
    if(!currentFsPath) return;
    const parts = currentFsPath.split('\\').filter(Boolean);
    if(parts.length <= 1) {
        fetchFileSystem("");
    } else {
        parts.pop();
        fetchFileSystem(parts.join('\\') + '\\');
    }
});

fetchFileSystem("");

// -----------------------------------------------------------
// 3D HOLOGRAPHIC REACTOR
// -----------------------------------------------------------
function init3DReactor() {
    if(typeof THREE === 'undefined') return;
    const container = document.getElementById('reactor-3d');
    if(!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.TorusKnotGeometry(1.5, 0.4, 64, 16);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0x00f0ff, 
        wireframe: true,
        transparent: true,
        opacity: 0.3
    });
    const torusKnot = new THREE.Mesh(geometry, material);
    scene.add(torusKnot);
    
    const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.1
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);

    camera.position.z = 4.5;
    let baseSpeed = 0.005;

    function animate() {
        requestAnimationFrame(animate);
        let cpuLoad = chartData.cpu[chartData.cpu.length - 1] || 0;
        let speed = baseSpeed + (cpuLoad / 100) * 0.02;
        
        torusKnot.rotation.x += speed;
        torusKnot.rotation.y += speed;
        sphere.rotation.x -= speed * 0.5;
        sphere.rotation.y -= speed * 0.5;
        
        let time = Date.now() * 0.002;
        material.opacity = 0.2 + Math.sin(time) * 0.1;
        
        if(reactorContainer.classList.contains('listening')) {
            material.color.setHex(0xff3355);
            sphereMat.color.setHex(0xff3355);
        } else {
            const computedStyle = getComputedStyle(document.documentElement);
            const themeColor = computedStyle.getPropertyValue('--cyan').trim() || '#00f0ff';
            material.color.setStyle(themeColor);
            sphereMat.color.setStyle(themeColor);
        }

        renderer.render(scene, camera);
    }
    animate();
    
    window.addEventListener('resize', () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
}
setTimeout(init3DReactor, 500);

// -----------------------------------------------------------
// WEBCAM & FACIAL TRACKING (face-api.js)
// -----------------------------------------------------------
const video = document.getElementById('webcam-video');
const webcamCanvas = document.getElementById('webcam-canvas');

if (video && webcamCanvas) {
    Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'),
    ]).then(startVideo);

    function startVideo() {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                video.srcObject = stream;
            })
            .catch(err => console.error('Error accessing webcam:', err));
    }

    video.addEventListener('play', () => {
        const displaySize = { width: video.clientWidth, height: video.clientHeight };
        faceapi.matchDimensions(webcamCanvas, displaySize);
        setInterval(async () => {
            const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            const ctx = webcamCanvas.getContext('2d');
            ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
            
            // Draw custom tactical tracking boxes
            resizedDetections.forEach(detection => {
                const box = detection.box;
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 2;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                
                // Draw crosshair lines
                ctx.beginPath();
                ctx.moveTo(box.x + box.width / 2, box.y);
                ctx.lineTo(box.x + box.width / 2, box.y + box.height);
                ctx.moveTo(box.x, box.y + box.height / 2);
                ctx.lineTo(box.x + box.width, box.y + box.height / 2);
                ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
                ctx.stroke();

                // Target label
                ctx.fillStyle = '#00f0ff';
                ctx.font = '10px monospace';
                ctx.fillText('TARGET ACQUIRED', box.x, box.y - 5);
            });
        }, 100);
    });
}


// -----------------------------------------------------------
// MEMORY ARCHIVE LOGIC
// -----------------------------------------------------------
const memoryList = document.getElementById('memory-list');
const memorySearch = document.getElementById('memory-search');
let allMemories = [];

async function fetchMemories() {
    try {
        const res = await fetch('/api/memory');
        if (res.ok) {
            allMemories = await res.json();
            renderMemories(allMemories);
        }
    } catch (e) { console.error('Error fetching memories:', e); }
}

function renderMemories(mems) {
    if (!memoryList) return;
    memoryList.innerHTML = '';
    if (mems.length === 0) {
        memoryList.innerHTML = '<div style="font-size:10px; color:var(--text-dim);">No long-term memories stored.</div>';
        return;
    }
    mems.forEach(mem => {
        const div = document.createElement('div');
        div.style.padding = '5px';
        div.style.borderBottom = '1px solid rgba(0, 240, 255, 0.1)';
        div.style.marginBottom = '5px';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        
        const cat = document.createElement('span');
        cat.style.fontSize = '8px';
        cat.style.color = 'var(--cyan-dim)';
        cat.innerText = mem.category ? mem.category.toUpperCase() : 'GENERAL';
        
        const delBtn = document.createElement('button');
        delBtn.innerText = 'X';
        delBtn.style.background = 'none';
        delBtn.style.border = 'none';
        delBtn.style.color = 'var(--error)';
        delBtn.style.cursor = 'pointer';
        delBtn.style.fontSize = '10px';
        delBtn.onclick = async () => {
            try {
                const res = await fetch(`/api/memory/${mem.id}`, { method: 'DELETE' });
                if(res.ok) fetchMemories();
            } catch(e) {}
        };
        
        header.appendChild(cat);
        header.appendChild(delBtn);
        
        const content = document.createElement('div');
        content.style.fontSize = '10px';
        content.style.marginTop = '4px';
        content.style.color = 'var(--text-main)';
        content.innerText = mem.content;
        
        div.appendChild(header);
        div.appendChild(content);
        memoryList.appendChild(div);
    });
}

if (memorySearch) {
    memorySearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allMemories.filter(m => m.content.toLowerCase().includes(term) || (m.category && m.category.toLowerCase().includes(term)));
        renderMemories(filtered);
    });
}
fetchMemories();

// -----------------------------------------------------------
// PROACTIVE INTELLIGENCE LOGIC
// -----------------------------------------------------------
const toggleProactive = document.getElementById('toggle-proactive');
const threshCpu = document.getElementById('thresh-cpu');
const threshCpuVal = document.getElementById('thresh-cpu-val');
const threshGpu = document.getElementById('thresh-gpu');
const threshGpuVal = document.getElementById('thresh-gpu-val');
const threshBatt = document.getElementById('thresh-batt');
const threshBattVal = document.getElementById('thresh-batt-val');
const btnSaveProactive = document.getElementById('btn-save-proactive');

let proactiveEnabled = true;

async function fetchProactiveConfig() {
    try {
        const res = await fetch('/api/proactive');
        if (res.ok) {
            const config = await res.json();
            proactiveEnabled = config.enabled !== false;
            if(toggleProactive) {
                toggleProactive.innerText = proactiveEnabled ? 'ON' : 'OFF';
                toggleProactive.style.color = proactiveEnabled ? 'var(--cyan)' : 'var(--text-dim)';
            }
            
            if (config.thresholds) {
                if (config.thresholds.cpu_percent && threshCpu) {
                    threshCpu.value = config.thresholds.cpu_percent;
                    threshCpuVal.innerText = config.thresholds.cpu_percent + '%';
                }
                if (config.thresholds.gpu_temp_c && threshGpu) {
                    threshGpu.value = config.thresholds.gpu_temp_c;
                    threshGpuVal.innerText = config.thresholds.gpu_temp_c + '°C';
                }
                if (config.thresholds.battery_percent_low && threshBatt) {
                    threshBatt.value = config.thresholds.battery_percent_low;
                    threshBattVal.innerText = config.thresholds.battery_percent_low + '%';
                }
            }
        }
    } catch(e) {}
}

if (threshCpu) threshCpu.addEventListener('input', e => threshCpuVal.innerText = e.target.value + '%');
if (threshGpu) threshGpu.addEventListener('input', e => threshGpuVal.innerText = e.target.value + '°C');
if (threshBatt) threshBatt.addEventListener('input', e => threshBattVal.innerText = e.target.value + '%');

if (toggleProactive) {
    toggleProactive.addEventListener('click', () => {
        proactiveEnabled = !proactiveEnabled;
        toggleProactive.innerText = proactiveEnabled ? 'ON' : 'OFF';
        toggleProactive.style.color = proactiveEnabled ? 'var(--cyan)' : 'var(--text-dim)';
    });
}

if (btnSaveProactive) {
    btnSaveProactive.addEventListener('click', async () => {
        const payload = {
            enabled: proactiveEnabled,
            thresholds: {
                cpu_percent: parseInt(threshCpu.value),
                gpu_temp_c: parseInt(threshGpu.value),
                battery_percent_low: parseInt(threshBatt.value),
                ram_percent: 90,
                disk_percent: 90,
                cpu_temp_c: 90
            }
        };
        try {
            const res = await fetch('/api/proactive', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                btnSaveProactive.innerText = 'SAVED!';
                setTimeout(() => btnSaveProactive.innerText = 'SAVE CONFIG', 2000);
            }
        } catch(e) {}
    });
}
fetchProactiveConfig();

// ---------------------------------------------------------
// LOCAL SECURITY CENTER
// ---------------------------------------------------------
async function fetchSecurity() {
    try {
        const res = await fetch('/api/security');
        const data = await res.json();
        if (data.status === 'success') {
            const riskEl = document.getElementById('sec-risk-val');
            riskEl.innerText = data.risk_level;
            if (data.risk_level === 'LOW') {
                riskEl.style.color = 'var(--green)';
            } else if (data.risk_level === 'MEDIUM') {
                riskEl.style.color = 'var(--warning)';
            } else {
                riskEl.style.color = 'var(--error)';
            }
            
            const alertsEl = document.getElementById('sec-alerts-container');
            alertsEl.innerHTML = '';
            if (data.alerts && data.alerts.length > 0) {
                data.alerts.forEach(alert => {
                    const d = document.createElement('div');
                    d.style.color = 'var(--error)';
                    d.style.fontSize = '10px';
                    d.style.marginBottom = '2px';
                    d.innerText = `[!] ${alert}`;
                    alertsEl.appendChild(d);
                });
            } else {
                alertsEl.innerHTML = '<div style="color:var(--green);font-size:10px;">[+] No critical alerts</div>';
            }
            
            const detailsEl = document.getElementById('sec-details-container');
            let details = '';
            if (data.defender) details += data.defender + '\n\n';
            if (data.firewall) details += data.firewall + '\n\n';
            if (data.processes) details += data.processes + '\n\n';
            if (data.files) details += data.files + '\n\n';
            if (data.ports) details += data.ports + '\n\n';
            if (data.devices) details += data.devices + '\n\n';
            
            detailsEl.innerText = details.trim();
        }
    } catch (err) {
        console.error("Security fetch error:", err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchSecurity();
    setInterval(fetchSecurity, 30000); // 30s


    
    const btnSec = document.getElementById('btn-sec-refresh');
    if (btnSec) {
        btnSec.addEventListener('click', () => {
            const detailsEl = document.getElementById('sec-details-container');
            if(detailsEl) detailsEl.innerText = 'Scanning...';
            fetchSecurity();
        });
    }
});

// ═══════════════════════════════════════════════════════════
// SYSTEM LOGS VIEWER
// ═══════════════════════════════════════════════════════════
const logOutput = document.getElementById('log-output');
const btnLogRefresh = document.getElementById('btn-log-refresh');

async function fetchLogs() {
    if (!logOutput) return;
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        if (data.status === 'success' && data.lines) {
            logOutput.innerHTML = '';
            data.lines.forEach(line => {
                const div = document.createElement('div');
                div.className = 'log-line';
                div.textContent = line;
                logOutput.appendChild(div);
            });
            logOutput.scrollTop = logOutput.scrollHeight;
        } else {
            logOutput.innerHTML = `<div class="log-line" style="color:var(--red);">[ERROR] Failed to read logs.</div>`;
        }
    } catch (e) {
        logOutput.innerHTML = `<div class="log-line" style="color:var(--red);">[ERROR] Connection failed.</div>`;
    }
}

if (btnLogRefresh) {
    btnLogRefresh.addEventListener('click', fetchLogs);
}

// Auto-refresh logs every 3 seconds
setInterval(fetchLogs, 3000);
fetchLogs();
