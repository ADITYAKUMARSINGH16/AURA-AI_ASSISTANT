import ollama
from tools import get_system_time, get_system_info, open_application, close_application, web_search, list_directory, read_file, read_clipboard, control_media, control_system_power, read_screen, run_threat_scan, manage_schedule, scan_home_network, sync_archive, remember_fact, recall_fact, search_memory, control_smart_lights, control_smart_plug, search_spotify, play_spotify_music
from config import OLLAMA_MODEL
from memory import load_memory, save_memory

available_tools = [get_system_time, get_system_info, open_application, close_application, web_search, list_directory, read_file, read_clipboard, control_media, control_system_power, read_screen, run_threat_scan, manage_schedule, scan_home_network, sync_archive, remember_fact, recall_fact, search_memory, control_smart_lights, control_smart_plug, search_spotify, play_spotify_music]
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

**Core Capabilities & Rules:**
1. **PC Control:** You have access to a set of external tools (APIs) that allow you to control the operating system, launch applications, manage files, check system information, and adjust settings.
2. **Context Awareness:** Always maintain context from previous interactions. If a user asks for a follow-up question, use the previous conversation history to answer appropriately.
3. **Long-Term Memory:** You have persistent memory tools (`remember_fact`, `recall_fact`, `search_memory`). If the user tells you a fact about themselves, a preference, or asks you to remember something, you MUST use `remember_fact` to store it permanently. If you need to recall past knowledge, use `search_memory`.
4. **Smart Home Integration:** You have access to smart home tools (`control_smart_lights`, `control_smart_plug`). If the user asks you to control physical lights, fans, or appliances, use these tools to simulate network commands to their home devices.
5. **Spotify & Music:** You can search and play music on Spotify using the `search_spotify` tool. You can also toggle playback using `play_spotify_music`.
6. **Tool Use:** You must *only* use the provided tools when an action requires external system interaction (e.g., opening a file, checking the time). If the request is purely conversational or philosophical, respond naturally without invoking tools unnecessarily.
7. **Error Handling:** If you cannot perform a requested action because the necessary tool is missing or permission is denied, inform the user clearly and politely about the limitation instead of guessing.

**Example Interaction Style:**
*   **User:** "AURA, what is the current time?"
*   **AURA (Internal Process):** Recognize request for system time -> Invoke `get_system_time` tool.
*   **AURA (Output):** "The current time is [Current Time]."

Begin by waiting for the initial command from the user. Do not offer unsolicited advice unless specifically asked.
"""

class JarvisAgent:
    def __init__(self):
        self.messages = load_memory()
        if not self.messages:
            self.messages = [
                {'role': 'system', 'content': system_instruction}
            ]
        
    def send_message(self, user_input: str) -> str:
        self.messages.append({'role': 'user', 'content': user_input})
        
        while True:
            response = ollama.chat(
                model=OLLAMA_MODEL,
                messages=self.messages,
                tools=available_tools
            )
            
            message = response['message']
            
            # Convert Ollama Message object to a native dictionary for JSON serialization
            msg_dict = {
                'role': message.get('role'),
                'content': message.get('content') or ''
            }
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
                break
                
            # Process tool calls sequentially
            for tool_call in msg_dict['tool_calls']:
                tool_name = tool_call['function']['name']
                arguments = tool_call['function']['arguments']
                
                if tool_name in tool_map:
                    try:
                        # Call the python function
                        result = tool_map[tool_name](**arguments)
                        self.messages.append({
                            'role': 'tool',
                            'name': tool_name,
                            'content': str(result)
                        })
                    except Exception as e:
                        self.messages.append({
                            'role': 'tool',
                            'name': tool_name,
                            'content': f"Error executing {tool_name}: {str(e)}"
                        })
                else:
                    self.messages.append({
                        'role': 'tool',
                        'name': tool_name,
                        'content': f"Tool {tool_name} not found."
                    })
                    
        self.messages = save_memory(self.messages)
        return msg_dict.get('content', '')
        
def create_agent():
    return JarvisAgent()
