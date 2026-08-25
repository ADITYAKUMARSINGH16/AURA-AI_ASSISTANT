import ollama
import logging
import threading
import time
import re
from tools import get_system_time, get_system_info, open_application, close_application, web_search, list_directory, read_file, read_clipboard, control_media, control_system_power, read_screen, run_threat_scan, manage_schedule, scan_home_network, sync_archive, remember_fact, recall_fact, search_memory, discover_smart_devices, get_smart_device_status, control_smart_device, set_smart_scene, search_spotify, play_spotify_music, execute_visual_task, get_active_window, forget_fact, get_cpu_info, get_gpu_info, get_ram_usage, get_disk_usage, get_battery_health, get_network_info, get_active_processes, get_startup_programs, get_windows_services, get_installed_applications, get_windows_event_logs, get_system_uptime, get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes, report_progress, create_temporary_plan, create_goal, list_goals, toggle_goal, run_aura_diagnostics
from permissions import confirm_pending_action, reject_pending_action, evaluate_permission
from config import OLLAMA_MODEL, chat_options, OLLAMA_KEEP_ALIVE
from memory import load_memory, save_memory
import json

logging.basicConfig(
    filename='aura_agent.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

available_tools = [get_system_time, get_system_info, open_application, close_application, web_search, list_directory, read_file, read_clipboard, control_media, control_system_power, read_screen, run_threat_scan, manage_schedule, scan_home_network, sync_archive, remember_fact, recall_fact, search_memory, discover_smart_devices, get_smart_device_status, control_smart_device, set_smart_scene, search_spotify, play_spotify_music, execute_visual_task, get_active_window, forget_fact, get_cpu_info, get_gpu_info, get_ram_usage, get_disk_usage, get_battery_health, get_network_info, get_active_processes, get_startup_programs, get_windows_services, get_installed_applications, get_windows_event_logs, get_system_uptime, get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes, report_progress, create_temporary_plan, create_goal, list_goals, toggle_goal, confirm_pending_action, reject_pending_action, run_aura_diagnostics]
tool_map = {tool.__name__: tool for tool in available_tools}

# Intent Router Mapping
TOOL_CATEGORIES = {
    "CHAT": [],
    "VISION": [read_screen],
    "SYSTEM": [get_system_time, get_system_info, open_application, close_application, control_media, control_system_power, manage_schedule, sync_archive, confirm_pending_action, reject_pending_action, get_cpu_info, get_gpu_info, get_ram_usage, get_disk_usage, get_battery_health, get_network_info, get_active_processes, get_startup_programs, get_windows_services, get_installed_applications, get_windows_event_logs, get_system_uptime, run_aura_diagnostics],
    "COMPUTER_CONTROL": [open_application, close_application, read_clipboard, execute_visual_task, get_active_window],
    "FILE": [list_directory, read_file, sync_archive],
    "WEB_RESEARCH": [web_search],
    "MEMORY": [remember_fact, recall_fact, search_memory, forget_fact],
    "SMART_HOME": [discover_smart_devices, get_smart_device_status, control_smart_device, set_smart_scene, search_spotify, play_spotify_music],
    "SECURITY": [run_threat_scan, scan_home_network, get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes],
    "PLANNER": [report_progress, create_temporary_plan, create_goal, list_goals, toggle_goal],
    "VOICE": []
}

def analyze_intent(user_input: str) -> dict:
    # The router costs a full LLM pass (30s+ on 4 GB VRAM). Allow opting out
    # via .env; the agent then falls back to the full toolset per message.
    import os
    if os.environ.get("AURA_INTENT_ROUTER", "on").strip().lower() in ("off", "false", "0"):
        return {"categories": [], "is_simple": False, "is_dangerous": False,
                "requires_plan": False, "active_skill": None}

    from skill_registry import registry
    skill_desc = registry.get_all_skill_descriptions()
    router_prompt = f"""
You are the AURA intent router. Classify the user's intent into one or more of the following categories:
CHAT, VISION, SYSTEM, COMPUTER_CONTROL, FILE, WEB_RESEARCH, MEMORY, SMART_HOME, SECURITY, PLANNER, VOICE.

Determine if the request is 'is_simple' (e.g. general knowledge, greetings, single commands) and if it is 'is_dangerous' (e.g. deleting files, formatting drives, terminating essential processes, risky system changes). Also determine 'requires_plan' for multi-step tasks.

Additionally, select the most relevant skill for the task from the following list (or null if none apply):
{skill_desc}

Return ONLY a valid JSON object matching this schema:
{{
  "categories": ["CATEGORY_NAME"],
  "is_simple": true,
  "is_dangerous": false,
  "requires_plan": false,
  "active_skill": "skill_name"
}}
"""
    router_fallback = {"categories": ["CHAT", "SYSTEM", "COMPUTER_CONTROL", "FILE", "WEB_RESEARCH", "MEMORY", "SMART_HOME", "SECURITY"], "is_simple": False, "is_dangerous": False, "requires_plan": False, "active_skill": None}
    for attempt in range(2):
        try:
            response = ollama.chat(
                model=OLLAMA_MODEL,
                messages=[
                    {'role': 'system', 'content': router_prompt},
                    {'role': 'user', 'content': user_input}
                ],
                format="json",
                options=chat_options(num_predict=128 if attempt == 0 else 512),
                keep_alive=OLLAMA_KEEP_ALIVE
            )
            content = response['message']['content'].strip()
            # Small models occasionally wrap JSON in code fences or prose; peel it off.
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()
            if not content:
                raise ValueError("model returned empty content")
            start, end = content.find('{'), content.rfind('}')
            if start != -1 and end > start:
                content = content[start:end + 1]
            return json.loads(content)
        except Exception as e:
            logging.warning(f"Router attempt {attempt + 1} failed: {e}")
    logging.error("Router failed after retry; using permissive fallback.")
    return router_fallback


system_instruction = """
You are AURA, a highly intelligent, sophisticated, and extremely helpful AI assistant designed to interact with the user to manage their PC environment and perform complex tasks. You are powered by the Gemma 4 model running locally via Ollama.

**Core Identity:**
- Your name is **AURA** (Autonomous Utility & Response Agent).
- You run on the **Gemma 4** large language model, served locally through **Ollama**.
- If asked what model you are, what you run on, or your name, always answer accurately with the above information.

**Core Personality & Tone:**
1. **Tone:** Formal, polite, professional, yet friendly and adaptive.
2. **Demeanor:** Always respond clearly and concisely. Use advanced vocabulary when appropriate but remain easy to understand.
3. **Goal:** Your primary goal is to execute the user's commands accurately and efficiently by interfacing with available tools.

**Computer Control Agent Paradigm (CRITICAL):**
You ARE fully capable of interacting directly with the graphical user interface. You have a powerful tool called `execute_visual_task` which spins up a closed-loop visual agent powered by Qwen3-VL.
When asked to perform a computer task (e.g., "Open Chrome and search for X", "Delete this file"):
1. **Delegate**: Pass the high-level goal to `execute_visual_task("Your goal here")`. Do NOT try to manage individual clicks or keystrokes yourself.
2. **Destructive Actions**: If the goal involves deleting, formatting, or resetting, you must set `require_confirmation=True` or explicitly ask the user for confirmation BEFORE calling the tool.
3. **Wait**: The visual agent will autonomously run its own Observe -> Plan -> Act -> Verify loop and return the final success or failure state.

**Safety & Destructive Actions Blacklist:**
1. **Never perform destructive actions without confirmation.**
2. You MUST ask the user for explicit conversational confirmation before:
   - Deleting files or folders
   - Formatting drives
   - Shutting down or restarting the computer
   - Sending emails or messages
   - Purchasing items or submitting payments
   - Changing critical security settings
   - Executing dangerous terminal commands

**Tool Usage Rules:**
- **Only** use tools when you actually need to fetch real-time data or perform a system action. For casual conversation, **do not** use tools. Just answer directly.
- **Never Hallucinate Tool Results:** You must actually invoke a tool. Do not invent a tool result without seeing the `tool` response.

**Agentic Planner:**
Instead of immediately executing tools, determine whether a task requires multiple steps:
1. **Simple Tasks** (e.g., "What is my CPU temp?"): Skip planning. Call the appropriate tool directly.
2. **Complex Tasks** (e.g., "Prepare my laptop for gaming", "Troubleshoot network"):
   - First, call `create_temporary_plan(steps=[...])` to register your multi-step plan.
   - Use `report_progress("Message")` right before executing each major step so the user knows what you are doing (e.g., "Checking CPU usage...").
   - Execute the corresponding tool for that step.
   - Verify the tool result. If it fails, retry intelligently.
   - Continue until the ultimate goal is achieved, then provide the final verbal response.
   - **Never fabricate** completed actions.

**Windows System Diagnostics:**
When the user asks about system performance, slowness, or hardware (e.g. "Why is my laptop slow?", "What is my GPU?"):
1. Gather the necessary data using tools like `get_cpu_info`, `get_gpu_info`, `get_ram_usage`, `get_active_processes`, etc.
2. Analyze the retrieved information locally.
3. Formulate a diagnostic summary and identify any clear bottlenecks or issues.
4. Keep all diagnostics local. Do not make system changes unless explicitly asked.

**Local Security Center:**
When the user asks to run a security sweep, check for threats, or monitor security:
1. Use the new security tools (`get_windows_defender_status`, `get_firewall_status`, `get_listening_ports`, `get_suspicious_files`, `analyze_suspicious_processes`, etc.) to gather data.
2. Formulate a simple, easy-to-understand response about the findings (e.g. "I found a process using unusually high CPU. I can investigate it further.").
3. **NEVER** automatically terminate processes, delete files, modify firewall rules, or disable security software. Require explicit user confirmation for any destructive or security-sensitive actions.

**Smart Home Automation:**
1. Use `discover_smart_devices` if you need to know what devices exist.
2. If asked to set a scene (e.g. "Movie mode", "Gaming mode"), use `set_smart_scene`.
3. If a smart device is unreachable or fails, you MUST report this failure to the user clearly. Do not pretend the action succeeded if the tool returns an error.

Begin by waiting for the initial command from the user. Do not offer unsolicited advice unless specifically asked.
"""

class AuraAgent:
    def __init__(self):
        self.messages = load_memory()
        self.ai_telemetry = {
            "model_latency": 0.0,
            "tokens_per_sec": 0.0,
            "prompt_tokens": 0,
            "response_tokens": 0,
            "tool_latency": 0.0,
            "vision_latency": 0.0,
            "total_task_time": 0.0
        }
        if not self.messages:
            self.messages = [
                {'role': 'system', 'content': system_instruction}
            ]
        # Tracks a request we refused as dangerous so the user's next
        # conversational "yes" can let it through instead of being
        # re-classified dangerous forever (confirmation deadlock).
        self._pending_danger = None  # (timestamp, original_input)
        
    def send_message(self, user_input: str, images: list = None, file_texts: list = None) -> str:
        """Sends a message to the agent and returns its text response."""
        task_start_time = time.time()
        self.ai_telemetry["tool_latency"] = 0.0
        self.ai_telemetry["vision_latency"] = 0.0
        
        logging.info("--- New User Request ---")
        logging.info(f"User Input: {user_input[:200]}{'...' if len(user_input) > 200 else ''}")
        
        original_user_input = user_input
        
        # --- INTENT ROUTING ---
        intent = analyze_intent(user_input)
        categories = intent.get('categories', [])
        is_simple = intent.get('is_simple', False)
        is_dangerous = intent.get('is_dangerous', False)
        requires_plan = intent.get('requires_plan', False)
        active_skill = intent.get('active_skill')
        
        logging.info(f"[SUBSYSTEM_ROUTING] Active Categories: {categories} | Plan: {requires_plan} | Dangerous: {is_dangerous} | Skill: {active_skill}")

        if is_dangerous:
            # If this input is an explicit confirmation of the request we just
            # warned about, let it proceed (tools remain individually gated by
            # evaluate_permission, so CRITICAL tools still queue for approval).
            pending = self._pending_danger
            confirmed = (
                pending is not None
                and (time.time() - pending[0]) < 300
                and re.fullmatch(
                    r"(yes|y|yes please|yep|yeah|sure|ok|okay|proceed|go ahead|"
                    r"do it|i confirm|confirm|confirmed|i am sure|i'm sure)[!.]?",
                    user_input.strip().lower()
                )
            )
            if not confirmed:
                self._pending_danger = (time.time(), original_user_input)
                warning = "WARNING: The action you requested is classified as potentially dangerous or destructive. Please re-confirm explicitly that you want to proceed."
                # Keep conversation history consistent even when we bail out early
                self.messages.append({'role': 'user', 'content': original_user_input})
                self.messages.append({'role': 'assistant', 'content': warning})
                save_memory(self.messages)
                return warning
            # Confirmation accepted; clear it so a later "yes" can't approve something new.
            self._pending_danger = None

        active_tools = []
        for cat in categories:
            if cat in TOOL_CATEGORIES:
                active_tools.extend(TOOL_CATEGORIES[cat])
                
        if requires_plan:
            active_tools.extend(TOOL_CATEGORIES.get("PLANNER", []))
            
        # Add required tools from active skill
        skill_data = None
        if active_skill:
            from skill_registry import registry
            skill_data = registry.get_skill(active_skill)
            if skill_data:
                req_tools = skill_data.get('required_tools', [])
                for t in available_tools:
                    if t.__name__ in req_tools and t not in active_tools:
                        active_tools.append(t)
                        
        # Deduplicate tools
        active_tools = list({t.__name__: t for t in active_tools}.values())
        
        # If no tools matched or it's a fallback, provide a default set
        if not active_tools and not is_simple:
             active_tools = available_tools
        # --- END INTENT ROUTING ---
        
        if skill_data:
            skill_ctx = f"[System Context - Active Skill: {skill_data['name']}]\n"
            skill_ctx += f"Instructions: {skill_data.get('instructions', '')}\n"
            skill_ctx += f"Safety Rules: {skill_data.get('safety_rules', '')}\n"
            if skill_data.get('workflows'):
                skill_ctx += f"Workflows: {json.dumps(skill_data.get('workflows'))}\n"
            user_input = skill_ctx + "\nUser Request:\n" + user_input
        
        from tools.memory_tools import search_relevant_memories, extract_and_store_memory
        relevant_mems = search_relevant_memories(original_user_input)
        if relevant_mems:
            user_input = f"[System Context - Relevant Memories:\n{relevant_mems}]\n\nUser Request:\n{user_input}"
        
        if file_texts:
            file_context = "I have uploaded the following files for you to read:\n\n"
            for f in file_texts:
                filename = f.get('name', 'Unknown')
                content = f.get('content', '')
                file_context += f"--- START OF {filename} ---\n{content}\n--- END OF {filename} ---\n\n"
            user_input = file_context + "My request:\n" + user_input

        msg = {'role': 'user', 'content': user_input}
        if images:
            from vision import analyze_vision_payload
            vision_summaries = []
            for i, img in enumerate(images):
                logging.info(f"Analyzing uploaded image {i+1} via internal vision pipeline...")
                v_start = time.time()
                summary = analyze_vision_payload(img, user_prompt=user_input)
                self.ai_telemetry["vision_latency"] += (time.time() - v_start)
                vision_summaries.append(f"--- Vision Analysis of Image {i+1} ---\n{summary}\n")
            
            vision_context = "\n".join(vision_summaries)
            user_input = f"[SYSTEM: The user uploaded images. The internal vision pipeline analyzed them and extracted the following structured data:]\n{vision_context}\n\nUser Request:\n{user_input}"
            msg['content'] = user_input
            logging.info(f"Injected structured vision context into prompt.")
            # We do NOT pass the raw base64 to Gemma 4 E2B to prevent text-model hallucination.

        self.messages.append(msg)
        
        MAX_TOOL_ITERATIONS = 12  # Safety cap so a looping model can't run tools forever
        tool_iterations = 0
        while True:
            tool_iterations += 1
            if tool_iterations > MAX_TOOL_ITERATIONS:
                logging.warning(f"Tool loop exceeded {MAX_TOOL_ITERATIONS} iterations; forcing stop.")
                msg_dict = {
                    'role': 'assistant',
                    'content': "I was unable to complete this task within the allowed number of tool operations, so I have stopped to avoid looping. Please check the last result or rephrase the task."
                }
                self.messages.append(msg_dict)
                break
            
            logging.info(f"Sending request to model with {len(self.messages)} messages in context.")
            try:
                m_start = time.time()
                response = ollama.chat(
                    model=OLLAMA_MODEL,
                    messages=self.messages,
                    tools=active_tools if active_tools else None,
                    options=chat_options(),
                    keep_alive=OLLAMA_KEEP_ALIVE
                )
                m_end = time.time()
                
                # Update model telemetry
                self.ai_telemetry["model_latency"] = m_end - m_start
                self.ai_telemetry["prompt_tokens"] = response.get('prompt_eval_count', 0)
                eval_count = response.get('eval_count', 0)
                self.ai_telemetry["response_tokens"] = eval_count
                eval_dur_ns = response.get('eval_duration', 0)
                if eval_dur_ns > 0:
                    self.ai_telemetry["tokens_per_sec"] = eval_count / (eval_dur_ns / 1e9)
                
            except Exception as e:
                logging.error(f"Error calling Ollama API: {e}")
                msg_dict = {
                    'role': 'assistant',
                    'content': f"I'm sorry, I encountered an internal connection error while processing your request: {e}"
                }
                self.messages.append(msg_dict)
                break
            
            message = response['message']
            
            # Convert Ollama Message object to a native dictionary for JSON serialization
            msg_dict = {
                'role': message.get('role', 'assistant'),
                'content': message.get('content') or ''
            }
            
            # If the model completely blanks out and calls no tools, retry without tools
            if not msg_dict.get('content') and not message.get('tool_calls'):
                logging.warning("Model returned empty response with no tools. Retrying without tools to prevent silence.")
                try:
                    retry_response = ollama.chat(
                        model=OLLAMA_MODEL,
                        messages=self.messages,
                        options=chat_options(),
                        keep_alive=OLLAMA_KEEP_ALIVE
                        # Intentionally omitting tools=available_tools
                    )
                    message = retry_response['message']
                    msg_dict = {
                        'role': message.get('role', 'assistant'),
                        'content': message.get('content') or ''
                    }
                except Exception as e:
                    logging.error(f"Error on retry: {e}")
            if message.get('tool_calls'):
                msg_dict['tool_calls'] = [
                    {
                        'function': {
                            'name': tc.function.name if hasattr(tc, 'function') else tc['function']['name'],
                            'arguments': tc.function.arguments if hasattr(tc, 'function') else tc['function']['arguments']
                        }
                    } for tc in message.get('tool_calls')
                ]
            
            self.messages.append(msg_dict)
            
            if not msg_dict.get('tool_calls'):
                # No tool calls, break and return the text response
                logging.info(f"Model responded directly (no tools). Response length: {len(msg_dict.get('content', ''))}")
                break
                
            # Process tool calls sequentially
            logging.info(f"Model requested {len(msg_dict['tool_calls'])} tool calls.")
            for tool_call in msg_dict['tool_calls']:
                tool_name = tool_call['function']['name']
                arguments = tool_call['function']['arguments']
                logging.info(f"Executing tool '{tool_name}' with args: {arguments}")
                
                if tool_name in tool_map:
                    try:
                        # Check permissions
                        status = evaluate_permission(tool_name, arguments)
                        
                        if status == "APPROVED":
                            # Call the python function
                            t_start = time.time()
                            result = str(tool_map[tool_name](**arguments))
                            self.ai_telemetry["tool_latency"] += (time.time() - t_start)
                            # Optional truncation for extremely large text (like screen reading)
                            if len(result) > 4000:
                                result = result[:4000] + "\n...[TRUNCATED FOR LENGTH]..."
                        else:
                            # It's an action ID, meaning PENDING
                            result = f"Tool '{tool_name}' blocked. Requires explicit user confirmation. Action ID: {status}. Tell the user you need authorization to proceed. They can click AUTHORIZE in the HUD, or simply reply 'Yes' in chat."
                            
                        logging.info(f"Tool '{tool_name}' succeeded. Result length: {len(result)}")
                        self.messages.append({
                            'role': 'tool',
                            'name': tool_name,
                            'content': result
                        })
                    except Exception as e:
                        logging.error(f"Tool '{tool_name}' failed with error: {e}")
                        self.messages.append({
                            'role': 'tool',
                            'name': tool_name,
                            'content': f"Error executing {tool_name}: {str(e)}"
                        })
                else:
                    logging.error(f"Tool '{tool_name}' not found.")
                    self.messages.append({
                        'role': 'tool',
                        'name': tool_name,
                        'content': f"Tool {tool_name} not found."
                    })
                    
        # Remove massive image base64 strings from historical messages to prevent context length errors
        for m in self.messages:
            if 'images' in m:
                del m['images']
                
        save_memory(self.messages)
        self.ai_telemetry["total_task_time"] = time.time() - task_start_time
        final_content = msg_dict.get('content', '').strip()
        
        # Fallback for empty responses
        if not final_content:
            last_tool = None
            for m in reversed(self.messages):
                if m['role'] == 'user': break
                if m['role'] == 'tool':
                    last_tool = m['content']
                    break
                    
            if last_tool:
                final_content = f"I've executed the tool. Here is the raw output:\n{last_tool[:800]}..."
            else:
                final_content = "I have processed your request but generated no verbal response."
                
        logging.info(f"Returning final content to user (Length: {len(final_content)})")
        
        if final_content and (len(original_user_input) + len(final_content)) > 80:
            # Skip the background memory-extraction LLM call for trivial
            # exchanges ("hi"/"thanks") - on 4 GB VRAM every extra generation
            # competes with the user's next request.
            threading.Thread(target=extract_and_store_memory, args=(original_user_input, final_content), daemon=True).start()
            
        return final_content
        
def create_agent():
    return AuraAgent()
