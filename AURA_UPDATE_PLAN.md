# AURA Master Update Plan — System Functions · UI · UX

Generated: 2026-08-25 · 18 tasks across 6 phases (Phase 0 + Phases 1–5)

**How to use this document:** Each task below contains a fenced, self-contained prompt. Paste one prompt into a fresh ZCode session and it has everything it needs (project context, exact files, constraints, acceptance criteria). Tasks are independent unless a "Depends on" line says otherwise. Execute in the suggested order at the bottom.

**Shared ground rules (already embedded in every prompt):**
- Tools always return human-readable `str` values and catch their own exceptions (never raise to the agent loop).
- All UI styling must use `static/tokens.css` variables — no raw hex/px outside tokens.css.
- Dark-only theme; cyan/purple are accents only, never body text.
- Every task ends with its own commit using conventional-commit style (`fix:`, `feat:`, `refactor:`) matching repo history.

---

## Phase 0 — Baseline

### T0 · Working-tree checkpoint (run yourself, not an agent task)
The working tree currently has ~40 modified files uncommitted. Before running any task below, snapshot the current state so every task lands as a clean diff:

```bash
git add -A
git commit -m "chore: checkpoint working tree before master update plan"
```

---

## Phase 1 — System Function Hardening

### Task 1 — Import-safety guards for optional dependencies
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows desktop AI assistant:
FastAPI backend (api.py), Ollama LLM loop (agent.py), and a web HUD in static/. The tools/
package exposes ~53 Python functions as LLM tools. Hard project rule: every tool returns a
human-readable string and catches its own exceptions. A missing optional dependency must NEVER
prevent the app from starting.

PROBLEM
Two modules import optional deps unguarded at module top level, so one missing package breaks
the ENTIRE tools package import and kills agent startup:
- tools/spotify_tools.py line 4: `import pyautogui` (unguarded)
- tools/windows_tools.py line 4: `import wmi` (unguarded)
For contrast, tools/smart_home_tools.py already guards pywizlight correctly — follow that pattern.

TASK
1. In spotify_tools.py: wrap the pyautogui import in try/except ImportError with module-level
   flag (e.g. PYAUTOGUI_AVAILABLE). Inside search_spotify and play_spotify_music, return an
   error string like "Spotify control unavailable: pyautogui is not installed." when the flag
   is False. Keep the existing Spotify-window-focus check logic intact.
2. In windows_tools.py: same treatment for `import wmi`. Each of the 12 functions that uses wmi
   must return a graceful error string when WMI is unavailable. Functions that only need psutil
   should keep working regardless.
3. Sweep every other file under tools/ for top-level imports of non-stdlib packages and confirm
   each is either listed in requirements.txt or guarded. Report anything you find.
4. Do NOT change function signatures, tool names, or return formats beyond error strings.

ACCEPTANCE CRITERIA
- Temporarily simulating a missing module (e.g. blocking pyautogui via sys.modules stub) still
  allows `python -c "from tools import search_spotify; print(search_spotify('test'))"` to run
  and return an error string instead of raising.
- `python -c "import agent"` succeeds.
- No behavior change when all dependencies ARE installed.

VERIFY
Run: python -c "import agent" ; then start api.py briefly and confirm no import errors in log.

COMMIT
fix(tools): guard optional imports so missing deps degrade gracefully instead of crashing startup
```

### Task 2 — Tool registry cleanup & docs truthfulness
Depends on: T0 (T1 recommended first)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. Tools are
plain Python functions exposed to Ollama via auto-schema from docstrings. Registration lives in
agent.py: `available_tools` list (~line 18), `tool_map` (~line 19), and TOOL_CATEGORIES dict
(~lines 22–34) used by the intent router to subset tools per message. tools/__init__.py
re-exports everything.

PROBLEM
1. Duplicate alias tools are exposed to the LLM: both recall_fact and search_memory exist
   (identical behavior), and forget_fact duplicates canonical forget_memory. This wastes schema
   tokens and can confuse routing.
2. Canonical forget_memory is NOT exported from tools/__init__.py (line ~5), so the registry can
   only expose the alias.
3. Docs drift: AI_PROJECT_OVERVIEW.md §Toolset Matrix claims computer_control exposes
   click_text/click_coordinates/type_text/press_key/scroll as tools — none exist (reality:
   execute_visual_task + get_active_window only). It also omits spotify_tools, goal_tools,
   diagnostic_tools entirely.

TASK
1. In memory_tools.py keep BOTH names working for backward compatibility but make search_memory
   and forget_memory the canonical implementations; make aliases thin wrappers.
2. Export forget_memory from tools/__init__.py.
3. In agent.py available_tools: remove duplicate aliases (recall_fact, forget_fact) from the LLM
   exposure list; ensure search_memory and forget_memory replace them everywhere including
   TOOL_CATEGORIES["MEMORY"]. Keep old aliases importable so nothing else breaks.
4. Update AI_PROJECT_OVERVIEW.md §Toolset Matrix to match reality exactly: list all 13 tool
   modules including spotify/goal/diagnostic/security/windows/planner, fix the computer-control
   entry to describe execute_visual_task (OCR-based closed-loop visual agent).
5. Update README.md tool count if stated anywhere.

ACCEPTANCE CRITERIA
- `python -c "import agent; print(len(agent.available_tools))"` runs and shows no duplicates.
- Grep confirms recall_fact/forget_fact no longer appear in available_tools or TOOL_CATEGORIES.
- Docs matrix matches actual exports; no phantom tool names remain anywhere in *.md.

VERIFY
python -c "import agent" ; grep -n "recall_fact" agent.py (expect zero hits).

COMMIT
refactor(tools): dedupe alias tools, export canonical forget_memory, correct docs toolset matrix
```

### Task 3 — Permission risk-map recalibration
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. Every LLM
tool call passes through evaluate_permission() in permissions.py (function ~line 89). TOOL_RISK_MAP
(~lines 17–78) assigns SAFE/LOW/MEDIUM/HIGH/CRITICAL: SAFE+LOW auto-run, MEDIUM auto-runs only in
Trusted Mode, HIGH/CRITICAL queue as pending actions requiring user approval via HUD or chat.
README.md documents the tier table.

PROBLEM — miscalibrated tiers:
- run_threat_scan is CRITICAL though it is a READ-ONLY scan (psutil CPU/RAM inspection).
- analyze_suspicious_processes is HIGH though also read-only heuristics.
- get_listening_ports / get_suspicious_files / get_removable_devices — verify tiers match their
  read-only nature.
- read_screen is SAFE although it captures the entire screen and sends it to a vision model —
  a privacy-sensitive action users may want gated.

TASK
1. Retune: run_threat_scan → MEDIUM (still noticeable but read-only), analyze_suspicious_processes
   → LOW, other read-only security scanners → LOW if currently higher. read_screen → MEDIUM.
2. Add a one-line rationale comment next to every entry you change (constraint the code can't
   show, e.g. "read-only scan; no state mutation").
3. Update README.md permission-tier table to match.
4. Confirm the meta-tools confirm_pending_action/reject_pending_action stay SAFE so approval
   can never deadlock.
5. Do NOT touch any tool implementation code.

ACCEPTANCE CRITERIA
- python -c "from permissions import TOOL_RISK_MAP; print(TOOL_RISK_MAP['run_threat_scan'], TOOL_RISK_MAP['read_screen'])" shows new tiers.
- README table matches TOOL_RISK_MAP for all changed entries.
- Existing HIGH/CRITICAL entries (control_system_power, execute_visual_task, etc.) unchanged.

VERIFY
Start the app, ask AURA to "run a threat scan" in non-trusted mode and confirm it now queues for
approval (MEDIUM behavior) instead of behaving as before per old tier.

COMMIT
fix(permissions): recalibrate risk tiers for read-only scanners and screen capture
```

### Task 4 — Backup integrity for sync_archive
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. Tool
sync_archive in tools/system_tools.py (~line 242 area) copies memory files into backups/.
Memory actually lives in THREE places: memory.json (short-term), ltm_db.json (3-layer long-term
store managed by memory.py/memory_tools.py), goals.json (background goal monitors from
goal_tools.py, consumed by api.py goal engine ~lines 754–843). There is also schedule.json and .env.

PROBLEM
sync_archive backs up memory.json, schedule.json, .env — but NOT ltm_db.json (the most valuable
file: all long-term memories) nor goals.json. Its return message claims to back up "active memory",
which is misleading.

TASK
1. Extend sync_archive to copy: memory.json, ltm_db.json, goals.json, schedule.json, .env into
   backups/ with timestamped filenames (follow whatever naming the existing code uses; extend it).
   Create backups/ if missing.
2. Make the return message list exactly which files were backed up and which were skipped because
   they don't exist yet — no false claims.
3. Handle ltm_db.json possibly being mid-write: use a short retry (2 attempts) if the JSON fails
   to parse-copy, mirroring the locking awareness in memory_tools.py (which holds a write lock, ~line 14).
4. Do not change the tool name or signature.

ACCEPTANCE CRITERIA
- Running the tool produces timestamped copies of all five files in backups/ and an accurate summary.
- Deleting goals.json temporarily results in a message noting it was skipped, not an exception.

VERIFY
Call sync_archive directly: python -c "from tools.system_tools import sync_archive; print(sync_archive())"
then inspect backups/.

COMMIT
fix(system): sync_archive now backs up long-term memory, goals, and reports accurately
```

### Task 5 — Dead code & stale asset purge
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant with a web
HUD (static/). Recent wake-word retraining (wakeword_training/TRAINING_LOG.md) deleted the v6
model artifacts, and the memory store was migrated off long_term_memory.json long ago.

PROBLEM — known-dead paths and stale files:
1. voice.py ~line 344: model-search path still probes official_features/hey_aura_v6/
   hey_aura_v6.onnx, which was deleted (see TRAINING_LOG.md cleanup notes). Dead probe path.
2. tools/memory_tools.py ~line 20: legacy migration block for long_term_memory.json — only a .bak
   remains; migration can never trigger again.
3. static/hud_screenshot.png (dated Aug 21) superseded by newer webp/jpg versions sitting beside it.
4. static/logo.jpg duplicates the root aura_logo_1_*.jpg asset.

TASK
1. Remove the v6 probe entry from voice.py's candidate-path list (keep hey_aura.onnx and any
   models/*.onnx discovery logic intact — test_wakeword.py depends on models/hey_aura.onnx).
2. Remove the legacy long_term_memory.json migration block from memory_tools.py.
3. Verify nothing references hud_screenshot.png or static/logo.jpg (grep static/*.html,
   script.js, landing.js, style.css, landing.css); if truly unreferenced, delete them. If
   referenced somewhere unexpected, update the reference instead of deleting.
4. List anything else you notice that is provably dead (unreferenced + documented-superseded)
   and include it, but be conservative — do NOT delete reactor.html or any file you cannot prove
   is unused (reactor.html is handled by a later UI task).

ACCEPTANCE CRITERIA
- python -c "import voice" and python -c "import tools.memory_tools" succeed.
- grep finds zero references to removed assets/files.
- Wake word still loads: python test_wakeword.py --help style check or importing its loader logic
  without mic access errors unrelated to your change.

COMMIT
chore: remove dead v6 wake-model probe, legacy memory migration, and stale static assets
```

---

## Phase 2 — Real-time Streaming Layer

### Task 6 — SSE event bus (single `/api/events` stream)
Depends on: T0 · Feeds: T7, T8, T10, T13, T15

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. Backend is
FastAPI (api.py, ~863 lines, run via uvicorn). Today the HUD polls ~9 REST endpoints on separate
intervals (telemetry 3s, threats 10s, schedule 30s, processes 5s/30s idle, permissions 3s,
notifications 5s, logs 10s, etc. — see pollers in static/script.js). Endpoints involved:
/api/telemetry (:71), /api/threats (:481), /api/permissions/pending (:184), /api/notifications
(:322), /api/logs (:57), /api/schedule (:344), /api/processes (:437), /api/security (:506).

TASK — add a Server-Sent Events bus WITHOUT breaking existing endpoints:
1. Create backend/event_bus.py: an asyncio broadcast hub. API:
   - `subscribe() -> asyncio.Queue`, `unsubscribe(q)`, `publish(event_type: str, data: dict)`.
   - Events carry {"type": ..., "data": ..., "ts": ...}.
2. Create api.py endpoint GET /api/events returning StreamingResponse with
   media_type="text/event-stream". On connect: send a `hello` event with server info, then stream.
   Heartbeat comment ping every 15s so proxies/clients can detect death. Handle client disconnect
   cleanly (unsubscribe; cancel per-client tasks).
3. Change-detector coroutines (single background set started via FastAPI lifespan or startup
   event): reuse the EXISTING handler logic from /api/telemetry, /api/threats,
   /api/permissions/pending, /api/notifications, /api/logs, /api/schedule, /api/processes —
   refactor those handlers' bodies into plain async helper functions that RETURN data, called by
   both the REST routes and the change-detectors. Publish ONLY when a hash/deep-compare of the
   payload changes. Respect each source's natural cadence (telemetry 3s, processes 5s active /
   30s idle is fine to simplify to 5s, notifications 3s, permissions instant-push where possible:
   publish immediately inside the permission confirm/reject/trusted-mode endpoints too).
4. Event types: telemetry, threats_update, permissions_update, notifications_update,
   logs_append, schedule_update, processes_update, heartbeat (as comment pings).
5. Keep ALL existing REST endpoints working unchanged — the frontend migrates in a later task.

CONSTRAINTS
- uvicorn only; do not introduce redis/websockets libs. Stdlib asyncio + sse starlette facilities only.
- Guard heavy calls (psutil priming exists in system_tools) — reuse, don't duplicate.
- Cap connected clients sanely (e.g. 20) and drop oldest on overflow.

ACCEPTANCE CRITERIA
- curl -N http://localhost:<port>/api/events streams hello, then telemetry events within ~5s,
  heartbeat comments every 15s.
- Confirming a permission via POST pushes permissions_update within ~200ms.
- Two browser tabs can subscribe simultaneously without starving each other.
- All previous REST endpoints return identical responses as before.

VERIFY
curl tests above + python -c "import api" clean. Check api.py has no duplicated telemetry logic
(REST route and bus share helpers).

COMMIT
feat(api): SSE event bus at /api/events broadcasting telemetry, threats, permissions, notifications
```

### Task 7 — Streaming chat endpoint with live tool progress
Depends on: T0, T6 (same event-bus infra pattern)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. agent.py
runs an Ollama tool-loop: analyze_intent router pass (~line 36), then chat with tools
(~line 316, max 12 iterations at ~line 297), permission gating via evaluate_permission
(~line 393), results truncated to 4000 chars (~line 401). api.py POST /api/chat (:163) blocks
until the whole loop finishes; the HUD waits up to 300s with no feedback. Ollama python client
supports ollama.chat(stream=True) yielding message chunks; tool-call deltas must be accumulated
across chunks before invoking.

TASK — add POST /api/chat/stream as an SSE endpoint (keep /api/chat untouched):
Event protocol (each SSE event JSON):
- {type:"meta", intent:{categories, requires_plan}, skill}   ← after router pass
- {type:"token", text:"..."}                                  ← content deltas
- {type:"tool_start", tool:"web_search", args_summary:"..."}  ← right before invocation
- {type:"tool_result", tool:"web_search", ok:true, preview:"first ~200 chars"}
- {type:"permission_request", action_id, tool, risk}          ← when evaluate_permission queues
- {type:"done", text:"<final full markdown>", memory_saved:bool}
- {type:"error", message}

IMPLEMENTATION
1. Extract the core of the existing chat pipeline into an async generator
   `agent.chat_stream(user_input, ...)` yielding typed events; refactor the blocking path to
   consume the same generator (so there is ONE pipeline, two transports). Preserve: intent
   routing + opt-out env AURA_INTENT_ROUTER, skill injection, permission gate, 12-iteration cap,
   4000-char truncation, empty-response retry, memory extraction hook (~agent.py:265).
2. Stream tokens: call ollama.chat(stream=True). Accumulate tool_call fragments across chunks;
   emit token events only for content chunks. When a complete tool call arrives, emit tool_start,
   run it through the SAME permission/execution path, emit tool_result, append to messages, continue.
3. api.py: POST /api/chat/stream accepts the same body as /api/chat, returns StreamingResponse
   text/event-stream, wraps generator errors into error events then closes.
4. Frontend wiring (minimal here — full UX lands in Task 8): in static/script.js chat flow
   (~lines 648–764) switch sendChat to fetch('/api/chat/stream') + ReadableStream SSE parsing
   (fetch-based, since we POST). Render partial markdown progressively: throttle marked+DOMPurify
   re-render to ~every 150ms during streaming, final render on done with hljs highlight. Show a
   status line ("Running web_search…", "Waiting for approval…") driven by tool_start /
   permission_request events. Keep TTS behavior identical (play on done).
5. Leave /api/chat fully functional as fallback (a ?stream=off query or config flag switches the
   client back if SSE misbehaves).

ACCEPTANCE CRITERIA
- curl -N -X POST /api/chat/stream -d '{"message":"what time is it"}' yields meta → token(s) → done.
- A tool-using prompt ("open calculator") yields tool_start/tool_result events between tokens.
- A dangerous prompt yields permission_request then continues after approval via existing endpoints.
- /api/chat still works exactly as before.
- Frontend shows incremental text and status lines; final message renders identically to old path.

VERIFY
Manual chat of each kind in the HUD (simple, tool-using, dangerous/approval). Watch
aura_agent.log for the loop behaving once, not twice (ensure refactored pipeline didn't double-run).

COMMIT
feat(chat): streaming SSE chat with live token output and tool-execution progress
```










done








### Task 8 — Frontend realtime refactor (retire the pollers)
Depends on: T6 (+T7 for chat status line polish)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). Frontend is vanilla JS:
static/script.js (~2163 lines). It has a central api() wrapper (~line 112) with AbortController
timeouts and ConnectionMonitor (~line 73) flipping an ONLINE/OFFLINE chip after 2 failures.
~9 independent polling loops refresh telemetry/threats/schedule/processes/permissions/
notifications/memories/security/logs with hash-compare skip logic. Backend now offers GET /api/events
(SSE bus broadcasting: hello, telemetry, threats_update, permissions_update, notifications_update,
logs_append, schedule_update, processes_update + heartbeat comments) from Task 6.

TASK
1. Create a small Realtime module inside script.js (or static/realtime.js loaded before script.js):
   - EventSource('/api/events') with automatic reconnect + exponential backoff (1s→30s cap).
   - Dispatch to registered handlers: Realtime.on('telemetry', fn).
   - Feed ConnectionMonitor from heartbeats: missed 2 consecutive heartbeats (>35s silent) → OFFLINE;
     first received → ONLINE. Replace the failure-counter logic tied to individual polls.
2. Migrate every polling loop whose data the bus covers (telemetry, threats, permissions,
   notifications, logs, schedule, processes, security sweep) to realtime handlers. DELETE their
   setInterval loops and hash-compare code — the server already dedupes unchanged payloads.
   Views hidden/off-tab: EventSource keeps flowing; simply skip DOM writes when document.hidden
   or view inactive, as today's pause logic does.
3. Keep polling ONLY for: /api/memory (memories list, low value), /api/proactive settings,
   wake-word status, and any endpoint not on the bus. Document remaining pollers in a comment.
4. Resilience: if EventSource errors repeatedly (3 failures), fall back to legacy polling for the
   affected channels (keep the old poll functions behind a flag rather than deleting outright IF
   trivial; otherwise a console warning + single manual refresh button in Settings is acceptable —
   pick the simpler option and note it in the commit body).
5. Stale-badge logic (setStale) now keys off heartbeat silence per channel: no event of a type for
   >3× its normal cadence → STALE badge on the relevant card.

ACCEPTANCE CRITERIA
- Kill the backend: sidebar flips OFFLINE within ~35s, STALE badges appear; restart: ONLINE within
  seconds of first heartbeat, data refreshes without reload.
- Network tab shows ONE long-lived /api/events connection instead of dozens of periodic requests.
- All 7 views still populate correctly (Chat, Reactor, System, Security, Files, Memory, Settings).
- No console errors across 10 minutes idle.

VERIFY
Browser devtools network inspection + kill/restart uvicorn twice. Test each view renders fresh data.

COMMIT
refactor(ui): replace polling loops with SSE realtime channel and heartbeat-driven connection monitor
```

---


done




## Phase 3 — Stateful Planner

### Task 9 — Persistent planner engine
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. Planner is
currently fake: tools/planner_tools.py has create_temporary_plan (~lines 22–39) and report_progress
(~lines 3–20) that only push notifications via notifications.push_notification — NO plan state is
stored anywhere. The agent system prompt has an "Agentic Planner" section (~agent.py lines 131–140)
instructing the model to call these. README overclaims "dependency sequencing". Goal monitors are
separate (goal_tools.py + api.py engine ~754–843) — do not touch them.

TASK — build real plan state:
1. New module planner_state.py (repo root, beside memory.py):
   - Thread-safe (threading.Lock, like memory_tools does) JSON store at plans.json:
     {plans:[{id, goal, steps:[{index,text,status}], current_step, created_at, updated_at,
      status}]}, status ∈ active|completed|cancelled. Keep max ~20 plans, prune oldest completed.
   - API: create_plan(goal, steps:list[str]) -> plan dict; update_step(plan_id, index|current,
     status, note=""); advance(plan_id) -> moves current_step forward, marks prior step done;
     complete_plan(plan_id); cancel_plan(plan_id); get_active_plan(); list_plans(limit).
2. Rewrite planner_tools.py keeping the exact tool names/signatures the LLM already knows:
   - create_temporary_plan(steps, goal="") — persists via planner_state.create_plan, pushes ONE
     notification summarizing the plan, returns "[PLANNER] Plan <id> registered with N steps.
     Begin executing step 1: <text>".
   - report_progress(message, step=None) — if a plan is active and message maps to a step
     transition, record it; push notification as today; return confirmation including
     "Step k/N complete. Next: <text>". Add heuristic: if message starts with "step N" or matches
     "complete"/"done", mark accordingly; otherwise attach note to current step.
3. Agent prompt section (~agent.py:131–140): update instructions — after create_temporary_plan the
     model MUST report_progress("Step k complete...") after finishing each step; final step
     completion auto-closes the plan (call out that complete_plan happens implicitly via
     advance() past last step; expose explicit complete only if trivial).
4. api.py endpoints: GET /api/plans/active (active plan or null), GET /api/plans (recent 10),
     POST /api/plans/{id}/cancel. Publish "plan_update" on the SSE bus (backend/event_bus.py from
     Task 6) on EVERY mutation; if event_bus doesn't exist yet (Task 6 not merged), guard the
     import and skip publishing.
5. Add plans.json to sync_archive's backup list in tools/system_tools.py (Task 4 may have already
     touched this — integrate cleanly).

ACCEPTANCE CRITERIA
- python smoke: create_plan → advance ×3 → get_active_plan shows statuses [done,done,done] and
  status completed; plans.json valid JSON after concurrent-ish writes.
- Via chat: "Plan: backup my files, then clean temp" makes AURA register a 2-step plan; progress
  notifications reflect step transitions; GET /api/plans/active returns it live mid-task.
- Old conversation flows that never call planner tools still work unchanged.

COMMIT
feat(planner): persistent multi-step plan state with step tracking and API surface
```


done




### Task 10 — Active Plan panel in the HUD
Depends on: T9 (and T6 for live updates; falls back to 5s polling of /api/plans/active otherwise)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). HUD is static/hud.html (524 lines,
7 views) + static/style.css (1415) + static/script.js (2163). Design system: static/tokens.css —
use its variables exclusively (--bg-elevated surfaces, --accent, spacing scale, radii, motion
tokens --ease-spring etc.). Chat view has a right rail containing Schedule card and Now Playing
card (~hud.html lines around the Chat section). Backend from Task 9 exposes GET /api/plans/active
returning {plan:{id,goal,steps:[{index,text,status}],current_step,status}} or null, and publishes
SSE "plan_update" events (event_bus). If the SSE bus isn't present, poll every 5s.

TASK
1. hud.html: new "Active Plan" card in the Chat view right rail ABOVE the Schedule card:
   header with pulsing dot while plan.status==active, goal text, ordered step list (numbered),
   each row showing status icon (pending ○ / active ▸ accent-colored / done ✓ / cancelled),
   progress bar (done/total using --accent), and a small cancel (×) button calling
   POST /api/plans/{id}/cancel with the shared confirm modal.
   When no plan: collapsed empty-state card ("No active plan") — subtle, not noisy.
2. Sidebar badge: the Chat nav button gets a tiny accent badge showing active-step count while a
   plan is active (reuse existing badge styles if any; else minimal ::after chip per tokens).
3. script.js: initPlans() — subscribe to Realtime 'plan_update' (or poll fallback); render
   function with hash-compare skip; wire cancel button; respect reduced-motion (no pulse anims).
   Register in VIEW_NAMES boot path alongside other cards.
4. style.css: styles appended in the Cards section following existing card patterns (.card base);
   no raw hex — tokens only; hover/focus states per existing buttons; responsive: rail stacks
   below chat on narrow widths like Schedule card already does.
5. Accessibility: aria-live="polite" on the step list container; buttons keyboard-focusable with
   visible focus ring per tokens.css.

ACCEPTANCE CRITERIA
- Trigger a real multi-step task in chat ("create a plan to: scan system, then list processes,
  then summarize") → card appears, steps tick to active/done as report_progress fires, bar fills,
  card collapses to empty-state on completion.
- Cancel works mid-plan with confirm modal; badge disappears.
- Theme switch (crimson/emerald/violet) recolors the card correctly — zero hardcoded colors.
- prefers-reduced-motion: no pulsing/transitions beyond opacity.

VERIFY
Run one planned task end-to-end in the HUD; toggle themes; resize window across breakpoints.

COMMIT
feat(hud): live Active Plan card with step tracking and cancel control
```

---
done  





## Phase 4 — UI Consolidation & Polish

### Task 11 — Entry-point consolidation (HUD at `/`, unified boot, retire reactor page)
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). Three HTML entry points exist:
- static/index.html (647 lines): marketing landing, currently served at "/" because api.py:854
  mounts StaticFiles(directory="static", html=True); its CTA links to hud.html.
- static/hud.html (524): the real application (7 views). Users must click through from landing
  EVERY visit.
- static/reactor.html (21): standalone prototype of the arc-reactor — the Reactor view is already
  embedded in hud.html with identical element IDs (#reactor-bay/#reactor-canvas/#reactor-status).
Boot sequence is DUPLICATED: full cinematic version in static/landing.js (~lines 22–40+) vs a
shorter variant in static/script.js (~lines 172–209), same DOM (#boot-lines, .bok classes).

TASK
1. Serve the HUD at root: rename static/index.html → static/welcome.html (git mv), update its
   internal CTA/link references (it linked TO hud.html; now link back sensibly), and add an
   explicit route in api.py BEFORE the static mount:
   @app.get("/", include_in_schema=False) -> FileResponse("static/hud.html")
   Also route "/welcome" → welcome.html for discoverability. Keep the StaticFiles mount unchanged.
2. Unify boot: extract the boot sequence into static/boot.js exposing AuraBoot.run({variant:'full'|'brief'})
   writing to #boot-lines with .bok entries. landing.js and script.js both call it (landing passes
   its longer line set; HUD keeps its brief set). Delete both inline implementations. Boot timing/
   classes/DOM ids stay EXACTLY as today so CSS is untouched.
3. Retire reactor.html: delete static/reactor.html. Move the genuinely page-level bits of
   static/reactor.css (86 lines) that only served the standalone page into oblivion, and fold the
   shared .reactor-bay base styles that currently live split between style.css and reactor.css
   into style.css (reactor.css comment ~lines 23–25 acknowledges this split-brain). reactor.js
   (the canvas engine, window.AuraReactor) stays untouched.
4. Update sidebar brand link target if it pointed to index.html (script.js or hud.html) → point to "/"
   (i.e., hud itself) or /welcome — choose "/" so the logo stays on-app; landing remains reachable
   via /welcome.
5. Grep for ANY remaining references to index.html, reactor.html across *.html,*.js,*.css,*.py and
   fix them (README screenshots references excepted).

ACCEPTANCE CRITERIA
- http://host/ loads the HUD directly with its brief boot; http://host/welcome loads landing with
  full boot; landing CTA reaches the HUD.
- Reactor view in HUD animates identically (canvas states idle/listening/processing/speaking).
- No 404s in console/network on either page; boot appears exactly once per page load.
- git status shows reactor.html deleted; no orphan CSS.

VERIFY
Load both pages in browser, exercise voice orb + reactor click-to-talk once, check console clean.

COMMIT
refactor(ui): HUD becomes root experience, unify boot sequence, retire standalone reactor page
```


done

### Task 12 — Design-token completion (type scale)
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). Design system: static/tokens.css
(212 lines) — colors, spacing (4px scale), radii, shadows, motion, z-index, layout vars. Fonts are
self-hosted Space Grotesk (UI), JetBrains Mono (mono), Orbitron (display/logo/boot ONLY).
PROBLEM: tokens.css defines NO font-size tokens, yet code references var(--text-sm, 12px)
(static/reactor.css:78 — silently falling back) and stylesheets hardcode px sizes everywhere
(style.css 1415 lines, landing.css 2082 lines).

TASK
1. Define a type scale in tokens.css (place near layout vars):
   --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-md: 14px; --text-lg: 16px;
   --text-xl: 20px; --text-2xl: 26px; --text-3xl: 32px; --text-display: clamp(...) for hero;
   plus line-height pair tokens (--leading-tight:1.2, --leading-normal:1.5) and the existing
   font-family vars formalized as --font-ui/--font-mono/--font-display if not already present.
   Values MUST equal the dominant sizes already in use (audit first: tabulate current px usage
   per stylesheet and pick the modal values — do NOT redesign typography, just tokenize it).
2. Sweep static/style.css and static/reactor.css replacing hardcoded font-size declarations with
   the tokens. Where a size doesn't match any token within ±1px, snap to nearest token UNLESS it
   would visibly break a component (then add a one-off token with a comment).
3. static/reactor.css:78 var(--text-sm, 12px) → var(--text-sm) (token now exists).
4. landing.css: tokenize the obvious body/UI text sizes; LEAVE the marketing display headlines
   alone if they use deliberate clamps — note exceptions in commit body.
5. Orbitron discipline check: confirm it appears ONLY on logo/boot/display elements (grep
   font-family usages); fix violations to --font-ui.
6. Visual regression pass: screenshot-equivalent manual check of Chat, System, Security views +
   landing at default zoom — spacing/rhythm must look unchanged.

ACCEPTANCE CRITERIA
- grep -n "font-size:" static/style.css static/reactor.css shows ≥90% var(--text-*) usage;
  remaining ones have a justification comment.
- Zero visual regressions you can detect in the four key screens.
- tokens.css contains the scale with a short comment mapping intended usage (xs=labels/chips,
  sm=secondary, base=body…).

COMMIT
refactor(ui): introduce --text-* type scale in tokens.css and migrate stylesheets onto tokens
```




done


### Task 13 — Real Now Playing card (Windows SMTC)
Depends on: T0 (nice-to-have: T6 for push updates; poll fallback required)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT), a Windows AI assistant. HUD Chat
view right rail has a "Now Playing" media card that is DECORATIVE: hardcoded placeholder art and
"Awaiting input…" (static/script.js ~line 1135 injects canned command strings). Backend media
control exists: control_media in tools/system_tools.py presses volume/playpause/next/previous
media keys via pyautogui. Python is 3.14 (check __pycache__ tags).

TASK
1. New module media_info.py (repo root): async function get_now_playing() using Windows System Media
   Transport Controls via winsdk (`winsdk.windows.media.control`
   GlobalSystemMediaTransportControlsSessionManager). Wrap in try/except ImportError → return
   {"available": False, "reason": "winsdk not installed"} so the feature degrades cleanly.
   Try `pip install winsdk` first; if it fails to install/import on this Python version, DO NOT
   fight it — implement the graceful-unavailable path and note it prominently in the commit body.
   Return shape: {available, playing, title, artist, album, album_art(thumb bytes→base64 data URI
   or null), app, position_s, duration_s}.
2. api.py: GET /api/media returning that dict (never raises; 200 always). If SSE bus exists,
   publish media_update on change (poll internally every 3s); else client polls every 4s.
3. HUD card wiring in script.js: title/artist/app from payload; album art img with graceful
   fallback to existing placeholder art; play/pause + next + prev buttons call the EXISTING
   /api/chat? No — add direct lightweight endpoints POST /api/media/control {"action":
   playpause|next|previous} that invoke control_media's underlying keystroke logic directly
   (reuse the function from system_tools; do not route through the LLM). Optimistic icon toggle,
   reconcile on next payload.
4. Progress bar: position/duration if both present; hide when unknown. Update cadence 1s locally
   interpolating between polls (cheap math only).
5. Style: reuse existing card patterns/tokens; art radius per tokens; zero hex literals.

ACCEPTANCE CRITERIA
- With Spotify/browser media playing: card shows real track, artist, app; buttons actually control
  playback; progress advances.
- With nothing playing: honest empty state ("Nothing playing"), controls disabled visually.
- Without winsdk: card shows the empty state and a muted hint; ZERO console errors; /api/media
  returns {"available": false,...} with 200.

VERIFY
Play something in Spotify; verify card + controls; stop playback; kill winsdk import path to test
degraded mode.

COMMIT
feat(media): real Now Playing card via Windows SMTC with graceful degradation
```


done




### Task 14 — Responsive audit & final asset pass
Depends on: T0 (do AFTER T11–T13 so you audit the consolidated UI)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). HUD shell: sidebar (--sidebar-w:
216px), header (--header-h:56px), 7 views, Chat right rail; breakpoints live near the end of
static/style.css (Responsive section) plus tokens.css layout vars. Landing: static/landing.css
(2082 lines).

TASK
1. Breakpoint audit at 1920, 1440, 1280, 1024, 820, 640, 400 widths (browser device toolbar):
   - Sidebar must collapse to icon rail ≤1280 and overlay-drawer ≤820 with backdrop; hamburger
     visible only when drawer mode active.
   - Chat rail (Schedule / Now Playing / Active Plan cards) stacks below messages ≤1024.
   - Header truncates long titles with ellipsis; controls never overlap.
   - Tables/lists (processes, logs, files) become horizontally scrollable within their cards,
     never overflowing the viewport.
   - Touch targets ≥44px effective at ≤820.
   Fix every violation found; prefer tokens/layout vars over magic numbers.
2. Reduced-motion spot-check at each width (emulate prefers-reduced-motion): no transform/parallax
   animations; content reachable.
3. Asset sweep: delete static/hud_screenshot.png-era leftovers ONLY if Task 5 didn't already; run a
   reference check (grep all html/js/css/py) for every file in static/ and list orphans; delete
   proven-orphan images. Compress any image >300KB losslessly (e.g. re-encode png→webp where
   referenced accordingly — only if you update references atomically).
4. Keyboard pass: Tab order sensible in Chat view; focus visible (tokens focus ring) on sidebar
   buttons, quick actions, chat input, voice orb.

ACCEPTANCE CRITERIA
- No horizontal scrollbar at any tested width except inside intentional scroll containers.
- Drawer/sidebar behaviors correct at boundaries (1279/1280, 819/820).
- Orphan asset list empty or intentionally kept with justification in commit body.
- Full keyboard navigation possible for: send a chat message, switch views, open shortcuts modal.

COMMIT
fix(ui): responsive audit fixes across HUD breakpoints and final asset cleanup
```

---


done



## Phase 5 — UX Depth

### Task 15 — Unified wake word (server-authoritative)
Depends on: T0 (better after T8: status via SSE; poll fallback mandatory)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). Wake word "Hey Aura" has TWO competing
implementations that can disagree:
(a) Server: openWakeWord ONNX (models/hey_aura.onnx + .onnx.data) consumed by voice.py — 16kHz mono,
    1280-sample chunks, threshold 0.6 (raised to 0.8 during speech for barge-in), 2s cooldown
    (~voice.py:394–397); toggled via POST /api/wakeword/toggle, status GET /api/wakeword/status
    (api.py:281–292).
(b) Client: browser SpeechRecognition running continuously, wired in static/script.js Settings
    (~lines 1628–1708) ALONGSIDE syncing the backend toggle — dual sources of truth.
The server model is the product decision going forward (custom-trained v9; see
wakeword_training/TRAINING_LOG.md).

TASK
1. script.js Settings wake-word section: REMOVE the browser SpeechRecognition engine entirely
   (recognition object, its handlers, its result routing). The toggle becomes a pure control for
   POST /api/wakeword/toggle {enabled}. Status comes from /api/wakeword/status (poll 5s, or
   Realtime 'wakeword_status' event if the bus broadcasts it — add that broadcast server-side in
   api.py where the toggle mutates state, cheap win).
2. voice.py/api.py additions: track last_detection_ts (updated in the detection callback) and
   false-positive counter reset daily; expose in /api/wakeword/status: {enabled, listening,
   threshold, last_detection_ts, model_loaded}.
3. Settings UI: status chip next to the toggle — gray disabled / green listening (accent token) /
   amber error (model failed to load) with tooltip detail; "Test detection" button: arms a 10s
   window that speaks/spoken-detects locally and reports hit/miss (uses last_detection_ts delta —
   instruct user to say "Hey Aura" aloud; purely informational).
4. Voice orb + reactor integration unchanged: browser mic visualization and /api/voice/listen flow
   stay exactly as-is; only the DETECTION layer is unified.
5. Migration nicety: localStorage['aura-wakeword-engine'] key ignored/removed on load.

ACCEPTANCE CRITERIA
- Toggle ON: only the SERVER listener runs (verify via voice.py log lines); saying "Hey Aura" wakes
  AURA end-to-end; browser mic is opened only for visualization during active listening sessions.
- Toggle OFF: zero detection activity server-side.
- Chip reflects enabled/error states truthfully; Test Detection reports honestly.
- No leftover references to webkitSpeechRecognition for wake purposes in script.js (grep clean).

COMMIT
refactor(voice): single server-side wake-word detector with honest status surfacing
```
done


### Task 16 — Configurable quick actions
Depends on: T0

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). HUD Chat view has quick-action chips
("Read screen", "Lock", "Web", "Scan") whose English command strings are HARDCODED in
static/script.js (~lines 1129–1137), sent through the chat path. Backend serves no UI config.

TASK
1. config/quick_actions.json (create config/ dir if absent):
   [{"id":"screen","label":"Read Screen","icon":"eye","prompt":"read my screen and describe what
   you see","danger":false}, ...for lock/web/scan...] — seed with the current four actions'
   equivalent prompts (choose prompts that produce today's behavior).
2. api.py: GET /api/config/ui returns {quick_actions:[...]} reading the JSON (cached with mtime
   check). Never 404: fall back to built-in defaults constant if file missing/corrupt (log warn).
3. script.js: render chips dynamically from that payload on boot; click sends prompt via the same
   sendChat path (works with streaming from Task 7 transparently). danger:true chips route through
   the existing confirm modal first. Remove hardcoded definitions.
4. Settings view: simple editor list for quick actions — label + prompt text inputs, add/remove,
   saved via POST /api/config/ui (writes the JSON atomically, validates: non-empty label/prompt,
   ≤12 actions, strip control chars). Reload chips after save without page reload.
5. Icons: map icon names to existing inline SVG set in hud.html; unknown icon → generic bolt.

ACCEPTANCE CRITERIA
- Editing "Web" action's prompt in Settings to "search the web for today's news" immediately
  changes chip behavior on next click.
- Deleting config/quick_actions.json + restart → defaults render, no crash.
- Malformed JSON → defaults + console warning, never a broken Settings page.

COMMIT
feat(ui): configurable quick actions backed by JSON config with Settings editor
```

### Task 17 — Voice-flow polish
Depends on: T0 (best after T7/T8 so states ride the realtime layer)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). Voice UX lives in
static/script.js: voice orb #voice-btn with ring pulse fed by mic RMS (~line 872),
startVoiceInteraction (~766–816) — barge-in pauses audio + POST /api/voice/stop, transcription via
blocking POST /api/voice/listen, /api/voice/speaking signals playback end, auto-continue listening
if reply ends with "?" (canStartListening ~839, 2s settle). Reactor states: idle/listening/
processing/speaking (window.AuraReactor + body CSS classes via setAuraState ~253). TTS: playTTS()
fetches /api/tts blob, WebAudio analyser feeds AuraReactor.feed().

TASK — close the gaps a real conversation exposes:
1. Conversation-mode indicator: while auto-listen chaining is armed (last reply was a question),
   show a persistent subtle "Listening…" pill near the input + reactor breathing animation;
   distinguishable from user-initiated listen (tooltip explains auto-chain).
2. Mic-denied state: catch getUserMedia rejection → dedicated inline banner in Chat ("Microphone
   blocked — enable it in browser/site settings") with a Retry button; reactor enters error tint
   (accent-danger token); orb disabled with tooltip. No silent failures.
3. Barge-in feedback: when user speaks during TTS playback, immediately (≤150ms) duck audio
   (gain ramp), switch reactor to listening state, flash a brief ripple on the orb — even before
   /api/voice/stop resolves.
4. TTS queueing guard: rapid consecutive replies must never overlap playback — single AudioContext
   play chain; if a new done-event arrives while speaking, apply barge-in rules ONLY if user audio
   detected; otherwise queue (max depth 2, drop oldest) with status pill "Queued reply".
5. Error paths: /api/voice/listen timeout (show "Didn't catch that" toast, return to idle),
   /api/tts failure (silent-mode fallback: show text-only with mute icon, don't block chat).
6. State machine hygiene: centralize transitions in setAuraState with an allowed-transitions map;
   log illegal transitions to console in dev; guarantee return to idle on finally{} for every
   async branch.

ACCEPTANCE CRITERIA
- Manual scenario pass: continuous Q&A conversation (ask 3 questions back-to-back) chains without
  clicks; denying mic permission shows the banner; interrupting mid-reply barge-ins cleanly;
  double-sending messages never overlaps audio; unplugging mic mid-session degrades gracefully.
- No stuck states after 20 random interactions (state always returns to idle).

COMMIT
feat(voice): conversation-mode indicators, barge-in feedback, TTS queueing, hardened error states
```

### Task 18 — First-run onboarding checklist
Depends on: T0 (ideally after T13/T15/T16 so checks reflect final features)

```text
PROJECT CONTEXT
You are working on AURA (G:\Side Projects\AURA-AI_ASSISTANT). HUD: static/hud.html has overlay
infrastructure — boot overlay, modals, toast container (overlays ~lines 471–514). Health signals
available: GET /api/telemetry (backend alive), Ollama reachability (diagnostic_tools.
run_aura_diagnostics checks it — expose a LIGHTWEIGHT GET /api/health/ollama in api.py doing a
1-model-list timeout-3s check, do NOT run full diagnostics), mic via getUserMedia probe,
wake word via /api/wakeword/status, theme choice via localStorage['aura-theme-v2'].

TASK
1. api.py: GET /api/health/ollama → {ok, model, latency_ms} using ollama.list() with 3s timeout,
   cached 30s. Never throws.
2. hud.html: onboarding overlay — centered card over dimmed backdrop, reusing modal patterns:
   Title "Welcome to AURA", 5-row checklist, each row: status icon (pending ○ / checking spinner /
   pass ✓ accent / fail ✕ danger), label, and inline action button where relevant:
   - Backend online (GET /api/health — add tiny endpoint {ok:true} if none exists)
   - Ollama reachable (/api/health/ollama) — action: "Retry"
   - Microphone access — action: "Enable" (triggers getUserMedia probe; explain browser will ask)
   - Wake word ready (/api/wakeword/status model_loaded) — action: "Open Settings" (deep-links the
     Settings view wake section)
   - Pick your accent theme — action: cycles theme dots inline (crimson/emerald/violet/default)
     writing the same localStorage key Settings uses
3. Flow: shows automatically on first HUD visit (localStorage['aura-onboarded'] absent); rows check
   in parallel on open; failing rows stay actionable; footer "Enter the HUD" button enables when
   backend row passes (other rows may remain failed — honesty over blocking); sets
   ['aura-onboarded'] on dismiss. Settings gets a "Replay setup" link to reopen.
4. Reduced-motion compliant; ESC does not dismiss until backend row resolved (avoid half-checked
   confusion); backdrop click ignored.
5. script.js: onboard.js-style module section (~120 lines max), hash-compare free, plain promises.

ACCEPTANCE CRITERIA
- Fresh profile: overlay appears once, checks resolve truthfully (kill Ollama → that row fails with
  Retry working after restart), theme picker persists choice, subsequent visits never show it.
- Replay Setup from Settings reproduces it; completing again doesn't duplicate storage flags.
- With mic denied, rest of HUD unaffected after dismissal.

COMMIT
feat(onboarding): first-run health checklist overlay with actionable recovery steps
```

---

## Suggested execution order

| Order | Tasks | Why |
|---|---|---|
| 1 | T0 | Clean baseline commit |
| 2 | T1 → T2 → T3 → T4 → T5 | Backend correctness first; each independent |
| 3 | T6 → T7 → T8 | Streaming foundation before anything consumes it |
| 4 | T9 → T10 | Stateful planner, then its HUD panel |
| 5 | T11 → T12 → T13 → T14 | UI consolidation, tokens, media, responsive |
| 6 | T15 → T16 → T17 → T18 | UX depth on the finished surface |

Parallel-friendly pairs if using separate sessions: (T3 ∥ T4 ∥ T5), (T9 ∥ T12), (T16 ∥ T17).
