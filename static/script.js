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
async function api(path, { method = 'GET', headers, body, timeout = 15000, signal = null, noThrow = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const linkAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', linkAbort, { once: true });
    }
    try {
        const res = await fetch(path, { method, headers, body, signal: controller.signal });
        ConnectionMonitor.record(res.ok);
        if (!res.ok && !noThrow) {
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return res;
    } catch (err) {
        ConnectionMonitor.record(false);
        throw err;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', linkAbort);
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
    // Brief variant of the shared boot (static/boot.js); typing audio per line.
    AuraBoot.run({ variant: 'brief', onLine: () => audioSys?.playTyping() });
}

// ═══════════════════════════════════════════════════════════
// VIEW ROUTER (sidebar navigation)
// ═══════════════════════════════════════════════════════════
const VIEW_NAMES = ['chat', 'reactor', 'system', 'security', 'files', 'memory', 'settings'];

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
    if (name === 'security') { initWebcam(); fetchThreats(); }
    // Reactor render loop only burns frames while the Reactor view is up
    reactor.setActive(name === 'reactor');
    // Bus events for hidden views are intentionally dropped; on activation,
    // pull one fresh snapshot immediately instead of waiting for the next tick.
    if (name === 'system') { fetchProcesses(); fetchLogs(); }
    if (name === 'settings') { initQuickActionsEditor(); }
    // In drawer mode (≤820px), choosing a destination closes the drawer.
    if (window.matchMedia('(max-width: 820px)').matches) setDrawer(false);
}

// ── Mobile navigation drawer (≤820px) ──
const menuBtn = document.getElementById('btn-menu');
const drawerBackdrop = document.getElementById('drawer-backdrop');

function setDrawer(open) {
    document.body.classList.toggle('drawer-open', open);
    menuBtn?.setAttribute('aria-expanded', String(!!open));
}

menuBtn?.addEventListener('click', () => {
    setDrawer(!document.body.classList.contains('drawer-open'));
});
drawerBackdrop?.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) setDrawer(false);
});

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ═══════════════════════════════════════════════════════════
// ARC REACTOR CORE — engine lives in reactor.js (window.AuraReactor)
// ═══════════════════════════════════════════════════════════
const reactor = window.AuraReactor || {
    setState() {}, setActive() {}, feed() {}, clearFeed() {}
};

// ═══════════════════════════════════════════════════════════
// VOICE STATE (reactor orb recoloring)
// ═══════════════════════════════════════════════════════════
const terminalOutput = document.getElementById('terminal-output');
const chatOutput = document.getElementById('chat-output');
window.auraState = 'idle';

// ── Centralized state machine with allowed transitions ──
const ALLOWED_TRANSITIONS = {
    idle: ['listening', 'processing', 'speaking', 'error'],
    listening: ['processing', 'speaking', 'idle', 'error'],
    processing: ['speaking', 'idle', 'error'],
    speaking: ['idle', 'listening', 'error'],  // listening = barge-in
    error: ['idle'],
};

const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function validateTransition(from, to) {
    const allowed = ALLOWED_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
        if (IS_DEV) {
            console.warn(`[StateMachine] Illegal transition: ${from} → ${to} (allowed: ${allowed.join(', ') || 'none'})`);
        }
        return false;
    }
    return true;
}

// ── Voice UX globals ──
let ttsQueue = [];                    // queue of {text, resolve, reject}
let isTtsPlaying = false;             // true while audio is actively playing
let audioGainNode = null;             // master gain for ducking during barge-in
let conversationModeArmed = false;    // true when auto-listen chain is armed
let micDenied = false;                // true when getUserMedia was denied

function setAuraState(state) {
    // Centralized transition; illegal moves are rejected (and logged in dev).
    if (!validateTransition(window.auraState, state)) {
        // Allow a forced return to idle as an escape hatch for error recovery,
        // but never silently accept an illegal forward move into a stuck state.
        if (state !== 'idle') return;
    }
    window.auraState = state;

    const vBtn = document.getElementById('voice-btn');
    const statusEl = vBtn?.querySelector('.core-status');

    let speed = 1.0;
    switch(state) {
        case 'idle': speed = 0.8; break;
        case 'listening': speed = 1.8; break;
        case 'processing': speed = 2.5; break;
        case 'speaking': speed = 1.2; break;
        case 'error': speed = 0.5; break;
    }
    document.documentElement.style.setProperty('--ring-speed', speed);

    // Update conversation-mode indicator visibility
    updateConversationIndicator(state);

    if (vBtn && statusEl) {
        vBtn.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking', 'state-error');
        vBtn.classList.add(`state-${state}`);
        statusEl.textContent =
            state === 'listening' ? 'HEARING' :
            state === 'processing' ? 'THINKING' :
            state === 'speaking' ? 'SPEAKING' :
            state === 'error' ? 'ERROR' : 'ONLINE';
    }

    // Reactor bay mirrors the same machine
    const bay = document.getElementById('reactor-bay');
    if (bay) {
        bay.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking', 'state-error');
        bay.classList.add(`state-${state}`);
    }
    const rStatus = document.getElementById('reactor-status');
    if (rStatus) {
        rStatus.textContent =
            state === 'listening' ? 'HEARING' :
            state === 'processing' ? 'THINKING' :
            state === 'speaking' ? 'SPEAKING' :
            state === 'error' ? 'ERROR' : 'ONLINE';
    }
    reactor.setState(state);
}

// ── Conversation-mode indicator (persistent "Listening..." pill) ──
let conversationIndicator = null;

function ensureConversationIndicator() {
    if (conversationIndicator) return conversationIndicator;
    const pill = document.createElement('div');
    pill.id = 'conversation-indicator';
    pill.className = 'conversation-pill';
    pill.innerHTML = `
        <span class="pill-dot"></span>
        <span class="pill-text">Listening…</span>
        <span class="pill-hint">Auto-chain armed — click to cancel</span>
    `;
    pill.title = 'AURA will keep listening after each reply (ends with "?"). Click to cancel.';
    pill.addEventListener('click', () => {
        conversationModeArmed = false;
        updateConversationIndicator(window.auraState);
    });
    // Insert near the input row
    const inputRow = document.querySelector('.input-row');
    if (inputRow) {
        inputRow.parentNode.insertBefore(pill, inputRow);
    }
    conversationIndicator = pill;
    return pill;
}

function updateConversationIndicator(state) {
    const pill = ensureConversationIndicator();
    if (!pill) return;
    const isArmed = conversationModeArmed && (state === 'idle' || state === 'speaking' || state === 'processing');
    pill.style.display = isArmed ? 'inline-flex' : 'none';
    // Reactor breathing: add a slow pulse class when armed
    const bay = document.getElementById('reactor-bay');
    if (bay) {
        bay.classList.toggle('breathing', isArmed);
    }
}

// ── Mic-denied inline banner ──
let micDeniedBanner = null;

function showMicDeniedBanner() {
    if (micDeniedBanner) return;
    const banner = document.createElement('div');
    banner.id = 'mic-denied-banner';
    banner.className = 'mic-denied-banner';
    banner.innerHTML = `
        <span class="banner-icon">🎤</span>
        <span class="banner-text">Microphone blocked — enable it in browser/site settings</span>
        <button type="button" class="qa-btn compact" id="mic-retry-btn">Retry</button>
    `;
    // Insert at top of chat/terminal output area
    const chatView = document.getElementById('view-chat');
    if (chatView) {
        chatView.insertBefore(banner, chatView.firstChild);
    }
    micDeniedBanner = banner;
    document.getElementById('mic-retry-btn')?.addEventListener('click', async () => {
        micDenied = false;
        hideMicDeniedBanner();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop()); // just test permission
            disableVoiceOrb(false);
            setAuraState('idle');
            showToast('MICROPHONE', 'Access restored.', 'success');
        } catch (e) {
            showMicDeniedBanner();
            setAuraState('error');
            showToast('MICROPHONE', 'Still blocked — check site permissions.', 'error');
        }
    });
}

function hideMicDeniedBanner() {
    if (micDeniedBanner) {
        micDeniedBanner.remove();
        micDeniedBanner = null;
    }
}

// ── Barge-in ripple on orb ──
function triggerBargeInRipple() {
    const vBtn = document.getElementById('voice-btn');
    if (!vBtn) return;
    const ripple = document.createElement('span');
    ripple.className = 'barge-ripple';
    vBtn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 300);
}

const commandInput = document.getElementById('command-input');
const voiceBtn = document.getElementById('voice-btn');

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
// Apply the default mode on load — without this, both outputs render at once
setConsoleMode(currentMode);

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
shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.classList.remove('active');
});

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
        return;
    }

    // Ctrl + M: Toggle Voice Core
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        voiceBtn.click();
        return;
    }

    // '?' to toggle shortcuts when not in an editable field
    const inEditable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === '?' && !inEditable) {
        e.preventDefault();
        toggleShortcuts();
        return;
    }

    // 1-7 to switch views when not typing in an input
    if (!inEditable && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= VIEW_NAMES.length) {
            e.preventDefault();
            showView(VIEW_NAMES[num - 1]);
            return;
        }
    }
});

// ═══════════════════════════════════════════════════════════
// AUDIO ANALYSERS (mic + TTS feed the reactor)
// ═══════════════════════════════════════════════════════════
let audioCtx = null;
let analyser = null;
let source = null;
let currentAudio = null;

// ════════════════════════════════════════════════════════════
// TTS QUEUE & PLAYBACK (with barge-in ducking, queue guard, error fallback)
// ════════════════════════════════════════════════════════════
async function playTTS(text) {
    if (!text) return;

    // Single play chain: if already speaking, queue (max depth 2, drop oldest).
    // Barge-in is decided by live-mic audio below, never by a racing reply.
    if (isTtsPlaying) {
        if (ttsQueue.length >= 2) {
            const dropped = ttsQueue.shift();
            dropped?.reject(new Error('TTS queue overflow'));
        }
        updateQueuePill();
        return new Promise((resolve, reject) => {
            ttsQueue.push({ text, resolve, reject });
            updateQueuePill();
        });
    }

    isTtsPlaying = true;
    updateQueuePill();
    setAuraState('speaking');

    let url = null;
    let audio = null;
    let drawLoopId = 0;
    let bargeFrameId = 0;
    let finished = false;

    try {
        await api('/api/voice/speaking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_speaking: true})
        });

        const response = await api(`/api/tts?text=${encodeURIComponent(text)}`, { timeout: 30000 });
        if (!response.ok) throw new Error('TTS fetch failed');

        const blob = await response.blob();
        url = URL.createObjectURL(blob);

        audio = new Audio(url);
        currentAudio = audio;

        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            audioGainNode = audioCtx.createGain(); // master gain for ducking
            audioGainNode.connect(audioCtx.destination);
        }
        // Restore unity gain in case a previous barge-in left it ducked.
        audioGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        audioGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

        if (audioCtx.state === 'suspended') await audioCtx.resume();
        if (source) { try { source.disconnect(); } catch (e) {} }

        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioGainNode);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function draw() {
            drawLoopId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);
            reactor.feed(dataArray, null);
        }

        // Barge-in: sample the live mic while speaking; trigger once on spike.
        function checkBargeIn() {
            if (finished) return;
            if (!micAnalyser || !micDataArray || !currentAudio || currentAudio.paused) {
                bargeFrameId = requestAnimationFrame(checkBargeIn);
                return;
            }
            micAnalyser.getByteFrequencyData(micDataArray);
            let sum = 0;
            for (let i = 0; i < micDataArray.length; i++) sum += micDataArray[i];
            const rms = sum / micDataArray.length;
            if (rms > 30) {
                handleBargeIn();
                return;
            }
            bargeFrameId = requestAnimationFrame(checkBargeIn);
        }

        function handleBargeIn() {
            if (finished) return;
            // Immediate ≤150ms feedback: duck gain, ripple, then clean stop.
            if (audioGainNode) {
                const t = audioCtx.currentTime;
                audioGainNode.gain.cancelScheduledValues(t);
                audioGainNode.gain.setValueAtTime(audioGainNode.gain.value, t);
                audioGainNode.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
            }
            triggerBargeInRipple();
            window._bargeIn = true;
            clearTtsQueue(); // user is redirecting the conversation
            api('/api/voice/stop', { method: 'POST' }).catch(() => {});
            if (audio) { audio.pause(); audio.dispatchEvent(new Event('ended')); }
        }

        audio.onended = () => {
            if (finished) return;
            finished = true;
            cancelAnimationFrame(drawLoopId);
            cancelAnimationFrame(bargeFrameId);
            reactor.clearFeed();
            if (url) URL.revokeObjectURL(url);
            currentAudio = null;
            window._lastPlaybackEnd = Date.now();
            isTtsPlaying = false;
            updateQueuePill();
            setAuraState('idle');
            api('/api/voice/speaking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({is_speaking: false})
            }).catch(() => {});
            processTtsQueue();

            if (window._bargeIn) {
                window._bargeIn = false;
                beginListen(); // user spoke over us — start a fresh listen now
                return;
            }

            if (conversationModeArmed) {
                // Keep the "Listening…" pill breathing through the 2s settle.
                setTimeout(() => {
                    if (canStartListening()) {
                        conversationModeArmed = false;
                        updateConversationIndicator(window.auraState);
                        beginListen();
                    } else {
                        conversationModeArmed = false;
                        updateConversationIndicator(window.auraState);
                        closeMic();
                    }
                }, 2100);
            } else {
                closeMic();
            }
        };

        await audio.play();
        draw();
        bargeFrameId = requestAnimationFrame(checkBargeIn);

    } catch (e) {
        if (finished) return;
        finished = true;
        console.error("Audio Playback Error:", e);
        cancelAnimationFrame(drawLoopId);
        cancelAnimationFrame(bargeFrameId);
        reactor.clearFeed();
        if (url) URL.revokeObjectURL(url);
        if (audio) { try { audio.pause(); } catch (err) {} }
        currentAudio = null;
        window._lastPlaybackEnd = Date.now();
        isTtsPlaying = false;
        updateQueuePill();
        showTtsFallback(text); // silent-mode fallback; never block chat
        setAuraState('idle');
        api('/api/voice/speaking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({is_speaking: false})
        }).catch(() => {});
        clearTtsQueue();
        closeMic();
    }
}

function clearTtsQueue() {
    ttsQueue.forEach(q => q.reject(new Error('TTS cancelled')));
    ttsQueue = [];
    updateQueuePill();
}

function processTtsQueue() {
    if (ttsQueue.length > 0 && !isTtsPlaying) {
        const next = ttsQueue.shift();
        playTTS(next.text).then(next.resolve, next.reject);
    }
}

function updateQueuePill() {
    let pill = document.getElementById('tts-queue-pill');
    if (ttsQueue.length > 0) {
        if (!pill) {
            pill = document.createElement('div');
            pill.id = 'tts-queue-pill';
            pill.className = 'queue-pill';
            const inputRow = document.querySelector('.input-row');
            if (inputRow) {
                inputRow.parentNode.insertBefore(pill, inputRow);
            }
        }
        pill.textContent = `Queued reply (${ttsQueue.length})`;
        pill.style.display = 'inline-flex';
    } else if (pill) {
        pill.style.display = 'none';
    }
}

function showTtsFallback(text) {
    // Silent-mode fallback: mark the reply as text-only (mute icon) without
    // duplicating the response that the normal render path already added.
    const bubbles = chatOutput.querySelectorAll('.bubble-aura:not(.tts-fallback)');
    const latest = bubbles[bubbles.length - 1];
    if (latest && latest.textContent.trim()) {
        latest.classList.add('tts-fallback');
        const icon = document.createElement('span');
        icon.className = 'mute-icon';
        icon.title = 'Audio playback failed — text only';
        icon.textContent = '🔇';
        latest.prepend(icon);
    } else {
        const chatDiv = document.createElement('div');
        chatDiv.className = 'chat-bubble bubble-aura tts-fallback';
        chatDiv.innerHTML = `
            <span class="mute-icon" title="Audio playback failed — text only">🔇</span>
            <span>${escapeHtml(text)}</span>
        `;
        chatOutput.appendChild(chatDiv);
        chatOutput.scrollTop = chatOutput.scrollHeight;
    }
    showToast('AUDIO', 'Playback failed — showing text only', 'warning');
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

// Runs one chat turn: requests the assistant reply (streaming by default) and
// renders it to the chat terminal, then plays TTS. Returns the final reply
// text ('' when the model produced nothing). Shared by the text-input path and
// the voice path so a spoken prompt gets the same live rendering as a typed one.
async function runChatTurn(text, images, fileTexts) {
    const payload = {
        message: text,
        images: images,
        file_texts: fileTexts
    };

    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'chat-bubble bubble-aura thinking';
    thinkingDiv.innerHTML = '<span class="dot-pulse"></span><span class="dot-pulse d2"></span><span class="dot-pulse d3"></span>';
    chatOutput.appendChild(thinkingDiv);
    chatOutput.scrollTop = chatOutput.scrollHeight;

    // Streaming transport by default; ?stream=off or window.AURA_STREAM_OFF
    // falls back to the classic blocking endpoint.
    const useStream = !window.AURA_STREAM_OFF &&
        new URLSearchParams(window.location.search).get('stream') !== 'off';

    let accumulatedText = '';

    if (useStream) {
        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok || !res.body) throw new Error('Stream request failed (HTTP ' + res.status + ')');

        thinkingDiv.remove();
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble bubble-aura';
        const statusDiv = document.createElement('div');
        statusDiv.className = 'stream-status';
        statusDiv.style.cssText = 'font-size:10px;opacity:.65;margin:4px 0 8px 2px;letter-spacing:.4px;min-height:12px;';
        chatOutput.appendChild(bubble);
        chatOutput.appendChild(statusDiv);

        let lastRender = 0;
        let renderTimer = null;
        let streamError = null;

        const renderPartial = () => {
            if (!accumulatedText) return;
            if (window.marked && window.DOMPurify) {
                bubble.innerHTML = DOMPurify.sanitize(marked.parse(accumulatedText));
            } else {
                bubble.textContent = accumulatedText;
            }
            chatOutput.scrollTop = chatOutput.scrollHeight;
        };
        // Throttle markdown re-rendering to ~150ms during streaming.
        const scheduleRender = () => {
            const now = Date.now();
            const elapsed = now - lastRender;
            if (elapsed >= 150) {
                lastRender = now;
                renderPartial();
            } else if (!renderTimer) {
                renderTimer = setTimeout(() => { renderTimer = null; scheduleRender(); }, 150 - elapsed);
            }
        };

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            sseBuf += decoder.decode(value, { stream: true });
            let sep;
            while ((sep = sseBuf.indexOf('\n\n')) !== -1) {
                const frame = sseBuf.slice(0, sep);
                sseBuf = sseBuf.slice(sep + 2);
                const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
                if (!dataLine) continue;
                let ev;
                try { ev = JSON.parse(dataLine.slice(5).trim()); } catch (e) { continue; }

                if (ev.type === 'token') {
                    accumulatedText += ev.text || '';
                    scheduleRender();
                } else if (ev.type === 'tool_start') {
                    statusDiv.textContent = 'Running ' + ev.tool + '\u2026';
                } else if (ev.type === 'tool_result') {
                    statusDiv.textContent = ev.tool + ' done.';
                } else if (ev.type === 'permission_request') {
                    statusDiv.textContent = 'Waiting for approval \u2014 ' + ev.tool + ' (' + ev.risk + '). Click AUTHORIZE in the panel or reply Yes.';
                } else if (ev.type === 'meta') {
                    // Intent info; no UI change needed yet.
                } else if (ev.type === 'done') {
                    accumulatedText = (typeof ev.text === 'string') ? ev.text : accumulatedText;
                } else if (ev.type === 'error') {
                    streamError = ev.message || 'Unknown pipeline error.';
                }
            }
        }
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }

        // Final render with syntax highlighting.
        if (accumulatedText) {
            if (window.marked && window.DOMPurify) {
                bubble.innerHTML = DOMPurify.sanitize(marked.parse(accumulatedText));
                if (window.hljs) {
                    bubble.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }
            } else {
                bubble.textContent = accumulatedText;
            }
        }
        statusDiv.textContent = streamError ? ('Error: ' + streamError) : '';
        setTimeout(() => statusDiv.remove(), streamError ? 10000 : 2000);
        chatOutput.scrollTop = chatOutput.scrollHeight;

        setAuraState('idle');

        if (streamError) throw new Error(streamError);

        if (accumulatedText) {
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
    } else {
        const response = await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: 300000 // agent may loop through tools for minutes
        });

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        accumulatedText = (data && typeof data.response === 'string') ? data.response : '';

        thinkingDiv.remove();
        setAuraState('idle');

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
    }

    return accumulatedText;
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

        try {
            const images = pendingAttachments.images.length > 0 ? pendingAttachments.images : null;
            const fileTexts = pendingAttachments.file_texts.length > 0 ? pendingAttachments.file_texts : null;
            clearAttachments();

            await runChatTurn(text, images, fileTexts);
        } catch (error) {
            console.error('Chat error:', error);
            setAuraState('idle');
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

async function startVoiceInteraction() {
    if (window.auraState === 'listening') return;

    // Barge-in: user clicked to take over while AURA was speaking.
    if (isTtsPlaying && currentAudio) {
        conversationModeArmed = false;
        updateConversationIndicator(window.auraState);
        clearTtsQueue();
        triggerBargeInRipple();
        api('/api/voice/stop', { method: 'POST' }).catch(() => {});
        currentAudio.pause();
        currentAudio.dispatchEvent(new Event('ended')); // route through onended cleanup
    }

    await beginListen();
}

// Open the mic once per interaction (reused across auto-continue turns).
async function beginListen() {
    // Attempt to open browser mic for canvas visualizer, but never block backend voice input
    try {
        await ensureMicOpen();
    } catch (e) {
        console.warn('Browser mic visualizer unavailable:', e);
    }

    if (window.auraState === 'listening') return;
    setAuraState('listening');
    commandInput.disabled = true;
    voiceBtn.setAttribute('aria-pressed', 'true');
    startMicAnim();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await api('/api/voice/listen', {
            method: 'POST',
            signal: controller.signal
        });
        const data = await response.json();

        stopMicAnim();
        voiceBtn.setAttribute('aria-pressed', 'false');
        commandInput.disabled = false;

        if (data.status === 'success' && data.transcription) {
            await appendToTerminal(data.transcription, 'user');
            // The reply is fetched and streamed separately so a slow local model
            // never delays appearance of the user's own words.
            setAuraState('processing');
            let reply = '';
            try {
                reply = (await runChatTurn(data.transcription, null, null)) || '';
            } catch (e) {
                console.error('Voice chat error:', e);
                const msg = ConnectionMonitor.isOffline
                    ? 'CONNECTION FAILED — backend unreachable.'
                    : 'Request failed or timed out.';
                await appendToTerminal(msg, 'error');
                showToast('REQUEST FAILED', msg, 'error');
            }
            const autoListenEnabled = localStorage.getItem('aura_auto_listen') === 'true';
            conversationModeArmed = autoListenEnabled && !!reply && reply.trim().endsWith('?');
            updateConversationIndicator(window.auraState);
            // runChatTurn already played TTS; mic stays open for barge-in.
            if (!isTtsPlaying && !conversationModeArmed) closeMic();
        } else if (data.status === 'no_speech') {
            conversationModeArmed = false;
            updateConversationIndicator(window.auraState);
            // Settle quietly back to idle; do not spam terminal history
            console.log('[VOICE] No speech detected; returning to idle.');
            closeMic();
        } else {
            conversationModeArmed = false;
            updateConversationIndicator(window.auraState);
            await appendToTerminal(data.message || 'VOICE ERROR', 'error');
            closeMic();
        }
    } catch (error) {
        stopMicAnim();
        if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            showToast('LISTENING', "Didn't catch that — try again", 'warning');
            await appendToTerminal('Listening timeout.', 'system');
        } else if (error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
            micDenied = true;
            showMicDeniedBanner();
            setAuraState('error');
            disableVoiceOrb(true);
        } else {
            await appendToTerminal('MIC CONNECTION FAILED', 'error');
            showToast('VOICE ERROR', 'Could not reach the voice service.', 'error');
        }
        closeMic();
    } finally {
        clearTimeout(timeoutId);
        stopMicAnim();
        voiceBtn.setAttribute('aria-pressed', 'false');
        commandInput.disabled = false;
        // Never linger in a transient state: if still "listening" (not handed
        // off to speaking), settle back to idle.
        if (window.auraState === 'listening') setAuraState('idle');
    }
}

voiceBtn.addEventListener('click', () => { startVoiceInteraction(); });

// Click-to-listen on the arc reactor core itself (mouse + keyboard)
const reactorBayEl = document.getElementById('reactor-bay');
reactorBayEl?.addEventListener('click', () => { startVoiceInteraction(); });
reactorBayEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startVoiceInteraction();
    }
});

// Live Mic Logic — mic stays open across a turn (listen → speak → maybe
// auto-relisten) so barge-in can sample user audio during TTS playback.
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

function disableVoiceOrb(on) {
    if (!voiceBtn) return;
    // Keep voice orb interactive so user can trigger backend listening anytime
    voiceBtn.removeAttribute('aria-disabled');
    voiceBtn.title = 'Start voice interaction';
}

// Acquire and wire the mic stream + analyser for canvas visualizer only.
// If browser mic permission is denied or unsupported, it gracefully returns false
// without disabling or blocking the backend voice listener.
async function ensureMicOpen() {
    if (micStream && micAnalyser && micAudioCtx && micAudioCtx.state !== 'closed') {
        return true;
    }
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micDenied = false;
            hideMicDeniedBanner();

            micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = micAudioCtx.createMediaStreamSource(micStream);
            micAnalyser = micAudioCtx.createAnalyser();
            micAnalyser.fftSize = 256;
            source.connect(micAnalyser);
            micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
            return true;
        }
    } catch (err) {
        console.warn('Browser mic visualizer unavailable (backend listening active):', err && err.name);
    }
    return false;
}

function startMicAnim() {
    if (!micAnalyser) return;
    stopMicAnim();
    const micTimeArray = new Uint8Array(micAnalyser.fftSize);
    function renderMic() {
        if (window.auraState !== 'listening') { micAnimFrame = 0; return; }
        micAnimFrame = requestAnimationFrame(renderMic);
        micAnalyser.getByteFrequencyData(micDataArray);
        micAnalyser.getByteTimeDomainData(micTimeArray);
        let sum = 0;
        for (let i = 0; i < micTimeArray.length; i++) {
            let val = (micTimeArray[i] - 128) / 128;
            sum += val * val;
        }
        let rms = Math.sqrt(sum / micTimeArray.length);
        reactor.feed(micDataArray, micTimeArray);
        document.documentElement.style.setProperty('--ring-pulse', rms.toFixed(3));
    }
    micAnimFrame = requestAnimationFrame(renderMic);
}

function stopMicAnim() {
    if (micAnimFrame) cancelAnimationFrame(micAnimFrame);
    micAnimFrame = 0;
    reactor.clearFeed();
    document.documentElement.style.setProperty('--ring-pulse', 0);
}

// Fully tear down the mic. Safe to call when not armed for auto-continue.
function closeMic() {
    stopMicAnim();
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (micAudioCtx && micAudioCtx.state !== 'closed') { try { micAudioCtx.close(); } catch (e) {} }
    micAudioCtx = null;
    micAnalyser = null;
    micDataArray = null;
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

// Renders a telemetry payload pushed by the SSE bus (or fetched by the legacy
// poller). One implementation, two transports.
function applyTelemetry(data) {
    if (!data || document.hidden) return;
    const sysCard = document.querySelector('.diagnostics-panel');
    try {
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
        console.warn("Telemetry render failed:", error.message);
    }
}

async function fetchTelemetry() {
    try {
        const response = await api('/api/telemetry', { timeout: 8000 });
        if (!response.ok) throw new Error('telemetry ' + response.status);
        applyTelemetry(await response.json());
    } catch (error) {
        console.warn("Telemetry fetch failed", error.message);
    }
}

// ═══════════════════════════════════════════════════════════
// THREAT DETECTION (Security view)
// ═══════════════════════════════════════════════════════════
function applyThreats(data) {
    if (!data || document.hidden) return;
    try {
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
    } catch(e) {}
}

async function fetchThreats() {
    try {
        const res = await api('/api/threats', { timeout: 8000 });
        if (res.ok) applyThreats(await res.json());
    } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
// QUICK ACTIONS & MEDIA
// ═══════════════════════════════════════════════════════════

// Icon SVG map — keys match icon names in config/quick_actions.json
const QUICK_ACTION_ICONS = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12h20M12 2v20M5 5l14 14M19 5L5 19"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-10h-9l1-8z"/></svg>',
};

async function loadQuickActions() {
    try {
        const res = await api('/api/config/ui', { timeout: 8000 });
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.quick_actions)) {
                return data.quick_actions;
            }
        }
    } catch (e) {
        console.warn('Failed to load quick actions from server, using defaults:', e);
    }
    // Fallback defaults (must match server defaults)
    return [
        {id: 'screen', label: 'Read Screen', icon: 'eye', prompt: 'read my screen and describe what you see', danger: false},
        {id: 'lock', label: 'Lock', icon: 'lock', prompt: 'lock the system', danger: true},
        {id: 'web', label: 'Web', icon: 'globe', prompt: 'search the web for the latest news', danger: false},
        {id: 'scan', label: 'Scan', icon: 'shield', prompt: 'run a basic threat scan on the system', danger: false},
    ];
}

function getIconSvg(iconName) {
    return QUICK_ACTION_ICONS[iconName] || QUICK_ACTION_ICONS.bolt;
}

function renderQuickActions(actions) {
    const container = document.querySelector('.quick-actions');
    if (!container) return;
    container.innerHTML = '';
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'qa-btn' + (action.danger ? ' danger' : '');
        btn.dataset.actionId = action.id;
        btn.title = action.label;
        btn.innerHTML = getIconSvg(action.icon) + '<span>' + action.label + '</span>';
        btn.addEventListener('click', () => {
            if (action.danger) {
                confirmAction({
                    title: 'Confirm ' + action.label,
                    message: 'This will execute: ' + action.prompt,
                    okLabel: action.label.toUpperCase(),
                }).then(confirmed => {
                    if (confirmed) handleFluentCommand(action.prompt);
                });
            } else {
                handleFluentCommand(action.prompt);
            }
        });
        container.appendChild(btn);
    });
    // Re-apply ripple effect to new buttons
    container.querySelectorAll('.qa-btn').forEach(btn => {
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
}

// Initialize quick actions on boot
async function initQuickActions() {
    const actions = await loadQuickActions();
    renderQuickActions(actions);
}

// Defer until DOM is ready; called from DOMContentLoaded handler below
document.addEventListener('DOMContentLoaded', () => {
    initQuickActions();
});

// ═══════════════════════════════════════════════════════════════
// QUICK ACTIONS SETTINGS EDITOR
// ═══════════════════════════════════════════════════════════════

let quickActionsCache = [];

function renderQuickActionsEditor(actions) {
    quickActionsCache = actions;
    const container = document.getElementById('quick-actions-editor');
    if (!container) return;
    container.innerHTML = '';
    
    actions.forEach((action, idx) => {
        const row = document.createElement('div');
        row.className = 'qa-editor-row';
        row.dataset.idx = idx;
        row.innerHTML = `
            <input type="hidden" class="qa-idx" value="${idx}">
            <input type="text" class="qa-label" value="${escapeHtml(action.label)}" placeholder="Label" aria-label="Action label">
            <input type="text" class="qa-prompt" value="${escapeHtml(action.prompt)}" placeholder="Prompt" aria-label="Action prompt" style="flex: 1;">
            <input type="text" class="qa-icon" value="${escapeHtml(action.icon)}" placeholder="Icon" aria-label="Icon name" style="width: 80px;">
            <label class="qa-danger-wrap">
                <input type="checkbox" class="qa-danger" ${action.danger ? 'checked' : ''} aria-label="Dangerous action">
                <span class="qa-danger-label">Danger</span>
            </label>
            <button type="button" class="qa-btn compact qa-delete" aria-label="Delete action">✕</button>
        `;
        container.appendChild(row);
    });
    
    // Bind delete buttons
    container.querySelectorAll('.qa-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const row = e.target.closest('.qa-editor-row');
            const idx = parseInt(row.dataset.idx, 10);
            quickActionsCache.splice(idx, 1);
            renderQuickActionsEditor(quickActionsCache);
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function loadQuickActionsEditor() {
    try {
        const res = await api('/api/config/ui', { timeout: 8000 });
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.quick_actions)) {
                renderQuickActionsEditor(data.quick_actions);
                return;
            }
        }
    } catch (e) {
        console.warn('Failed to load quick actions for editor:', e);
    }
    // Fallback to defaults
    const defaults = [
        {id: 'screen', label: 'Read Screen', icon: 'eye', prompt: 'read my screen and describe what you see', danger: false},
        {id: 'lock', label: 'Lock', icon: 'lock', prompt: 'lock the system', danger: true},
        {id: 'web', label: 'Web', icon: 'globe', prompt: 'search the web for the latest news', danger: false},
        {id: 'scan', label: 'Scan', icon: 'shield', prompt: 'run a basic threat scan on the system', danger: false},
    ];
    renderQuickActionsEditor(defaults);
}

async function saveQuickActions() {
    const container = document.getElementById('quick-actions-editor');
    if (!container) return;
    
    const rows = container.querySelectorAll('.qa-editor-row');
    const actions = [];
    
    for (const row of rows) {
        const label = row.querySelector('.qa-label').value.trim();
        const prompt = row.querySelector('.qa-prompt').value.trim();
        const icon = row.querySelector('.qa-icon').value.trim() || 'bolt';
        const danger = row.querySelector('.qa-danger').checked;
        
        if (!label || !prompt) {
            showToast('INVALID', 'Label and prompt are required for all actions', 'error');
            return;
        }
        
        actions.push({
            id: 'action-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            label: label,
            icon: icon,
            prompt: prompt,
            danger: danger,
        });
    }
    
    if (actions.length > 12) {
        showToast('TOO MANY', 'Maximum 12 actions allowed', 'error');
        return;
    }
    
    try {
        const res = await api('/api/config/ui', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actions }),
            timeout: 10000
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('SAVED', 'Quick actions updated', 'success');
            // Reload chips in chat view
            const fresh = await loadQuickActions();
            renderQuickActions(fresh);
        } else {
            showToast('ERROR', data.message || 'Save failed', 'error');
        }
    } catch (e) {
        console.error('Save quick actions failed:', e);
        showToast('ERROR', 'Failed to save: ' + e.message, 'error');
    }
}

// Bind add/save buttons when Settings view is shown
function bindQuickActionsEditorButtons() {
    document.getElementById('btn-add-quick-action')?.addEventListener('click', () => {
        const container = document.getElementById('quick-actions-editor');
        if (!container) return;
        const idx = quickActionsCache.length;
        const row = document.createElement('div');
        row.className = 'qa-editor-row';
        row.dataset.idx = idx;
        row.innerHTML = `
            <input type="hidden" class="qa-idx" value="${idx}">
            <input type="text" class="qa-label" value="" placeholder="Label" aria-label="Action label">
            <input type="text" class="qa-prompt" value="" placeholder="Prompt" aria-label="Action prompt" style="flex: 1;">
            <input type="text" class="qa-icon" value="bolt" placeholder="Icon" aria-label="Icon name" style="width: 80px;">
            <label class="qa-danger-wrap">
                <input type="checkbox" class="qa-danger" aria-label="Dangerous action">
                <span class="qa-danger-label">Danger</span>
            </label>
            <button type="button" class="qa-btn compact qa-delete" aria-label="Delete action">✕</button>
        `;
        container.appendChild(row);
        // Bind delete for new row
        row.querySelector('.qa-delete').addEventListener('click', (e) => {
            const r = e.target.closest('.qa-editor-row');
            const i = parseInt(r.dataset.idx, 10);
            quickActionsCache.splice(i, 1);
            renderQuickActionsEditor(quickActionsCache);
        });
    });
    
    document.getElementById('btn-save-quick-actions')?.addEventListener('click', saveQuickActions);
    
    // Replay onboarding setup
    document.getElementById('btn-replay-onboard')?.addEventListener('click', () => {
        if (window.Onboarding) window.Onboarding.reopen();
    });
}

// Call this when Settings view becomes active
function initQuickActionsEditor() {
    loadQuickActionsEditor();
    bindQuickActionsEditorButtons();
}

async function refreshScreenPreview() {
    const img = document.getElementById('screen-preview-img');
    const container = document.getElementById('screen-preview-container');
    const span = container?.querySelector('.screen-preview-empty-text');
    if (!img || !container) return;

    try {
        const res = await api(`/api/captures/last_screen?t=${Date.now()}`, { method: 'HEAD', noThrow: true });
        if (!res.ok) {
            img.style.display = 'none';
            if (span) span.style.display = 'block';
            container.classList.remove('has-image');
            return;
        }
        img.onload = () => {
            img.style.display = 'block';
            if (span) span.style.display = 'none';
            container.classList.add('has-image');
        };
        img.onerror = () => {
            img.style.display = 'none';
            if (span) span.style.display = 'block';
            container.classList.remove('has-image');
        };
        img.src = `/api/captures/last_screen?t=${Date.now()}`;
    } catch (e) {}
}

async function handleFluentCommand(command) {
    if (window.auraState === 'listening') return;

    commandInput.disabled = true;
    setAuraState('processing');

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
        commandInput.disabled = false;
        await appendToTerminal('CONNECTION FAILED', 'error');
    }
}

// Media Control bindings — direct transport control, no LLM in the loop.
document.getElementById('sp-prev')?.addEventListener('click', () => sendMediaControl('previous'));
document.getElementById('sp-play')?.addEventListener('click', () => sendMediaControl('playpause'));
document.getElementById('sp-next')?.addEventListener('click', () => sendMediaControl('next'));

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
function applySchedule(data) {
    if (!data || document.hidden) return;
    try {
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
    } catch(e) {}
}

async function fetchSchedule() {
    try {
        const res = await api('/api/schedule', { timeout: 8000 });
        if(res.ok) applySchedule(await res.json());
    } catch(e) {}
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
// PROCESS MANAGER (System view) — confirm kill
// ═══════════════════════════════════════════════════════════
function applyProcesses(data) {
    if (!data || document.hidden || !isViewActive('system')) return;
    setStale(document.querySelector('.process-panel'), false);
    renderProcesses(data.processes || []);
}

async function fetchProcesses() {
    try {
        const res = await api('/api/processes', { timeout: 8000 });
        if(res.ok) applyProcesses(await res.json());
    } catch(e) {}
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

function applyPermissions(data) {
    if (!permissionsList || !data || document.hidden) return;
    try {
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
async function fetchPermissions() {
    try {
        const res = await api('/api/permissions/pending', { timeout: 8000 });
        if (res.ok) applyPermissions(await res.json());
    } catch (e) {}
}
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

// The SSE bus only signals availability (it must not consume the shared
// server-side queue); this REST call remains the single consumer.
async function consumeNotifications() {
    if (document.hidden) return;
    try {
        const response = await api('/api/notifications', { timeout: 8000 });
        if (!response.ok) return;
        const data = await response.json();

        if (data.has_notification && data.message) {
            if (data.message === '__WAKE_WORD__') {
                if (Date.now() < wakeTestUntil) {
                    // Suppress launching full voice session while user is actively running the wake-word test
                    return;
                }
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
// Push-triggered consume: the bus wakes us when the queue is non-empty.
function onNotificationsUpdate(data) {
    if (!data || data.available === false) return;
    consumeNotifications();
}
consumeNotifications();

// ═══════════════════════════════════════════════════════════
// WAKE WORD ("Hey Aura") — server-side detection only.
//
// Detection runs exclusively in the backend (openWakeWord ONNX, see
// voice.py). The HUD toggle is a pure control for
// POST /api/wakeword/toggle {enabled}; state comes from
// GET /api/wakeword/status (5s poll) and the bus 'wakeword_status'
// broadcast fired on toggle. The browser mic opens only for
// visualization during active listening sessions.
// ═══════════════════════════════════════════════════════════
let wakeWordActive = false;
let wakeStatusError = null;      // last server-side model error, if any
let wakeTestUntil = 0;           // epoch ms the "Test detection" window ends
const wakeWordToggle = document.getElementById('wake-word-toggle');
const wakeWordStatus = document.getElementById('wake-word-status');
const wakeTestBtn = document.getElementById('btn-wake-test');

// One-time migration: the old client-side engine preference is obsolete.
try { localStorage.removeItem('aura-wakeword-engine'); } catch (e) {}

function applyWakeStatus(data) {
    if (!data) return;
    wakeWordActive = !!data.enabled;
    wakeStatusError = data.enabled && !data.model_loaded ? (data.error || 'model failed to load') : null;
    wakeWordToggle?.setAttribute('aria-checked', String(wakeWordActive));
    if (!wakeWordStatus) return;
    if (!wakeWordActive) {
        wakeWordStatus.textContent = 'OFF';
        wakeWordStatus.className = 'status-idle module-status';
        wakeWordStatus.title = 'Wake word disabled';
    } else if (wakeStatusError) {
        wakeWordStatus.textContent = 'ERROR';
        wakeWordStatus.className = 'status-error module-status';
        wakeWordStatus.title = 'Wake word detector failed: ' + wakeStatusError;
    } else if (!data.listening) {
        wakeWordStatus.textContent = 'ERROR';
        wakeWordStatus.className = 'status-error module-status';
        wakeWordStatus.title = 'Detector armed but the mic stream is not open yet '
            + '(startup, or no usable input device — check server logs).';
    } else {
        wakeWordStatus.textContent = 'LISTENING';
        wakeWordStatus.className = 'status-active module-status';
        const last = data.last_detection_ts ? new Date(data.last_detection_ts * 1000).toLocaleTimeString() : 'never';
        wakeWordStatus.title = `Listening for "Hey Aura" (threshold ${data.threshold ?? '—'}) · last detection: ${last}`
            + (data.false_positives_today ? ` · near-misses today: ${data.false_positives_today}` : '');
    }
}

async function fetchWakeStatus() {
    try {
        const res = await api('/api/wakeword/status', { timeout: 8000 });
        if (res.ok) applyWakeStatus(await res.json());
    } catch (e) {}
}

function toggleWakeWord() {
    const next = !wakeWordActive;
    // Optimistic flip; the status poll/broadcast corrects if the POST fails.
    applyWakeStatus({ enabled: next, model_loaded: true, threshold: undefined, last_detection_ts: 0 });
    api('/api/wakeword/toggle', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: next})
    }).then(() => fetchWakeStatus()).catch(() => { fetchWakeStatus(); });
    if (next) {
        showToast('MODULE ACTIVE', 'Wake word "Hey Aura" enabled (server detector).', 'info');
    } else {
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

// Test detection: arms a 10s window and reports whether the server
// detector registered a fresh "Hey Aura" (last_detection_ts advances).
// Purely informational — it does not trigger a listening session.
wakeTestBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() < wakeTestUntil) return;
    if (!wakeWordActive) {
        showToast('WAKE WORD OFF', 'Enable the wake word toggle first.', 'warning');
        return;
    }
    wakeTestUntil = Date.now() + 10000;
    const armedAtSec = Date.now() / 1000;
    wakeTestBtn.textContent = '…10s';
    wakeTestBtn.disabled = true;
    showToast('TEST ARMED', 'Say "Hey Aura" aloud now.', 'info');
    const poll = setInterval(async () => {
        let hit = false, last = null;
        try {
            const res = await api('/api/wakeword/status', { timeout: 4000 });
            if (res.ok) {
                const data = await res.json();
                last = data.last_detection_ts || 0;
                hit = last > armedAtSec;
                applyWakeStatus(data);
            }
        } catch (err) {}
        if (hit || Date.now() >= wakeTestUntil) {
            clearInterval(poll);
            wakeTestBtn.textContent = 'TEST';
            wakeTestBtn.disabled = false;
            wakeTestUntil = 0;
            if (hit) {
                showToast('TEST PASSED', `"Hey Aura" detected at ${new Date(last * 1000).toLocaleTimeString()}.`, 'success');
            } else {
                showToast('TEST FAILED', 'No detection within 10s. Check mic selection / model in server logs.', 'warning');
            }
        }
    }, 1000);
});

// Server pushes state on toggle; poll covers page load and missed events.
Realtime.on('wakeword_status', applyWakeStatus);
setInterval(() => { if (!document.hidden) fetchWakeStatus(); }, 5000);
fetchWakeStatus();

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
function applySecurity(data) {
    if (document.hidden || !data) return;
    try {
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

async function fetchSecurity() {
    if (document.hidden) return;
    try {
        const res = await api('/api/security', { timeout: 30000 });
        applySecurity(await res.json());
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

// ═══════════════════════════════════════════════════════════
// SYSTEM LOGS VIEWER (System view) — diff-render + smart scroll
// ═══════════════════════════════════════════════════════════
const logOutput = document.getElementById('log-output');
const btnLogRefresh = document.getElementById('btn-log-refresh');
const btnLogServer = document.getElementById('btn-log-server');
const btnLogAgent = document.getElementById('btn-log-agent');
let currentLogSource = 'server';

function setLogSource(source) {
    currentLogSource = source;
    btnLogServer?.classList.toggle('active', source === 'server');
    btnLogAgent?.classList.toggle('active', source === 'agent');
    fetchLogs(true);
}

btnLogServer?.addEventListener('click', () => setLogSource('server'));
btnLogAgent?.addEventListener('click', () => setLogSource('agent'));

function applyLogsData(data, manual = false) {
    if (!logOutput || !data) return;
    if (data.status === 'success' && data.lines) {
        const nearBottom = logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight < 48;
        logOutput.innerHTML = '';
        data.lines.forEach(line => {
            const div = document.createElement('div');
            div.className = 'log-line';
            if (line.includes('ERROR') || line.includes('error') || line.includes('failed') || line.includes('Fatal')) {
                div.classList.add('log-error');
            }
            div.textContent = line;
            logOutput.appendChild(div);
        });
        if (nearBottom || manual) logOutput.scrollTop = logOutput.scrollHeight;
    } else if (manual) {
        logOutput.innerHTML = `<div class="log-line log-error">[ERROR] ${data.message || 'Failed to read logs.'}</div>`;
    }
}

async function fetchLogs(manual = false) {
    if (!logOutput) return;
    if (!manual && (document.hidden || !isViewActive('system'))) return;
    try {
        const res = await api(`/api/logs?source=${encodeURIComponent(currentLogSource)}`, { timeout: 8000 });
        applyLogsData(await res.json(), manual);
    } catch (e) {
        if (manual) {
            logOutput.innerHTML = '<div class="log-line log-error">[ERROR] Connection failed.</div>';
        }
    }
}

if (btnLogRefresh) {
    btnLogRefresh.addEventListener('click', () => fetchLogs(true));
}
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
// ═══════════════════════════════════════════════════════════
// ACTIVE PLAN CARD (Chat rail) — SSE-driven, poll fallback
// ═══════════════════════════════════════════════════════════
const planPulse = document.getElementById('plan-pulse');
const planEmpty = document.getElementById('plan-empty');
const planBody = document.getElementById('plan-body');
const planGoal = document.getElementById('plan-goal');
const planStepsEl = document.getElementById('plan-steps');
const planFill = document.getElementById('plan-progress-fill');
const planProgressLabel = document.getElementById('plan-progress-label');
const planCancelBtn = document.getElementById('btn-plan-cancel');
const chatPlanBadge = document.getElementById('chat-plan-badge');
let lastPlanHash = null;
let currentPlanId = null;

function applyPlan(plan) {
    // Server already dedupes unchanged payloads; hash-skip guards against
    // duplicate deliveries and redundant poll results.
    const hash = JSON.stringify(plan);
    if (hash === lastPlanHash) return;
    lastPlanHash = hash;

    if (!plan || plan.status !== 'active') {
        // Completed or cancelled: collapse to the quiet empty-state.
        currentPlanId = null;
        if (planBody) planBody.hidden = true;
        if (planEmpty) planEmpty.hidden = false;
        if (planPulse) planPulse.hidden = true;
        if (planCancelBtn) planCancelBtn.hidden = true;
        if (chatPlanBadge) chatPlanBadge.hidden = true;
        return;
    }

    currentPlanId = plan.id;
    if (planEmpty) planEmpty.hidden = true;
    if (planBody) planBody.hidden = false;
    if (planPulse) planPulse.hidden = false;
    if (planCancelBtn) planCancelBtn.hidden = false;

    if (planGoal) planGoal.textContent = plan.goal || 'Active plan';
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    if (planStepsEl) {
        planStepsEl.innerHTML = '';
        steps.forEach(s => {
            const li = document.createElement('li');
            const isCurrent = s.index === plan.current_step && s.status !== 'done';
            li.className = 'plan-step' + (s.status === 'done' ? ' done' : isCurrent ? ' current' : '');
            const icon = s.status === 'done' ? '✓' : (isCurrent ? '▸' : '○');
            li.innerHTML =
                `<span class="plan-step-icon">${icon}</span>` +
                `<span class="plan-step-text">${escapeHtml(s.text)}` +
                (s.note ? ` <em class="plan-note">— ${escapeHtml(s.note)}</em>` : '') +
                `</span>`;
            planStepsEl.appendChild(li);
        });
    }

    const total = steps.length;
    const doneCount = steps.filter(s => s.status === 'done').length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    if (planFill) planFill.style.width = pct + '%';
    if (planProgressLabel) {
        planProgressLabel.textContent = total
            ? `${doneCount}/${total} steps · step ${Math.min(plan.current_step, total)} active`
            : '';
    }

    // Sidebar badge: how many steps remain while the plan runs.
    const remaining = Math.max(0, total - doneCount);
    if (chatPlanBadge) {
        chatPlanBadge.textContent = remaining;
        chatPlanBadge.hidden = remaining === 0;
    }
}

async function fetchActivePlan() {
    try {
        const res = await api('/api/plans/active', { timeout: 8000 });
        if (!res.ok) return;
        const data = await res.json();
        applyPlan(data.plan || null);
    } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING OVERLAY — first-run health checklist
// ═══════════════════════════════════════════════════════════
(function () {
    const ONBOARDED_KEY = 'aura-onboarded';
    const THEME_KEY = 'aura-theme-v2';
    const THEMES = ['default', 'crimson', 'emerald', 'violet'];

    // Row definitions: id, label, checker fn, action {label, handler}
    const ROWS = [
        {
            id: 'backend',
            label: 'Backend online',
            check: async () => {
                const res = await fetch('/api/health', { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.ok) throw new Error('Backend not OK');
                return { ok: true };
            },
            action: { label: 'Retry', handler: () => runRowCheck('backend') }
        },
        {
            id: 'ollama',
            label: 'Ollama reachable',
            check: async () => {
                const res = await fetch('/api/health/ollama', { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'Ollama unreachable');
                return { ok: true, model: data.model, latency: data.latency_ms };
            },
            action: { label: 'Retry', handler: () => runRowCheck('ollama') }
        },
        {
            id: 'mic',
            label: 'Microphone access',
            check: async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(t => t.stop());
                    return { ok: true };
                } catch (e) {
                    throw new Error(e.name === 'NotAllowedError' ? 'Permission denied' : 'Microphone unavailable');
                }
            },
            action: { label: 'Enable', handler: () => runRowCheck('mic') }
        },
        {
            id: 'wakeword',
            label: 'Wake word ready',
            check: async () => {
                const res = await fetch('/api/wakeword/status', { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.enabled) throw new Error('Wake word disabled in Settings');
                if (!data.model_loaded) throw new Error(data.error || 'Model not loaded');
                return { ok: true };
            },
            action: { label: 'Open Settings', handler: () => { closeOnboard(); switchView('settings'); } }
        },
        {
            id: 'theme',
            label: 'Pick your accent theme',
            check: async () => {
                // Always "pass" — this row is for selection, not validation
                const current = localStorage.getItem(THEME_KEY) || 'default';
                return { ok: true, theme: current };
            },
            action: { label: 'Cycle', handler: cycleTheme }
        }
    ];

    let overlay = null;
    let checklistEl = null;
    let enterBtn = null;
    let rowStates = {}; // id -> 'pending'|'checking'|'pass'|'fail'
    let rowResults = {}; // id -> result data
    let backendResolved = false;

    function createRowEl(row) {
        const div = document.createElement('div');
        div.className = 'onboard-row';
        div.dataset.id = row.id;
        div.dataset.state = 'pending';
        div.innerHTML = `
            <div class="onboard-status-badge" aria-hidden="true">
                <span class="badge-pending">WAIT</span>
                <span class="badge-checking">CHECK</span>
                <span class="badge-pass">READY</span>
                <span class="badge-fail">ERROR</span>
            </div>
            <span class="onboard-label">${escapeHtml(row.label)}</span>
            ${row.action ? `<button class="qa-btn onboard-action" data-action="${row.id}">${escapeHtml(row.action.label)}</button>` : ''}
        `;
        return div;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":"'"}[c]));
    }

    function setRowState(id, state, result) {
        rowStates[id] = state;
        if (result) rowResults[id] = result;
        const rowEl = checklistEl.querySelector(`[data-id="${id}"]`);
        if (!rowEl) return;
        rowEl.dataset.state = state;
        const actionBtn = rowEl.querySelector('.onboard-action');
        if (actionBtn) {
            actionBtn.hidden = state === 'pass' && id !== 'theme';
        }
        updateEnterButton();
    }

    function updateEnterButton() {
        if (enterBtn) {
            enterBtn.disabled = !backendResolved;
        }
    }

    async function runRowCheck(id) {
        const row = ROWS.find(r => r.id === id);
        if (!row) return;
        setRowState(id, 'checking');
        try {
            const result = await row.check();
            setRowState(id, 'pass', result);
            if (id === 'backend') backendResolved = true;
        } catch (e) {
            setRowState(id, 'fail', { error: e.message });
            if (id === 'backend') backendResolved = true; // allow dismiss even if backend fails
        }
    }

    function cycleTheme() {
        const current = localStorage.getItem(THEME_KEY) || 'default';
        const idx = THEMES.indexOf(current);
        const next = THEMES[(idx + 1) % THEMES.length];
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
        setRowState('theme', 'pass', { theme: next });
    }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        // Update theme dots in Settings if visible
        document.querySelectorAll('.theme-dot').forEach(dot => {
            dot.classList.toggle('active', dot.dataset.theme === theme);
        });
    }

    function buildOverlay() {
        overlay = document.getElementById('onboard-overlay');
        checklistEl = document.getElementById('onboard-checklist');
        enterBtn = document.getElementById('onboard-enter');

        // Populate checklist
        ROWS.forEach(row => {
            checklistEl.appendChild(createRowEl(row));
        });

        // Delegate action buttons
        checklistEl.addEventListener('click', e => {
            const btn = e.target.closest('.onboard-action');
            if (btn) {
                const id = btn.dataset.action;
                const row = ROWS.find(r => r.id === id);
                if (row?.action?.handler) row.action.handler();
            }
        });

        // Enter button
        enterBtn.addEventListener('click', () => {
            closeOnboard();
        });

        // ESC handling — only dismiss if backend row resolved
        overlay._escHandler = (e) => {
            if (e.key === 'Escape' && backendResolved) {
                closeOnboard();
            }
        };
    }

    function openOnboard() {
        if (!overlay) buildOverlay();
        // Reset states
        rowStates = {};
        rowResults = {};
        backendResolved = false;
        ROWS.forEach(r => setRowState(r.id, 'pending'));
        updateEnterButton();

        // Ensure ESC key listener is attached whenever overlay opens
        if (overlay._escHandler) {
            document.removeEventListener('keydown', overlay._escHandler);
            document.addEventListener('keydown', overlay._escHandler);
        }

        overlay.hidden = false;
        document.body.style.overflow = 'hidden';

        // Run all checks in parallel
        ROWS.forEach(r => runRowCheck(r.id));
    }

    function closeOnboard() {
        if (!overlay) return;
        overlay.hidden = true;
        document.body.style.overflow = '';
        localStorage.setItem(ONBOARDED_KEY, 'true');
        if (overlay._escHandler) {
            document.removeEventListener('keydown', overlay._escHandler);
        }
    }

    // Public API
    window.Onboarding = {
        init: () => {
            if (!localStorage.getItem(ONBOARDED_KEY)) {
                // Small delay so boot overlay finishes first
                setTimeout(openOnboard, 800);
            }
        },
        reopen: () => {
            openOnboard();
        }
    };
})();

function initPlans() {
    if (!document.getElementById('plan-card')) return;
    Realtime.on('plan_update', () => fetchActivePlan());
    // Fallback for when the SSE bus isn't available.
    setInterval(() => {
        if (!Realtime.connected && !document.hidden) fetchActivePlan();
    }, 5000);
    fetchActivePlan();

    planCancelBtn?.addEventListener('click', async () => {
        if (!currentPlanId) return;
        const ok = await confirmAction({
            title: 'CANCEL PLAN',
            message: 'Cancel the active plan? Completed steps are kept in history.',
            okLabel: 'CANCEL PLAN'
        });
        if (!ok) return;
        try {
            await api(`/api/plans/${currentPlanId}/cancel`, { method: 'POST', timeout: 10000 });
            showToast('PLAN CANCELLED', 'The active plan was cancelled.', 'info');
            fetchActivePlan();
        } catch (e) {
            showToast('ERROR', 'Could not cancel the plan.', 'error');
        }
    });
}

// ═══════════════════════════════════════════════════════════
// NOW PLAYING CARD (Chat rail) — SMTC via /api/media
// ═══════════════════════════════════════════════════════════
const spArtImg = document.getElementById('sp-art-img');
const spArtPlaceholder = document.getElementById('sp-art-placeholder');
const spTitleEl = document.getElementById('sp-title');
const spArtistEl = document.getElementById('sp-artist');
const mediaControlsEl = document.getElementById('media-controls');
const mediaProgressBar = document.getElementById('media-progress');
const mediaProgressFill = document.getElementById('media-progress-fill');
const mediaHint = document.getElementById('media-hint');
const spPlayBtn = document.getElementById('sp-play');
let lastMedia = null;
let mediaAnchor = { pos: 0, at: 0, playing: false, duration: 0, known: false };
let optimisticPlaying = null; // set between an optimistic icon flip and the next payload

const PLAY_ICON = 'M8 5v14l11-7z';
const PAUSE_ICON = 'M7 5h4v14H7zm6 0h4v14h-4z';

function setPlayIcon(playing) {
    spPlayBtn?.querySelector('path')?.setAttribute('d', playing ? PAUSE_ICON : PLAY_ICON);
}

function mediaSetControlsDisabled(disabled) {
    mediaControlsEl?.classList.toggle('media-disabled', disabled);
}

function applyMedia(data) {
    if (!data) return;
    lastMedia = data;

    const hasTrack = !!(data.title || data.artist);
    if (!data.available) {
        if (spTitleEl) spTitleEl.textContent = 'Nothing playing';
        if (spArtistEl) spArtistEl.textContent = 'SYSTEM MEDIA';
        if (mediaHint) {
            mediaHint.textContent = 'Metadata unavailable — ' + (data.reason || 'SMTC missing');
            mediaHint.hidden = false;
        }
        mediaSetControlsDisabled(true);
    } else if (!hasTrack) {
        if (spTitleEl) spTitleEl.textContent = 'Nothing playing';
        if (spArtistEl) spArtistEl.textContent = 'SYSTEM MEDIA';
        if (mediaHint) mediaHint.hidden = true;
        mediaSetControlsDisabled(true);
    } else {
        if (spTitleEl) spTitleEl.textContent = data.title;
        if (spArtistEl) spArtistEl.textContent = [data.artist, data.app].filter(Boolean).join(' · ') || 'SYSTEM MEDIA';
        if (mediaHint) mediaHint.hidden = true;
        mediaSetControlsDisabled(false);
    }

    // Album art with graceful fallback to the placeholder glyph.
    if (data.album_art && spArtImg) {
        spArtImg.src = data.album_art;
        spArtImg.hidden = false;
        if (spArtPlaceholder) spArtPlaceholder.hidden = true;
    } else {
        if (spArtImg) { spArtImg.removeAttribute('src'); spArtImg.hidden = true; }
        if (spArtPlaceholder) spArtPlaceholder.hidden = false;
    }

    const playing = optimisticPlaying !== null ? optimisticPlaying : !!data.playing;
    setPlayIcon(playing);
    optimisticPlaying = null;

    // Progress anchor: 1s local interpolation between server payloads.
    const known = data.position_s != null && data.duration_s != null && data.duration_s > 0;
    mediaAnchor = {
        pos: data.position_s || 0,
        at: Date.now(),
        playing: !!data.playing,
        duration: data.duration_s || 0,
        known
    };
    if (mediaProgressBar) mediaProgressBar.hidden = !known;
    renderMediaProgress();
}

function renderMediaProgress() {
    if (!mediaAnchor.known || !mediaProgressFill) return;
    const elapsed = mediaAnchor.playing ? (Date.now() - mediaAnchor.at) / 1000 : 0;
    const pos = Math.min(mediaAnchor.pos + elapsed, mediaAnchor.duration);
    const pct = mediaAnchor.duration ? (pos / mediaAnchor.duration) * 100 : 0;
    mediaProgressFill.style.width = pct.toFixed(2) + '%';
}

async function fetchMedia() {
    try {
        const res = await api('/api/media', { timeout: 8000 });
        if (res.ok) applyMedia(await res.json());
    } catch (e) {}
}

async function sendMediaControl(action) {
    // Optimistic play/pause icon flip; reconciled on the next payload.
    if (action === 'playpause' && lastMedia && lastMedia.available) {
        const current = optimisticPlaying !== null ? optimisticPlaying : !!lastMedia.playing;
        optimisticPlaying = !current;
        setPlayIcon(optimisticPlaying);
    }
    try {
        await api('/api/media/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
            timeout: 8000
        });
    } catch (e) {}
    setTimeout(fetchMedia, 1200); // reconcile with real state after the keystroke
}

function initMedia() {
    if (!document.getElementById('media-controls')) return;
    Realtime.on('media_update', applyMedia);
    // Poll fallback when the bus isn't connected; while connected the bus
    // pushes on track/state change and progress interpolates locally.
    setInterval(() => { if (!Realtime.connected && !document.hidden) fetchMedia(); }, 4000);
    setInterval(renderMediaProgress, 1000);
    fetchMedia();
}

// ═══════════════════════════════════════════════════════════
// DATA TRANSPORT WIRING (SSE bus + legacy fallback)
// ═══════════════════════════════════════════════════════════
// Bus-driven channels (GET /api/events): telemetry, threats_update,
// permissions_update, notifications_update, logs_append, schedule_update,
// processes_update, security_update.
//
// Remaining intentional pollers / one-shots NOT on the bus:
//   - /api/memory           every 10s (Memory view list; low-value churn)
//   - /api/wakeword/status  every 5s (Settings wake-word chip; bus broadcast
//                           'wakeword_status' covers toggle-time updates)
//   - /api/proactive        Settings view threshold config (load + save)
//   - /api/captures/last_screen HEAD probe behind the screen-preview refresh
//   - updateClock()         local clock tick, 1s
//
// If the SSE connection fails 3 times consecutively, startLegacyPolling()
// below re-arms REST polling for every bus channel until the next page load.

function startLegacyPolling() {
    console.warn('[AURA] SSE unavailable — legacy REST polling re-armed.');
    setInterval(fetchTelemetry, 3000);
    setInterval(fetchThreats, 10000);
    setInterval(fetchPermissions, 3000);
    setInterval(consumeNotifications, 5000);
    setInterval(() => { if (!document.hidden && isViewActive('system')) fetchLogs(); }, 10000);
    setInterval(fetchSchedule, 30000);
    setInterval(fetchProcesses, 5000);
    setInterval(fetchSecurity, 30000);
}

Realtime.on('telemetry', applyTelemetry);
Realtime.on('threats_update', applyThreats);
Realtime.on('permissions_update', applyPermissions);
Realtime.on('notifications_update', onNotificationsUpdate);
Realtime.on('logs_append', (data) => {
    if (!document.hidden && isViewActive('system')) applyLogsData(data);
});
Realtime.on('schedule_update', applySchedule);
Realtime.on('processes_update', applyProcesses);
Realtime.on('security_update', applySecurity);

setTimeout(loadHistory, 1500);
initPlans();
initMedia();
// First-run onboarding (checks onboarding flag, shows overlay if needed)
if (window.Onboarding) window.Onboarding.init();
fetchSchedule();          // one-shot initial paint; the bus maintains from here
fetchNetworkScan();
fetchProcesses();
refreshScreenPreview();
fetchThreats();
Realtime.onFallback(startLegacyPolling);
Realtime.start();
