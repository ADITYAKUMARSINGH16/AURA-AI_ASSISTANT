// ═══════════════════════════════════════════════════════════
// AURA LANDING PAGE — Full Interactive Experience
// 9 Feature Modules
// ═══════════════════════════════════════════════════════════

const startTime = Date.now();

// ═══════════════════════════════════════════════════════════
// MODULE 1: CINEMATIC BOOT OVERLAY
// ═══════════════════════════════════════════════════════════
(function bootOverlay() {
    const overlay = document.getElementById('boot-overlay');
    const bootLinesContainer = document.getElementById('boot-lines');
    const bootPrompt = document.getElementById('boot-prompt');
    const progressBar = document.getElementById('boot-progress-bar');

    const lines = [
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
    ];

    let lineIndex = 0;

    function renderLine() {
        if (lineIndex >= lines.length) {
            progressBar.style.width = '100%';
            setTimeout(() => { bootPrompt.classList.add('visible'); }, 300);
            return;
        }

        const l = lines[lineIndex];
        const div = document.createElement('div');
        div.className = 'bline';
        div.innerHTML = l.text + (l.suffix || '');
        if (l.cls) div.classList.add(l.cls);
        bootLinesContainer.appendChild(div);

        progressBar.style.width = ((lineIndex + 1) / lines.length * 100) + '%';
        lineIndex++;
        setTimeout(renderLine, l.delay);
    }

    setTimeout(renderLine, 600);

    function dismiss() {
        overlay.classList.add('dismissed');
        setTimeout(() => { overlay.style.display = 'none'; }, 800);
        // Show HUD overlays after boot
        document.querySelectorAll('.hud-overlay').forEach(el => el.classList.add('visible'));
    }

    document.addEventListener('keydown', dismiss, { once: true });
    overlay.addEventListener('click', dismiss, { once: true });

    // Auto-dismiss after 7 seconds
    setTimeout(dismiss, 7000);
})();


// ═══════════════════════════════════════════════════════════
// MODULE 2: CUSTOM CURSOR + TRAIL
// ═══════════════════════════════════════════════════════════
(function customCursor() {
    const dot = document.getElementById('cursor-dot');
    const ring = document.getElementById('cursor-ring');
    const trailCanvas = document.getElementById('cursor-trail');
    const ctx = trailCanvas.getContext('2d');

    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;
    const trail = [];
    const maxTrail = 20;

    function resize() {
        trailCanvas.width = window.innerWidth;
        trailCanvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        dot.style.left = mouseX + 'px';
        dot.style.top = mouseY + 'px';
        trail.push({ x: mouseX, y: mouseY, alpha: 1 });
        if (trail.length > maxTrail) trail.shift();
    });

    // Hover state for interactive elements
    const interactives = 'a, button, input, .feature-card, .carousel-btn, .c-dot, .cta-primary, .cta-secondary, .ctrl-btn, .tech-item, .nav-link, .sound-toggle';

    document.addEventListener('mouseover', (e) => {
        if (e.target.closest(interactives)) {
            dot.classList.add('hover');
            ring.classList.add('hover');
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.closest(interactives)) {
            dot.classList.remove('hover');
            ring.classList.remove('hover');
        }
    });

    function animate() {
        // Ring follows with delay
        ringX += (mouseX - ringX) * 0.15;
        ringY += (mouseY - ringY) * 0.15;
        ring.style.left = ringX + 'px';
        ring.style.top = ringY + 'px';

        // Trail
        ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
        for (let i = 0; i < trail.length; i++) {
            const t = trail[i];
            t.alpha -= 0.04;
            if (t.alpha <= 0) continue;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 240, 255, ${t.alpha * 0.3})`;
            ctx.fill();
        }

        // Clean dead trail points
        while (trail.length > 0 && trail[0].alpha <= 0) trail.shift();

        requestAnimationFrame(animate);
    }
    animate();
})();


// ═══════════════════════════════════════════════════════════
// MODULE 3: WEBGL SHADER BACKGROUND
// ═══════════════════════════════════════════════════════════
(function shaderBackground() {
    const canvas = document.getElementById('shader-bg');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    const vertSrc = `
        attribute vec2 pos;
        void main() { gl_Position = vec4(pos, 0.0, 1.0); }
    `;

    const fragSrc = `
        precision mediump float;
        uniform float u_time;
        uniform vec2 u_res;

        // Simplex-like noise
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

        float snoise(vec2 v) {
            const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                              -0.577350269189626, 0.024390243902439);
            vec2 i  = floor(v + dot(v, C.yy));
            vec2 x0 = v - i + dot(i, C.xx);
            vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod289(i);
            vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
            vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
            m = m*m; m = m*m;
            vec3 x = 2.0 * fract(p * C.www) - 1.0;
            vec3 h = abs(x) - 0.5;
            vec3 ox = floor(x + 0.5);
            vec3 a0 = x - ox;
            m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
            vec3 g;
            g.x = a0.x * x0.x + h.x * x0.y;
            g.yz = a0.yz * x12.xz + h.yz * x12.yw;
            return 130.0 * dot(m, g);
        }

        void main() {
            vec2 uv = gl_FragCoord.xy / u_res;
            float t = u_time * 0.08;

            // Layered noise for nebula effect
            float n1 = snoise(uv * 2.0 + vec2(t * 0.5, t * 0.3)) * 0.5 + 0.5;
            float n2 = snoise(uv * 4.0 - vec2(t * 0.3, t * 0.7)) * 0.5 + 0.5;
            float n3 = snoise(uv * 8.0 + vec2(t * 0.2, -t * 0.4)) * 0.5 + 0.5;

            float noise = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

            // Dark base with subtle color
            vec3 cyan = vec3(0.0, 0.94, 1.0);
            vec3 purple = vec3(0.66, 0.33, 0.97);
            vec3 dark = vec3(0.008, 0.03, 0.06);

            vec3 color = dark;
            color += cyan * noise * 0.03 * smoothstep(0.4, 0.8, n1);
            color += purple * noise * 0.02 * smoothstep(0.5, 0.9, n2);

            // Vignette
            float vignette = 1.0 - length((uv - 0.5) * 1.2);
            color *= smoothstep(0.0, 0.7, vignette);

            gl_FragColor = vec4(color, 1.0);
        }
    `;

    function compileShader(src, type) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(vertSrc, gl.VERTEX_SHADER));
    gl.attachShader(prog, compileShader(fragSrc, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const timeLoc = gl.getUniformLocation(prog, 'u_time');
    const resLoc = gl.getUniformLocation(prog, 'u_res');

    function render(t) {
        gl.uniform1f(timeLoc, t * 0.001);
        gl.uniform2f(resLoc, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
})();


// ═══════════════════════════════════════════════════════════
// MODULE 4: SOUND EFFECTS (Web Audio API)
// ═══════════════════════════════════════════════════════════
const SFX = (function soundEffects() {
    let ctx = null;
    let enabled = false;
    const toggleBtn = document.getElementById('sound-toggle');
    const iconOn = toggleBtn.querySelector('.sound-icon-on');
    const iconOff = toggleBtn.querySelector('.sound-icon-off');

    function initCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    function playTone(freq, duration, type = 'sine', vol = 0.05) {
        if (!enabled || !ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    }

    function hover() { playTone(1800, 0.06, 'sine', 0.03); }
    function click() { playTone(2400, 0.08, 'square', 0.02); }
    function keypress() { playTone(800 + Math.random() * 400, 0.04, 'sine', 0.02); }
    function bootBeep() { playTone(1200, 0.1, 'sine', 0.04); }
    function success() { playTone(880, 0.15, 'sine', 0.04); setTimeout(() => playTone(1100, 0.15, 'sine', 0.04), 100); }
    function error() { playTone(200, 0.3, 'sawtooth', 0.03); }

    // Ambient hum
    let ambientOsc = null;
    let ambientGain = null;

    function startAmbient() {
        if (!ctx) return;
        ambientOsc = ctx.createOscillator();
        ambientGain = ctx.createGain();
        ambientOsc.type = 'sine';
        ambientOsc.frequency.value = 60;
        ambientGain.gain.value = 0.008;
        ambientOsc.connect(ambientGain);
        ambientGain.connect(ctx.destination);
        ambientOsc.start();

        // Add second harmonic
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 120;
        gain2.gain.value = 0.004;
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
    }

    function stopAmbient() {
        if (ambientOsc) { ambientOsc.stop(); ambientOsc = null; }
    }

    toggleBtn.addEventListener('click', () => {
        initCtx();
        enabled = !enabled;
        toggleBtn.classList.toggle('active', enabled);
        iconOn.style.display = enabled ? 'block' : 'none';
        iconOff.style.display = enabled ? 'none' : 'block';

        if (enabled) {
            startAmbient();
            success();
        } else {
            stopAmbient();
        }
    });

    // Attach hover sounds to interactive elements
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest('a, button, .feature-card, .carousel-btn, .tech-item, .nav-link')) {
            hover();
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('a, button, .carousel-btn')) {
            click();
        }
    });

    return { hover, click, keypress, bootBeep, success, error, playTone };
})();


// ═══════════════════════════════════════════════════════════
// MODULE 5: NAVIGATION
// ═══════════════════════════════════════════════════════════
(function navigation() {
    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id]');

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 60);

        let current = '';
        sections.forEach(section => {
            if (window.scrollY >= section.offsetTop - 120) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) link.classList.add('active');
        });
    });

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
})();


// ═══════════════════════════════════════════════════════════
// MODULE 6: SCROLL REVEAL
// ═══════════════════════════════════════════════════════════
(function scrollReveal() {
    const revealElements = document.querySelectorAll('.reveal');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                if (entry.target.classList.contains('specs-grid')) animateSpecs();
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    revealElements.forEach(el => observer.observe(el));
})();


// ═══════════════════════════════════════════════════════════
// MODULE 7: TYPEWRITER + SUBTITLE DECODE
// ═══════════════════════════════════════════════════════════
(function typewriterAndDecode() {
    // Typewriter
    const taglines = [
        "Your tactical AI assistant. Always watching. Always learning.",
        "Voice command. Live telemetry. Autonomous routines.",
        "100% local. Zero cloud dependency. Total privacy.",
        "See what your AI sees. Full screen vision & OCR.",
        "Smart home control. Network scanning. System authority."
    ];

    const taglineEl = document.getElementById('hero-tagline');
    let tIdx = 0, cIdx = 0, isDeleting = false, speed = 50;

    function type() {
        const current = taglines[tIdx];
        if (!isDeleting) {
            taglineEl.textContent = current.substring(0, cIdx + 1);
            cIdx++;
            if (cIdx === current.length) { speed = 3000; isDeleting = true; }
            else speed = 40 + Math.random() * 40;
        } else {
            taglineEl.textContent = current.substring(0, cIdx - 1);
            cIdx--;
            if (cIdx === 0) { isDeleting = false; tIdx = (tIdx + 1) % taglines.length; speed = 400; }
            else speed = 20;
        }
        setTimeout(type, speed);
    }
    setTimeout(type, 2000);

    // Subtitle decode
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
    const subtitleInner = document.querySelector('.subtitle-inner');
    if (subtitleInner) {
        const originalText = subtitleInner.innerText;
        let iter = 0;
        setTimeout(() => {
            const interval = setInterval(() => {
                subtitleInner.innerText = originalText.split('').map((ch, i) => {
                    if (i < iter) return originalText[i];
                    if (ch === ' ') return ' ';
                    return letters[Math.floor(Math.random() * letters.length)];
                }).join('');
                if (iter >= originalText.length) clearInterval(interval);
                iter += 0.5;
            }, 30);
        }, 800);
    }
})();


// ═══════════════════════════════════════════════════════════
// MODULE 8: INTERACTIVE TERMINAL
// ═══════════════════════════════════════════════════════════
(function interactiveTerminal() {
    const body = document.getElementById('terminal-body');
    const input = document.getElementById('terminal-input');
    let bootStarted = false;

    // Boot sequence
    const bootSeq = [
        { text: '> loading neural mesh driver .............. ', sfx: '<span class="success">[OK]</span>', delay: 400 },
        { text: '> initializing voice core ................. ', sfx: '<span class="success">[OK]</span>', delay: 500 },
        { text: '> calibrating sensor array ................ ', sfx: '<span class="success">[OK]</span>', delay: 600 },
        { text: '> establishing secure uplink .............. ', sfx: '<span class="success">[OK]</span>', delay: 700 },
        { text: '> scanning local network .................. ', sfx: '<span class="info">[3 devices]</span>', delay: 800 },
        { text: '> threat assessment ....................... ', sfx: '<span class="success">[CLEAR]</span>', delay: 500 },
        { text: '', delay: 200 },
        { text: '  ╔══════════════════════════════════════╗', delay: 80, cls: 'info' },
        { text: '  ║   A U R A  v2.0  //  ALL SYSTEMS    ║', delay: 80, cls: 'info' },
        { text: '  ║          ◆  O N L I N E  ◆          ║', delay: 80, cls: 'info' },
        { text: '  ╚══════════════════════════════════════╝', delay: 80, cls: 'info' },
        { text: '', delay: 150 },
        { text: '> Type "help" for available commands.', delay: 200, cls: 'command' },
    ];

    let bIdx = 0;

    function runBoot() {
        if (bIdx >= bootSeq.length) { input.focus(); return; }
        const step = bootSeq[bIdx];
        const line = document.createElement('div');
        line.className = `terminal-line ${step.cls || ''}`;
        line.innerHTML = step.text + (step.sfx || '');
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
        SFX.bootBeep();
        bIdx++;
        setTimeout(runBoot, step.delay);
    }

    const termObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !bootStarted) {
                bootStarted = true;
                setTimeout(runBoot, 500);
            }
        });
    }, { threshold: 0.3 });
    termObserver.observe(document.getElementById('terminal'));

    // Command responses
    const commands = {
        help: () => [
            { text: '  Available commands:', cls: 'info' },
            { text: '    help     — Show this help menu' },
            { text: '    status   — System status report' },
            { text: '    scan     — Network scan' },
            { text: '    whoami   — Identify current operator' },
            { text: '    time     — Current system time' },
            { text: '    ping     — Test connection' },
            { text: '    threat   — Threat assessment' },
            { text: '    memory   — Memory usage' },
            { text: '    clear    — Clear terminal' },
            { text: '    about    — About AURA' },
        ],
        status: () => [
            { text: '  ═══ SYSTEM STATUS REPORT ═══', cls: 'info' },
            { text: `  Neural Load:   ████████░░ 88%` },
            { text: `  Memory:        ███████░░░ 72%` },
            { text: `  Uplink:        ██████░░░░ 64%`, cls: 'command' },
            { text: `  Power Cell:    █░░░░░░░░░ 12%`, cls: 'error' },
            { text: `  Status:        ALL SYSTEMS NOMINAL`, cls: 'success' },
        ],
        scan: () => {
            const devices = [
                '192.168.1.1    — Router (Gateway)',
                '192.168.1.42   — AURA-HOST (This Machine)',
                '192.168.1.105  — SmartTV-LivingRoom',
            ];
            return [
                { text: '  Scanning local network...', cls: 'info' },
                { text: `  Found ${devices.length} active devices:` },
                ...devices.map(d => ({ text: `    • ${d}` })),
                { text: '  Scan complete.', cls: 'success' },
            ];
        },
        whoami: () => [
            { text: '  Operator: ADMIN', cls: 'info' },
            { text: '  Clearance: LEVEL 5 — FULL ACCESS' },
            { text: '  Session: AUTHENTICATED', cls: 'success' },
        ],
        time: () => [
            { text: `  System Clock: ${new Date().toLocaleTimeString()}`, cls: 'info' },
            { text: `  Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` },
            { text: `  Uptime: ${Math.floor((Date.now() - startTime) / 1000)}s` },
        ],
        ping: () => {
            const latency = Math.floor(8 + Math.random() * 15);
            return [
                { text: '  PING aura-core (127.0.0.1)...', cls: 'info' },
                { text: `  Reply: bytes=64 time=${latency}ms TTL=64`, cls: 'success' },
                { text: `  Connection: STABLE` },
            ];
        },
        threat: () => [
            { text: '  ═══ THREAT ASSESSMENT ═══', cls: 'info' },
            { text: '  External intrusion attempts: 0' },
            { text: '  Malware signatures detected: 0' },
            { text: '  Firewall status: ACTIVE', cls: 'success' },
            { text: '  Overall threat level: CLEAR ◆', cls: 'success' },
        ],
        memory: () => {
            const used = (Math.random() * 2 + 1).toFixed(1);
            return [
                { text: '  ═══ MEMORY ARCHIVE ═══', cls: 'info' },
                { text: `  Long-term entries: ${Math.floor(Math.random() * 50 + 10)}` },
                { text: `  Session context: ${used} KB` },
                { text: `  Archive status: SYNCED`, cls: 'success' },
            ];
        },
        about: () => [
            { text: '  ═══ ABOUT AURA ═══', cls: 'info' },
            { text: '  AURA — Autonomous Utility & Response Agent' },
            { text: '  Version: 2.0' },
            { text: '  Engine: Ollama + Gemma 4' },
            { text: '  Voice: Edge TTS + Google STT' },
            { text: '  Vision: Tesseract OCR' },
            { text: '  Backend: FastAPI + Uvicorn' },
            { text: '  Privacy: 100% Local Inference', cls: 'success' },
        ],
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const cmd = input.value.trim().toLowerCase();
            input.value = '';

            if (!cmd) return;

            // Echo command
            const echo = document.createElement('div');
            echo.className = 'terminal-line command';
            echo.textContent = `> ${cmd}`;
            body.appendChild(echo);

            SFX.keypress();

            if (cmd === 'clear') {
                body.innerHTML = '';
                return;
            }

            const handler = commands[cmd];
            if (handler) {
                const lines = handler();
                lines.forEach((l, i) => {
                    setTimeout(() => {
                        const div = document.createElement('div');
                        div.className = `terminal-line ${l.cls || ''}`;
                        div.textContent = l.text;
                        body.appendChild(div);
                        body.scrollTop = body.scrollHeight;
                    }, i * 60);
                });
                SFX.success();
            } else {
                const errLine = document.createElement('div');
                errLine.className = 'terminal-line error';
                errLine.textContent = `  Unknown command: "${cmd}". Type "help" for available commands.`;
                body.appendChild(errLine);
                SFX.error();
            }

            body.scrollTop = body.scrollHeight;
        }
    });

    // Typing sound
    input.addEventListener('input', () => SFX.keypress());
})();


// ═══════════════════════════════════════════════════════════
// MODULE 9: 3D GLOBE (Three.js)
// ═══════════════════════════════════════════════════════════
(function globe3D() {
    const canvas = document.getElementById('globe-canvas');
    if (!window.THREE) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.z = 3;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Wireframe sphere
    const sphereGeo = new THREE.SphereGeometry(1, 24, 24);
    const sphereMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.08
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(sphere);

    // Nodes on sphere surface
    const nodeCount = 40;
    const nodes = [];
    const nodeGeo = new THREE.SphereGeometry(0.02, 8, 8);

    for (let i = 0; i < nodeCount; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.sin(phi) * Math.sin(theta);
        const z = Math.cos(phi);

        const nodeMat = new THREE.MeshBasicMaterial({
            color: Math.random() > 0.7 ? 0xa855f7 : 0x00f0ff
        });
        const node = new THREE.Mesh(nodeGeo, nodeMat);
        node.position.set(x, y, z);
        sphere.add(node);
        nodes.push(node);
    }

    // Connection arcs between nearby nodes
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.12 });

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dist = nodes[i].position.distanceTo(nodes[j].position);
            if (dist < 0.8) {
                const points = [nodes[i].position.clone(), nodes[j].position.clone()];
                const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(lineGeo, lineMat);
                sphere.add(line);
            }
        }
    }

    // Outer ring
    const ringGeo = new THREE.RingGeometry(1.3, 1.32, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff, transparent: true, opacity: 0.15, side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 3;
    scene.add(ring);

    // Second ring
    const ring2 = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 1.52, 64),
        new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
    );
    ring2.rotation.x = -Math.PI / 4;
    ring2.rotation.y = Math.PI / 6;
    scene.add(ring2);

    // Mouse interaction
    let mouseX = 0, mouseY = 0;
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    });

    // Pulse nodes
    let time = 0;

    function animate() {
        time += 0.005;
        sphere.rotation.y += 0.002;
        sphere.rotation.y += mouseX * 0.005;
        sphere.rotation.x = mouseY * 0.3;

        ring.rotation.z += 0.003;
        ring2.rotation.z -= 0.002;

        // Pulse random nodes
        nodes.forEach((node, i) => {
            const scale = 1 + Math.sin(time * 3 + i) * 0.3;
            node.scale.set(scale, scale, scale);
        });

        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    }
    animate();

    // Resize
    window.addEventListener('resize', () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
})();


// ═══════════════════════════════════════════════════════════
// MODULE 10: FLOATING HUD OVERLAYS (live data)
// ═══════════════════════════════════════════════════════════
(function hudOverlays() {
    const latEl = document.getElementById('hud-lat');
    const lngEl = document.getElementById('hud-lng');
    const sigEl = document.getElementById('hud-sig-val');
    const threatEl = document.getElementById('hud-threat-val');
    const clockEl = document.getElementById('hud-sys-clock');
    const uptimeEl = document.getElementById('hud-uptime');

    let baseLat = 28.6139, baseLng = 77.2090;

    function update() {
        // Coordinates drift
        baseLat += (Math.random() - 0.5) * 0.0001;
        baseLng += (Math.random() - 0.5) * 0.0001;
        latEl.textContent = baseLat.toFixed(4) + '° N';
        lngEl.textContent = baseLng.toFixed(4) + '° E';

        // Signal
        const sig = Math.floor(82 + Math.random() * 16);
        sigEl.textContent = sig + '%';

        // Clock
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });

        // Uptime
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = uptime % 60;
        uptimeEl.textContent = `UPTIME: ${h}h ${m}m ${s}s`;
    }

    setInterval(update, 1000);
    update();
})();


// ═══════════════════════════════════════════════════════════
// MODULE 11: SPEC COUNTER ANIMATION
// ═══════════════════════════════════════════════════════════
function animateSpecs() {
    document.querySelectorAll('.spec-value[data-target]').forEach(el => {
        const target = parseInt(el.dataset.target);
        const start = performance.now();
        const duration = 2000;

        function tick(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(eased * target);
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    });

    document.querySelectorAll('.spec-card').forEach(c => c.classList.add('animated'));
}


// ═══════════════════════════════════════════════════════════
// MODULE 12: CAROUSEL
// ═══════════════════════════════════════════════════════════
(function carousel() {
    const track = document.getElementById('carousel-track');
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const dots = document.querySelectorAll('.c-dot');
    const totalSlides = dots.length;
    let current = 0;
    let autoInterval;

    function goTo(index) {
        current = ((index % totalSlides) + totalSlides) % totalSlides;
        track.style.transform = `translateX(-${current * 100}%)`;
        dots.forEach((d, i) => d.classList.toggle('active', i === current));
    }

    prevBtn.addEventListener('click', () => { goTo(current - 1); resetAuto(); });
    nextBtn.addEventListener('click', () => { goTo(current + 1); resetAuto(); });

    dots.forEach((d, i) => {
        d.addEventListener('click', () => { goTo(i); resetAuto(); });
    });

    function resetAuto() {
        clearInterval(autoInterval);
        autoInterval = setInterval(() => goTo(current + 1), 5000);
    }

    autoInterval = setInterval(() => goTo(current + 1), 5000);
})();


// ═══════════════════════════════════════════════════════════
// MODULE 13: HERO PARALLAX
// ═══════════════════════════════════════════════════════════
(function heroParallax() {
    const heroLogo = document.getElementById('hero-logo');
    const heroSection = document.getElementById('hero');

    if (heroSection && heroLogo) {
        heroSection.addEventListener('mousemove', (e) => {
            const rect = heroSection.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            heroLogo.style.transform = `translate(${x * 8}px, ${y * 8}px)`;
        });

        heroSection.addEventListener('mouseleave', () => {
            heroLogo.style.transform = 'translate(0, 0)';
            heroLogo.style.transition = 'transform 0.5s ease';
            setTimeout(() => { heroLogo.style.transition = ''; }, 500);
        });
    }
})();


// ═══════════════════════════════════════════════════════════
// MODULE 14: EASTER EGG — KONAMI CODE
// ═══════════════════════════════════════════════════════════
(function konamiEgg() {
    let progress = 0;
    const code = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];

    document.addEventListener('keydown', (e) => {
        if (e.keyCode === code[progress]) {
            progress++;
            if (progress === code.length) {
                progress = 0;
                document.body.style.filter = 'hue-rotate(180deg) saturate(2)';
                SFX.success();
                setTimeout(() => {
                    SFX.success();
                    setTimeout(() => { document.body.style.filter = ''; }, 3000);
                }, 200);
            }
        } else {
            progress = 0;
        }
    });
})();
