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
        osc.frequency.value = 55;
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.2;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 0.02;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start();
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
// CORE HELPERS
// ═══════════════════════════════════════════════════════════

// Escape server-controlled strings before any innerHTML insertion (XSS guard)
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── Connection monitor: drives the sidebar ONLINE/OFFLINE chip ──
const ConnectionMonitor = {
    el: null,
    fails: 0,
    online: true,
    announced: false,
    init() {
        this.el = document.getElementById('conn-status');
    },
    record(ok) {
        if (ok) {
            if (!this.online && this.announced) {
                showToast('CONNECTION RESTORED', 'Backend is reachable again.', 'success');
            }
            this.fails = 0;
            this.online = true;
            this.announced = false;
            this.el?.classList.remove('offline');
            this.el?.classList.add('online');
            const t = this.el?.querySelector('.conn-text');
            if (t) t.textContent = 'ONLINE';
        } else {
            this.fails++;
            if (this.online && this.fails >= 2) {
                this.online = false;
                this.announced = true;
                this.el?.classList.add('offline');
                this.el?.classList.remove('online');
                const t = this.el?.querySelector('.conn-text');
                if (t) t.textContent = 'OFFLINE';
                showToast('CONNECTION LOST', 'Cannot reach the AURA backend.', 'error');
            }
        }
    },
    get isOffline() { return !this.online; }
};

// Central fetch wrapper: request timeout + connection tracking.
// Long-running endpoints pass a larger `timeout` (chat can take minutes
// when the agent loops through tools).
async function api(path, { method = 'GET', headers, body, timeout = 15000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    try {
        const res = await fetch(path, { method, headers, body, signal: controller.signal });
        ConnectionMonitor.record(true);
        return res;
    } catch (err) {
        ConnectionMonitor.record(false);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// Mark a card's data as stale when its poll keeps failing
function setStale(cardEl, stale) {
    cardEl?.classList.toggle('stale', !!stale);
}

function isViewActive(name) {
    return document.getElementById('view-' + name)?.classList.contains('active') || false;
}

// ── Confirmation modal for destructive actions ──
const confirmModal = document.getElementById('confirm-modal');
let confirmResolve = null;

function confirmAction({ title = 'Confirm action', message = 'Are you sure?', okLabel = 'CONFIRM' } = {}) {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        const okBtn = document.getElementById('confirm-ok');
        okBtn.textContent = okLabel;
        confirmModal.classList.add('active');
        okBtn.focus();
    });
}

function settleConfirm(result) {
    if (confirmResolve) {
        confirmResolve(result);
        confirmResolve = null;
    }
    confirmModal.classList.remove('active');
}

document.getElementById('confirm-ok')?.addEventListener('click', () => settleConfirm(true));
document.getElementById('confirm-cancel')?.addEventListener('click', () => settleConfirm(false));
document.getElementById('confirm-x')?.addEventListener('click', () => settleConfirm(false));

// ═══════════════════════════════════════════════════════════
// BOOT SEQUENCE (signature moment — kept short)
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    ConnectionMonitor.init();
    startBootSequence();
});

function startBootSequence() {
    const bootOverlay = document.getElementById('boot-overlay');
    const bootProgress = document.getElementById('boot-progress-bar');
    const bootLinesContainer = document.getElementById('boot-lines');

    const bootLines = [
        { text: '> AURA KERNEL v2.0 loading...', delay: 160 },
        { text: '> Neural mesh handshake ............... ', suffix: '<span class="bok">[OK]</span>', delay: 220 },
        { text: '> Voice core calibrated ............... ', suffix: '<span class="bok">[OK]</span>', delay: 220 },
        { text: '> Sensor array online ................. ', suffix: '<span class="bok">[OK]</span>', delay: 220 },
        { text: '> All subsystems nominal.', delay: 180 }
    ];

    let lineIndex = 0;

    function renderLine() {
        if (lineIndex >= bootLines.length) {
            if(bootProgress) bootProgress.style.width = '100%';
            setTimeout(() => {
                if(bootOverlay) bootOverlay.classList.add('dismissed');
            }, 400);
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

    setTimeout(renderLine, 600);
}

// ═══════════════════════════════════════════════════════════
// VIEW ROUTER (sidebar navigation)
// ═══════════════════════════════════════════════════════════
const VIEW_NAMES = ['chat', 'system', 'security', 'files', 'memory', 'settings'];

function showView(name) {
    if (!VIEW_NAMES.includes(name)) name = 'chat';
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.nav-item').forEach(btn => {
        const on = btn.dataset.view === name;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    const section = document.getElementById('view-' + name);
    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.textContent = section?.dataset.title || name;
    try { localStorage.setItem('aura-view', name); } catch (e) {}
    // Lazy-init panels that own hardware/network resources
    if (name === 'security') initWebcam();
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ═══════════════════════════════════════════════════════════
// VOICE STATE (reactor orb recoloring)
// ═══════════════════════════════════════════════════════════
const terminalOutput = document.getElementById('terminal-output');
const chatOutput = document.getElementById('chat-output');
window.auraState = 'idle';

function setAuraState(state) {
    window.auraState = state;
    const vBtn = document.getElementById('voice-btn');
    const statusEl = vBtn?.querySelector('.core-status');
    if(!vBtn || !statusEl) return;

    vBtn.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking');
    vBtn.classList.add(`state-${state}`);

    let speed = 1.0;
    switch(state) {
        case 'idle': speed = 0.8; statusEl.textContent = 'ONLINE'; break;
        case 'listening': speed = 1.8; statusEl.textContent = 'HEARING'; break;
        case 'processing': speed = 2.5; statusEl.textContent = 'THINKING'; break;
        case 'speaking': speed = 1.2; statusEl.textContent = 'SPEAKING'; break;
    }
    document.documentElement.style.setProperty('--ring-speed', speed);
}

const commandInput = document.getElementById('command-input');
const voiceBtn = document.getElementById('voice-btn');
const visualizer = document.getElementById('visualizer');

// Toggle between Terminal and Chat modes
let currentMode = 'terminal';
const btnModeTerm = document.getElementById('btn-mode-term');
const btnModeChat = document.getElementById('btn-mode-chat');

function setConsoleMode(mode) {
    currentMode = mode;
    const isTerm = mode === 'terminal';
    btnModeTerm.classList.toggle('active', isTerm);
    btnModeChat.classList.toggle('active', !isTerm);
    btnModeTerm.setAttribute('aria-pressed', String(isTerm));
    btnModeChat.setAttribute('aria-pressed', String(!isTerm));
    terminalOutput.style.display = isTerm ? 'flex' : 'none';
    chatOutput.style.display = isTerm ? 'none' : 'flex';
    (isTerm ? terminalOutput : chatOutput).scrollTop = (isTerm ? terminalOutput : chatOutput).scrollHeight;
}

btnModeTerm.addEventListener('click', () => setConsoleMode('terminal'));
btnModeChat.addEventListener('click', () => setConsoleMode('chat'));

// Initialize clock (system-local timezone)
function updateClock() {
    const clk = document.getElementById('hud-sys-clock');
    if(clk) clk.textContent = new Date().toLocaleTimeString([], { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// Restore last visited view
(function restoreView() {
    let saved = null;
    try { saved = localStorage.getItem('aura-view'); } catch (e) {}
    showView(VIEW_NAMES.includes(saved) ? saved : 'chat');
})();

// ═══════════════════════════════════════════════════════════
// NOTIFICATION TOASTS
// ═══════════════════════════════════════════════════════════
const toastContainer = document.getElementById('toast-container');

function showToast(title, message, type = 'info') {
    const toast = document.createElement('div');
    toast.className =
        type === 'error' ? 'toast toast-error' :
        type === 'warning' ? 'toast toast-warning' :
        type === 'success' ? 'toast toast-success' : 'toast';

    toast.innerHTML = `
        <div class="toast-title">${escapeHtml(title)}</div>
        <div class="toast-msg">${escapeHtml(message)}</div>
    `;

    toastContainer.appendChild(toast);

    const dismiss = () => {
        toast.style.animation = 'toast-slide-out 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 300);
    };
    setTimeout(dismiss, 5000);
    toast.addEventListener('click', dismiss);
}

// ═══════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
const shortcutsModal = document.getElementById('shortcuts-modal');
const btnShortcuts = document.getElementById('btn-shortcuts');
const btnCloseShortcuts = document.getElementById('close-shortcuts');

function toggleShortcuts() {
    shortcutsModal.classList.toggle('active');
}

btnShortcuts.addEventListener('click', toggleShortcuts);
btnCloseShortcuts.addEventListener('click', () => shortcutsModal.classList.remove('active'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (confirmModal.classList.contains('active')) { settleConfirm(false); return; }
        if (shortcutsModal.classList.contains('active')) { shortcutsModal.classList.remove('active'); return; }
        if (document.getElementById('lightbox-overlay').classList.contains('open')) { document.getElementById('lightbox-overlay').classList.remove('open'); return; }
        document.getElementById('notif-drawer')?.classList.remove('open');
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
const numBars = 24;
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

    setAuraState('speaking');
    clearInterval(visInterval);

    try {
        await api('/api/voice/speaking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_speaking: true})
        });

        const response = await api(`/api/tts?text=${encodeURIComponent(text)}`, { timeout: 30000 });
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
            window._lastPlaybackEnd = Date.now();
            setAuraState('idle');
            api('/api/voice/speaking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({is_speaking: false})
            }).catch(() => {});
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
        currentAudio = null;
        window._lastPlaybackEnd = Date.now();
        setAuraState('idle');
        api('/api/voice/speaking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_speaking: false})
        }).catch(() => {});
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

    // 2. Append to Chat View (plain-text fallback; rich rendering
    //    happens in the send flow for live responses)
    const chatDiv = document.createElement('div');
    chatDiv.className = `chat-bubble bubble-${type === 'error' ? 'error' : type === 'user' ? 'user' : 'aura'}`;
    chatDiv.textContent = text;
    chatOutput.appendChild(chatDiv);
    chatOutput.scrollTop = chatOutput.scrollHeight;
}

async function loadHistory() {
    try {
        const response = await api('/api/history');
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
// COMMAND INPUT, VOICE & ATTACHMENTS
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
        pill.innerHTML = `<img src="data:image/jpeg;base64,${b64}" alt="attachment"> <span>Image</span> <button class="attach-remove" data-type="image" data-index="${i}" aria-label="Remove">×</button>`;
        attachmentPreview.appendChild(pill);
        pill.querySelector('.attach-remove').addEventListener('click', () => {
            pendingAttachments.images.splice(i, 1);
            rebuildAttachmentPreview();
        });
    });
    pendingAttachments.file_texts.forEach((fileObj, i) => {
        const pill = document.createElement('div');
        pill.className = 'attach-pill';
        pill.innerHTML = `<span>📄</span> <span>${escapeHtml(fileObj.name)}</span> <button class="attach-remove" data-type="text" data-index="${i}" aria-label="Remove">×</button>`;
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
const commandHistory = [];
let historyIndex = -1;

commandInput.addEventListener('input', () => {
    const tokenCounter = document.getElementById('token-counter');
    if (tokenCounter) {
        const tokens = Math.ceil(commandInput.value.length / 4);
        tokenCounter.textContent = `~${tokens} tokens`;
    }
});

function enhanceLatestBubble(rawText = null) {
    const bubbles = chatOutput.querySelectorAll('.chat-bubble:not(.thinking)');
    if (bubbles.length === 0) return;
    const latest = bubbles[bubbles.length - 1];

    // Add Timestamp
    const timeSpan = document.createElement('span');
    timeSpan.className = 'bubble-time';
    const now = new Date();
    timeSpan.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    latest.appendChild(timeSpan);

    // Add Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.setAttribute('aria-label', 'Copy message');
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

    const textToCopy = rawText !== null ? rawText : latest.textContent.replace(timeSpan.textContent, '').trim();

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(textToCopy);
        const originalHTML = copyBtn.innerHTML;
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.innerHTML = originalHTML; }, 1000);
    });
    latest.appendChild(copyBtn);
}

commandInput.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length > 0) {
            if (historyIndex === -1) historyIndex = commandHistory.length - 1;
            else historyIndex = Math.max(0, historyIndex - 1);
            commandInput.value = commandHistory[historyIndex];
            commandInput.dispatchEvent(new Event('input'));
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex !== -1) {
            historyIndex++;
            if (historyIndex >= commandHistory.length) {
                historyIndex = -1;
                commandInput.value = '';
            } else {
                commandInput.value = commandHistory[historyIndex];
            }
            commandInput.dispatchEvent(new Event('input'));
        }
    } else if (e.key === 'Enter') {
        const text = commandInput.value.trim();
        if (!text) return;

        commandHistory.push(text);
        historyIndex = -1;

        if (text.toLowerCase() === 'clear') {
            terminalOutput.innerHTML = '';
            chatOutput.innerHTML = '';
            commandInput.value = '';
            commandInput.dispatchEvent(new Event('input'));
            return;
        }

        commandInput.value = '';
        commandInput.disabled = true;
        commandInput.dispatchEvent(new Event('input'));

        await appendToTerminal(text, 'user');
        enhanceLatestBubble(text);

        setAuraState('processing');
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(true), 100);

        try {
            const payload = {
                message: text,
                images: pendingAttachments.images.length > 0 ? pendingAttachments.images : null,
                file_texts: pendingAttachments.file_texts.length > 0 ? pendingAttachments.file_texts : null
            };
            clearAttachments();

            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'chat-bubble bubble-aura thinking';
            thinkingDiv.innerHTML = '<span class="dot-pulse"></span><span class="dot-pulse d2"></span><span class="dot-pulse d3"></span>';
            chatOutput.appendChild(thinkingDiv);
            chatOutput.scrollTop = chatOutput.scrollHeight;

            const response = await api('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                timeout: 300000 // agent may loop through tools for minutes
            });

            if (!response.ok) throw new Error('Network response was not ok');

            const data = await response.json();
            const accumulatedText = (data && typeof data.response === 'string') ? data.response : '';

            thinkingDiv.remove();
            setAuraState('idle');
            clearInterval(visInterval);
            visInterval = setInterval(() => animateVisualizer(false), 100);

            if (accumulatedText) {
                const currentBubble = document.createElement('div');
                currentBubble.className = 'chat-bubble bubble-aura';
                chatOutput.appendChild(currentBubble);

                if (window.marked && window.DOMPurify) {
                    currentBubble.innerHTML = DOMPurify.sanitize(marked.parse(accumulatedText));
                    if (window.hljs) {
                        currentBubble.querySelectorAll('pre code').forEach((block) => {
                            hljs.highlightElement(block);
                        });
                    }
                } else {
                    currentBubble.textContent = accumulatedText;
                }
                chatOutput.scrollTop = chatOutput.scrollHeight;

                enhanceLatestBubble(accumulatedText);

                const termDiv = document.createElement('div');
                termDiv.className = 'aura-msg';
                termDiv.textContent = accumulatedText;
                terminalOutput.appendChild(termDiv);
                terminalOutput.scrollTop = terminalOutput.scrollHeight;

                playTTS(accumulatedText);
            } else {
                await appendToTerminal('No response received.', 'error');
            }
        } catch (error) {
            console.error('Chat error:', error);
            setAuraState('idle');
            clearInterval(visInterval);
            visInterval = setInterval(() => animateVisualizer(false), 100);
            const msg = ConnectionMonitor.isOffline
                ? 'CONNECTION FAILED — backend unreachable.'
                : 'Request failed or timed out.';
            await appendToTerminal(msg, 'error');
            showToast('REQUEST FAILED', msg, 'error');
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
        api('/api/voice/stop', { method: 'POST' }).catch(() => {});
    }

    if (window.auraState === 'listening') return;
    setAuraState('listening');
    commandInput.disabled = true;
    voiceBtn.setAttribute('aria-pressed', 'true');

    // Start Live Mic Visualization
    startMicVisualization();

    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    try {
        const response = await api('/api/voice/listen', { method: 'POST', timeout: 60000 });
        const data = await response.json();

        stopMicVisualization();
        setAuraState('idle');
        voiceBtn.setAttribute('aria-pressed', 'false');
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
        stopMicVisualization();
        setAuraState('idle');
        voiceBtn.setAttribute('aria-pressed', 'false');
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        await appendToTerminal('MIC CONNECTION FAILED', 'error');
        showToast('VOICE ERROR', 'Could not reach the voice service.', 'error');
    }
});

// Live Mic Visualization Logic
let micStream = null;
let micAudioCtx = null;
let micAnalyser = null;
let micDataArray = null;
let micAnimFrame = null;

// Anti-echo guard: never start a listening session while AURA is speaking
// or within 2s of her finishing - otherwise the mic captures her own voice.
function canStartListening() {
    const settled = Date.now() - (window._lastPlaybackEnd || 0) > 2000;
    return !currentAudio && window.auraState !== 'listening' && settled;
}

async function startMicVisualization() {
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = micAudioCtx.createMediaStreamSource(micStream);

        micAnalyser = micAudioCtx.createAnalyser();
        micAnalyser.fftSize = 256;
        source.connect(micAnalyser);

        micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
        const micTimeArray = new Uint8Array(micAnalyser.fftSize);

        function renderMic() {
            if(window.auraState !== 'listening') return;
            micAnimFrame = requestAnimationFrame(renderMic);

            micAnalyser.getByteFrequencyData(micDataArray);
            bars.forEach((bar, index) => {
                let value = micDataArray[index] || 0;
                let percent = Math.max(10, (value / 255) * 100);
                bar.style.height = `${percent}%`;
            });

            micAnalyser.getByteTimeDomainData(micTimeArray);
            let sum = 0;
            for(let i = 0; i < micTimeArray.length; i++) {
                let val = (micTimeArray[i] - 128) / 128;
                sum += val * val;
            }
            let rms = Math.sqrt(sum / micTimeArray.length);

            document.documentElement.style.setProperty('--ring-pulse', rms.toFixed(3));
        }
        renderMic();
    } catch(err) {
        console.warn("Mic visualization failed", err);
    }
}

function stopMicVisualization() {
    if (micAnimFrame) cancelAnimationFrame(micAnimFrame);
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (micAudioCtx && micAudioCtx.state !== 'closed') micAudioCtx.close();

    bars.forEach(bar => bar.style.height = '10%');
    document.documentElement.style.setProperty('--ring-pulse', 0);
}

// ═══════════════════════════════════════════════════════════
// LIVE TELEMETRY (System view + topbar signal)
// ═══════════════════════════════════════════════════════════
const historySize = 30;
const chartData = {
    cpu: Array(historySize).fill(0),
    mem: Array(historySize).fill(0),
    net: Array(historySize).fill(0)
};

function updateGauge(id, pct) {
    const arc = document.getElementById('gauge-'+id+'-arc');
    if (!arc) return;
    const offset = 157 * (1 - pct / 100);
    arc.style.strokeDashoffset = offset;
    const hue = pct < 60 ? 160 : pct < 80 ? 40 : 0;
    arc.style.stroke = 'hsl('+hue+',100%,60%)';
    arc.style.filter = 'drop-shadow(0 0 4px hsla('+hue+',100%,60%,0.8))';
    const text = document.getElementById('gauge-'+id+'-text');
    if (text) text.textContent = Math.round(pct)+'%';
    // Sparkline update (last 30 values redrawn as SVG polyline)
    const spark = document.getElementById('gauge-'+id+'-spark');
    if (!spark) return;
    const points = chartData[id].map((val, i) => {
        const x = (i / (historySize - 1)) * 120;
        const y = 19 - (Math.min(100, Math.max(0, val)) / 100) * 18;
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    let polyline = spark.querySelector('polyline');
    if (!polyline) {
        polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        spark.appendChild(polyline);
    }
    polyline.setAttribute('points', points);
}

function setDiag(fillId, valId, valueText, pct) {
    const val = document.getElementById(valId);
    const fill = document.getElementById(fillId);
    if (val) val.textContent = valueText;
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

let telemetryStaleCount = 0;

async function updateTelemetry() {
    const sysCard = document.querySelector('.diagnostics-panel');
    if (!document.hidden) {
        try {
            const response = await api('/api/telemetry', { timeout: 8000 });
            if (!response.ok) throw new Error('telemetry ' + response.status);
            const data = await response.json();
            telemetryStaleCount = 0;
            setStale(sysCard, false);
            setStale(document.querySelector('.thermals-panel'), false);

            // Diagnostics bars
            setDiag('load-fill', 'load-val', `${data.cpu}%`, data.cpu);
            setDiag('mem-fill', 'mem-val', `${data.memory}%`, data.memory);
            setDiag('uplink-fill', 'uplink-val', `${data.uplink}%`, data.uplink);
            setDiag('power-fill', 'power-val', `${data.power}%`, data.power);

            // Topbar signal pill (compact 5-block meter)
            const uplinkVal = document.getElementById('hud-signal');
            if(uplinkVal) {
                let sigStr = "";
                let p = Math.round((data.uplink / 100) * 5);
                for(let i=0; i<5; i++) sigStr += (i<p) ? "█" : "░";
                uplinkVal.textContent = sigStr + ` ${data.uplink}%`;
            }

            // Thermals: backend sends null when a sensor is unavailable
            if(data.cpu_temp != null) {
                setDiag('cpu-temp-fill', 'cpu-temp-val', `${data.cpu_temp}°C`, data.cpu_temp);
                const cpuTempFill = document.getElementById('cpu-temp-fill');
                if(cpuTempFill) cpuTempFill.style.background = data.cpu_temp > 85 ? 'var(--danger)' : data.cpu_temp > 70 ? 'var(--purple)' : 'var(--cyan)';
            } else {
                const v = document.getElementById('cpu-temp-val');
                if (v) v.textContent = 'N/A';
            }

            if(data.cpu_fan != null) {
                setDiag('cpu-fan-fill', 'cpu-fan-val', `${data.cpu_fan} RPM`, (data.cpu_fan / 5000) * 100);
            } else {
                const v = document.getElementById('cpu-fan-val');
                if (v) v.textContent = 'N/A';
            }

            if(data.gpu_temp != null) {
                setDiag('gpu-temp-fill', 'gpu-temp-val', `${data.gpu_temp}°C`, data.gpu_temp);
                const gpuTempFill = document.getElementById('gpu-temp-fill');
                if(gpuTempFill) gpuTempFill.style.background = data.gpu_temp > 85 ? 'var(--danger)' : data.gpu_temp > 70 ? 'var(--purple)' : 'var(--cyan)';
            } else {
                const v = document.getElementById('gpu-temp-val');
                if (v) v.textContent = 'N/A';
            }

            if(data.gpu_mem !== undefined) {
                const v = document.getElementById('gpu-mem-val');
                if (v) v.textContent = data.gpu_mem;
                let memParts = String(data.gpu_mem).split('/');
                if(memParts.length === 2) {
                    let used = parseInt(memParts[0]);
                    let total = parseInt(memParts[1]);
                    if(!isNaN(used) && !isNaN(total) && total > 0) {
                        setDiag('gpu-mem-fill', 'gpu-mem-val', data.gpu_mem, (used/total)*100);
                    }
                }
            }

            if(data.gpu_fan !== undefined) {
                const v = document.getElementById('gpu-fan-val');
                if (v) v.textContent = data.gpu_fan;
            }

            // Chart Data
            chartData.cpu.push(data.cpu); chartData.cpu.shift();
            chartData.mem.push(data.memory); chartData.mem.shift();
            let netLoad = Math.min(100, Math.max(0, data.uplink || 0));
            chartData.net.push(netLoad); chartData.net.shift();

            updateGauge('cpu', data.cpu);
            updateGauge('mem', data.memory);
            updateGauge('net', netLoad);

            // AURA CORE AI Telemetry
            if(data.ai) {
                const ai = data.ai;
                const modelVal = document.getElementById('ai-model-val');
                if (modelVal) modelVal.textContent = ai.model || '---';
                const vramVal = document.getElementById('ai-vram-val');
                if (vramVal) vramVal.textContent = `${ai.vram}GB`;

                if(ai.telemetry) {
                    const t = ai.telemetry;
                    const tokensVal = document.getElementById('ai-tokens-val');
                    if (tokensVal) tokensVal.textContent = `${(t.tokens_per_sec || 0).toFixed(1)}/s`;
                    const visionVal = document.getElementById('ai-vision-val');
                    if (visionVal) visionVal.textContent = `${(t.vision_latency || 0).toFixed(1)}s`;
                    const toolsVal = document.getElementById('ai-tools-val');
                    if (toolsVal) toolsVal.textContent = `${(t.tool_latency || 0).toFixed(1)}s`;
                }
            }
        } catch (error) {
            telemetryStaleCount++;
            if (telemetryStaleCount >= 3) {
                setStale(sysCard, true);
                setStale(document.querySelector('.thermals-panel'), true);
            }
            console.warn("Telemetry fetch failed", error.message);
        }
    }
    setTimeout(updateTelemetry, 3000);
}

// ═══════════════════════════════════════════════════════════
// THREAT DETECTION (Security view)
// ═══════════════════════════════════════════════════════════
async function fetchThreats() {
    try {
        const res = await api('/api/threats', { timeout: 8000 });
        if (res.ok) {
            const data = await res.json();
            const box = document.getElementById('threat-box');
            const val = document.getElementById('threat-val');
            const msg = document.getElementById('threat-msg');

            if(data.status === 'ELEVATED') {
                if(val && val.textContent !== 'ELEVATED') {
                    showToast('SECURITY ALERT', 'Anomalous login activity detected!', 'error');
                }
                box?.classList.add('elevated');
                if(val) val.textContent = 'ELEVATED';
            } else {
                box?.classList.remove('elevated');
                if(val) val.textContent = 'CLEAR';
            }
            if(msg && data.message) msg.textContent = data.message;
        }
    } catch(e) {}
    setTimeout(fetchThreats, 10000);
}

// ═══════════════════════════════════════════════════════════
// QUICK ACTIONS & MEDIA
// ═══════════════════════════════════════════════════════════
async function refreshScreenPreview() {
    try {
        const res = await api(`/api/captures/last_screen?t=${Date.now()}`, { method: 'HEAD' });
        if (!res.ok) return;
        const img = document.getElementById('screen-preview-img');
        const container = document.getElementById('screen-preview-container');
        const span = container?.querySelector('.screen-preview-empty-text');
        if (img && container) {
            img.src = `/api/captures/last_screen?t=${Date.now()}`;
            img.style.display = 'block';
            if (span) span.style.display = 'none';
            container.classList.add('has-image');
        }
    } catch (e) {}
}

async function handleFluentCommand(command) {
    if (window.auraState === 'listening') return;

    commandInput.disabled = true;
    setAuraState('processing');
    clearInterval(visInterval);
    visInterval = setInterval(() => animateVisualizer(true), 100);

    await appendToTerminal(`[SYSTEM ACTION] ${command}`, 'user');

    try {
        const response = await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: command, use_voice_output: true }),
            timeout: 120000
        });
        const data = await response.json();

        setAuraState('idle');
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;

        if (data.response) {
            playTTS(data.response);
            await appendToTerminal(data.response, 'aura');

            // If the command was to read screen, refresh the thumbnail
            if (command.includes('read my screen')) {
                refreshScreenPreview();
            }
        } else {
            await appendToTerminal('No response received.', 'error');
        }
    } catch (error) {
        setAuraState('idle');
        clearInterval(visInterval);
        visInterval = setInterval(() => animateVisualizer(false), 100);
        commandInput.disabled = false;
        await appendToTerminal('CONNECTION FAILED', 'error');
    }
}

document.getElementById('qa-read-screen')?.addEventListener('click', () => handleFluentCommand('read my screen'));
document.getElementById('qa-lock')?.addEventListener('click', () => handleFluentCommand('lock the system'));
document.getElementById('qa-web')?.addEventListener('click', () => handleFluentCommand('search the web for the latest news'));
document.getElementById('qa-scan')?.addEventListener('click', () => handleFluentCommand('run a basic threat scan on the system'));

// Media Control bindings
document.getElementById('sp-play')?.addEventListener('click', () => handleFluentCommand('toggle media playback'));
document.getElementById('sp-next')?.addEventListener('click', () => handleFluentCommand('play next track'));
document.getElementById('sp-prev')?.addEventListener('click', () => handleFluentCommand('play previous track'));

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
const lightboxOverlay = document.getElementById('lightbox-overlay');
document.getElementById('screen-preview-container')?.addEventListener('click', () => {
    const img = document.getElementById('screen-preview-img');
    const lightboxImg = document.getElementById('lightbox-img');
    if (img && img.style.display !== 'none' && lightboxOverlay && lightboxImg && img.src) {
        lightboxImg.src = img.src;
        lightboxOverlay.classList.add('open');
    }
});
lightboxOverlay?.addEventListener('click', () => lightboxOverlay.classList.remove('open'));

// ═══════════════════════════════════════════════════════════
// SCHEDULE & REMINDERS (Chat rail)
// ═══════════════════════════════════════════════════════════
let lastScheduleHash = null;

async function fetchSchedule() {
    try {
        const res = await api('/api/schedule', { timeout: 8000 });
        if(res.ok) {
            const data = await res.json();
            const hash = JSON.stringify(data);
            if (hash !== lastScheduleHash) {
                lastScheduleHash = hash;
                const list = document.getElementById('schedule-list');
                if(list) {
                    list.innerHTML = '';
                    if (!data || data.length === 0) {
                        list.innerHTML = '<div class="schedule-empty">No scheduled events.</div>';
                    } else {
                        data.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'schedule-item';
                            const timeSpan = document.createElement('span');
                            timeSpan.textContent = item.time;
                            const eventSpan = document.createElement('span');
                            eventSpan.textContent = item.event;
                            div.appendChild(timeSpan);
                            div.appendChild(eventSpan);
                            list.appendChild(div);
                        });
                    }
                }
            }
        }
    } catch(e) {}
    setTimeout(fetchSchedule, 30000);
}

document.getElementById('btn-add-sched')?.addEventListener('click', async () => {
    const time = document.getElementById('sched-time').value.trim();
    const event = document.getElementById('sched-event').value.trim();
    if(!time || !event) return;

    try {
        const res = await api('/api/schedule', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({time, event})
        });
        const data = await res.json();
        if(data.status === 'success') {
            document.getElementById('sched-time').value = '';
            document.getElementById('sched-event').value = '';
            lastScheduleHash = null; // force re-render
            showToast('SCHEDULE UPDATED', `Added: ${event}`, 'success');
            fetchSchedule();
        }
    } catch(e) {
        showToast('SCHEDULE ERROR', 'Could not reach the backend.', 'error');
    }
});

// ═══════════════════════════════════════════════════════════
// NETWORK GRID LOGIC (force-directed graph, Security view)
// ═══════════════════════════════════════════════════════════
let networkNodes = [];
let netSimulation = null;
let netTooltip = null;

function sendPrompt(text) {
    if (!text || !commandInput || commandInput.disabled) return;
    showView('chat');
    commandInput.value = text;
    commandInput.dispatchEvent(new Event('input'));
    commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    commandInput.focus();
}

async function fetchNetworkScan() {
    try {
        const btn = document.getElementById('btn-net-scan');
        if(btn) btn.textContent = 'SCANNING…';
        const res = await api('/api/network/scan', { timeout: 45000 });
        if(!res.ok) throw new Error('scan failed');
        const data = await res.json();

        networkNodes = data.nodes || [];
        renderNetworkGraph();
        if(btn) btn.textContent = 'SCAN';
    } catch(e) {
        const btn = document.getElementById('btn-net-scan');
        if(btn) btn.textContent = 'SCAN';
        showToast('NETWORK SCAN FAILED', 'Could not complete the scan.', 'error');
    }
}

function netNodeColor(d) {
    if (d.kind === 'local') return 'var(--cyan)';
    if (d.kind === 'suspicious') return 'var(--red)';
    return 'var(--amber)';
}

function renderNetworkGraph() {
    const svg = document.getElementById('network-svg');
    if (!svg) return;
    if (typeof d3 === 'undefined') return; // vendor lib unavailable

    const container = svg.parentElement;
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    if (width < 10 || height < 10) return;

    if (netSimulation) { netSimulation.stop(); netSimulation = null; }

    if (!netTooltip || !container.contains(netTooltip)) {
        netTooltip = document.createElement('div');
        netTooltip.className = 'network-tooltip';
        container.appendChild(netTooltip);
    }

    const nodes = [{ id: 'local', label: 'LOCAL', kind: 'local', port: null, process: 'aura-host' }];
    const links = [];
    networkNodes.forEach((n, i) => {
        const id = n.ip || ('node-' + i);
        const suspicious = n.type === 'suspicious' || n.suspicious === true;
        nodes.push({
            id: id,
            label: n.ip || id,
            kind: suspicious ? 'suspicious' : 'external',
            mac: n.mac,
            port: n.port,
            process: n.process
        });
        links.push({ source: 'local', target: id });
    });

    d3.select(svg).selectAll('*').remove();
    const root = d3.select(svg).attr('width', width).attr('height', height);

    const linkSel = root.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', 0.5)
        .style('stroke', 'rgba(148,163,184,0.25)');

    const nodeSel = root.append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('class', 'net-node')
        .attr('r', 5)
        .style('fill', netNodeColor)
        .call(d3.drag()
            .on('start', (event, d) => {
                if (!event.active) netSimulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            })
            .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
            .on('end', (event, d) => {
                if (!event.active) netSimulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            })
        );

    const labelSel = root.append('g')
        .selectAll('text')
        .data(nodes)
        .join('text')
        .attr('class', 'net-label')
        .attr('dy', 12)
        .text(d => d.label);

    nodeSel
        .on('mouseover', (event, d) => {
            const port = d.port !== undefined && d.port !== null ? d.port : '—';
            const proc = d.process || '—';
            netTooltip.innerHTML = `PORT: ${escapeHtml(String(port))} | PROC: ${escapeHtml(String(proc))}` +
                (d.mac ? `<br>MAC: ${escapeHtml(d.mac)}` : '') +
                (d.id !== 'local' ? `<br>IP: ${escapeHtml(d.id)}` : '');
            netTooltip.style.display = 'block';
        })
        .on('mousemove', (event) => {
            const rect = container.getBoundingClientRect();
            const x = event.clientX - rect.left + 10;
            const y = event.clientY - rect.top - 10;
            netTooltip.style.left = Math.min(x, rect.width - netTooltip.offsetWidth - 4) + 'px';
            netTooltip.style.top = Math.max(2, y) + 'px';
        })
        .on('mouseout', () => { netTooltip.style.display = 'none'; })
        .on('click', (event, d) => {
            netTooltip.style.display = 'none';
            const details = [];
            if (d.port) details.push('port ' + d.port);
            if (d.process) details.push('process ' + d.process);
            if (d.mac) details.push('mac ' + d.mac);
            if (d.id !== 'local') details.push('ip ' + d.id);
            const prefix = d.port ? `Analyze port ${d.port}` : `Analyze host ${d.id}`;
            sendPrompt(`${prefix}: ${details.join(', ')}`);
        });

    netSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(55))
        .force('charge', d3.forceManyBody().strength(-50))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .on('tick', () => {
            linkSel
                .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            nodeSel
                .attr('cx', d => d.x).attr('cy', d => d.y);
            labelSel
                .attr('x', d => d.x).attr('y', d => d.y);
        });
}

document.getElementById('btn-net-scan')?.addEventListener('click', fetchNetworkScan);
let netResizeTimer = null;
window.addEventListener('resize', () => {
    if (!networkNodes.length || !isViewActive('security')) return;
    clearTimeout(netResizeTimer);
    netResizeTimer = setTimeout(renderNetworkGraph, 200);
});

// ═══════════════════════════════════════════════════════════
// PROCESS MANAGER (System view) — diff-render + confirm kill
// ═══════════════════════════════════════════════════════════
let lastProcessHash = null;
let processFailures = 0;

async function fetchProcesses() {
    const pollActive = isViewActive('system');
    if (!document.hidden && pollActive) {
        try {
            const res = await api('/api/processes', { timeout: 8000 });
            if(res.ok) {
                const data = await res.json();
                processFailures = 0;
                setStale(document.querySelector('.process-panel'), false);
                const hash = JSON.stringify(data.processes || []);
                if (hash !== lastProcessHash) {
                    lastProcessHash = hash;
                    renderProcesses(data.processes || []);
                }
            }
        } catch(e) {
            processFailures++;
            if (processFailures >= 3) setStale(document.querySelector('.process-panel'), true);
        }
    }
    setTimeout(fetchProcesses, pollActive ? 5000 : 30000);
}

function renderProcesses(processes) {
    const list = document.getElementById('process-list');
    if(!list) return;
    list.innerHTML = '';

    if (processes.length === 0) {
        list.innerHTML = '<div class="empty-note">No processes reported.</div>';
        return;
    }

    processes.forEach(p => {
        const div = document.createElement('div');
        div.className = 'process-item';
        div.innerHTML = `
            <div class="process-info">
                <span class="process-name">${escapeHtml(p.name)} <span class="mono">· PID ${escapeHtml(String(p.pid))}</span></span>
                <span class="process-stats">CPU ${Number(p.cpu).toFixed(1)}% · MEM ${Number(p.mem).toFixed(1)}%</span>
            </div>
            <button class="btn-kill" data-pid="${escapeHtml(String(p.pid))}" data-name="${escapeHtml(p.name)}">KILL</button>
        `;
        list.appendChild(div);
    });

    list.querySelectorAll('.btn-kill').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const pid = e.currentTarget.dataset.pid;
            const name = e.currentTarget.dataset.name;
            const confirmed = await confirmAction({
                title: 'Terminate process',
                message: `Kill "${name}" (PID ${pid})? This cannot be undone.`,
                okLabel: 'KILL'
            });
            if (!confirmed) return;
            try {
                const kRes = await api('/api/processes/kill', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({pid: parseInt(pid)})
                });
                const kData = await kRes.json();
                if(kData.status === 'success') {
                    showToast('PROCESS TERMINATED', `PID: ${pid}`, 'warning');
                    lastProcessHash = null;
                    fetchProcesses();
                } else {
                    showToast('TERMINATION FAILED', kData.message || 'Unknown error', 'error');
                }
            } catch(err) {
                showToast('TERMINATION FAILED', 'Could not reach the backend.', 'error');
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════
// SECURITY CLEARANCE (pending tool permissions)
// ═══════════════════════════════════════════════════════════
const permissionsList = document.getElementById('permissions-list');
const trustedModeToggle = document.getElementById('trusted-mode-toggle');

async function fetchPermissions() {
    if (!permissionsList) return;
    if (document.hidden) return;
    try {
        const res = await api('/api/permissions/pending', { timeout: 8000 });
        if (!res.ok) return;
        const data = await res.json();

        if (trustedModeToggle && !trustedModeToggle.matches(':focus')) {
            trustedModeToggle.checked = !!data.trusted_automation;
        }

        const pending = data.pending || {};
        if (Object.keys(pending).length === 0) {
            if (!permissionsList.dataset.empty) {
                permissionsList.innerHTML = '<div class="empty-note">NO PENDING ACTIONS</div>';
                permissionsList.dataset.empty = "1";
            }
            return;
        }
        delete permissionsList.dataset.empty;
        permissionsList.innerHTML = '';

        Object.values(pending).forEach(action => {
            const item = document.createElement('div');
            item.className = 'perm-item';

            const label = document.createElement('div');
            label.className = 'perm-label';
            label.textContent = `[${action.risk}] ${action.tool_name}(${JSON.stringify(action.arguments).substring(0, 80)})`;

            const btnRow = document.createElement('div');
            btnRow.className = 'perm-actions';

            const approveBtn = document.createElement('button');
            approveBtn.className = 'qa-btn compact';
            approveBtn.style.color = 'var(--green)';
            approveBtn.textContent = 'AUTHORIZE';
            approveBtn.addEventListener('click', async () => {
                try {
                    await api(`/api/permissions/confirm/${action.id}`, { method: 'POST' });
                    showToast('ACTION AUTHORIZED', action.tool_name, 'success');
                    fetchPermissions();
                } catch(e) { showToast('ERROR', 'Authorization failed', 'error'); }
            });

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'qa-btn compact';
            rejectBtn.style.color = 'var(--danger)';
            rejectBtn.textContent = 'REJECT';
            rejectBtn.addEventListener('click', async () => {
                try {
                    await api(`/api/permissions/reject/${action.id}`, { method: 'POST' });
                    showToast('ACTION REJECTED', action.tool_name, 'info');
                    fetchPermissions();
                } catch(e) { showToast('ERROR', 'Rejection failed', 'error'); }
            });

            btnRow.appendChild(approveBtn);
            btnRow.appendChild(rejectBtn);
            item.appendChild(label);
            item.appendChild(btnRow);
            permissionsList.appendChild(item);
        });
    } catch (e) {}
}

if (trustedModeToggle) {
    trustedModeToggle.addEventListener('change', async () => {
        try {
            await api('/api/permissions/trusted_mode', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: trustedModeToggle.checked})
            });
            showToast('TRUSTED MODE', trustedModeToggle.checked ? 'MEDIUM-risk tools will auto-execute.' : 'All MEDIUM-risk tools require approval.', trustedModeToggle.checked ? 'warning' : 'info');
        } catch(e) {
            showToast('ERROR', 'Could not update trusted mode.', 'error');
        }
    });
}
setInterval(fetchPermissions, 3000);
fetchPermissions();

// ═══════════════════════════════════════════════════════════
// NOTIFICATION DRAWER & POLLING
// ═══════════════════════════════════════════════════════════
const notifDrawer = document.getElementById('notif-drawer');
const notifBell = document.getElementById('notif-bell');
const notifBadge = document.getElementById('notif-badge');
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

async function pollNotifications() {
    if (document.hidden) return;
    try {
        const response = await api('/api/notifications', { timeout: 8000 });
        if (!response.ok) return;
        const data = await response.json();

        if (data.has_notification && data.message) {
            if (data.message === '__WAKE_WORD__') {
                if (wakeWordActive && canStartListening() && voiceBtn) voiceBtn.click();
                return;
            }
            playTTS(data.message);
            await appendToTerminal(data.message, 'aura');
            showToast('AURA NOTIFICATION', data.message.substring(0, 50) + '...', 'info');

            const list = document.getElementById('notif-list');
            if(list) {
                const item = document.createElement('div');
                item.className = 'notif-item';
                const timeStr = new Date().toLocaleTimeString();
                const timeDiv = document.createElement('div');
                timeDiv.className = 'notif-time';
                timeDiv.textContent = timeStr;
                const msgDiv = document.createElement('div');
                msgDiv.textContent = data.message;
                item.appendChild(timeDiv);
                item.appendChild(msgDiv);
                list.prepend(item);

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
pollNotifications();

// ═══════════════════════════════════════════════════════════
// WAKE WORD ("Hey Aura")
// ═══════════════════════════════════════════════════════════
let wakeWordActive = false;
let wakeRecognition = null;
const wakeWordToggle = document.getElementById('wake-word-toggle');
const wakeWordStatus = document.getElementById('wake-word-status');
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
                if (canStartListening()) voiceBtn.click();
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

function toggleWakeWord() {
    wakeWordActive = !wakeWordActive;
    // Keep the backend openwakeword listener in sync with the HUD toggle
    api('/api/wakeword/toggle', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: wakeWordActive})
    }).catch(() => {});
    wakeWordToggle?.setAttribute('aria-checked', String(wakeWordActive));
    if (wakeWordActive) {
        wakeWordStatus.textContent = 'ACTIVE';
        wakeWordStatus.className = 'status-active module-status';
        try { wakeRecognition.start(); } catch(e) {}
        showToast('MODULE ACTIVE', 'Wake word "Hey Aura" enabled.', 'info');
    } else {
        wakeWordStatus.textContent = 'OFF';
        wakeWordStatus.className = 'status-idle module-status';
        try { wakeRecognition.stop(); } catch(e) {}
        showToast('MODULE OFFLINE', 'Wake word disabled.', 'warning');
    }
}
wakeWordToggle?.addEventListener('click', toggleWakeWord);
wakeWordToggle?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleWakeWord();
    }
});

// Sync the HUD toggle with the backend listener state on page load
(async () => {
    try {
        const res = await api('/api/wakeword/status', { timeout: 8000 });
        if (!res.ok) return;
        const data = await res.json();
        wakeWordActive = !!data.enabled;
        wakeWordToggle?.setAttribute('aria-checked', String(wakeWordActive));
        if (wakeWordActive) {
            wakeWordStatus.textContent = 'ACTIVE';
            wakeWordStatus.className = 'status-active module-status';
            try { wakeRecognition.start(); } catch(e) {}
        } else {
            wakeWordStatus.textContent = 'OFF';
            wakeWordStatus.className = 'status-idle module-status';
        }
    } catch (e) {}
})();

// ═══════════════════════════════════════════════════════════
// FILE EXPLORER (Files view)
// ═══════════════════════════════════════════════════════════
let currentFsPath = "";
async function fetchFileSystem(path = "") {
    try {
        const res = await api(`/api/fs?path=${encodeURIComponent(path)}`, { timeout: 10000 });
        if(res.ok) {
            const data = await res.json();
            if(data.status === 'success') {
                currentFsPath = data.current;
                const pathEl = document.getElementById('fs-path');
                if (pathEl) pathEl.textContent = currentFsPath || 'ROOT';

                const list = document.getElementById('fs-list');
                if(!list) return;
                list.innerHTML = "";

                if (!data.items || data.items.length === 0) {
                    list.innerHTML = '<div class="fs-empty">Empty directory.</div>';
                    return;
                }

                data.items.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'fs-item';
                    const icon = document.createElement('span');
                    icon.className = 'fs-icon';
                    icon.textContent = item.is_dir ? '📁' : '📄';
                    const name = document.createElement('span');
                    name.className = 'fs-name';
                    name.textContent = item.name;
                    div.appendChild(icon);
                    div.appendChild(name);

                    div.addEventListener('click', () => {
                        if(item.is_dir) {
                            fetchFileSystem(item.path);
                        } else {
                            showToast('FILE SELECTED', item.name, 'info');
                        }
                    });

                    list.appendChild(div);
                });
            } else {
                showToast('FS ERROR', data.message || 'Browse failed', 'error');
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

// ═══════════════════════════════════════════════════════════
// WEBCAM & FACIAL TRACKING — lazily initialized when the
// Security view is first opened; degrades to plain video.
// ═══════════════════════════════════════════════════════════
const FACE_API_SCRIPT = 'vendor/face-api.min.js';
const FACE_WEIGHTS_URI = 'vendor/face-api-model';
let webcamInitialized = false;

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function initWebcam() {
    if (webcamInitialized) return;
    webcamInitialized = true;

    const video = document.getElementById('webcam-video');
    const webcamCanvas = document.getElementById('webcam-canvas');
    const container = video?.closest('.webcam-container');
    if (!video || !webcamCanvas || !container) return;

    const startStream = () => navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => { video.srcObject = stream; container.classList.add('live'); })
        .catch(err => console.warn('Camera unavailable:', err));

    try {
        await loadScriptOnce(FACE_API_SCRIPT);
        await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_WEIGHTS_URI);
        await startStream();

        video.addEventListener('play', () => {
            const displaySize = { width: video.clientWidth, height: video.clientHeight };
            faceapi.matchDimensions(webcamCanvas, displaySize);
            setInterval(async () => {
                if (!isViewActive('security')) return;
                try {
                    const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
                    const resizedDetections = faceapi.resizeResults(detections, displaySize);
                    const ctx = webcamCanvas.getContext('2d');
                    ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);

                    resizedDetections.forEach(detection => {
                        const box = detection.box;
                        const accent = getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim() || '#00f0ff';
                        ctx.strokeStyle = accent;
                        ctx.lineWidth = 2;
                        ctx.strokeRect(box.x, box.y, box.width, box.height);

                        ctx.beginPath();
                        ctx.moveTo(box.x + box.width / 2, box.y);
                        ctx.lineTo(box.x + box.width / 2, box.y + box.height);
                        ctx.moveTo(box.x, box.y + box.height / 2);
                        ctx.lineTo(box.x + box.width, box.y + box.height / 2);
                        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
                        ctx.stroke();

                        ctx.fillStyle = accent;
                        ctx.font = '10px monospace';
                        ctx.fillText('TRACKING', box.x, box.y - 5);
                    });
                } catch (e) {}
            }, 350);
        });
    } catch (err) {
        // Model or library unavailable — plain camera feed only
        console.warn('Face tracking unavailable:', err);
        startStream();
    }
}

// ═══════════════════════════════════════════════════════════
// MEMORY ARCHIVE (Memory view) — confirm-before-delete
// ═══════════════════════════════════════════════════════════
const memoryList = document.getElementById('memory-list');
const memorySearch = document.getElementById('memory-search');
let allMemories = [];

async function fetchMemories() {
    try {
        const res = await api('/api/memory', { timeout: 8000 });
        if (res.ok) {
            allMemories = await res.json();
            applyMemoryFilter();
        }
    } catch (e) { console.warn('Error fetching memories:', e.message); }
}

function applyMemoryFilter() {
    if (!memorySearch) return renderMemories(allMemories);
    const term = memorySearch.value.toLowerCase();
    const filtered = allMemories.filter(m => m.content.toLowerCase().includes(term) || (m.category && m.category.toLowerCase().includes(term)));
    renderMemories(filtered);
}

function renderMemories(mems) {
    if (!memoryList) return;
    const prevScroll = memoryList.scrollTop;
    memoryList.innerHTML = '';
    if (mems.length === 0) {
        memoryList.innerHTML = '<div class="mem-empty">No long-term memories stored.</div>';
        return;
    }
    mems.forEach(mem => {
        const div = document.createElement('div');
        div.className = 'mem-item';

        const header = document.createElement('div');
        header.className = 'mem-header';

        const cat = document.createElement('span');
        cat.className = 'mem-category';
        cat.innerText = mem.category ? mem.category.toUpperCase() : 'GENERAL';

        const delBtn = document.createElement('button');
        delBtn.className = 'mem-delete';
        delBtn.setAttribute('aria-label', 'Delete memory');
        delBtn.innerText = '×';
        delBtn.onclick = async () => {
            const confirmed = await confirmAction({
                title: 'Delete memory',
                message: 'Permanently delete this memory from the archive?',
                okLabel: 'DELETE'
            });
            if (!confirmed) return;
            try {
                const res = await api(`/api/memory/${mem.id}`, { method: 'DELETE' });
                if(res.ok) fetchMemories();
            } catch(e) {}
        };

        header.appendChild(cat);
        header.appendChild(delBtn);

        const content = document.createElement('div');
        content.className = 'mem-content';
        content.innerText = mem.content;

        div.appendChild(header);
        div.appendChild(content);
        memoryList.appendChild(div);
    });
    memoryList.scrollTop = prevScroll;
}

if (memorySearch) {
    memorySearch.addEventListener('input', applyMemoryFilter);
}
fetchMemories();
// Keep MEMORY ARCHIVE in sync when AURA learns new memories
setInterval(fetchMemories, 10000);

// ═══════════════════════════════════════════════════════════
// PROACTIVE INTELLIGENCE (Settings view)
// ═══════════════════════════════════════════════════════════
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
        const res = await api('/api/proactive', { timeout: 8000 });
        if (res.ok) {
            const config = await res.json();
            proactiveEnabled = config.enabled !== false;
            if(toggleProactive) {
                toggleProactive.innerText = proactiveEnabled ? 'ON' : 'OFF';
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
            const res = await api('/api/proactive', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                btnSaveProactive.innerText = 'SAVED ✓';
                setTimeout(() => btnSaveProactive.innerText = 'SAVE CONFIG', 2000);
            }
        } catch(e) {
            showToast('SAVE FAILED', 'Could not save proactive config.', 'error');
        }
    });
}
fetchProactiveConfig();

// ═══════════════════════════════════════════════════════════
// LOCAL SECURITY CENTER (Security view)
// ═══════════════════════════════════════════════════════════
async function fetchSecurity() {
    if (document.hidden) return;
    try {
        const res = await api('/api/security', { timeout: 30000 });
        const data = await res.json();
        if (data.status === 'success') {
            const riskEl = document.getElementById('sec-risk-val');
            riskEl.innerText = data.risk_level;
            if (data.risk_level === 'LOW') {
                riskEl.style.color = 'var(--green)';
            } else if (data.risk_level === 'MEDIUM') {
                riskEl.style.color = 'var(--amber)';
            } else {
                riskEl.style.color = 'var(--danger)';
            }

            const alertsEl = document.getElementById('sec-alerts-container');
            alertsEl.innerHTML = '';
            if (data.alerts && data.alerts.length > 0) {
                data.alerts.forEach(alert => {
                    const d = document.createElement('div');
                    d.className = 'sec-alert-line bad';
                    d.innerText = `[!] ${alert}`;
                    alertsEl.appendChild(d);
                });
            } else {
                const ok = document.createElement('div');
                ok.className = 'sec-alert-line ok';
                ok.innerText = '[+] No critical alerts';
                alertsEl.appendChild(ok);
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
        console.warn("Security fetch failed:", err.message);
    }
}

document.getElementById('btn-sec-refresh')?.addEventListener('click', () => {
    const detailsEl = document.getElementById('sec-details-container');
    if(detailsEl) detailsEl.innerText = 'Scanning…';
    fetchSecurity();
});
fetchSecurity();
setInterval(fetchSecurity, 30000);

// ═══════════════════════════════════════════════════════════
// SYSTEM LOGS VIEWER (System view) — diff-render + smart scroll
// ═══════════════════════════════════════════════════════════
const logOutput = document.getElementById('log-output');
const btnLogRefresh = document.getElementById('btn-log-refresh');
let lastLogsRaw = '';

async function fetchLogs(manual = false) {
    if (!logOutput) return;
    if (!manual && (document.hidden || !isViewActive('system'))) return;
    try {
        const res = await api('/api/logs', { timeout: 8000 });
        const data = await res.json();
        if (data.status === 'success' && data.lines) {
            const raw = data.lines.join('\n');
            if (raw === lastLogsRaw && !manual) return;
            lastLogsRaw = raw;

            const nearBottom = logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight < 48;
            logOutput.innerHTML = '';
            data.lines.forEach(line => {
                const div = document.createElement('div');
                div.className = 'log-line';
                div.textContent = line;
                logOutput.appendChild(div);
            });
            if (nearBottom || manual) logOutput.scrollTop = logOutput.scrollHeight;
        } else if (manual) {
            lastLogsRaw = '';
            logOutput.innerHTML = '<div class="log-line log-error">[ERROR] Failed to read logs.</div>';
        }
    } catch (e) {
        if (manual) {
            lastLogsRaw = '';
            logOutput.innerHTML = '<div class="log-line log-error">[ERROR] Connection failed.</div>';
        }
    }
}

if (btnLogRefresh) {
    btnLogRefresh.addEventListener('click', () => fetchLogs(true));
}
// Auto-refresh only while the System view is open
setInterval(() => {
    if (isViewActive('system')) fetchLogs();
}, 10000);
fetchLogs();

// ═══════════════════════════════════════════════════════════
// THEME SWITCHER (presets only — Settings view)
// ═══════════════════════════════════════════════════════════
function applyPreset(preset) {
    document.documentElement.classList.remove('theme-crimson', 'theme-emerald', 'theme-violet');
    if (['theme-crimson', 'theme-emerald', 'theme-violet'].includes(preset)) {
        document.documentElement.classList.add(preset);
    }
    try {
        localStorage.setItem('aura-theme-v2', JSON.stringify({ preset: preset || '' }));
    } catch(e) {}

    document.querySelectorAll('.theme-dot').forEach(dot => {
        const dt = dot.getAttribute('data-theme') || '';
        const isActive = dt === (preset || '');
        dot.classList.toggle('active', isActive);
        dot.setAttribute('aria-pressed', String(isActive));
    });
}

document.querySelectorAll('.theme-dot').forEach(dot => {
    dot.addEventListener('click', () => applyPreset(dot.getAttribute('data-theme') || ''));
});

// Load theme on start
(function loadSavedTheme() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('aura-theme-v2')); } catch (e) {}
    applyPreset(saved?.preset || '');
})();

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
setTimeout(loadHistory, 1500);
updateTelemetry();
fetchSchedule();
fetchNetworkScan();
fetchProcesses();
refreshScreenPreview();
fetchThreats();
