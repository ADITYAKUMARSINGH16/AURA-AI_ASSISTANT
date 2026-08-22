import ollama
import logging
import threading
from tools import get_system_time, get_system_info, open_application, close_application, web_search, list_directory, read_file, read_clipboard, control_media, control_system_power, read_screen, run_threat_scan, manage_schedule, scan_home_network, sync_archive, remember_fact, recall_fact, search_memory, discover_smart_devices, get_smart_device_status, control_smart_device, set_smart_scene, search_spotify, play_spotify_music, click_text, click_coordinates, type_text, press_key, scroll, get_active_window, forget_fact, get_cpu_info, get_gpu_info, get_ram_usage, get_disk_usage, get_battery_health, get_network_info, get_active_processes, get_startup_programs, get_windows_services, get_installed_applications, get_windows_event_logs, get_system_uptime, get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes, report_progress, create_temporary_plan
from config import OLLAMA_MODEL
from memory import load_memory, save_memory

logging.basicConfig(
    filename='aura_agent.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

available_tools = [get_system_time, get_system_info, open_application, close_application, web_search, list_directory, read_file, read_clipboard, control_media, control_system_power, read_screen, run_threat_scan, manage_schedule, scan_home_network, sync_archive, remember_fact, recall_fact, search_memory, discover_smart_devices, get_smart_device_status, control_smart_device, set_smart_scene, search_spotify, play_spotify_music, click_text, click_coordinates, type_text, press_key, scroll, get_active_window, forget_fact, get_cpu_info, get_gpu_info, get_ram_usage, get_disk_usage, get_battery_health, get_network_info, get_active_processes, get_startup_programs, get_windows_services, get_installed_applications, get_windows_event_logs, get_system_uptime, get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes, report_progress, create_temporary_plan]
tool_map = {tool.__name__: tool for tool in available_tools}

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
You ARE fully capable of interacting directly with the graphical user interface. You have tools to move the mouse, click text (`click_text`), type on the keyboard (`type_text`), press keys (`press_key`), scroll (`scroll`), and open applications (`open_application`). Do NOT ever claim you cannot interact with the GUI.
When asked to perform a computer task (e.g., "Open Chrome and search for X"):
1. **Plan & Act**: Determine the first logical step and execute it using a tool.
2. **Verify**: UI tools (like `click_text`, `type_text`, `open_application`) inherently return the new visual state of the screen or system. You MUST read this returned visual context to verify if your action succeeded before proceeding to the next step.
3. **Loop**: Continue observing the screen state, taking the next action, and verifying until the user's ultimate goal is fully achieved. 
4. **Intelligent Retry**: If the expected UI change did not occur, adapt and retry intelligently (e.g., wait longer, or use a different search text).
5. **Never Blindly Guess**: Use `click_text` to reliably click UI elements based on OCR. Avoid using `click_coordinates` unless absolutely necessary.

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
        if not self.messages:
            self.messages = [
                {'role': 'system', 'content': system_instruction}
            ]
        
    def send_message(self, user_input: str, images: list = None, file_texts: list = None) -> str:
        logging.info("--- New User Request ---")
        logging.info(f"User Input: {user_input[:200]}{'...' if len(user_input) > 200 else ''}")
        
        original_user_input = user_input
        
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
                summary = analyze_vision_payload(img, user_prompt=user_input)
                vision_summaries.append(f"--- Vision Analysis of Image {i+1} ---\n{summary}\n")
            
            vision_context = "\n".join(vision_summaries)
            user_input = f"[SYSTEM: The user uploaded images. The internal vision pipeline analyzed them and extracted the following structured data:]\n{vision_context}\n\nUser Request:\n{user_input}"
            msg['content'] = user_input
            logging.info(f"Injected structured vision context into prompt.")
            # We do NOT pass the raw base64 to Gemma 4 E2B to prevent text-model hallucination.

        self.messages.append(msg)
        
        while True:
            logging.info(f"Sending request to model with {len(self.messages)} messages in context.")
            try:
                response = ollama.chat(
                    model=OLLAMA_MODEL,
                    messages=self.messages,
                    tools=available_tools
                )
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
                        messages=self.messages
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
                        # Call the python function
                        result = str(tool_map[tool_name](**arguments))
                        
                        # Truncate massive strings to prevent context window overflow
                        if len(result) > 2000:
                            logging.warning(f"Tool '{tool_name}' output too large ({len(result)} chars), truncating.")
                            result = result[:2000] + "... [TRUNCATED DUE TO LENGTH]"
                            
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
                
        self.messages = save_memory(self.messages)
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
        
        if final_content:
            threading.Thread(target=extract_and_store_memory, args=(original_user_input, final_content), daemon=True).start()
            
        return final_content
        
def create_agent():
    return AuraAgent()
