// ═══════════════════════════════════════════════════════════
// AURA REACTOR MODULE (standalone canvas engine)
// Full-page arc reactor + flanking oscilloscopes.
// Exposes window.AuraReactor: { setState, setActive, feed, clearFeed }.
// ═══════════════════════════════════════════════════════════
window.AuraReactor = (() => {
    const bay = document.getElementById('reactor-bay');
    const canvas = document.getElementById('reactor-canvas');
    if (!bay || !canvas || !canvas.getContext) {
        return { setState() {}, feed() {}, clearFeed() {} };
    }
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const SPOKES = 64;
    const COILS = 10;
    const TICKS = 72;

    let w = 0, h = 0, dpr = 1;
    let rafId = null;
    let lastT = performance.now();
    let lastRender = 0;
    let rotTick = 0, rotA = 0, rotB = 0;
    let level = 0;                 // smoothed loudness driving the core
    let state = 'idle';
    let activeView = true;         // host page can pause the loop (e.g. hidden view)
    let dirty = true;              // force repaint (resize / state / theme)
    let liveFreq = null, liveTime = null, lastFeedAt = 0;

    // ── Theme-aware palette: cached CSS custom props, refreshed when
    //    <html> class changes so theme switching recolors the reactor.
    const palette = { idle: [0,240,255], listening: [0,255,136], processing: [255,176,32], speaking: [168,85,247] };
    function parseColor(raw) {
        raw = raw.trim();
        let m = raw.match(/^#([0-9a-f]{6})$/i);
        if (m) return [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)];
        m = raw.match(/^rgba?\(([^)]+)\)/i);
        if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2]]; }
        return null;
    }
    function refreshPalette() {
        const map = { idle: '--cyan', listening: '--green', processing: '--amber', speaking: '--purple' };
        const cs = getComputedStyle(document.documentElement);
        for (const key of Object.keys(map)) {
            const c = parseColor(cs.getPropertyValue(map[key]));
            if (c) palette[key] = c;
        }
        dirty = true;
    }
    new MutationObserver(refreshPalette)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    refreshPalette();

    const col = () => palette[state] || palette.idle;
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    // ── Per-state motion profile ──
    const PROFILE = {
        idle:       { speed: 0.8, energy: 0.35 },
        listening:  { speed: 1.8, energy: 1.0 },
        processing: { speed: 2.5, energy: 1.5 },
        speaking:   { speed: 1.2, energy: 0.8 }
    };

    // ── Audio feed API (driven by mic + TTS analyser loops) ──
    function feed(freqData, timeData) {
        liveFreq = freqData || null;
        liveTime = timeData || null;
        lastFeedAt = performance.now();
    }
    function clearFeed() {
        liveFreq = null;
        liveTime = null;
    }
    function hasLive() {
        return !!liveFreq && liveFreq.length > 0 && performance.now() - lastFeedAt < 250;
    }

    // ── Synthetic fallbacks when no analyser is feeding us ──
    function synthLevel(t) {
        const p = PROFILE[state];
        if (state === 'processing') return Math.pow(Math.max(0, Math.sin(t * 5)), 2) * 0.5 * p.energy;
        if (state !== 'idle') return (Math.sin(t * 3) * 0.5 + 0.5) * 0.3 * p.energy;
        return 0;
    }
    function synthSpoke(i, t, n) {
        const p = PROFILE[state];
        if (state === 'processing') {
            return Math.abs(Math.sin(i * 0.55 - t * 7) * Math.sin(i * 0.21 + t * 2.3)) * 0.55 * p.energy;
        }
        const ripple = Math.sin((i / n) * Math.PI * 6 - t * 2.2) * 0.5 + 0.5;
        return ripple * 0.16 * p.energy;
    }
    function synthScope(u, t) {
        if (state === 'processing') {
            const burst = Math.pow(Math.max(0, Math.sin(u * 7 - t * 6)), 3);
            return Math.sin(u * 30 - t * 12) * burst;
        }
        if (state !== 'idle') return Math.sin(u * 24 - t * 9) * 0.4;
        return Math.sin(u * 14 + t * 1.6) * (0.14 + 0.07 * Math.sin(t * 0.7));
    }

    // ── DPR-aware sizing ──
    function resize() {
        const rect = bay.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = rect.width;
        h = rect.height;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        dirty = true;
    }
    new ResizeObserver(resize).observe(bay);

    // ── Level measurement: realtime RMS or synthetic fallback ──
    function measureLevel(t, dt) {
        let target = null;
        if (hasLive()) {
            if (liveTime && liveTime.length) {
                let sum = 0;
                for (let i = 0; i < liveTime.length; i++) {
                    const v = (liveTime[i] - 128) / 128;
                    sum += v * v;
                }
                target = Math.min(1, Math.sqrt(sum / liveTime.length) * 2.4);
            } else {
                let sum = 0;
                for (let i = 0; i < liveFreq.length; i++) sum += liveFreq[i];
                target = Math.min(1, (sum / liveFreq.length / 255) * 2.2);
            }
        }
        if (target == null) target = synthLevel(t);
        level += (target - level) * Math.min(1, dt * 10);
    }

    // ── Render layers ──
    function drawTicks(cx, cy, R) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotTick);
        ctx.strokeStyle = rgba(col(), 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < TICKS; i++) {
            const a = (i / TICKS) * Math.PI * 2;
            const len = i % 6 === 0 ? 9 : 5;
            ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
            ctx.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawArcs(cx, cy, R) {
        const rings = [
            { r: R * 0.86, segs: 6, span: 0.62, lw: 4, rot: rotA },
            { r: R * 0.74, segs: 8, span: 0.50, lw: 2.5, rot: rotB }
        ];
        ctx.save();
        ctx.lineCap = 'round';
        for (const ring of rings) {
            for (let s = 0; s < ring.segs; s++) {
                const a0 = ring.rot + (s / ring.segs) * Math.PI * 2;
                const a1 = a0 + (ring.span / ring.segs) * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(cx, cy, ring.r, a0, a1);
                ctx.strokeStyle = rgba(col(), 0.75);
                ctx.lineWidth = ring.lw;
                ctx.shadowColor = rgba(col(), 0.9);
                ctx.shadowBlur = 9;
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    // Radial waveform: mirrored spokes driven by frequency data
    function drawWaveform(cx, cy, R, t) {
        const inner = R * 0.56;
        const maxLen = R * 0.22;
        const live = hasLive();
        const energyBoost = 0.6 + PROFILE[state].energy * 0.35;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = rgba(col(), 0.85);
        ctx.lineWidth = 1.6;
        ctx.shadowColor = rgba(col(), 0.8);
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i < SPOKES; i++) {
            const a = (i / SPOKES) * Math.PI * 2 - Math.PI / 2;
            let v;
            if (live) {
                const mirrored = ((i <= SPOKES / 2) ? i : SPOKES - i) / (SPOKES / 2); // 0..1
                const idx = Math.min(liveFreq.length - 1, Math.floor(mirrored * liveFreq.length));
                v = liveFreq[idx] / 255;
            } else {
                v = synthSpoke(i, t, SPOKES);
            }
            const len = 2 + v * maxLen * energyBoost;
            const ca = Math.cos(a), sa = Math.sin(a);
            ctx.moveTo(ca * inner, sa * inner);
            ctx.lineTo(ca * (inner + len), sa * (inner + len));
        }
        ctx.stroke();
        ctx.restore();
    }

    function roundedPath(x, y, rw, rh, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + rw, y, x + rw, y + rh, r);
        ctx.arcTo(x + rw, y + rh, x, y + rh, r);
        ctx.arcTo(x, y + rh, x, y, r);
        ctx.arcTo(x, y, x + rw, y, r);
        ctx.closePath();
    }

    function drawCoils(cx, cy, R, t) {
        const r = R * 0.40;
        const cw = R * 0.11, ch = R * 0.055;
        ctx.save();
        ctx.translate(cx, cy);
        for (let i = 0; i < COILS; i++) {
            const a = (i / COILS) * Math.PI * 2 + rotA * 0.5;
            const pulse = Math.sin(t * 2.4 - i * (Math.PI * 2 / COILS)) * 0.5 + 0.5;
            ctx.save();
            ctx.rotate(a);
            ctx.translate(r, 0);
            ctx.rotate(Math.PI / 2);
            ctx.globalAlpha = 0.35 + pulse * 0.5 * (0.6 + PROFILE[state].energy * 0.25);
            ctx.fillStyle = rgba(col(), 0.95);
            roundedPath(-cw / 2, -ch / 2, cw, ch, ch / 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    function drawCore(cx, cy, R, t) {
        const breathe = reduceMotion.matches ? 0 : (Math.sin(t * 1.15) * 0.5 + 0.5) * 0.10;
        const rc = Math.max(8, R * 0.26 * (1 + breathe + level * 0.35));
        const c = col();
        ctx.save();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc * 2.2);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.18, rgba(c, 0.95));
        g.addColorStop(0.45, rgba(c, 0.32));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rc * 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = rgba(c, 0.9);
        ctx.lineWidth = 2;
        ctx.shadowColor = rgba(c, 1);
        ctx.shadowBlur = 16 + level * 34;
        ctx.beginPath();
        ctx.arc(cx, cy, rc, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Flanking oscilloscopes: time-domain lines reaching to the bay edges
    function drawScopes(cx, cy, R, t) {
        const pad = 12;
        const gap = R + 20;
        const amp = Math.min(h * 0.16, 24);
        const regions = [
            { x0: pad, x1: cx - gap, flip: true },
            { x0: cx + gap, x1: w - pad, flip: false }
        ];
        const live = hasLive();
        ctx.save();
        for (const reg of regions) {
            const span = reg.x1 - reg.x0;
            if (span < 28) continue;
            // faint midline
            ctx.strokeStyle = rgba(col(), 0.10);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(reg.x0, cy);
            ctx.lineTo(reg.x1, cy);
            ctx.stroke();

            ctx.strokeStyle = rgba(col(), 0.65);
            ctx.lineWidth = 1.4;
            ctx.shadowColor = rgba(col(), 0.6);
            ctx.shadowBlur = 5;
            ctx.beginPath();
            const steps = Math.max(24, Math.floor(span / 3));
            for (let s = 0; s <= steps; s++) {
                const frac = s / steps;
                const x = reg.flip ? reg.x1 - frac * span : reg.x0 + frac * span;
                let y;
                if (live && liveTime && liveTime.length) {
                    const idx = Math.floor(frac * (liveTime.length - 1));
                    y = ((liveTime[idx] - 128) / 128) * amp;
                } else if (live) {
                    const idx = Math.floor(frac * (liveFreq.length - 1));
                    y = (liveFreq[idx] / 255 - 0.28) * amp * 1.6;
                } else {
                    const u = frac * 2 - 1;
                    y = synthScope(reg.flip ? -u : u, t) * amp;
                }
                if (s === 0) ctx.moveTo(x, cy + y);
                else ctx.lineTo(x, cy + y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    // ── Main loop (dt-based so speed is framerate-independent) ──
    function frame(now) {
        rafId = requestAnimationFrame(frame);
        const dt = Math.min((now - lastT) / 1000, 0.05);
        lastT = now;

        if (reduceMotion.matches) {
            // Static frame per state; audio feedback throttled to ~15 fps.
            if (!hasLive() && !dirty) return;
            if (now - lastRender < 66) return;
            lastRender = now;
            dirty = false;
        }

        const t = now / 1000;
        const p = PROFILE[state] || PROFILE.idle;
        if (!reduceMotion.matches) {
            rotTick += dt * 0.10 * p.speed;
            rotA += dt * 0.45 * p.speed;
            rotB -= dt * 0.60 * p.speed;
        }

        measureLevel(t, dt);

        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = (h - 18) / 2;
        const R = Math.max(42, Math.min(w * 0.5 - 14, h * 0.44));

        drawScopes(cx, cy, R, t);
        drawTicks(cx, cy, R);
        drawArcs(cx, cy, R);
        drawWaveform(cx, cy, R, t);
        drawCoils(cx, cy, R, t);
        drawCore(cx, cy, R, t);
    }

    function start() {
        if (rafId == null && activeView && !document.hidden) {
            lastT = performance.now();
            rafId = requestAnimationFrame(frame);
        }
    }
    function stop() {
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stop(); else start();
    });

    resize();
    start();

    return {
        setState(s) {
            state = s;
            dirty = true;
            bay.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking');
            bay.classList.add('state-' + (PROFILE[s] ? s : 'idle'));
            const status = document.getElementById('reactor-status');
            if (status) status.textContent = s.toUpperCase();
        },
        setActive(on) { activeView = !!on; if (on) start(); else stop(); },
        feed,
        clearFeed
    };
})();
