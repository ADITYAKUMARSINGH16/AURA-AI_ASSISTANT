// ═══════════════════════════════════════════════════════════
// AURA BOOT SEQUENCE — single shared implementation
// Used by the landing page (full cinematic variant) and the
// HUD (brief variant). Writes into #boot-lines with .bline /
// .bok / .bwarn entries exactly as the originals did, so the
// CSS is untouched.
//
// AuraBoot.run({
//   variant: 'full' | 'brief',
//   onLine: (line) => {}   // optional per-line hook (HUD typing audio)
// })
// ═══════════════════════════════════════════════════════════

const AuraBoot = (() => {

    const VARIANTS = {
        full: {
            initialDelay: 600,
            autoDismissMs: 7000,
            showPrompt: true,      // reveal #boot-prompt, then .hud-overlay elements
            allowSkip: true,       // click / keypress dismisses early
            lines: [
                { text: '> AURA KERNEL v2.0.4 loading...', delay: 200 },
                { text: '> Mounting encrypted filesystem ............... ', suffix: '<span class="bok">[OK]</span>', delay: 350 },
                { text: '> Initializing neural mesh driver ............. ', suffix: '<span class="bok">[OK]</span>', delay: 300 },
                { text: '> Loading Ollama inference engine ............. ', suffix: '<span class="bok">[OK]</span>', delay: 400 },
                { text: '> Calibrating voice core (Edge TTS) .......... ', suffix: '<span class="bok">[OK]</span>', delay: 350 },
                { text: '> Speech recognition module ................... ', suffix: '<span class="bok">[OK]</span>', delay: 250 },
                { text: '> Tesseract OCR vision driver ................. ', suffix: '<span class="bok">[OK]</span>', delay: 300 },
                { text: '> Scanning local network (HOME GRID) ......... ', suffix: '<span class="bwarn">[3 devices]</span>', delay: 450 },
                { text: '> Threat assessment protocol .................. ', suffix: '<span class="bok">[CLEAR]</span>', delay: 300 },
                { text: '> Memory archive sync ........................ ', suffix: '<span class="bok">[SYNCED]</span>', delay: 350 },
                { text: '> Establishing secure uplink .................. ', suffix: '<span class="bok">[CONNECTED]</span>', delay: 400 },
                { text: '> All subsystems nominal.', delay: 200 },
                { text: '', delay: 100 },
                { text: '  ◆ AURA ONLINE — Awaiting operator.', delay: 300, cls: 'bok' },
            ]
        },
        brief: {
            initialDelay: 600,
            autoDismissMs: 0,      // 0 = dismiss 400ms after the last line
            showPrompt: false,
            allowSkip: false,
            lines: [
                { text: '> AURA KERNEL v2.0 loading...', delay: 160 },
                { text: '> Neural mesh handshake ............... ', suffix: '<span class="bok">[OK]</span>', delay: 220 },
                { text: '> Voice core calibrated ............... ', suffix: '<span class="bok">[OK]</span>', delay: 220 },
                { text: '> Sensor array online ................. ', suffix: '<span class="bok">[OK]</span>', delay: 220 },
                { text: '> All subsystems nominal.', delay: 180 }
            ]
        }
    };

    function run(opts = {}) {
        const cfg = VARIANTS[opts.variant || 'brief'];
        const overlay = document.getElementById('boot-overlay');
        const bootLinesContainer = document.getElementById('boot-lines');
        const bootPrompt = document.getElementById('boot-prompt');
        const progressBar = document.getElementById('boot-progress-bar');

        let lineIndex = 0;
        let dismissed = false;

        function dismiss() {
            if (dismissed) return;
            dismissed = true;
            if (!overlay) return;
            overlay.classList.add('dismissed');
            setTimeout(() => { overlay.style.display = 'none'; }, 800);
            // Landing-only: reveal page overlays once boot completes
            document.querySelectorAll('.hud-overlay').forEach(el => el.classList.add('visible'));
        }

        function finish() {
            if (progressBar) progressBar.style.width = '100%';
            if (cfg.showPrompt) {
                setTimeout(() => { bootPrompt?.classList.add('visible'); }, 300);
                if (cfg.autoDismissMs > 0) setTimeout(dismiss, cfg.autoDismissMs);
            } else {
                setTimeout(dismiss, 400);
            }
        }

        function renderLine() {
            if (lineIndex >= cfg.lines.length) { finish(); return; }
            const l = cfg.lines[lineIndex];
            const div = document.createElement('div');
            div.className = 'bline';
            div.innerHTML = l.text + (l.suffix || '');
            if (l.cls) div.classList.add(l.cls);
            if (bootLinesContainer) bootLinesContainer.appendChild(div);
            opts.onLine?.(l);
            if (progressBar) progressBar.style.width = ((lineIndex + 1) / cfg.lines.length * 100) + '%';
            lineIndex++;
            setTimeout(renderLine, l.delay);
        }

        setTimeout(renderLine, cfg.initialDelay);

        if (cfg.allowSkip) {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') return; // don't hijack keyboard navigation
                dismiss();
            }, { once: true });
            overlay?.addEventListener('click', dismiss, { once: true });
        }
    }

    return { run };
})();
