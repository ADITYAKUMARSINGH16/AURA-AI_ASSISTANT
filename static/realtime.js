// ═══════════════════════════════════════════════════════════
// REALTIME — SSE bus client (loaded before script.js).
//
// One long-lived EventSource to /api/events replaces the per-channel
// polling loops. script.js registers view-specific handlers via
// Realtime.on(type, fn) and calls Realtime.start() once the DOM and
// handlers are ready.
//
// Liveness model:
//  - Heartbeat comments (`: ping`) are invisible to the JS EventSource API,
//    so liveness is judged by ANY event traffic; backend detectors re-publish
//    unchanged payloads at ~3x cadence, so total silence >35s means death.
//  - Per-channel staleness: no event of a type for >3x its cadence puts the
//    STALE badge on that channel's card.
//  - Resilience: after 3 consecutive connection failures, onFallback() fires
//    (script.js restarts legacy REST polling). Retries back off 1s → 30s.
// ═══════════════════════════════════════════════════════════

const Realtime = (() => {
    const CADENCE = {
        telemetry: 3,
        ambient_update: 3,
        permissions_update: 3,
        notifications_update: 3,
        processes_update: 5,
        threats_update: 10,
        logs_append: 10,
        schedule_update: 30,
        security_update: 30
    };
    const STALE_TARGETS = {
        telemetry: ['.diagnostics-panel', '.thermals-panel'],
        processes_update: ['.process-panel'],
        logs_append: ['.log-panel'],
        threats_update: ['.security-panel'],
        security_update: ['.security-panel'],
        permissions_update: ['.permissions-panel']
    };
    const SILENCE_LIMIT = 35000;   // >35s without any traffic => OFFLINE
    const STALE_MULTIPLE = 3;
    const MAX_FAILURES_BEFORE_FALLBACK = 3;

    const handlers = {};
    const lastSeenByType = {};
    const knownTypes = new Set(Object.keys(CADENCE));
    let es = null;
    let started = false;
    let everConnected = false;
    let lastActivity = Date.now();
    let backoffMs = 1000;
    let consecutiveFailures = 0;
    let fallbackFn = null;
    let fallbackStarted = false;

    function markStale(el, stale) { el?.classList.toggle('stale', !!stale); }

    function emit(type, data) {
        lastSeenByType[type] = Date.now();
        lastActivity = Date.now();
        (handlers[type] || []).forEach(fn => {
            try { fn(data); } catch (e) { console.error('[Realtime] handler error (' + type + '):', e); }
        });
        (handlers['*'] || []).forEach(fn => {
            try { fn(type, data); } catch (e) {}
        });
    }

    function connect() {
        if (!started) return;
        try {
            es = new EventSource('/api/events');
        } catch (e) {
            handleFailure(e);
            return;
        }

        es.onopen = () => {
            // Socket re-opened: reset backoff. Data handlers wait for actual events.
            backoffMs = 1000;
            lastActivity = Date.now();
        };

        es.onmessage = (e) => {
            let ev;
            try { ev = JSON.parse(e.data); } catch (_) { return; }
            if (!everConnected) {
                everConnected = true;
                consecutiveFailures = 0;
                ConnectionMonitor.record(true);
            }
            emit(ev.type || 'message', ev.data);
        };

        // Named SSE events arrive via addEventListener channels, not onmessage.
        // One shared handler covers every known type; Realtime.on() can grow
        // the set at runtime (e.g. channels added after this file loads).
        for (const type of knownTypes) {
            es.addEventListener(type, onNamedEvent);
        }
        es.addEventListener('hello', onHelloEvent);

        es.onerror = () => {
            es.close();
            handleFailure(new Error('eventsource error'));
        };
    }

    function onHelloEvent(e) {
        if (!everConnected) {
            everConnected = true;
            consecutiveFailures = 0;
            ConnectionMonitor.record(true);
        }
        let data = null;
        try { data = JSON.parse(e.data).data; } catch (_) {}
        emit('hello', data);
    }

    function onNamedEvent(e) {
        if (!everConnected) {
            everConnected = true;
            consecutiveFailures = 0;
            ConnectionMonitor.record(true);
        }
        let data = null;
        try { data = JSON.parse(e.data).data; } catch (_) {}
        emit(e.type, data);
    }

    function handleFailure(err) {
        consecutiveFailures++;
        console.warn('[Realtime] connection failed x' + consecutiveFailures + '; retrying in ' + backoffMs + 'ms', err?.message || '');
        if (consecutiveFailures >= MAX_FAILURES_BEFORE_FALLBACK && !fallbackStarted && fallbackFn) {
            fallbackStarted = true;
            console.warn('[Realtime] falling back to legacy REST polling.');
            try { fallbackFn(); } catch (e) { console.error('[Realtime] fallback start failed:', e); }
        }
        setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30000);
    }

    // ── Liveness watchdog: drives the ONLINE/OFFLINE chip off bus silence ──
    setInterval(() => {
        if (!started) return;
        const silentFor = Date.now() - lastActivity;
        if (silentFor > SILENCE_LIMIT) {
            if (!ConnectionMonitor.isOffline) ConnectionMonitor.record(false);
        } else if (everConnected && ConnectionMonitor.isOffline) {
            ConnectionMonitor.record(true);
        }
    }, 5000);

    // ── Staleness watchdog: STALE badges per channel ──
    setInterval(() => {
        if (!started || document.hidden) return;
        for (const [type, selectors] of Object.entries(STALE_TARGETS)) {
            const seen = lastSeenByType[type];
            // Only flag stale once the channel has delivered at least one event;
            // before that the cards are simply "not yet loaded".
            const stale = !!seen && (Date.now() - seen) > CADENCE[type] * STALE_MULTIPLE * 1000;
            selectors.forEach(sel => markStale(document.querySelector(sel), stale));
        }
    }, 5000);

    return {
        /** Register a handler for a bus event type. Also wires the underlying
         *  EventSource listener, including after (re)connection. */
        on(type, fn) {
            (handlers[type] = handlers[type] || []).push(fn);
            if (!knownTypes.has(type)) {
                knownTypes.add(type);
                if (es && es.readyState === 1) es.addEventListener(type, onNamedEvent);
            }
        },
        /** Start after handlers are registered (called from script.js INIT). */
        start() {
            if (started) return;
            started = true;
            connect();
        },
        /** Register the legacy-polling restart used after repeated failures. */
        onFallback(fn) { fallbackFn = fn; },
        get connected() { return everConnected; }
    };
})();
