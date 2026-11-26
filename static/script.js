// ═══════════════════════════════════════════════════════════
// AUDIO ENGINE (Web Audio API Synthesizer)
// ═══════════════════════════════════════════════════════════
class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.muted = localStorage.getItem('aura_sfx_muted') === 'true';
        this.masterGain.gain.value = this.muted ? 0.0 : 0.3;
        this.masterGain.connect(this.ctx.destination);
    }

    setMuted(mute) {
        this.muted = !!mute;
        localStorage.setItem('aura_sfx_muted', this.muted ? 'true' : 'false');
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.masterGain.gain.setValueAtTime(this.muted ? 0.0 : 0.3, this.ctx.currentTime);
        }
        updateSfxUi();
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    playTyping() {
        if (this.muted) return;
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
        if (this.muted) return;
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

    playBeep(freq = 880, duration = 0.05, type = 'sine') {
        if (this.muted) return;
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playSuccess() {
        if (this.muted) return;
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.07); // A5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
    }

    playError() {
        if (this.muted) return;
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.15);
    }
}

function updateSfxUi() {
    const isMuted = localStorage.getItem('aura_sfx_muted') === 'true';
    const onIcon = document.getElementById('sfx-icon-on');
    const offIcon = document.getElementById('sfx-icon-off');
    const btn = document.getElementById('btn-audio-sfx');
    if (onIcon && offIcon) {
        onIcon.style.display = isMuted ? 'none' : 'block';
        offIcon.style.display = isMuted ? 'block' : 'none';
    }
    if (btn) {
        btn.setAttribute('aria-pressed', isMuted ? 'false' : 'true');
        btn.title = isMuted ? 'UI Sound Effects: Muted (Click to unmute)' : 'UI Sound Effects: Active (Click to mute)';
    }
}

let audioSys = null;

// Initialize Audio Engine on first interaction to comply with autoplay policies
document.addEventListener('click', () => {
    if (!audioSys) {
        audioSys = new AudioEngine();
        audioSys.playHum();
        updateSfxUi();
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
let lastConfirmTrigger = null;

function confirmAction({ title = 'Confirm action', message = 'Are you sure?', okLabel = 'CONFIRM' } = {}) {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        lastConfirmTrigger = document.activeElement;
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
    if (lastConfirmTrigger && typeof lastConfirmTrigger.focus === 'function') {
        lastConfirmTrigger.focus();
    }
    lastConfirmTrigger = null;
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
    if (name === 'security') { initWebcam(); fetchThreats(); fetchNetworkScan(); }
    // Reactor render loop only burns frames while the Reactor view is up
    reactor.setActive(name === 'reactor');
    // Bus events for hidden views are intentionally dropped; on activation,
    // pull one fresh snapshot immediately instead of waiting for the next tick.
    if (name === 'system') { fetchProcesses(); fetchLogs(); }
    if (name === 'settings') {
        initQuickActionsEditor();
        loadEnvSettings();
        if (typeof fetchProactiveConfig === 'function') fetchProactiveConfig();
    }
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
    const overlay = document.getElementById('voice-overlay');
    if (overlay) {
        overlay.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking', 'state-error', 'state-interrupted');
        overlay.classList.add(`state-${state}`);
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
let lastShortcutsTrigger = null;

function openShortcuts() {
    lastShortcutsTrigger = document.activeElement;
    shortcutsModal.classList.add('active');
    btnCloseShortcuts?.focus();
}

function closeShortcuts() {
    shortcutsModal.classList.remove('active');
    if (lastShortcutsTrigger && typeof lastShortcutsTrigger.focus === 'function') {
        lastShortcutsTrigger.focus();
    }
    lastShortcutsTrigger = null;
}

function toggleShortcuts() {
    if (shortcutsModal.classList.contains('active')) closeShortcuts();
    else openShortcuts();
}

btnShortcuts.addEventListener('click', toggleShortcuts);
btnCloseShortcuts.addEventListener('click', closeShortcuts);
shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) closeShortcuts();
});

document.addEventListener('keydown', (e) => {
    // Ctrl + K or Cmd + K: Toggle Command Palette Spotlight
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (isPaletteOpen()) closePalette();
        else openPalette();
        return;
    }

    if (e.key === 'Escape') {
        if (isPaletteOpen()) { closePalette(); return; }
        if (confirmModal.classList.contains('active')) { settleConfirm(false); return; }
        if (shortcutsModal.classList.contains('active')) { closeShortcuts(); return; }
        if (document.getElementById('lightbox-overlay').classList.contains('open')) { closeLightbox(); return; }
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
// COMMAND PALETTE SPOTLIGHT ENGINE (Ctrl+K)
// ═══════════════════════════════════════════════════════════
const PALETTE_COMMANDS = [
    // Navigation
    { id: 'nav-chat', title: 'Go to Chat', category: 'Navigation', icon: '💬', shortcut: '1', action: () => showView('chat') },
    { id: 'nav-reactor', title: 'Go to Reactor Core', category: 'Navigation', icon: '⚛', shortcut: '2', action: () => showView('reactor') },
    { id: 'nav-system', title: 'Go to System Diagnostics', category: 'Navigation', icon: '📊', shortcut: '3', action: () => showView('system') },
    { id: 'nav-security', title: 'Go to Security Center', category: 'Navigation', icon: '🛡', shortcut: '4', action: () => showView('security') },
    { id: 'nav-files', title: 'Go to File Explorer', category: 'Navigation', icon: '📁', shortcut: '5', action: () => showView('files') },
    { id: 'nav-memory', title: 'Go to Memory Archive', category: 'Navigation', icon: '🧠', shortcut: '6', action: () => showView('memory') },
    { id: 'nav-settings', title: 'Go to Settings', category: 'Navigation', icon: '⚙', shortcut: '7', action: () => showView('settings') },
    
    // Voice & Audio
    { id: 'act-voice-overlay', title: 'Fullscreen Voice Assistant', category: 'Voice & Audio', icon: '🎙', shortcut: 'Ctrl+Space', action: () => {
        openVoiceOverlay();
        if (canStartListening() && voiceBtn) voiceBtn.click();
    }},
    { id: 'act-voice-mic', title: 'Toggle Voice Microphone', category: 'Voice & Audio', icon: '🎤', shortcut: 'Ctrl+M', action: () => {
        if (voiceBtn) voiceBtn.click();
    }},
    { id: 'act-wake-test', title: 'Test Wake Word Detection ("Hey Aura")', category: 'Voice & Audio', icon: '👂', action: () => {
        document.getElementById('btn-wake-test')?.click();
    }},
    { id: 'act-sfx-toggle', title: 'Toggle Audio SFX (Mute / Unmute)', category: 'Voice & Audio', icon: '🔊', action: () => {
        if (audioSys) {
            const muted = audioSys.toggleMute();
            showToast('AUDIO', muted ? 'Sound effects muted' : 'Sound effects enabled', 'info');
        }
    }},

    // Voice Models
    { id: 'voice-ava', title: 'Set Voice: Ava (Ultra-Realistic Female)', category: 'Voice & Audio', icon: '🎙️', action: () => {
        localStorage.setItem('aura_tts_voice', 'en-US-AvaNeural');
        const sel = document.getElementById('tts-voice-select');
        if (sel) sel.value = 'en-US-AvaNeural';
        api('/api/voice/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ voice: 'en-US-AvaNeural' }) });
        showToast('VOICE ENGINE', 'Voice set to Ava (Ultra-Realistic Conversational).', 'info');
    }},
    { id: 'voice-andrew', title: 'Set Voice: Andrew (Natural Conversational Male)', category: 'Voice & Audio', icon: '🎙️', action: () => {
        localStorage.setItem('aura_tts_voice', 'en-US-AndrewNeural');
        const sel = document.getElementById('tts-voice-select');
        if (sel) sel.value = 'en-US-AndrewNeural';
        api('/api/voice/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ voice: 'en-US-AndrewNeural' }) });
        showToast('VOICE ENGINE', 'Voice set to Andrew (Warm Natural Male).', 'info');
    }},
    { id: 'voice-sonia', title: 'Set Voice: Sonia (Sophisticated British Female - Jarvis/Friday)', category: 'Voice & Audio', icon: '🎙️', action: () => {
        localStorage.setItem('aura_tts_voice', 'en-GB-SoniaNeural');
        const sel = document.getElementById('tts-voice-select');
        if (sel) sel.value = 'en-GB-SoniaNeural';
        api('/api/voice/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ voice: 'en-GB-SoniaNeural' }) });
        showToast('VOICE ENGINE', 'Voice set to Sonia (Sophisticated British).', 'info');
    }},
    { id: 'voice-jenny', title: 'Set Voice: Jenny (Warm Friendly Female)', category: 'Voice & Audio', icon: '🎙️', action: () => {
        localStorage.setItem('aura_tts_voice', 'en-US-JennyNeural');
        const sel = document.getElementById('tts-voice-select');
        if (sel) sel.value = 'en-US-JennyNeural';
        api('/api/voice/settings', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ voice: 'en-US-JennyNeural' }) });
        showToast('VOICE ENGINE', 'Voice set to Jenny (Warm & Friendly).', 'info');
    }},

    // Themes
    { id: 'theme-cyan', title: 'Switch Theme: Tactical Cyan (Default)', category: 'Themes', icon: '🔷', action: () => setTheme('') },
    { id: 'theme-amber', title: 'Switch Theme: Amber Tactical Alert', category: 'Themes', icon: '🟠', action: () => setTheme('theme-amber') },
    { id: 'theme-crimson', title: 'Switch Theme: Crimson Alert', category: 'Themes', icon: '🔴', action: () => setTheme('theme-crimson') },
    { id: 'theme-emerald', title: 'Switch Theme: Matrix Emerald', category: 'Themes', icon: '🟢', action: () => setTheme('theme-emerald') },
    { id: 'theme-violet', title: 'Switch Theme: Psionic Violet', category: 'Themes', icon: '🟣', action: () => setTheme('theme-violet') },

    // Actions & Tools
    { id: 'act-clear', title: 'Clear Console & Chat Output', category: 'Actions', icon: '🧹', shortcut: 'Ctrl+L', action: () => {
        terminalOutput.innerHTML = '';
        chatOutput.innerHTML = '';
        showToast('SYSTEM', 'Console cleared.', 'info');
    }},
    { id: 'act-sec-scan', title: 'Run Security Sweep', category: 'Actions', icon: '⚡', action: () => {
        showView('security');
        document.getElementById('btn-sec-refresh')?.click();
    }},
    { id: 'act-net-scan', title: 'Scan Local Network Grid', category: 'Actions', icon: '🌐', action: () => {
        showView('security');
        document.getElementById('btn-net-scan')?.click();
    }},
    { id: 'act-telemetry-refresh', title: 'Refresh System Telemetry', category: 'Actions', icon: '🔄', action: () => {
        fetchTelemetry();
        showToast('SYSTEM', 'Telemetry refreshed', 'info');
    }},
    { id: 'act-screen-capture', title: 'Inspect Screen Capture', category: 'Actions', icon: '📷', action: () => {
        showView('files');
        refreshScreenPreview();
    }},
    { id: 'act-shortcuts', title: 'Show Keyboard Shortcuts Modal', category: 'Help', icon: '❓', shortcut: '?', action: () => {
        shortcutsModal?.classList.add('active');
    }}
];

let paletteActiveIndex = 0;
let paletteFiltered = [];

function isPaletteOpen() {
    const el = document.getElementById('command-palette-overlay');
    return el && !el.hidden;
}

function openPalette() {
    const el = document.getElementById('command-palette-overlay');
    const input = document.getElementById('palette-input');
    if (!el || !input) return;
    el.hidden = false;
    input.value = '';
    filterPalette('');
    setTimeout(() => input.focus(), 40);
    audioSys?.playBeep(980, 0.04);
}

function closePalette() {
    const el = document.getElementById('command-palette-overlay');
    if (!el || el.hidden) return;
    el.hidden = true;
    audioSys?.playBeep(640, 0.04);
}

function filterPalette(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
        paletteFiltered = [...PALETTE_COMMANDS];
    } else {
        paletteFiltered = PALETTE_COMMANDS.filter(cmd => 
            cmd.title.toLowerCase().includes(q) || 
            cmd.category.toLowerCase().includes(q)
        );
    }
    paletteActiveIndex = 0;
    renderPaletteResults();
}

function renderPaletteResults() {
    const list = document.getElementById('palette-results');
    if (!list) return;
    list.innerHTML = '';

    if (paletteFiltered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'palette-item';
        empty.style.color = 'var(--text-dim)';
        empty.textContent = 'No matching commands found.';
        list.appendChild(empty);
        return;
    }

    let lastCategory = '';
    paletteFiltered.forEach((cmd, idx) => {
        if (cmd.category !== lastCategory) {
            lastCategory = cmd.category;
            const catDiv = document.createElement('div');
            catDiv.className = 'palette-category';
            catDiv.textContent = cmd.category;
            list.appendChild(catDiv);
        }

        const item = document.createElement('div');
        item.className = 'palette-item' + (idx === paletteActiveIndex ? ' active' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', idx === paletteActiveIndex ? 'true' : 'false');
        item.innerHTML = `
            <span class="palette-item-icon">${cmd.icon}</span>
            <span class="palette-item-text">${escapeHtml(cmd.title)}</span>
            ${cmd.shortcut ? `<span class="palette-item-shortcut">${escapeHtml(cmd.shortcut)}</span>` : ''}
        `;

        item.addEventListener('click', () => {
            executePaletteCommand(cmd);
        });

        item.addEventListener('mouseenter', () => {
            paletteActiveIndex = idx;
            updatePaletteActiveItem();
        });

        list.appendChild(item);
    });

    scrollPaletteActiveIntoView();
}

function updatePaletteActiveItem() {
    const items = document.querySelectorAll('.palette-results .palette-item:not([style*="text-dim"])');
    items.forEach((it, idx) => {
        if (idx === paletteActiveIndex) {
            it.classList.add('active');
            it.setAttribute('aria-selected', 'true');
        } else {
            it.classList.remove('active');
            it.setAttribute('aria-selected', 'false');
        }
    });
}

function scrollPaletteActiveIntoView() {
    const active = document.querySelector('.palette-results .palette-item.active');
    if (active) {
        active.scrollIntoView({ block: 'nearest' });
    }
}

function executePaletteCommand(cmd) {
    if (!cmd) return;
    closePalette();
    audioSys?.playSuccess();
    try {
        cmd.action();
    } catch (err) {
        console.error('Palette command failed:', err);
    }
}

function initCommandPalette() {
    const btnSpotlight = document.getElementById('btn-spotlight');
    if (btnSpotlight) {
        btnSpotlight.addEventListener('click', openPalette);
    }

    const btnSfx = document.getElementById('btn-audio-sfx');
    if (btnSfx) {
        btnSfx.addEventListener('click', () => {
            if (audioSys) {
                const muted = audioSys.toggleMute();
                showToast('AUDIO', muted ? 'Sound effects muted' : 'Sound effects enabled', 'info');
            }
        });
        updateSfxUi();
    }

    const overlay = document.getElementById('command-palette-overlay');
    const input = document.getElementById('palette-input');
    const backdrop = overlay?.querySelector('.palette-backdrop');
    const escBadge = overlay?.querySelector('.palette-esc-badge');

    if (backdrop) backdrop.addEventListener('click', closePalette);
    if (escBadge) escBadge.addEventListener('click', closePalette);

    if (input) {
        input.addEventListener('input', () => filterPalette(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (paletteFiltered.length > 0) {
                    paletteActiveIndex = (paletteActiveIndex + 1) % paletteFiltered.length;
                    updatePaletteActiveItem();
                    scrollPaletteActiveIntoView();
                    audioSys?.playBeep(1100, 0.02);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (paletteFiltered.length > 0) {
                    paletteActiveIndex = (paletteActiveIndex - 1 + paletteFiltered.length) % paletteFiltered.length;
                    updatePaletteActiveItem();
                    scrollPaletteActiveIntoView();
                    audioSys?.playBeep(1100, 0.02);
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (paletteFiltered.length > 0 && paletteFiltered[paletteActiveIndex]) {
                    executePaletteCommand(paletteFiltered[paletteActiveIndex]);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closePalette();
            }
        });
    }
}

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

        const chosenVoice = localStorage.getItem('aura_tts_voice') || 'en-US-AvaNeural';
        const chosenRate = localStorage.getItem('aura_tts_rate') || '+0%';
        const chosenBackend = localStorage.getItem('aura_tts_backend') || '';
        const backendParam = chosenBackend ? `&backend=${encodeURIComponent(chosenBackend)}` : '';
        const response = await api(`/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(chosenVoice)}&rate=${encodeURIComponent(chosenRate)}${backendParam}`, { timeout: 30000 });
        if (!response.ok) throw new Error('TTS fetch failed');

        if (response.status === 204) {
            finished = true;
            isTtsPlaying = false;
            updateQueuePill();
            setAuraState('idle');
            api('/api/voice/speaking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({is_speaking: false})
            }).catch(() => {});
            processTtsQueue();
            return;
        }

        const blob = await response.blob();
        if (!blob || blob.size === 0) {
            finished = true;
            isTtsPlaying = false;
            updateQueuePill();
            setAuraState('idle');
            api('/api/voice/speaking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({is_speaking: false})
            }).catch(() => {});
            processTtsQueue();
            return;
        }
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

    // 2. Append to Chat View (with rich markdown, cognitive trace, and actions)
    const chatDiv = document.createElement('div');
    chatDiv.className = `chat-bubble bubble-${type === 'error' ? 'error' : type === 'user' ? 'user' : 'aura'}`;
    if (type === 'user') {
        chatDiv.textContent = text;
    } else {
        chatDiv.innerHTML = formatAuraMarkdown(text, false);
    }
    chatOutput.appendChild(chatDiv);
    enhanceBubble(chatDiv, text);
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

function formatAuraMarkdown(rawText, isStreaming = false) {
    if (!rawText) return '';

    // 1. Extract <think>...</think> or streaming <think>...
    let thinkingHtml = '';
    let bodyText = rawText;

    const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
    if (thinkMatch) {
        const thinkingContent = thinkMatch[1].trim();
        const isOpen = isStreaming || !rawText.includes('</think>');
        if (thinkingContent) {
            let parsedThinking = thinkingContent;
            if (window.marked && window.DOMPurify) {
                parsedThinking = DOMPurify.sanitize(marked.parse(thinkingContent));
            } else {
                parsedThinking = escapeHtml(thinkingContent).replace(/\n/g, '<br>');
            }
            thinkingHtml = `
                <details class="aura-thinking-block" ${isOpen ? 'open' : ''}>
                    <summary class="thinking-summary">
                        <span class="thinking-pulse"></span>
                        <span class="thinking-label">COGNITIVE TRACE</span>
                        <span class="thinking-badge">${isOpen ? 'REASONING...' : 'COMPLETE'}</span>
                    </summary>
                    <div class="thinking-content">${parsedThinking}</div>
                </details>
            `;
        }
        bodyText = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, '').trim();
    }

    let parsedBody = '';
    if (bodyText) {
        if (window.marked && window.DOMPurify) {
            parsedBody = DOMPurify.sanitize(marked.parse(bodyText));
        } else {
            parsedBody = escapeHtml(bodyText).replace(/\n/g, '<br>');
        }
    }

    return thinkingHtml + parsedBody;
}

function enhanceCodeBlocks(container) {
    if (!container) return;
    container.querySelectorAll('pre code').forEach((codeBlock) => {
        const pre = codeBlock.parentElement;
        if (!pre || pre.parentElement?.classList.contains('code-block-wrapper')) return;

        // Detect language from class e.g. "language-python"
        let lang = 'CODE';
        codeBlock.classList.forEach(cls => {
            if (cls.startsWith('language-')) {
                lang = cls.replace('language-', '').toUpperCase();
            }
        });

        // Highlight syntax if hljs is loaded
        if (window.hljs && !codeBlock.classList.contains('hljs')) {
            try { hljs.highlightElement(codeBlock); } catch (e) {}
        }

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        // Create header
        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <span class="code-lang-tag">${lang}</span>
            <button class="code-copy-btn" title="Copy code" aria-label="Copy code">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy</span>
            </button>
        `;

        const copyBtn = header.querySelector('.code-copy-btn');
        copyBtn.addEventListener('click', () => {
            const codeToCopy = codeBlock.innerText;
            navigator.clipboard.writeText(codeToCopy);
            audioSys?.playSuccess();
            copyBtn.innerHTML = '<span>✓ Copied</span>';
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                `;
            }, 1500);
        });

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
    });
}

function enhanceBubble(bubble, rawText = null) {
    if (!bubble || bubble.classList.contains('thinking')) return;
    
    // First enhance code blocks
    enhanceCodeBlocks(bubble);

    // Prevent duplicate action bars
    if (bubble.querySelector('.bubble-actions')) return;

    const actionsBar = document.createElement('div');
    actionsBar.className = 'bubble-actions';

    // Timestamp
    const timeSpan = document.createElement('span');
    timeSpan.className = 'bubble-time';
    const now = new Date();
    timeSpan.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    // Clean text to copy
    const textToCopy = rawText !== null ? rawText : bubble.innerText.trim();

    // Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn-pill';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>';
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(textToCopy);
        audioSys?.playSuccess();
        copyBtn.innerHTML = '<span>✓ Copied</span>';
        setTimeout(() => {
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>';
        }, 1500);
    });
    actionsBar.appendChild(copyBtn);

    // Speak Button (for AURA messages)
    if (bubble.classList.contains('bubble-aura')) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'action-btn-pill';
        speakBtn.title = 'Speak aloud (TTS)';
        speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg><span>Speak</span>';
        speakBtn.addEventListener('click', () => {
            audioSys?.playBeep(720, 0.05);
            // Clean markdown tags for TTS
            const cleanSpeech = textToCopy.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[#*`_~]/g, '');
            playTTS(cleanSpeech);
        });
        actionsBar.appendChild(speakBtn);

        // Canvas View Button
        const canvasBtn = document.createElement('button');
        canvasBtn.className = 'action-btn-pill';
        canvasBtn.title = 'Open in Canvas';
        canvasBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg><span>Canvas</span>';
        canvasBtn.addEventListener('click', () => {
            AuraWorkspace.render('AURA Output', textToCopy);
        });
        actionsBar.appendChild(canvasBtn);
    }

    actionsBar.appendChild(timeSpan);
    bubble.appendChild(actionsBar);
}

// ═══════════════════════════════════════════════════════════
// DUAL-PANE ARTIFACT & CODE WORKSPACE CANVAS
// ═══════════════════════════════════════════════════════════
const AuraWorkspace = {
    isOpen: false,
    currentContent: '',

    toggle(force) {
        const pane = document.getElementById('workspace-canvas-pane');
        const btn = document.getElementById('btn-toggle-canvas');
        if (!pane) return;
        this.isOpen = (force !== undefined) ? force : !this.isOpen;
        pane.hidden = !this.isOpen;
        if (btn) {
            btn.classList.toggle('active', this.isOpen);
            btn.setAttribute('aria-pressed', this.isOpen ? 'true' : 'false');
        }
        if (this.isOpen) {
            audioSys?.playBeep(920, 0.04);
        } else {
            audioSys?.playBeep(600, 0.04);
        }
    },

    render(title, content, type = 'markdown') {
        const pane = document.getElementById('workspace-canvas-pane');
        const titleEl = document.getElementById('canvas-title');
        const bodyEl = document.getElementById('canvas-body');
        if (!pane || !bodyEl) return;

        this.currentContent = content || '';
        if (titleEl) titleEl.textContent = title || 'Artifact Workspace';

        if (!content) {
            bodyEl.innerHTML = `
                <div class="canvas-empty-state">
                    <div class="canvas-empty-glyph">◫</div>
                    <div class="canvas-empty-title">Artifact & Code Canvas</div>
                    <div class="canvas-empty-subtitle">Generated reports, code files, diffs, and diagrams appear here.</div>
                </div>
            `;
        } else {
            if (type === 'code') {
                bodyEl.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
                if (window.hljs) hljs.highlightElement(bodyEl.querySelector('pre code'));
            } else if (window.marked && window.DOMPurify) {
                bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(content));
                enhanceCodeBlocks(bodyEl);
            } else {
                bodyEl.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
            }
        }

        if (content && !this.isOpen) this.toggle(true);
    }
};
window.AuraWorkspace = AuraWorkspace;

function initWorkspaceCanvas() {
    const btnToggle = document.getElementById('btn-toggle-canvas');
    const btnClose = document.getElementById('canvas-close-btn');
    const btnCopy = document.getElementById('canvas-copy-btn');

    AuraWorkspace.toggle(false);

    if (btnToggle) btnToggle.addEventListener('click', () => AuraWorkspace.toggle());
    if (btnClose) btnClose.addEventListener('click', () => AuraWorkspace.toggle(false));
    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            if (!AuraWorkspace.currentContent) return;
            navigator.clipboard.writeText(AuraWorkspace.currentContent);
            audioSys?.playSuccess();
            btnCopy.textContent = 'COPIED!';
            setTimeout(() => { btnCopy.textContent = 'COPY'; }, 1500);
        });
    }

    // Keyboard shortcut Alt + C to toggle canvas
    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            AuraWorkspace.toggle();
        }
    });
}

// ═══════════════════════════════════════════════════════════
// IN-LINE HUMAN-IN-THE-LOOP (HITL) PERMISSION CARD
// ═══════════════════════════════════════════════════════════
function renderHitlPermissionCard(ev) {
    const actionId = ev.action_id || ev.id || ('act_' + Date.now());
    let existing = document.getElementById(`hitl-perm-${actionId}`);
    if (existing) return;

    const card = document.createElement('div');
    card.className = 'hitl-permission-card';
    card.id = `hitl-perm-${actionId}`;
    const risk = (ev.risk || 'medium').toLowerCase();
    
    card.innerHTML = `
        <div class="hitl-header">
            <span class="hitl-icon">⚠</span>
            <span class="hitl-title">SECURITY CLEARANCE REQUIRED</span>
            <span class="hitl-risk-badge risk-${risk}">${escapeHtml(risk.toUpperCase())} RISK</span>
        </div>
        <div class="hitl-body">
            <div class="hitl-tool-row"><strong>Target Tool:</strong> <code>${escapeHtml(ev.tool || 'System Command')}</code></div>
            ${ev.description ? `<div class="hitl-desc">${escapeHtml(ev.description)}</div>` : ''}
        </div>
        <div class="hitl-actions">
            <button class="qa-btn primary hitl-btn-auth">AUTHORIZE</button>
            <button class="qa-btn danger hitl-btn-reject">REJECT</button>
        </div>
    `;

    const authBtn = card.querySelector('.hitl-btn-auth');
    const rejectBtn = card.querySelector('.hitl-btn-reject');

    authBtn.addEventListener('click', async () => {
        authBtn.disabled = true;
        rejectBtn.disabled = true;
        try {
            await api(`/api/permissions/confirm/${actionId}`, { method: 'POST' });
        } catch (e) {}
        card.className = 'hitl-permission-card authorized';
        card.querySelector('.hitl-title').textContent = 'PERMISSION AUTHORIZED';
        card.querySelector('.hitl-actions').innerHTML = '<span style="font-size:11px; color:var(--green); font-family:var(--font-mono);">✓ Operator clearance granted. Continuing execution...</span>';
        audioSys?.playSuccess();
        fetchPermissions();
    });

    rejectBtn.addEventListener('click', async () => {
        authBtn.disabled = true;
        rejectBtn.disabled = true;
        try {
            await api(`/api/permissions/reject/${actionId}`, { method: 'POST' });
        } catch (e) {}
        card.className = 'hitl-permission-card rejected';
        card.querySelector('.hitl-title').textContent = 'PERMISSION DENIED';
        card.querySelector('.hitl-actions').innerHTML = '<span style="font-size:11px; color:var(--danger); font-family:var(--font-mono);">✕ Action cancelled by operator.</span>';
        audioSys?.playError();
        fetchPermissions();
    });

    chatOutput.appendChild(card);
    chatOutput.scrollTop = chatOutput.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
// SLASH COMMAND AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════
function initSlashCommands() {
    const popup = document.getElementById('slash-popup');
    if (!commandInput || !popup) return;
    popup.hidden = true;

    commandInput.addEventListener('input', () => {
        const val = commandInput.value;
        if (val.startsWith('/')) {
            const query = val.slice(1).toLowerCase();
            const items = popup.querySelectorAll('.slash-item');
            let hasMatch = false;
            items.forEach(it => {
                const cmd = it.getAttribute('data-cmd');
                if (cmd.toLowerCase().includes(query)) {
                    it.style.display = 'flex';
                    hasMatch = true;
                } else {
                    it.style.display = 'none';
                }
            });
            popup.hidden = !hasMatch;
        } else {
            popup.hidden = true;
        }
    });

    popup.querySelectorAll('.slash-item').forEach(it => {
        it.addEventListener('click', () => {
            const cmd = it.getAttribute('data-cmd');
            commandInput.value = cmd;
            popup.hidden = true;
            commandInput.focus();
            audioSys?.playBeep(880, 0.04);
        });
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.input-row')) {
            popup.hidden = true;
        }
    });
}

function enhanceLatestBubble(rawText = null) {
    const bubbles = chatOutput.querySelectorAll('.chat-bubble:not(.thinking)');
    if (bubbles.length === 0) return;
    const latest = bubbles[bubbles.length - 1];
    enhanceBubble(latest, rawText);
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
        
        // Supervisory tool traces container
        const toolTracesDiv = document.createElement('div');
        toolTracesDiv.className = 'tool-traces-container';
        chatOutput.appendChild(toolTracesDiv);

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
            bubble.innerHTML = formatAuraMarkdown(accumulatedText, true);
            enhanceCodeBlocks(bubble);
            chatOutput.scrollTop = chatOutput.scrollHeight;
        };
        // Throttle markdown re-rendering to ~120ms during streaming.
        const scheduleRender = () => {
            const now = Date.now();
            const elapsed = now - lastRender;
            if (elapsed >= 120) {
                lastRender = now;
                renderPartial();
            } else if (!renderTimer) {
                renderTimer = setTimeout(() => { renderTimer = null; scheduleRender(); }, 120 - elapsed);
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
                    let chip = toolTracesDiv.querySelector(`[data-tool="${ev.tool}"]`);
                    if (!chip) {
                        chip = document.createElement('div');
                        chip.setAttribute('data-tool', ev.tool);
                        toolTracesDiv.appendChild(chip);
                    }
                    chip.className = 'tool-chip running';
                    chip.innerHTML = `<span class="tool-spinner"></span><span class="tool-name">⚡ ${escapeHtml(ev.tool)}</span><span class="tool-status">RUNNING...</span>`;
                    audioSys?.playBeep(720, 0.03);
                } else if (ev.type === 'tool_result') {
                    statusDiv.textContent = ev.tool + ' done.';
                    let chip = toolTracesDiv.querySelector(`[data-tool="${ev.tool}"]`);
                    if (!chip) {
                        chip = document.createElement('div');
                        chip.setAttribute('data-tool', ev.tool);
                        toolTracesDiv.appendChild(chip);
                    }
                    chip.className = 'tool-chip success';
                    chip.innerHTML = `<span class="tool-icon">✓</span><span class="tool-name">⚡ ${escapeHtml(ev.tool)}</span><span class="tool-status">DONE</span>`;
                    audioSys?.playSuccess();
                } else if (ev.type === 'permission_request') {
                    statusDiv.textContent = 'Waiting for approval \u2014 ' + ev.tool + ' (' + ev.risk + '). Click AUTHORIZE in the panel or reply Yes.';
                    let chip = toolTracesDiv.querySelector(`[data-tool="${ev.tool}"]`);
                    if (!chip) {
                        chip = document.createElement('div');
                        chip.setAttribute('data-tool', ev.tool);
                        toolTracesDiv.appendChild(chip);
                    }
                    chip.className = 'tool-chip pending-auth';
                    chip.innerHTML = `<span class="tool-icon">⚠</span><span class="tool-name">⚡ ${escapeHtml(ev.tool)} (${escapeHtml(ev.risk)})</span><span class="tool-status">APPROVAL NEEDED</span>`;
                    audioSys?.playError();
                    renderHitlPermissionCard(ev);
                } else if (ev.type === 'meta') {
                    // Intent info
                } else if (ev.type === 'done') {
                    accumulatedText = (typeof ev.text === 'string') ? ev.text : accumulatedText;
                } else if (ev.type === 'error') {
                    streamError = ev.message || 'Unknown pipeline error.';
                }
            }
        }
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }

        // Final render with syntax highlighting and action toolbar
        if (accumulatedText) {
            bubble.innerHTML = formatAuraMarkdown(accumulatedText, false);
            enhanceBubble(bubble, accumulatedText);
        }
        statusDiv.textContent = streamError ? ('Error: ' + streamError) : '';
        setTimeout(() => statusDiv.remove(), streamError ? 10000 : 2000);
        chatOutput.scrollTop = chatOutput.scrollHeight;

        setAuraState('idle');

        if (streamError) throw new Error(streamError);

        if (accumulatedText) {
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
            currentBubble.innerHTML = formatAuraMarkdown(accumulatedText, false);
            chatOutput.appendChild(currentBubble);
            enhanceBubble(currentBubble, accumulatedText);
            chatOutput.scrollTop = chatOutput.scrollHeight;

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
        setVoiceOverlayStatus('INTERRUPTED // LISTENING...', '"Say your command..."', 'interrupted');
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
    setVoiceOverlayStatus('AURA LISTENING...', '"Listening for your command..."');
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
            setVoiceOverlayStatus('PROCESSING...', `"${data.transcription}"`);
            await appendToTerminal(data.transcription, 'user');
            // The reply is fetched and streamed separately so a slow local model
            // never delays appearance of the user's own words.
            setAuraState('processing');
            let reply = '';
            try {
                reply = (await runChatTurn(data.transcription, null, null)) || '';
                setVoiceOverlayStatus('SPEAKING...', `"${reply.slice(0, 140)}${reply.length > 140 ? '...' : ''}"`);
                setTimeout(() => { if (!isTtsPlaying && isVoiceOverlayOpen()) closeVoiceOverlay(); }, 4000);
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

        // Topbar signal pill (tactical 4-bar meter + percentage)
        const uplinkEl = document.getElementById('hud-signal');
        const uplinkText = document.getElementById('hud-signal-text');
        if (uplinkEl && uplinkText) {
            uplinkText.textContent = `${data.uplink}%`;
            const bars = uplinkEl.querySelectorAll('.signal-bar');
            const activeCount = Math.round((data.uplink / 100) * bars.length);
            bars.forEach((bar, idx) => {
                if (idx < activeCount) bar.classList.add('active');
                else bar.classList.remove('active');
            });
        } else if (uplinkEl) {
            uplinkEl.textContent = `${data.uplink}%`;
        }

        // Thermals: backend sends null when a sensor is unavailable
        if(data.cpu_temp != null) {
            setDiag('cpu-temp-fill', 'cpu-temp-val', `${data.cpu_temp}°C`, data.cpu_temp);
            const cpuTempFill = document.getElementById('cpu-temp-fill');
            if(cpuTempFill) cpuTempFill.style.background = data.cpu_temp > 85 ? 'var(--danger)' : data.cpu_temp > 70 ? 'var(--purple)' : 'var(--cyan)';
        } else {
            const v = document.getElementById('cpu-temp-val');
            if (v) v.textContent = 'N/A';
            const f = document.getElementById('cpu-temp-fill');
            if (f) f.style.width = '0%';
        }

        if(data.cpu_fan != null && data.cpu_fan !== 'N/A') {
            if (data.cpu_fan === 'AUTO') {
                const v = document.getElementById('cpu-fan-val');
                if (v) v.textContent = 'AUTO';
                const f = document.getElementById('cpu-fan-fill');
                if (f) f.style.width = '35%';
            } else {
                const rpm = parseInt(data.cpu_fan);
                setDiag('cpu-fan-fill', 'cpu-fan-val', `${data.cpu_fan} RPM`, isNaN(rpm) ? 35 : (rpm / 5000) * 100);
            }
        } else {
            const v = document.getElementById('cpu-fan-val');
            if (v) v.textContent = 'AUTO';
            const f = document.getElementById('cpu-fan-fill');
            if (f) f.style.width = '35%';
        }

        if(data.gpu_temp != null) {
            setDiag('gpu-temp-fill', 'gpu-temp-val', `${data.gpu_temp}°C`, data.gpu_temp);
            const gpuTempFill = document.getElementById('gpu-temp-fill');
            if(gpuTempFill) gpuTempFill.style.background = data.gpu_temp > 85 ? 'var(--danger)' : data.gpu_temp > 70 ? 'var(--purple)' : 'var(--cyan)';
        } else {
            const v = document.getElementById('gpu-temp-val');
            if (v) v.textContent = 'N/A';
            const f = document.getElementById('gpu-temp-fill');
            if (f) f.style.width = '0%';
        }

        if(data.gpu_mem !== undefined && data.gpu_mem !== null) {
            const v = document.getElementById('gpu-mem-val');
            if (v) v.textContent = data.gpu_mem;
            let memParts = String(data.gpu_mem).split('/');
            if(memParts.length === 2) {
                let used = parseInt(memParts[0]);
                let total = parseInt(memParts[1]);
                if(!isNaN(used) && !isNaN(total) && total > 0) {
                    // Provide a subtle 3% minimum baseline when memory is 0 MB used so the gauge remains visually responsive
                    const pct = Math.max(used > 0 ? (used / total) * 100 : 3, 3);
                    setDiag('gpu-mem-fill', 'gpu-mem-val', data.gpu_mem, pct);
                } else {
                    const f = document.getElementById('gpu-mem-fill');
                    if (f) f.style.width = '0%';
                }
            } else {
                const f = document.getElementById('gpu-mem-fill');
                if (f) f.style.width = '0%';
            }
        } else {
            const v = document.getElementById('gpu-mem-val');
            if (v) v.textContent = 'N/A';
            const f = document.getElementById('gpu-mem-fill');
            if (f) f.style.width = '0%';
        }

        if(data.gpu_fan !== undefined && data.gpu_fan !== 'N/A') {
            const v = document.getElementById('gpu-fan-val');
            if (v) v.textContent = data.gpu_fan;
            const f = document.getElementById('gpu-fan-fill');
            if (f) {
                if (data.gpu_fan === 'AUTO') {
                    f.style.width = '35%';
                } else {
                    const num = parseInt(data.gpu_fan);
                    f.style.width = isNaN(num) ? '35%' : `${num}%`;
                }
            }
        } else {
            const v = document.getElementById('gpu-fan-val');
            if (v) v.textContent = 'AUTO';
            const f = document.getElementById('gpu-fan-fill');
            if (f) f.style.width = '35%';
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

        if (data.ambient) {
            applyAmbient(data.ambient);
        }
    } catch (error) {
        console.warn("Telemetry render failed:", error.message);
    }
}

function applyAmbient(ambient) {
    if (!ambient) return;
    const appEl = document.getElementById('ambient-app-text');
    if (appEl && ambient.active_window) {
        const appName = ambient.active_window.app_name || 'Desktop';
        const title = ambient.active_window.title || '';
        appEl.textContent = `Active: ${appName}`;
        appEl.title = title ? `${appName} — "${title}"` : appName;
    }

    const clipBadge = document.getElementById('ambient-clip-badge');
    if (clipBadge) {
        if (ambient.clipboard && ambient.clipboard.has_content) {
            clipBadge.style.display = 'inline-block';
            clipBadge.textContent = `📋 ${ambient.clipboard.content_type.replace('_', ' ').toUpperCase()}`;
            clipBadge.title = ambient.clipboard.preview || '';
        } else {
            clipBadge.style.display = 'none';
        }
    }

    const suggContainer = document.getElementById('ambient-suggestions');
    if (suggContainer) {
        suggContainer.innerHTML = '';
        let list = Array.isArray(ambient.suggestions) && ambient.suggestions.length > 0 ? ambient.suggestions : [];
        if (list.length === 0) {
            const app = (ambient.active_window?.app_name || '').toLowerCase();
            const title = (ambient.active_window?.title || '').toLowerCase();
            if (app.includes('code') || app.includes('studio') || app.includes('cursor') || title.includes('.py') || title.includes('.js')) {
                list = [
                    { title: '⚡ Explain Code', prompt: 'Review and explain the current code file I am working on.' },
                    { title: '🧪 Write Tests', prompt: 'Write comprehensive unit tests for this active module.' },
                    { title: '🔧 Refactor', prompt: 'Suggest clean architecture and performance refactorings.' }
                ];
            } else if (app.includes('terminal') || app.includes('powershell') || app.includes('cmd') || app.includes('bash')) {
                list = [
                    { title: '🔍 Explain Error', prompt: 'Explain the error output in my terminal and suggest a fix.' },
                    { title: '⚡ Suggest Command', prompt: 'What command should I run next for this task?' }
                ];
            } else if (app.includes('chrome') || app.includes('edge') || app.includes('firefox') || app.includes('browser')) {
                list = [
                    { title: '📝 Summarize Page', prompt: 'Summarize the key takeaways of the web page I am viewing.' },
                    { title: '🔎 Research Topic', prompt: 'Deep-dive and research the topic on this browser tab.' }
                ];
            } else if (ambient.clipboard && ambient.clipboard.has_content) {
                list = [
                    { title: '📋 Explain Clipboard', prompt: 'Analyze and explain the contents of my clipboard.' },
                    { title: '⚡ Run from Clipboard', prompt: 'Execute or process the snippet currently on my clipboard.' }
                ];
            } else {
                list = [
                    { title: '🛡️ Security Scan', prompt: '/security' },
                    { title: '📋 Autonomous Plan', prompt: '/plan ' },
                    { title: '🌐 Search Web', prompt: '/search ' }
                ];
            }
        }
        list.forEach(s => {
            const btn = document.createElement('button');
            btn.className = 'ambient-pill';
            btn.textContent = s.title;
            btn.title = s.prompt;
            btn.onclick = () => {
                const cmdInput = document.getElementById('command-input');
                if (cmdInput) {
                    cmdInput.value = s.prompt;
                    cmdInput.focus();
                }
                audioSys?.playBeep(650, 0.03);
            };
            suggContainer.appendChild(btn);
        });
    }
}

async function fetchAmbient() {
    try {
        const response = await api('/api/ambient', { timeout: 5000 });
        if (response.ok) applyAmbient(await response.json());
    } catch (_) {}
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

let _quickActionButtonsBound = false;

// Bind add/save buttons when Settings view is shown
function bindQuickActionsEditorButtons() {
    if (_quickActionButtonsBound) return;
    _quickActionButtonsBound = true;

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
const lightboxCloseBtn = document.getElementById('lightbox-close');
const screenPreviewContainer = document.getElementById('screen-preview-container');
let lastLightboxTrigger = null;

function openLightbox() {
    const img = document.getElementById('screen-preview-img');
    const lightboxImg = document.getElementById('lightbox-img');
    if (img && img.style.display !== 'none' && lightboxOverlay && lightboxImg && img.src) {
        lastLightboxTrigger = document.activeElement;
        lightboxImg.src = img.src;
        lightboxOverlay.classList.add('open');
        lightboxCloseBtn?.focus();
    }
}

function closeLightbox() {
    lightboxOverlay?.classList.remove('open');
    if (lastLightboxTrigger && typeof lastLightboxTrigger.focus === 'function') {
        lastLightboxTrigger.focus();
    }
    lastLightboxTrigger = null;
}

screenPreviewContainer?.addEventListener('click', openLightbox);
screenPreviewContainer?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox();
    }
});
lightboxCloseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
});
lightboxOverlay?.addEventListener('click', closeLightbox);

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
                openVoiceOverlay();
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
    document.documentElement.classList.remove('theme-amber', 'theme-crimson', 'theme-emerald', 'theme-violet');
    if (['theme-amber', 'theme-crimson', 'theme-emerald', 'theme-violet'].includes(preset)) {
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
    const THEMES = ['default', 'amber', 'crimson', 'emerald', 'violet'];

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
            action: { label: 'Open Settings', handler: () => { closeOnboard(); showView('settings'); } }
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
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
        let current = 'default';
        try {
            const parsed = JSON.parse(localStorage.getItem(THEME_KEY) || '{}');
            if (parsed?.preset) current = parsed.preset.replace(/^theme-/, '');
        } catch (_) {}
        const idx = THEMES.indexOf(current);
        const next = THEMES[(idx + 1) % THEMES.length];
        applyTheme(next);
        setRowState('theme', 'pass', { theme: next });
    }

    function applyTheme(theme) {
        const preset = theme === 'default' ? '' : `theme-${theme}`;
        if (typeof applyPreset === 'function') {
            applyPreset(preset);
        } else {
            localStorage.setItem(THEME_KEY, JSON.stringify({ preset }));
        }
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
Realtime.on('ambient_update', applyAmbient);
Realtime.on('threats_update', applyThreats);
Realtime.on('permissions_update', applyPermissions);
Realtime.on('notifications_update', onNotificationsUpdate);
Realtime.on('logs_append', (data) => {
    if (!document.hidden && isViewActive('system')) applyLogsData(data);
});
Realtime.on('schedule_update', applySchedule);
Realtime.on('processes_update', applyProcesses);
Realtime.on('security_update', applySecurity);

let voiceWaveRaf = null;

function drawVoiceWave() {
    const canvas = document.getElementById('voice-overlay-wave');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const isSpeaking = window.auraState === 'speaking' && isTtsPlaying;
    const isListening = window.auraState === 'listening';
    
    // Choose active analyser: tts or mic
    const activeAnalyser = isSpeaking ? analyser : micAnalyser;
    const freqData = (isSpeaking ? dataArray : micDataArray);

    if (activeAnalyser && freqData && freqData.length > 0) {
        activeAnalyser.getByteFrequencyData(freqData);
        const bars = 32;
        const barWidth = Math.floor(w / bars) - 3;
        const step = Math.floor(freqData.length / bars);

        ctx.fillStyle = isListening ? 'rgba(0, 255, 136, 0.85)' : 'rgba(0, 240, 255, 0.85)';
        ctx.shadowBlur = 8;
        ctx.shadowColor = isListening ? '#00ff88' : '#00f0ff';

        for (let i = 0; i < bars; i++) {
            const val = freqData[i * step] || 0;
            const barHeight = Math.max(3, (val / 255) * h * 0.85);
            const x = i * (barWidth + 3);
            const y = (h - barHeight) / 2;
            ctx.fillRect(x, y, barWidth, barHeight);
        }
    } else {
        // Futuristic cyber resting oscillation
        const t = performance.now() * 0.003;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#00f0ff';
        ctx.beginPath();
        for (let x = 0; x < w; x += 4) {
            const u = x / w;
            const y = (h / 2) + Math.sin(u * 14 + t) * 6 * Math.sin(u * Math.PI);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    if (isVoiceOverlayOpen()) {
        voiceWaveRaf = requestAnimationFrame(drawVoiceWave);
    }
}

function startVoiceWave() {
    if (voiceWaveRaf) cancelAnimationFrame(voiceWaveRaf);
    voiceWaveRaf = requestAnimationFrame(drawVoiceWave);
}

function stopVoiceWave() {
    if (voiceWaveRaf) {
        cancelAnimationFrame(voiceWaveRaf);
        voiceWaveRaf = null;
    }
}

async function updateLatencyIndicator() {
    const latEl = document.getElementById('hud-latency');
    if (!latEl) return;
    const t0 = performance.now();
    try {
        const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
        if (res.ok) {
            const ms = Math.max(1, Math.round(performance.now() - t0));
            latEl.textContent = ms + 'ms';
            if (ms < 50) latEl.style.color = 'var(--green)';
            else if (ms < 150) latEl.style.color = 'var(--amber)';
            else latEl.style.color = 'var(--red)';
        }
    } catch (e) {
        latEl.textContent = 'OFFLINE';
        latEl.style.color = 'var(--red)';
    }
}

function isVoiceOverlayOpen() {
    const el = document.getElementById('voice-overlay');
    return el && el.classList.contains('active');
}

function openVoiceOverlay() {
    const el = document.getElementById('voice-overlay');
    if (!el) return;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('active'));
    setVoiceOverlayStatus('AURA LISTENING...', '"Say a command or ask a question..."');
    startVoiceWave();
    audioSys?.playBeep(880, 0.05);
}

function closeVoiceOverlay() {
    const el = document.getElementById('voice-overlay');
    if (!el) return;
    el.classList.remove('active');
    stopVoiceWave();
    audioSys?.playBeep(520, 0.05);
    setTimeout(() => {
        if (!el.classList.contains('active')) el.hidden = true;
    }, 300);
}

function setVoiceOverlayStatus(statusText, transcriptText, stateKey) {
    const overlay = document.getElementById('voice-overlay');
    const stEl = document.getElementById('voice-overlay-status');
    const trEl = document.getElementById('voice-overlay-transcript');
    if (stEl && statusText) stEl.textContent = statusText;
    if (trEl && transcriptText !== undefined) trEl.textContent = transcriptText;

    if (overlay && statusText) {
        overlay.classList.remove('state-listening', 'state-processing', 'state-speaking', 'state-interrupted');
        const sLower = statusText.toLowerCase();
        const key = stateKey || (sLower.includes('listen') ? 'listening' :
                                sLower.includes('process') ? 'processing' :
                                sLower.includes('speak') ? 'speaking' :
                                sLower.includes('interrupt') ? 'interrupted' : '');
        if (key) overlay.classList.add(`state-${key}`);
    }
}

function initHudCustomization() {
    const WIDGET_MAP = {
        'widget-toggle-media': { target: '.media-card', defaultVisible: true },
        'widget-toggle-plan': { target: '#plan-card', defaultVisible: true },
        'widget-toggle-schedule': { target: '.schedule-card', defaultVisible: true },
        'widget-toggle-ambient': { target: '#ambient-bar', defaultVisible: true }
    };

    let visibility = {};
    try {
        visibility = JSON.parse(localStorage.getItem('aura_widget_visibility') || '{}');
    } catch (_) {}

    Object.keys(WIDGET_MAP).forEach(id => {
        const toggle = document.getElementById(id);
        const config = WIDGET_MAP[id];
        const el = document.querySelector(config.target);
        if (!toggle || !el) return;

        const isVisible = visibility[id] !== undefined ? visibility[id] : config.defaultVisible;
        toggle.checked = isVisible;
        el.classList.toggle('hud-widget-hidden', !isVisible);

        toggle.addEventListener('change', () => {
            const nowVisible = toggle.checked;
            el.classList.toggle('hud-widget-hidden', !nowVisible);
            visibility[id] = nowVisible;
            try {
                localStorage.setItem('aura_widget_visibility', JSON.stringify(visibility));
            } catch (_) {}
            audioSys?.playBeep(nowVisible ? 800 : 400, 0.03);
        });
    });
}

function initVoiceSettings() {
    const select = document.getElementById('tts-voice-select');
    const slider = document.getElementById('tts-rate-slider');
    const rateVal = document.getElementById('tts-rate-val');
    const previewBtn = document.getElementById('btn-preview-voice');

    const savedRate = localStorage.getItem('aura_tts_rate') || '+0%';

    if (slider && rateVal) {
        const rateInt = parseInt(savedRate.replace('%', '').replace('+', '')) || 0;
        slider.value = rateInt;
        rateVal.textContent = rateInt === 0 ? 'Normal (+0%)' : `${rateInt > 0 ? '+' : ''}${rateInt}%`;

        slider.addEventListener('input', () => {
            const v = parseInt(slider.value) || 0;
            const formatted = `${v >= 0 ? '+' : ''}${v}%`;
            rateVal.textContent = v === 0 ? 'Normal (+0%)' : formatted;
            localStorage.setItem('aura_tts_rate', formatted);
        });
    }

    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            const v = select ? select.value : 'en-US-AvaNeural';
            const r = slider ? `${parseInt(slider.value) >= 0 ? '+' : ''}${parseInt(slider.value)}%` : '+0%';
            const b = (document.getElementById('env-tts-backend')?.value || 'edge').toLowerCase();
            previewBtn.disabled = true;
            previewBtn.textContent = 'SYNTHESIZING...';
            try {
                const sampleText = "Hello! I am Aura. My neural speech engine is now calibrated to sound natural, warm, and human.";
                const res = await api(`/api/tts?text=${encodeURIComponent(sampleText)}&voice=${encodeURIComponent(v)}&rate=${encodeURIComponent(r)}&backend=${encodeURIComponent(b)}`);
                if (res.ok) {
                    const blob = await res.blob();
                    const audioUrl = URL.createObjectURL(blob);
                    const audio = new Audio(audioUrl);
                    const cleanup = () => URL.revokeObjectURL(audioUrl);
                    audio.addEventListener('ended', cleanup, { once: true });
                    audio.addEventListener('error', cleanup, { once: true });
                    await audio.play();
                } else {
                    showToast('VOICE ENGINE', 'Failed to synthesize voice preview.', 'error');
                }
            } catch (e) {
                console.error('Preview voice error:', e);
                showToast('VOICE ENGINE', 'Voice preview failed.', 'error');
            } finally {
                previewBtn.disabled = false;
                previewBtn.textContent = '▶ PREVIEW VOICE';
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════
// ENVIRONMENT (.ENV) CONFIGURATION MANAGER
// ═══════════════════════════════════════════════════════════
let cachedEnvVars = {};
let cachedEnvSchema = {};
let cachedEnvOptions = {};
let _pendingVoiceByBackend = { edge: null, kokoro: null };
let _ttsBackendUserTouched = false;

const DEFAULT_EDGE_VOICES = [
    { id: 'en-US-AvaNeural', name: 'Ava (Ultra-Realistic Conversational Female)' },
    { id: 'en-US-AndrewNeural', name: 'Andrew (Warm Natural Conversational Male)' },
    { id: 'en-US-EmmaNeural', name: 'Emma (Expressive Natural Female)' },
    { id: 'en-US-JennyNeural', name: 'Jenny (Warm & Friendly Female)' },
    { id: 'en-US-BrianNeural', name: 'Brian (Deep Articulate Male)' },
    { id: 'en-US-GuyNeural', name: 'Guy (Casual American Male)' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia (Sophisticated British Female - Jarvis/Friday)' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (Intellectual British Male)' },
    { id: 'en-US-AriaNeural', name: 'Aria (Classic Tactical Assistant)' },
    { id: 'en-IN-NeerjaNeural', name: 'Neerja (Natural Indian English Female)' },
    { id: 'en-IN-PrabhatNeural', name: 'Prabhat (Natural Indian English Male)' }
];

const DEFAULT_KOKORO_VOICES = [
    { id: 'af', name: 'af (American Female - Flagship Default)' },
    { id: 'af_bella', name: 'af_bella (American Female - Warm Expressive)' },
    { id: 'af_nicole', name: 'af_nicole (American Female - Soft Whispery)' },
    { id: 'af_sarah', name: 'af_sarah (American Female - Clear Professional)' },
    { id: 'af_sky', name: 'af_sky (American Female - Bright Casual)' },
    { id: 'am_adam', name: 'am_adam (American Male - Steady Narrator)' },
    { id: 'am_michael', name: 'am_michael (American Male - Deep Broadcast)' },
    { id: 'bf_emma', name: 'bf_emma (British Female - Clear)' },
    { id: 'bf_isabella', name: 'bf_isabella (British Female - Refined)' },
    { id: 'bm_george', name: 'bm_george (British Male - Warm)' },
    { id: 'bm_lewis', name: 'bm_lewis (British Male - Articulate)' }
];

const CLOUD_PROVIDER_DEFAULTS = {
    groq: { keyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'] },
    nvidia: { keyEnv: 'NVIDIA_API_KEY', modelEnv: 'NVIDIA_MODEL', defaultModel: 'meta/llama-3.3-70b-instruct', models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'qwen/qwen2.5-72b-instruct', 'deepseek-ai/deepseek-r1', 'mistralai/mistral-large-2-instruct'] },
    gemini: { keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'] },
    openai: { keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'] },
    openrouter: { keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat-v3-0324:free', 'meta-llama/llama-3.3-70b-instruct:free', 'openrouter/auto'] }
};

let liveProviderModels = (() => {
    try {
        const raw = localStorage.getItem('aura_live_models_cache');
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) {
        return {};
    }
})();
const _providerFetchSeq = {};
const _providerLastKey = {};
const _providerAutoFetched = {};
const _providerDebounceTimers = {};

function saveLiveProviderModels(prov, models) {
    if (!prov || !Array.isArray(models) || models.length === 0) return;
    liveProviderModels[prov] = models;
    try {
        localStorage.setItem('aura_live_models_cache', JSON.stringify(liveProviderModels));
    } catch (_) { /* ignore storage quota errors */ }
}

function getCloudModelOptions(prov, searchQuery = '') {
    const spec = CLOUD_PROVIDER_DEFAULTS[prov];
    if (!spec) return [];
    const live = liveProviderModels[prov];
    const baseList = (Array.isArray(live) && live.length > 0)
        ? live
        : (cachedEnvSchema[spec.modelEnv]?.options?.map(o => o.value) || spec.models);
    const q = String(searchQuery || '').trim().toLowerCase();
    const filtered = q ? baseList.filter(m => String(m).toLowerCase().includes(q)) : baseList;
    return filtered.map(m => ({ value: m, label: m }));
}

function refreshCloudModelSelect(prov, preferredModel) {
    const spec = CLOUD_PROVIDER_DEFAULTS[prov];
    const modelSelect = document.getElementById(`env-${prov}-model`);
    const modelCustom = document.getElementById(`env-${prov}-model-custom`);
    const searchInput = document.getElementById(`env-${prov}-model-search`);
    if (!spec || !modelSelect) return;

    const currentUiVal = modelSelect.value === '__custom__'
        ? (modelCustom?.value.trim() || '')
        : modelSelect.value;
    const curM = preferredModel !== undefined
        ? preferredModel
        : (currentUiVal || cachedEnvVars[spec.modelEnv] || spec.defaultModel);

    const opts = getCloudModelOptions(prov, searchInput ? searchInput.value : '');
    if (opts.length === 0 && searchInput && searchInput.value.trim()) {
        populateSelectOptions(modelSelect, [{ value: curM, label: `No matches (${curM})` }], curM, true);
    } else {
        populateSelectOptions(modelSelect, opts, curM, true);
    }
    if (modelCustom) {
        const isCustom = modelSelect.value === '__custom__';
        modelCustom.style.display = isCustom ? 'block' : 'none';
        modelCustom.value = isCustom ? curM : '';
    }
    if (searchInput && Array.isArray(liveProviderModels[prov]) && liveProviderModels[prov].length > 0) {
        searchInput.placeholder = `Search ${liveProviderModels[prov].length} live models...`;
    }
}

async function fetchLiveModelsForProvider(prov, { silent = false } = {}) {
    const spec = CLOUD_PROVIDER_DEFAULTS[prov];
    if (!spec) return { ok: false };
    const keyInput = document.getElementById(`env-${prov}-api-key`);
    const statusPill = document.getElementById(`provider-status-${prov}`);
    const testBtn = document.querySelector(`.btn-test-provider[data-provider="${prov}"]`);
    const keyVal = keyInput ? keyInput.value.trim() : '';

    if (!keyVal) {
        if (statusPill) {
            statusPill.textContent = 'KEY OPTIONAL';
            statusPill.classList.remove('configured', 'error');
        }
        return { ok: false };
    }

    const seq = (_providerFetchSeq[prov] || 0) + 1;
    _providerFetchSeq[prov] = seq;
    _providerLastKey[prov] = keyVal;

    if (statusPill) {
        statusPill.textContent = 'SEARCHING...';
        statusPill.classList.remove('configured', 'error');
    }
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = '...';
    }

    try {
        const res = await api('/api/settings/provider/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: prov, api_key: keyVal })
        });
        const data = await res.json();
        if (_providerFetchSeq[prov] !== seq) return data;

        if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
            saveLiveProviderModels(prov, data.models);
            if (cachedEnvSchema[spec.modelEnv]) {
                cachedEnvSchema[spec.modelEnv].options = data.models.map(m => ({ value: m, label: m }));
            }
            if (statusPill) {
                statusPill.textContent = `LIVE (${data.count})`;
                statusPill.classList.remove('error');
                statusPill.classList.add('configured');
            }
            refreshCloudModelSelect(prov);
            const filterEl = document.getElementById('env-filter-input');
            if (document.getElementById('env-table-body')) {
                renderEnvTable(filterEl ? filterEl.value.trim() : '');
            }
            if (!silent) {
                showToast('CLOUD API', `${prov.toUpperCase()} verified (${data.count} live models)`, 'success');
                audioSys?.playSuccess();
            }
        } else {
            if (statusPill) {
                statusPill.textContent = data.ok ? 'NO MODELS' : 'INVALID KEY';
                statusPill.classList.remove('configured');
                statusPill.classList.add('error');
            }
            if (!silent) {
                showToast('CLOUD API', data.error || `${prov.toUpperCase()} check failed`, 'error');
            }
        }
        return data;
    } catch (err) {
        if (_providerFetchSeq[prov] === seq && statusPill) {
            statusPill.textContent = 'ERROR';
            statusPill.classList.remove('configured');
            statusPill.classList.add('error');
        }
        if (!silent) {
            showToast('CLOUD API', `Failed to test ${prov.toUpperCase()}`, 'error');
        }
        return { ok: false };
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = 'TEST';
        }
    }
}

const FALLBACK_ENV_SCHEMA = {
    AURA_LLM_PROVIDER: { category: 'ai', description: 'Active reasoning provider (Ollama local or Cloud API)', type: 'select', options: [
        { value: 'ollama', label: 'ollama (Local Ollama)' }, { value: 'groq', label: 'groq (Groq Cloud)' },
        { value: 'nvidia', label: 'nvidia (NVIDIA NIM)' }, { value: 'gemini', label: 'gemini (Google Gemini)' },
        { value: 'openai', label: 'openai (OpenAI / ChatGPT)' }, { value: 'openrouter', label: 'openrouter (OpenRouter)' }
    ]},
    GROQ_API_KEY: { category: 'ai', description: 'Custom API key for Groq Cloud', type: 'password', options: [] },
    GROQ_MODEL: { category: 'ai', description: 'Default Groq Cloud model ID', type: 'select_or_custom', options: CLOUD_PROVIDER_DEFAULTS.groq.models.map(m => ({ value: m, label: m })) },
    NVIDIA_API_KEY: { category: 'ai', description: 'Custom API key for NVIDIA NIM', type: 'password', options: [] },
    NVIDIA_MODEL: { category: 'ai', description: 'Default NVIDIA NIM model ID', type: 'select_or_custom', options: CLOUD_PROVIDER_DEFAULTS.nvidia.models.map(m => ({ value: m, label: m })) },
    GEMINI_API_KEY: { category: 'ai', description: 'Custom API key for Google Gemini', type: 'password', options: [] },
    GEMINI_MODEL: { category: 'ai', description: 'Default Google Gemini model ID', type: 'select_or_custom', options: CLOUD_PROVIDER_DEFAULTS.gemini.models.map(m => ({ value: m, label: m })) },
    OPENAI_API_KEY: { category: 'ai', description: 'Custom API key for OpenAI / ChatGPT', type: 'password', options: [] },
    OPENAI_MODEL: { category: 'ai', description: 'Default OpenAI / ChatGPT model ID', type: 'select_or_custom', options: CLOUD_PROVIDER_DEFAULTS.openai.models.map(m => ({ value: m, label: m })) },
    OPENROUTER_API_KEY: { category: 'ai', description: 'Custom API key for OpenRouter', type: 'password', options: [] },
    OPENROUTER_MODEL: { category: 'ai', description: 'Default OpenRouter model ID', type: 'select_or_custom', options: CLOUD_PROVIDER_DEFAULTS.openrouter.models.map(m => ({ value: m, label: m })) },
    OLLAMA_MODEL: { category: 'ai', description: 'Primary reasoning LLM (must be pulled in Ollama)', type: 'select_or_custom', options: [{ value: 'gemma4:e2b', label: 'gemma4:e2b' }] },
    OLLAMA_VISION_MODEL: { category: 'ai', description: 'Dedicated vision-language model for screenshots & images', type: 'select_or_custom', options: [{ value: 'qwen3-vl:4b', label: 'qwen3-vl:4b' }] },
    OLLAMA_NUM_CTX: { category: 'ai', description: 'Context window size in tokens', type: 'select_or_custom', options: [
        { value: '2048', label: '2,048 tokens (Low VRAM)' }, { value: '4096', label: '4,096 tokens' },
        { value: '8192', label: '8,192 tokens (Default)' }, { value: '16384', label: '16,384 tokens' },
        { value: '32768', label: '32,768 tokens' }, { value: '65536', label: '65,536 tokens' }, { value: '131072', label: '131,072 tokens' }
    ]},
    OLLAMA_KEEP_ALIVE: { category: 'ai', description: 'How long Ollama keeps models loaded in RAM/VRAM', type: 'select_or_custom', options: [
        { value: '0', label: '0 (Unload immediately)' }, { value: '2m', label: '2m' }, { value: '5m', label: '5m (Default)' },
        { value: '10m', label: '10m' }, { value: '30m', label: '30m' }, { value: '1h', label: '1h' }, { value: '-1', label: '-1 (Keep forever)' }
    ]},
    AURA_INTENT_ROUTER: { category: 'ai', description: 'Pre-classify intent before main agent pass', type: 'select', options: [
        { value: 'on', label: 'on (Fast intent pre-routing)' }, { value: 'off', label: 'off (Direct full toolset)' }
    ]},
    AURA_TTS_BACKEND: { category: 'audio', description: 'Text-to-Speech synthesis engine', type: 'select', options: [
        { value: 'edge', label: 'edge (Microsoft Cloud Neural)' }, { value: 'kokoro', label: 'kokoro (100% Offline ONNX Neural)' }
    ]},
    AURA_TTS_VOICE: { category: 'audio', description: 'Voice model ID (Edge Neural or Kokoro local)', type: 'select_or_custom', options: [
        ...DEFAULT_EDGE_VOICES.map(v => ({ value: v.id, label: `Edge: ${v.name}` })),
        ...DEFAULT_KOKORO_VOICES.map(v => ({ value: v.id, label: `Kokoro: ${v.name}` }))
    ]},
    AURA_TTS_RATE: { category: 'audio', description: 'Speech rate adjustment', type: 'select_or_custom', options: [
        '-20%', '-15%', '-10%', '-5%', '+0%', '+5%', '+10%', '+15%', '+20%'
    ].map(r => ({ value: r, label: r === '+0%' ? '+0% (Normal)' : r })) },
    AURA_STT_BACKEND: { category: 'audio', description: 'Speech-to-Text engine', type: 'select', options: [
        { value: 'local', label: 'local (faster-whisper offline)' }, { value: 'cloud', label: 'cloud (Google SpeechRecognition)' }
    ]},
    AURA_STT_MODEL: { category: 'audio', description: 'faster-whisper model checkpoint size', type: 'select_or_custom', options: [
        { value: 'tiny.en', label: 'tiny.en (~39M, Fastest English)' }, { value: 'tiny', label: 'tiny (~39M, Multilingual)' },
        { value: 'base.en', label: 'base.en (~74M, Balanced English)' }, { value: 'base', label: 'base (~74M, Multilingual)' },
        { value: 'small.en', label: 'small.en (~244M, Accurate English)' }, { value: 'small', label: 'small (~244M, Multilingual)' },
        { value: 'medium.en', label: 'medium.en (~769M, High Accuracy)' }, { value: 'medium', label: 'medium (~769M, Multilingual)' },
        { value: 'large-v3', label: 'large-v3 (~1.55B, Maximum)' }, { value: 'turbo', label: 'turbo (~809M, Fast Accurate)' }
    ]},
    AURA_STT_DEVICE: { category: 'audio', description: 'Hardware device for Whisper inference', type: 'select', options: [
        { value: 'auto', label: 'auto (CUDA / CPU)' }, { value: 'cuda', label: 'cuda (NVIDIA GPU)' }, { value: 'cpu', label: 'cpu (Host CPU)' }
    ]},
    AURA_STT_COMPUTE_TYPE: { category: 'audio', description: 'CTranslate2 precision / quantization', type: 'select', options: [
        { value: 'auto', label: 'auto' }, { value: 'default', label: 'default' }, { value: 'int8', label: 'int8' },
        { value: 'float16', label: 'float16' }, { value: 'int8_float16', label: 'int8_float16' }, { value: 'float32', label: 'float32' }
    ]},
    AURA_WAKEWORD_MODEL: { category: 'audio', description: 'ONNX/TFLite wake word model path', type: 'select_or_custom', options: [
        { value: 'models/hey_aura.onnx', label: 'models/hey_aura.onnx' }
    ]},
    AURA_WAKEWORD_THRESHOLD: { category: 'audio', description: 'Wake word detection confidence cutoff', type: 'select_or_custom', options: [
        '0.30', '0.35', '0.40', '0.45', '0.50', '0.55', '0.60', '0.65', '0.70', '0.75', '0.80', '0.85', '0.90', '0.95'
    ].map(v => ({ value: v, label: v })) },
    AURA_WAKEWORD_SPEAKING_THRESHOLD: { category: 'audio', description: 'Higher threshold while AURA speaks (barge-in guard)', type: 'select_or_custom', options: [
        '0.50', '0.55', '0.60', '0.65', '0.70', '0.75', '0.80', '0.85', '0.90', '0.95'
    ].map(v => ({ value: v, label: v })) },
    AURA_WAKEWORD_COOLDOWN: { category: 'audio', description: 'Seconds to suppress repeat wake detections', type: 'select_or_custom', options: [
        '0.5', '1.0', '1.5', '2.0', '3.0', '3.5', '5.0'
    ].map(v => ({ value: v, label: `${v}s` })) },
    AURA_WAKEWORD_PERSISTENCE: { category: 'audio', description: 'Consecutive 80ms chunks required above threshold', type: 'select_or_custom', options: [
        '1', '2', '3', '4', '5', '6', '8'
    ].map(v => ({ value: v, label: `${v} chunks` })) },
    AURA_WAKEWORD_VAD_THRESHOLD: { category: 'audio', description: 'Audio RMS energy cutoff to skip silence', type: 'select_or_custom', options: [
        '0.0', '10.0', '15.0', '20.0', '30.0', '50.0', '100.0'
    ].map(v => ({ value: v, label: v })) },
    AURA_WAKEWORD_DEVICE: { category: 'audio', description: 'Microphone input device index or name', type: 'select_or_custom', options: [
        { value: '', label: 'System Default Microphone' }
    ]},
    AURA_WAKEWORD_ONE_SHOT: { category: 'audio', description: 'Stream pre-roll utterance right after wake word', type: 'select', options: [
        { value: 'true', label: 'true (Stream immediately)' }, { value: 'false', label: 'false (Wait for pause)' }
    ]},
    AURA_SPEAKER_VERIFICATION: { category: 'audio', description: 'Verify enrolled speaker voiceprint on wake word', type: 'select', options: [
        { value: 'false', label: 'false (Allow any speaker)' }, { value: 'true', label: 'true (Enforce voiceprint gate)' }
    ]},
    AURA_VISUAL_TASK_TIMEOUT: { category: 'env', description: 'Time budget in seconds for visual desktop agent', type: 'select_or_custom', options: [
        '30', '60', '90', '120', '180', '240', '300'
    ].map(v => ({ value: v, label: `${v}s` })) },
    AURA_WIZ_BROADCAST: { category: 'env', description: 'WiZ smart-bulb UDP discovery broadcast address', type: 'select_or_custom', options: [
        { value: '255.255.255.255', label: '255.255.255.255 (Global Broadcast)' }
    ]},
    AURA_SSE_HEARTBEAT: { category: 'env', description: 'Server-Sent Events keep-alive ping interval (seconds)', type: 'select_or_custom', options: [
        '5', '10', '15', '20', '30', '60'
    ].map(v => ({ value: v, label: `${v}s` })) }
};

function populateSelectOptions(selectEl, options, currentVal, extraCustomOption = false) {
    if (!selectEl) return;
    const valStr = currentVal === undefined || currentVal === null ? '' : String(currentVal);
    const opts = Array.isArray(options) ? options.slice() : [];
    const hasExact = opts.some(o => String(o.value) === valStr);

    if (valStr !== '' && !hasExact && !extraCustomOption) {
        opts.unshift({ value: valStr, label: `${valStr} (Current)` });
    }

    let html = opts.map(o => {
        const v = String(o.value);
        const sel = v === valStr ? 'selected' : '';
        return `<option value="${escapeHtml(v)}" ${sel}>${escapeHtml(o.label || v)}</option>`;
    }).join('');

    if (extraCustomOption) {
        const useCustom = valStr !== '' && !hasExact;
        html += `<option value="__custom__" ${useCustom ? 'selected' : ''}>Custom value...</option>`;
    }

    selectEl.innerHTML = html;
    if (extraCustomOption) {
        selectEl.value = (valStr !== '' && !hasExact) ? '__custom__' : valStr;
    } else if (hasExact || valStr !== '') {
        selectEl.value = valStr;
    }
}

function getVoiceOptionsForBackend(backend) {
    const norm = String(backend || 'edge').toLowerCase();
    const voicesByBackend = cachedEnvOptions?.tts_voices || {};
    const rawEdge = (Array.isArray(voicesByBackend.edge) && voicesByBackend.edge.length)
        ? voicesByBackend.edge
        : DEFAULT_EDGE_VOICES;
    const rawKokoro = (Array.isArray(voicesByBackend.kokoro) && voicesByBackend.kokoro.length)
        ? voicesByBackend.kokoro
        : DEFAULT_KOKORO_VOICES;
    const raw = norm === 'kokoro' ? rawKokoro : rawEdge;
    return raw.map(v => ({ value: v.id, label: v.name }));
}

function updateVoiceSelectForBackend(backend, desiredVoice) {
    const ttsVoiceSelect = document.getElementById('tts-voice-select');
    if (!ttsVoiceSelect) return;
    const norm = String(backend || 'edge').toLowerCase() === 'kokoro' ? 'kokoro' : 'edge';
    const list = getVoiceOptionsForBackend(norm);
    const current = desiredVoice !== undefined
        ? desiredVoice
        : (_pendingVoiceByBackend[norm] || cachedEnvVars.AURA_TTS_VOICE || ttsVoiceSelect.value);
    const matchesBackend = list.some(o => o.value === current);
    const fallbackDefault = norm === 'kokoro' ? 'af' : 'en-US-JennyNeural';
    const chosen = matchesBackend
        ? current
        : (list.some(o => o.value === fallbackDefault) ? fallbackDefault : (list[0]?.value || ''));

    populateSelectOptions(ttsVoiceSelect, list, chosen, false);
    if (chosen) {
        _pendingVoiceByBackend[norm] = chosen;
        localStorage.setItem('aura_tts_voice', chosen);
    }
    localStorage.setItem('aura_tts_backend', norm);
}

function getEnvRowValue(row, key) {
    if (!row) return '';
    const main = row.querySelector(`.env-inline-input[data-key="${CSS.escape(key)}"]`);
    if (!main) return '';
    if (main.tagName === 'SELECT' && main.value === '__custom__') {
        const customInput = row.querySelector(`.env-custom-input[data-key="${CSS.escape(key)}"]`);
        return customInput ? customInput.value.trim() : '';
    }
    return main.value.trim();
}

let _envLoadInFlight = null;
async function loadEnvSettings() {
    if (_envLoadInFlight) return _envLoadInFlight;
    _envLoadInFlight = _doLoadEnvSettings().finally(() => { _envLoadInFlight = null; });
    return _envLoadInFlight;
}

async function _doLoadEnvSettings() {
    try {
        const res = await api('/api/settings/env');
        if (!res.ok) return;
        const data = await res.json();
        if (data.status !== 'success') return;
        cachedEnvVars = data.env || {};
        cachedEnvSchema = { ...FALLBACK_ENV_SCHEMA, ...(data.schema || {}) };
        cachedEnvOptions = data.options || {};

        const models = Array.isArray(data.available_models) ? data.available_models : [];
        const modelOpts = models.map(m => ({ value: m, label: m }));

        // 1. Populate Active Provider, Cloud Keys/Models & Ollama Reasoning/Vision dropdowns
        const providerSelect = document.getElementById('env-llm-provider');
        if (providerSelect) {
            const curProv = (cachedEnvVars.AURA_LLM_PROVIDER || 'ollama').trim().toLowerCase();
            providerSelect.value = ['ollama', 'groq', 'nvidia', 'gemini', 'openai', 'openrouter'].includes(curProv) ? curProv : 'ollama';
        }

        Object.entries(CLOUD_PROVIDER_DEFAULTS).forEach(([prov, spec]) => {
            const keyInput = document.getElementById(`env-${prov}-api-key`);
            const statusPill = document.getElementById(`provider-status-${prov}`);
            const keyVal = cachedEnvVars[spec.keyEnv] || '';
            if (keyInput) keyInput.value = keyVal;
            if (statusPill) {
                statusPill.classList.remove('configured', 'error');
                if (keyVal.trim()) {
                    const cachedCount = Array.isArray(liveProviderModels[prov]) ? liveProviderModels[prov].length : 0;
                    statusPill.textContent = cachedCount > 0 ? `LIVE (${cachedCount})` : 'KEY SET';
                    statusPill.classList.add('configured');
                } else {
                    statusPill.textContent = 'KEY OPTIONAL';
                }
            }
            if (Array.isArray(liveProviderModels[prov]) && liveProviderModels[prov].length > 0 && cachedEnvSchema[spec.modelEnv]) {
                cachedEnvSchema[spec.modelEnv].options = liveProviderModels[prov].map(m => ({ value: m, label: m }));
            }
            refreshCloudModelSelect(prov, cachedEnvVars[spec.modelEnv] || spec.defaultModel);
            if (keyVal.trim().length >= 12 && !_providerAutoFetched[prov]) {
                _providerAutoFetched[prov] = true;
                fetchLiveModelsForProvider(prov, { silent: true });
            }
        });

        const ollamaSelect = document.getElementById('env-ollama-model');
        const ollamaCustom = document.getElementById('env-ollama-model-custom');
        if (ollamaSelect) {
            const curModel = cachedEnvVars.OLLAMA_MODEL || 'gemma4:e2b';
            const opts = modelOpts.length ? modelOpts : [{ value: curModel, label: `${curModel} (Configured)` }];
            populateSelectOptions(ollamaSelect, opts, curModel, true);
            if (ollamaCustom) {
                const isCustom = ollamaSelect.value === '__custom__';
                ollamaCustom.style.display = isCustom ? 'block' : 'none';
                ollamaCustom.value = isCustom ? curModel : '';
            }
        }

        const visionSelect = document.getElementById('env-vision-model');
        const visionCustom = document.getElementById('env-vision-model-custom');
        if (visionSelect) {
            const curVision = cachedEnvVars.OLLAMA_VISION_MODEL || 'qwen3-vl:4b';
            const vOpts = modelOpts.length ? modelOpts : [{ value: curVision, label: `${curVision} (Configured)` }];
            populateSelectOptions(visionSelect, vOpts, curVision, true);
            if (visionCustom) {
                const isCustom = visionSelect.value === '__custom__';
                visionCustom.style.display = isCustom ? 'block' : 'none';
                visionCustom.value = isCustom ? curVision : '';
            }
        }

        const ctxSelect = document.getElementById('env-num-ctx');
        if (ctxSelect && cachedEnvVars.OLLAMA_NUM_CTX !== undefined) {
            const curCtx = String(cachedEnvVars.OLLAMA_NUM_CTX || '8192');
            if (!Array.from(ctxSelect.options).some(o => o.value === curCtx)) {
                ctxSelect.add(new Option(`${curCtx} tokens (Custom)`, curCtx));
            }
            ctxSelect.value = curCtx;
        }

        const keepAliveSelect = document.getElementById('env-keep-alive');
        if (keepAliveSelect && cachedEnvVars.OLLAMA_KEEP_ALIVE !== undefined) {
            const curKa = String(cachedEnvVars.OLLAMA_KEEP_ALIVE || '5m');
            if (!Array.from(keepAliveSelect.options).some(o => o.value === curKa)) {
                keepAliveSelect.add(new Option(`${curKa} (Custom)`, curKa));
            }
            keepAliveSelect.value = curKa;
        }

        const routerSelect = document.getElementById('env-intent-router');
        if (routerSelect && cachedEnvVars.AURA_INTENT_ROUTER !== undefined) {
            const rawRouter = String(cachedEnvVars.AURA_INTENT_ROUTER || 'on').trim().toLowerCase();
            routerSelect.value = ['off', 'false', '0', 'no'].includes(rawRouter) ? 'off' : 'on';
        }

        // 2. Populate TTS & Voice fields
        const savedTtsBackend = (cachedEnvVars.AURA_TTS_BACKEND || 'edge').trim().toLowerCase() === 'kokoro' ? 'kokoro' : 'edge';
        const ttsBackendSelect = document.getElementById('env-tts-backend');
        const activeTtsBackend = (_ttsBackendUserTouched && ttsBackendSelect)
            ? (ttsBackendSelect.value === 'kokoro' ? 'kokoro' : 'edge')
            : savedTtsBackend;
        if (ttsBackendSelect && !_ttsBackendUserTouched) {
            ttsBackendSelect.value = activeTtsBackend;
        }
        const savedTtsVoice = cachedEnvVars.AURA_TTS_VOICE || (savedTtsBackend === 'kokoro' ? 'af' : 'en-US-JennyNeural');
        if (!_ttsBackendUserTouched) {
            _pendingVoiceByBackend[savedTtsBackend] = savedTtsVoice;
            updateVoiceSelectForBackend(activeTtsBackend, savedTtsVoice);
        } else {
            updateVoiceSelectForBackend(activeTtsBackend);
        }

        const ttsRateSlider = document.getElementById('tts-rate-slider');
        const ttsRateVal = document.getElementById('tts-rate-val');
        if (ttsRateSlider && cachedEnvVars.AURA_TTS_RATE !== undefined) {
            const rawRate = cachedEnvVars.AURA_TTS_RATE || '+0%';
            const rInt = parseInt(rawRate.replace('%', '').replace('+', '')) || 0;
            ttsRateSlider.value = rInt;
            if (ttsRateVal) ttsRateVal.textContent = rInt === 0 ? 'Normal (+0%)' : `${rInt > 0 ? '+' : ''}${rInt}%`;
            localStorage.setItem('aura_tts_rate', rawRate);
        }

        // 3. Populate STT & Wake Word fields
        const sttBackendSelect = document.getElementById('env-stt-backend');
        if (sttBackendSelect && cachedEnvVars.AURA_STT_BACKEND) {
            sttBackendSelect.value = String(cachedEnvVars.AURA_STT_BACKEND).trim().toLowerCase();
        }
        const sttModelSelect = document.getElementById('env-stt-model');
        if (sttModelSelect && cachedEnvVars.AURA_STT_MODEL) {
            if (!Array.from(sttModelSelect.options).some(o => o.value === cachedEnvVars.AURA_STT_MODEL)) {
                sttModelSelect.add(new Option(cachedEnvVars.AURA_STT_MODEL, cachedEnvVars.AURA_STT_MODEL));
            }
            sttModelSelect.value = cachedEnvVars.AURA_STT_MODEL;
        }
        const sttDeviceSelect = document.getElementById('env-stt-device');
        if (sttDeviceSelect && cachedEnvVars.AURA_STT_DEVICE) {
            sttDeviceSelect.value = String(cachedEnvVars.AURA_STT_DEVICE).trim().toLowerCase();
        }
        const sttComputeSelect = document.getElementById('env-stt-compute-type');
        if (sttComputeSelect && cachedEnvVars.AURA_STT_COMPUTE_TYPE) {
            sttComputeSelect.value = String(cachedEnvVars.AURA_STT_COMPUTE_TYPE).trim().toLowerCase();
        }

        const wakeModelSelect = document.getElementById('env-wakeword-model');
        if (wakeModelSelect) {
            const wwOpts = cachedEnvOptions.wakeword_models || [{ value: 'models/hey_aura.onnx', label: 'models/hey_aura.onnx' }];
            populateSelectOptions(wakeModelSelect, wwOpts, cachedEnvVars.AURA_WAKEWORD_MODEL || 'models/hey_aura.onnx', false);
        }

        const wakeDeviceSelect = document.getElementById('env-wakeword-device');
        if (wakeDeviceSelect) {
            const devOpts = cachedEnvOptions.audio_input_devices || [{ value: '', label: 'System Default Microphone' }];
            populateSelectOptions(wakeDeviceSelect, devOpts, cachedEnvVars.AURA_WAKEWORD_DEVICE ?? '', false);
        }

        const wakeThreshSlider = document.getElementById('env-wakeword-thresh-slider');
        const wakeThreshVal = document.getElementById('env-wakeword-thresh-val');
        if (wakeThreshSlider && cachedEnvVars.AURA_WAKEWORD_THRESHOLD) {
            const val = parseFloat(cachedEnvVars.AURA_WAKEWORD_THRESHOLD);
            if (!Number.isNaN(val)) {
                wakeThreshSlider.value = Math.round(val * 100);
                if (wakeThreshVal) wakeThreshVal.textContent = val.toFixed(2);
            }
        }
        const spkThreshSlider = document.getElementById('env-speaking-thresh-slider');
        const spkThreshVal = document.getElementById('env-speaking-thresh-val');
        if (spkThreshSlider && cachedEnvVars.AURA_WAKEWORD_SPEAKING_THRESHOLD) {
            const val = parseFloat(cachedEnvVars.AURA_WAKEWORD_SPEAKING_THRESHOLD);
            if (!Number.isNaN(val)) {
                spkThreshSlider.value = Math.round(val * 100);
                if (spkThreshVal) spkThreshVal.textContent = val.toFixed(2);
            }
        }

        const cooldownSelect = document.getElementById('env-wakeword-cooldown');
        if (cooldownSelect && cachedEnvVars.AURA_WAKEWORD_COOLDOWN !== undefined) {
            const cur = String(cachedEnvVars.AURA_WAKEWORD_COOLDOWN || '2.0');
            if (!Array.from(cooldownSelect.options).some(o => o.value === cur)) {
                cooldownSelect.add(new Option(`${cur}s`, cur));
            }
            cooldownSelect.value = cur;
        }
        const persistSelect = document.getElementById('env-wakeword-persistence');
        if (persistSelect && cachedEnvVars.AURA_WAKEWORD_PERSISTENCE !== undefined) {
            const cur = String(cachedEnvVars.AURA_WAKEWORD_PERSISTENCE || '3');
            if (!Array.from(persistSelect.options).some(o => o.value === cur)) {
                persistSelect.add(new Option(`${cur} chunks`, cur));
            }
            persistSelect.value = cur;
        }
        const vadSelect = document.getElementById('env-wakeword-vad');
        if (vadSelect && cachedEnvVars.AURA_WAKEWORD_VAD_THRESHOLD !== undefined) {
            const cur = String(cachedEnvVars.AURA_WAKEWORD_VAD_THRESHOLD || '20.0');
            if (!Array.from(vadSelect.options).some(o => o.value === cur)) {
                vadSelect.add(new Option(cur, cur));
            }
            vadSelect.value = cur;
        }
        const oneShotSelect = document.getElementById('env-wakeword-one-shot');
        if (oneShotSelect && cachedEnvVars.AURA_WAKEWORD_ONE_SHOT !== undefined) {
            const rawOneShot = String(cachedEnvVars.AURA_WAKEWORD_ONE_SHOT || 'true').trim().toLowerCase();
            oneShotSelect.value = ['true', '1', 'yes'].includes(rawOneShot) ? 'true' : 'false';
        }
        const spkVerSelect = document.getElementById('env-speaker-verification');
        if (spkVerSelect && cachedEnvVars.AURA_SPEAKER_VERIFICATION !== undefined) {
            const rawSpk = String(cachedEnvVars.AURA_SPEAKER_VERIFICATION || 'false').trim().toLowerCase();
            spkVerSelect.value = ['true', '1', 'yes'].includes(rawSpk) ? 'true' : 'false';
        }

        // 4. Populate Automation, Smart Home & Server fields
        const timeoutSelect = document.getElementById('env-visual-timeout');
        if (timeoutSelect && cachedEnvVars.AURA_VISUAL_TASK_TIMEOUT !== undefined) {
            const cur = String(cachedEnvVars.AURA_VISUAL_TASK_TIMEOUT || '120');
            if (!Array.from(timeoutSelect.options).some(o => o.value === cur)) {
                timeoutSelect.add(new Option(`${cur}s`, cur));
            }
            timeoutSelect.value = cur;
        }
        const wizSelect = document.getElementById('env-wiz-broadcast');
        if (wizSelect) {
            const wizOpts = cachedEnvOptions.wiz_broadcasts || [{ value: '255.255.255.255', label: '255.255.255.255 (Global Broadcast)' }];
            populateSelectOptions(wizSelect, wizOpts, cachedEnvVars.AURA_WIZ_BROADCAST || '255.255.255.255', false);
        }
        const sseSelect = document.getElementById('env-sse-heartbeat');
        if (sseSelect && cachedEnvVars.AURA_SSE_HEARTBEAT !== undefined) {
            const cur = String(cachedEnvVars.AURA_SSE_HEARTBEAT || '15');
            if (!Array.from(sseSelect.options).some(o => o.value === cur)) {
                sseSelect.add(new Option(`${cur}s`, cur));
            }
            sseSelect.value = cur;
        }

        // 5. Render full .env Editor table with exact options
        const filterEl = document.getElementById('env-filter-input');
        renderEnvTable(filterEl ? filterEl.value.trim() : '');
    } catch (e) {
        console.error('Failed to load .env settings:', e);
    }
}

function renderEnvTable(filterQuery = '') {
    const tableBody = document.getElementById('env-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const keys = Object.keys(cachedEnvVars).filter(k => {
        if (!filterQuery) return true;
        const q = filterQuery.toLowerCase();
        const desc = (cachedEnvSchema[k]?.description || '').toLowerCase();
        return k.toLowerCase().includes(q) || String(cachedEnvVars[k]).toLowerCase().includes(q) || desc.includes(q);
    });

    if (keys.length === 0) {
        tableBody.innerHTML = '<div class="env-table-empty">No matching environment variables found.</div>';
        return;
    }

    keys.forEach(key => {
        const row = document.createElement('div');
        row.className = 'env-table-row';
        const val = String(cachedEnvVars[key] ?? '');
        const meta = cachedEnvSchema[key];
        const descHtml = meta?.description ? `<span class="env-key-desc" title="${escapeHtml(meta.description)}">${escapeHtml(meta.description)}</span>` : '';

        let controlHtml = '';
        let rowOptions = meta?.options;
        if (key === 'AURA_TTS_VOICE') {
            const activeBackend = (cachedEnvVars.AURA_TTS_BACKEND || 'edge').toLowerCase();
            rowOptions = getVoiceOptionsForBackend(activeBackend);
        }

        if (meta && Array.isArray(rowOptions) && rowOptions.length > 0) {
            const hasExact = rowOptions.some(o => String(o.value) === val);
            const allowCustom = meta.type === 'select_or_custom';
            const optsHtml = rowOptions.map(o => {
                const ov = String(o.value);
                const sel = ov === val ? 'selected' : '';
                return `<option value="${escapeHtml(ov)}" ${sel}>${escapeHtml(o.label || ov)}</option>`;
            }).join('') + (allowCustom ? `<option value="__custom__" ${!hasExact ? 'selected' : ''}>Custom value...</option>` : '');

            const customStyle = (allowCustom && !hasExact) ? 'display:block;' : 'display:none;';
            const customVal = (allowCustom && !hasExact) ? val : '';

            controlHtml = `
                <select class="env-inline-input env-inline-select" data-key="${escapeHtml(key)}" aria-label="${escapeHtml(key)}">
                    ${optsHtml}
                </select>
                ${allowCustom ? `<input type="text" class="env-inline-input env-custom-input" data-key="${escapeHtml(key)}" value="${escapeHtml(customVal)}" placeholder="Enter custom value..." style="${customStyle}">` : ''}
            `;
        } else if (meta?.type === 'password') {
            controlHtml = `
                <div class="secret-input-group">
                    <input type="password" class="env-inline-input" data-key="${escapeHtml(key)}" value="${escapeHtml(val)}" placeholder="Enter API key..." autocomplete="off">
                    <button type="button" class="qa-btn compact env-secret-toggle" title="Show/Hide value" aria-label="Show ${escapeHtml(key)} value" aria-pressed="false">SHOW</button>
                </div>
            `;
        } else {
            controlHtml = `<input type="text" class="env-inline-input" data-key="${escapeHtml(key)}" value="${escapeHtml(val)}">`;
        }

        row.innerHTML = `
            <div class="env-col-key">
                <span class="env-key-name">${escapeHtml(key)}</span>
                ${descHtml}
            </div>
            <div class="env-col-val">
                ${controlHtml}
            </div>
            <div class="env-col-act">
                <button type="button" class="qa-btn compact env-row-save" data-key="${escapeHtml(key)}" title="Save ${escapeHtml(key)} to .env">SAVE</button>
            </div>
        `;
        tableBody.appendChild(row);
    });

    // Wire dirty tracking & custom toggle
    tableBody.querySelectorAll('.env-table-row').forEach(row => {
        const key = row.querySelector('[data-key]')?.getAttribute('data-key');
        if (!key) return;
        const mainCtrl = row.querySelector(`.env-inline-input[data-key="${CSS.escape(key)}"]`);
        const customCtrl = row.querySelector(`.env-custom-input[data-key="${CSS.escape(key)}"]`);

        const updateDirty = () => {
            const curVal = getEnvRowValue(row, key);
            const origVal = String(cachedEnvVars[key] ?? '');
            row.classList.toggle('dirty', curVal !== origVal);
        };

        if (mainCtrl) {
            mainCtrl.addEventListener('change', () => {
                if (customCtrl && mainCtrl.tagName === 'SELECT') {
                    const isCustom = mainCtrl.value === '__custom__';
                    customCtrl.style.display = isCustom ? 'block' : 'none';
                    if (isCustom && !customCtrl.value) customCtrl.focus();
                }
                if (key === 'AURA_TTS_BACKEND') {
                    const voiceCtrl = tableBody.querySelector('.env-inline-select[data-key="AURA_TTS_VOICE"]');
                    const voiceRow = voiceCtrl?.closest('.env-table-row');
                    if (voiceCtrl && voiceRow) {
                        const newBackend = mainCtrl.value.toLowerCase();
                        const backendVoices = getVoiceOptionsForBackend(newBackend);
                        const curVoice = getEnvRowValue(voiceRow, 'AURA_TTS_VOICE');
                        const fallbackVoice = newBackend === 'kokoro' ? 'af' : 'en-US-JennyNeural';
                        const nextVoice = backendVoices.some(o => o.value === curVoice)
                            ? curVoice
                            : (backendVoices.some(o => o.value === fallbackVoice) ? fallbackVoice : (backendVoices[0]?.value || ''));
                        populateSelectOptions(voiceCtrl, backendVoices, nextVoice, true);
                        const vCustom = voiceRow.querySelector('.env-custom-input[data-key="AURA_TTS_VOICE"]');
                        if (vCustom) vCustom.style.display = 'none';
                        voiceRow.classList.toggle('dirty', nextVoice !== String(cachedEnvVars.AURA_TTS_VOICE ?? ''));
                    }
                }
                updateDirty();
            });
            mainCtrl.addEventListener('input', updateDirty);
        }
        if (customCtrl) {
            customCtrl.addEventListener('input', updateDirty);
        }
        const secretToggle = row.querySelector('.env-secret-toggle');
        if (secretToggle && mainCtrl) {
            secretToggle.addEventListener('click', () => {
                const reveal = mainCtrl.type === 'password';
                mainCtrl.type = reveal ? 'text' : 'password';
                secretToggle.setAttribute('aria-pressed', String(reveal));
                secretToggle.textContent = reveal ? 'HIDE' : 'SHOW';
                secretToggle.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${key} value`);
            });
        }
    });

    tableBody.querySelectorAll('.env-row-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-key');
            const row = btn.closest('.env-table-row');
            if (!key || !row) return;
            const newVal = getEnvRowValue(row, key);
            btn.disabled = true;
            btn.textContent = '...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: { [key]: newVal } })
                });
                if (res.ok) {
                    cachedEnvVars[key] = newVal;
                    row.classList.remove('dirty');
                    if (key === 'AURA_TTS_BACKEND' || key === 'AURA_TTS_VOICE') {
                        _ttsBackendUserTouched = false;
                    }
                    showToast('ENVIRONMENT', `${key} saved to .env`, 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('ENVIRONMENT', `Failed to save ${key}`, 'error');
                }
            } catch (err) {
                showToast('ENVIRONMENT', `Error saving ${key}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'SAVE';
            }
        });
    });
}

function initEnvSettings() {
    // 1. Load from .env API only if Settings is already active; otherwise showView('settings') loads it lazily.
    if (isViewActive('settings')) {
        loadEnvSettings();
    }

    // 2. Reasoning & Vision model custom toggles + TTS backend voice switcher
    const ollamaSelect = document.getElementById('env-ollama-model');
    const ollamaCustom = document.getElementById('env-ollama-model-custom');
    if (ollamaSelect && ollamaCustom) {
        ollamaSelect.addEventListener('change', () => {
            const isCustom = ollamaSelect.value === '__custom__';
            ollamaCustom.style.display = isCustom ? 'block' : 'none';
            if (isCustom) ollamaCustom.focus();
        });
    }

    const visionSelect = document.getElementById('env-vision-model');
    const visionCustom = document.getElementById('env-vision-model-custom');
    if (visionSelect && visionCustom) {
        visionSelect.addEventListener('change', () => {
            const isCustom = visionSelect.value === '__custom__';
            visionCustom.style.display = isCustom ? 'block' : 'none';
            if (isCustom) visionCustom.focus();
        });
    }

    const ttsBackendSelect = document.getElementById('env-tts-backend');
    const ttsVoiceSelectEl = document.getElementById('tts-voice-select');
    if (ttsVoiceSelectEl) {
        ttsVoiceSelectEl.addEventListener('change', () => {
            const curBackend = (ttsBackendSelect?.value || 'edge').toLowerCase() === 'kokoro' ? 'kokoro' : 'edge';
            _pendingVoiceByBackend[curBackend] = ttsVoiceSelectEl.value;
            localStorage.setItem('aura_tts_voice', ttsVoiceSelectEl.value);
        });
    }
    if (ttsBackendSelect) {
        ttsBackendSelect.addEventListener('change', () => {
            _ttsBackendUserTouched = true;
            updateVoiceSelectForBackend(ttsBackendSelect.value);
        });
    }

    // 3. Wake word threshold slider feedback
    const wakeSlider = document.getElementById('env-wakeword-thresh-slider');
    const wakeVal = document.getElementById('env-wakeword-thresh-val');
    if (wakeSlider && wakeVal) {
        wakeSlider.addEventListener('input', () => {
            const v = (parseInt(wakeSlider.value) / 100).toFixed(2);
            wakeVal.textContent = v;
        });
    }

    const spkSlider = document.getElementById('env-speaking-thresh-slider');
    const spkVal = document.getElementById('env-speaking-thresh-val');
    if (spkSlider && spkVal) {
        spkSlider.addEventListener('input', () => {
            const v = (parseInt(spkSlider.value) / 100).toFixed(2);
            spkVal.textContent = v;
        });
    }

    // 4. Save LLM & Reasoning Settings to .env
    const saveLlmBtn = document.getElementById('btn-save-llm-env');
    if (saveLlmBtn) {
        saveLlmBtn.addEventListener('click', async () => {
            const provider = document.getElementById('env-llm-provider')?.value || 'ollama';
            const mSel = document.getElementById('env-ollama-model')?.value;
            const model = mSel === '__custom__' ? document.getElementById('env-ollama-model-custom')?.value.trim() : mSel;
            const vSel = document.getElementById('env-vision-model')?.value;
            const vision = vSel === '__custom__' ? document.getElementById('env-vision-model-custom')?.value.trim() : vSel;
            const ctx = document.getElementById('env-num-ctx')?.value;
            const keepAlive = document.getElementById('env-keep-alive')?.value;
            const router = document.getElementById('env-intent-router')?.value;

            const payload = { 'AURA_LLM_PROVIDER': provider };
            if (model) payload['OLLAMA_MODEL'] = model;
            if (vision) payload['OLLAMA_VISION_MODEL'] = vision;
            if (ctx) payload['OLLAMA_NUM_CTX'] = ctx;
            if (keepAlive !== undefined && keepAlive !== '') payload['OLLAMA_KEEP_ALIVE'] = keepAlive;
            if (router) payload['AURA_INTENT_ROUTER'] = router;

            saveLlmBtn.disabled = true;
            saveLlmBtn.textContent = 'SAVING...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: payload })
                });
                if (res.ok) {
                    showToast('AI CONFIG', 'AI provider & Ollama settings saved to .env', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('AI CONFIG', 'Failed to save to .env', 'error');
                }
            } catch (err) {
                showToast('AI CONFIG', 'Failed to save to .env', 'error');
            } finally {
                saveLlmBtn.disabled = false;
                saveLlmBtn.textContent = 'SAVE TO .ENV';
            }
        });
    }

    // 4b. Cloud AI API Keys & Models (Groq, NVIDIA NIM, Google Gemini, OpenAI)
    document.querySelectorAll('.btn-toggle-secret').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const inp = targetId ? document.getElementById(targetId) : null;
            if (inp) {
                const reveal = inp.type === 'password';
                inp.type = reveal ? 'text' : 'password';
                btn.setAttribute('aria-pressed', String(reveal));
                btn.textContent = reveal ? 'HIDE' : 'SHOW';
            }
        });
    });

    Object.keys(CLOUD_PROVIDER_DEFAULTS).forEach(prov => {
        const mSel = document.getElementById(`env-${prov}-model`);
        const mCust = document.getElementById(`env-${prov}-model-custom`);
        if (mSel && mCust) {
            mSel.addEventListener('change', () => {
                const isCustom = mSel.value === '__custom__';
                mCust.style.display = isCustom ? 'block' : 'none';
                if (isCustom) mCust.focus();
            });
        }
        const mSearch = document.getElementById(`env-${prov}-model-search`);
        if (mSearch) {
            mSearch.addEventListener('input', () => {
                refreshCloudModelSelect(prov);
            });
        }
        const keyInp = document.getElementById(`env-${prov}-api-key`);
        if (keyInp) {
            const scheduleAutoFetch = (delayMs) => {
                clearTimeout(_providerDebounceTimers[prov]);
                const val = keyInp.value.trim();
                if (!val) {
                    const pill = document.getElementById(`provider-status-${prov}`);
                    if (pill) {
                        pill.textContent = 'KEY OPTIONAL';
                        pill.classList.remove('configured', 'error');
                    }
                    return;
                }
                if (val.length < 12 || val === _providerLastKey[prov]) return;
                _providerDebounceTimers[prov] = setTimeout(() => {
                    fetchLiveModelsForProvider(prov, { silent: false });
                }, delayMs);
            };
            keyInp.addEventListener('input', () => scheduleAutoFetch(700));
            keyInp.addEventListener('change', () => scheduleAutoFetch(50));
        }
    });

    document.querySelectorAll('.btn-test-provider').forEach(btn => {
        btn.addEventListener('click', async () => {
            const prov = btn.getAttribute('data-provider');
            if (!prov) return;
            clearTimeout(_providerDebounceTimers[prov]);
            await fetchLiveModelsForProvider(prov, { silent: false });
        });
    });

    const saveCloudBtn = document.getElementById('btn-save-cloud-env');
    if (saveCloudBtn) {
        saveCloudBtn.addEventListener('click', async () => {
            const payload = {};
            Object.entries(CLOUD_PROVIDER_DEFAULTS).forEach(([prov, spec]) => {
                const keyVal = document.getElementById(`env-${prov}-api-key`)?.value.trim() ?? '';
                const mSel = document.getElementById(`env-${prov}-model`)?.value;
                const modelVal = mSel === '__custom__'
                    ? (document.getElementById(`env-${prov}-model-custom`)?.value.trim() || spec.defaultModel)
                    : (mSel || spec.defaultModel);
                payload[spec.keyEnv] = keyVal;
                payload[spec.modelEnv] = modelVal;
            });
            saveCloudBtn.disabled = true;
            saveCloudBtn.textContent = 'SAVING...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: payload })
                });
                if (res.ok) {
                    showToast('CLOUD API', 'API keys & models saved to .env', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('CLOUD API', 'Failed to save API keys', 'error');
                }
            } catch (err) {
                showToast('CLOUD API', 'Failed to save API keys', 'error');
            } finally {
                saveCloudBtn.disabled = false;
                saveCloudBtn.textContent = 'SAVE API KEYS & MODELS TO .ENV';
            }
        });
    }

    // 5. Save STT & Wake Word Settings to .env
    const saveSttBtn = document.getElementById('btn-save-stt-env');
    if (saveSttBtn) {
        saveSttBtn.addEventListener('click', async () => {
            const payload = {
                'AURA_STT_BACKEND': document.getElementById('env-stt-backend')?.value || 'local',
                'AURA_STT_MODEL': document.getElementById('env-stt-model')?.value || 'tiny.en',
                'AURA_STT_DEVICE': document.getElementById('env-stt-device')?.value || 'auto',
                'AURA_STT_COMPUTE_TYPE': document.getElementById('env-stt-compute-type')?.value || 'auto',
                'AURA_WAKEWORD_MODEL': document.getElementById('env-wakeword-model')?.value || 'models/hey_aura.onnx',
                'AURA_WAKEWORD_DEVICE': document.getElementById('env-wakeword-device')?.value ?? '',
                'AURA_WAKEWORD_THRESHOLD': wakeSlider ? (parseInt(wakeSlider.value) / 100).toFixed(2) : '0.60',
                'AURA_WAKEWORD_SPEAKING_THRESHOLD': spkSlider ? (parseInt(spkSlider.value) / 100).toFixed(2) : '0.85',
                'AURA_WAKEWORD_COOLDOWN': document.getElementById('env-wakeword-cooldown')?.value || '2.0',
                'AURA_WAKEWORD_PERSISTENCE': document.getElementById('env-wakeword-persistence')?.value || '3',
                'AURA_WAKEWORD_VAD_THRESHOLD': document.getElementById('env-wakeword-vad')?.value || '20.0',
                'AURA_WAKEWORD_ONE_SHOT': document.getElementById('env-wakeword-one-shot')?.value || 'true',
                'AURA_SPEAKER_VERIFICATION': document.getElementById('env-speaker-verification')?.value || 'false',
            };

            saveSttBtn.disabled = true;
            saveSttBtn.textContent = 'SAVING...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: payload })
                });
                if (res.ok) {
                    showToast('SPEECH & WAKE', 'Settings written to .env', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('SPEECH & WAKE', 'Failed to save to .env', 'error');
                }
            } catch (err) {
                showToast('SPEECH & WAKE', 'Failed to save to .env', 'error');
            } finally {
                saveSttBtn.disabled = false;
                saveSttBtn.textContent = 'SAVE TO .ENV';
            }
        });
    }

    // 6. Save Automation, Smart Home & Server Settings to .env
    const saveSysBtn = document.getElementById('btn-save-system-env');
    if (saveSysBtn) {
        saveSysBtn.addEventListener('click', async () => {
            const payload = {
                'AURA_VISUAL_TASK_TIMEOUT': document.getElementById('env-visual-timeout')?.value || '120',
                'AURA_WIZ_BROADCAST': document.getElementById('env-wiz-broadcast')?.value || '255.255.255.255',
                'AURA_SSE_HEARTBEAT': document.getElementById('env-sse-heartbeat')?.value || '15',
            };
            saveSysBtn.disabled = true;
            saveSysBtn.textContent = 'SAVING...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: payload })
                });
                if (res.ok) {
                    showToast('SYSTEM CONFIG', 'System .env settings saved', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('SYSTEM CONFIG', 'Failed to save to .env', 'error');
                }
            } catch (err) {
                showToast('SYSTEM CONFIG', 'Failed to save to .env', 'error');
            } finally {
                saveSysBtn.disabled = false;
                saveSysBtn.textContent = 'SAVE TO .ENV';
            }
        });
    }

    // 7. Save Voice Settings cleanly to .env (single authoritative listener)
    const saveVoiceBtn = document.getElementById('btn-save-voice');
    if (saveVoiceBtn) {
        saveVoiceBtn.addEventListener('click', async () => {
            const v = document.getElementById('tts-voice-select')?.value || 'en-US-AvaNeural';
            const slider = document.getElementById('tts-rate-slider');
            const r = slider ? `${parseInt(slider.value) >= 0 ? '+' : ''}${parseInt(slider.value)}%` : '+0%';
            const backend = document.getElementById('env-tts-backend')?.value || 'edge';

            saveVoiceBtn.disabled = true;
            saveVoiceBtn.textContent = 'SAVING...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        settings: {
                            'AURA_TTS_VOICE': v,
                            'AURA_TTS_RATE': r,
                            'AURA_TTS_BACKEND': backend
                        }
                    })
                });
                if (res.ok) {
                    _ttsBackendUserTouched = false;
                    _pendingVoiceByBackend[backend === 'kokoro' ? 'kokoro' : 'edge'] = v;
                    localStorage.setItem('aura_tts_voice', v);
                    localStorage.setItem('aura_tts_rate', r);
                    localStorage.setItem('aura_tts_backend', backend);
                    showToast('VOICE ENGINE', 'Voice preferences saved to .env', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('VOICE ENGINE', 'Failed to save voice settings', 'error');
                }
            } catch (err) {
                showToast('VOICE ENGINE', 'Failed to save voice settings', 'error');
            } finally {
                saveVoiceBtn.disabled = false;
                saveVoiceBtn.textContent = 'SAVE PREFERENCE (TO .ENV)';
            }
        });
    }

    // 8. Table Filter / Search
    const filterInput = document.getElementById('env-filter-input');
    if (filterInput) {
        filterInput.addEventListener('input', () => {
            renderEnvTable(filterInput.value.trim());
        });
    }

    // 9. Reload from disk
    const reloadBtn = document.getElementById('btn-reload-env');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', async () => {
            reloadBtn.disabled = true;
            _ttsBackendUserTouched = false;
            _pendingVoiceByBackend = { edge: null, kokoro: null };
            await loadEnvSettings();
            showToast('ENVIRONMENT', 'Settings reloaded from .env file.', 'info');
            reloadBtn.disabled = false;
        });
    }

    // 10. Save All Table Changes to .env
    const saveAllBtn = document.getElementById('btn-save-all-env');
    if (saveAllBtn) {
        saveAllBtn.addEventListener('click', async () => {
            const rows = document.querySelectorAll('#env-table-body .env-table-row');
            const payload = {};
            rows.forEach(row => {
                const k = row.querySelector('[data-key]')?.getAttribute('data-key');
                if (k) payload[k] = getEnvRowValue(row, k);
            });

            saveAllBtn.disabled = true;
            saveAllBtn.textContent = 'SAVING ALL...';
            try {
                const res = await api('/api/settings/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ settings: payload })
                });
                if (res.ok) {
                    _ttsBackendUserTouched = false;
                    showToast('ENVIRONMENT', 'All settings successfully saved to .env', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('ENVIRONMENT', 'Error saving .env file.', 'error');
                }
            } catch (err) {
                showToast('ENVIRONMENT', 'Failed to communicate with server.', 'error');
            } finally {
                saveAllBtn.disabled = false;
                saveAllBtn.textContent = 'SAVE ALL TO .ENV';
            }
        });
    }

    // 9. Add custom variable inline panel
    const addVarBtn = document.getElementById('btn-add-env-var');
    const addPanel = document.getElementById('env-add-panel');
    const addKeyInput = document.getElementById('env-add-key-input');
    const addValInput = document.getElementById('env-add-val-input');
    const addConfirmBtn = document.getElementById('btn-env-add-confirm');
    const addCancelBtn = document.getElementById('btn-env-add-cancel');

    const closeAddPanel = () => {
        if (!addPanel) return;
        addPanel.hidden = true;
        if (addKeyInput) addKeyInput.value = '';
        if (addValInput) addValInput.value = '';
        addVarBtn?.focus();
    };

    const submitAddVar = () => {
        const rawKey = addKeyInput?.value.trim() || '';
        const cleaned = rawKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (!cleaned) {
            showToast('ENVIRONMENT', 'Enter a valid variable name.', 'warning');
            addKeyInput?.focus();
            return;
        }
        cachedEnvVars[cleaned] = addValInput?.value ?? '';
        closeAddPanel();
        renderEnvTable(filterInput ? filterInput.value.trim() : '');
        showToast('ENVIRONMENT', `Added ${cleaned}. Click "SAVE ALL TO .ENV" to persist.`, 'info');
    };

    if (addVarBtn && addPanel) {
        addVarBtn.addEventListener('click', () => {
            addPanel.hidden = !addPanel.hidden;
            if (!addPanel.hidden) addKeyInput?.focus();
        });
        addConfirmBtn?.addEventListener('click', submitAddVar);
        addCancelBtn?.addEventListener('click', closeAddPanel);
        [addKeyInput, addValInput].forEach(inp => {
            inp?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitAddVar(); }
                if (e.key === 'Escape') { e.preventDefault(); closeAddPanel(); }
            });
        });
    }

    // 10. Reset .env from .env.example (uses AURA's confirmAction modal)
    const resetEnvBtn = document.getElementById('btn-reset-env');
    if (resetEnvBtn) {
        resetEnvBtn.addEventListener('click', async () => {
            const confirmed = await confirmAction({
                title: 'Restore Default .env',
                message: 'Restore default settings from .env.example? Your current .env will be backed up to .env.bak.',
                okLabel: 'RESTORE DEFAULTS'
            });
            if (!confirmed) return;
            resetEnvBtn.disabled = true;
            resetEnvBtn.textContent = '...';
            try {
                const res = await api('/api/settings/env/reset', { method: 'POST' });
                if (res.ok) {
                    _ttsBackendUserTouched = false;
                    _pendingVoiceByBackend = { edge: null, kokoro: null };
                    showToast('ENVIRONMENT', 'Defaults restored from .env.example (backup: .env.bak)', 'success');
                    audioSys?.playSuccess();
                    await loadEnvSettings();
                } else {
                    showToast('ENVIRONMENT', 'Failed to restore defaults.', 'error');
                }
            } catch (err) {
                showToast('ENVIRONMENT', 'Failed to communicate with server.', 'error');
            } finally {
                resetEnvBtn.disabled = false;
                resetEnvBtn.textContent = '↺ RESTORE DEFAULTS';
            }
        });
    }

    // 11. Category Navigation Tabs for Settings View
    initSettingsTabs();
}

function initSettingsTabs() {
    const tabs = Array.from(document.querySelectorAll('.settings-tab'));
    if (!tabs.length) return;
    const activateTab = (tab) => {
        const cat = tab.dataset.cat || 'all';
        tabs.forEach(t => {
            const isAct = t === tab;
            t.classList.toggle('active', isAct);
            t.setAttribute('aria-selected', String(isAct));
        });
        const cards = document.querySelectorAll('#view-settings .card');
        cards.forEach(card => {
            const cardCat = card.dataset.cat || 'ui';
            const show = cat === 'all' || cardCat === cat;
            card.classList.toggle('card-cat-hidden', !show);
        });
    };
    tabs.forEach((tab, idx) => {
        tab.addEventListener('click', () => activateTab(tab));
        tab.addEventListener('keydown', (e) => {
            let nextIdx = -1;
            if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') nextIdx = 0;
            else if (e.key === 'End') nextIdx = tabs.length - 1;
            if (nextIdx >= 0) {
                e.preventDefault();
                tabs[nextIdx].focus();
                activateTab(tabs[nextIdx]);
            }
        });
    });
}

function initVoiceOverlay() {
    const closeBtn = document.getElementById('voice-overlay-close');
    if (closeBtn) closeBtn.onclick = closeVoiceOverlay;
    const backdrop = document.querySelector('.voice-overlay-backdrop');
    if (backdrop) backdrop.onclick = closeVoiceOverlay;

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
            e.preventDefault();
            if (isVoiceOverlayOpen()) {
                closeVoiceOverlay();
            } else {
                openVoiceOverlay();
                if (canStartListening() && voiceBtn) voiceBtn.click();
            }
        } else if (e.key === 'Escape' && isVoiceOverlayOpen()) {
            closeVoiceOverlay();
        }
    });
}

updateLatencyIndicator();
setInterval(updateLatencyIndicator, 15000);
setTimeout(loadHistory, 1500);
initPlans();
initMedia();
initVoiceOverlay();
initCommandPalette();
initWorkspaceCanvas();
initSlashCommands();
initHudCustomization();
initVoiceSettings();
initEnvSettings();
// First-run onboarding (checks onboarding flag, shows overlay if needed)
if (window.Onboarding) window.Onboarding.init();
fetchSchedule();          // one-shot initial paint; the bus maintains from here
fetchAmbient();
refreshScreenPreview();
Realtime.onFallback(startLegacyPolling);
Realtime.start();
