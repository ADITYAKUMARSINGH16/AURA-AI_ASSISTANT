import json
from pathlib import Path

from config import project_path

# Anchor to the project root so the path never depends on the server's CWD.
MEMORY_FILE = project_path("memory.json")
MAX_MESSAGES = 20
INTACT_MESSAGES = 6  # Keep the last 6 messages completely intact (including tools)

def load_memory():
    """Loads the conversation history from the JSON file."""
    mem_path = Path(MEMORY_FILE)
    if mem_path.exists():
        try:
            return json.loads(mem_path.read_text(encoding='utf-8'))
        except Exception as e:
            print(f"Warning: Could not load memory ({e}). Starting fresh.")
            return []
    return []

def save_memory(messages):
    """Trims the conversation history (in place) and saves it to JSON.
    Keeps only recent messages and strips old tool outputs to save tokens.
    Mutates the passed list so the caller's in-memory context stays bounded."""
    if len(messages) <= 1:
        return messages
        
    system_msg = messages[0]
    history_msgs = messages[1:]
    
    # 1. Strip tool_calls and tool messages from older history to save tokens
    if len(history_msgs) > INTACT_MESSAGES:
        old_msgs = history_msgs[:-INTACT_MESSAGES]
        recent_msgs = history_msgs[-INTACT_MESSAGES:]
        
        cleaned_old_msgs = []
        for msg in old_msgs:
            if msg.get('role') == 'tool':
                continue  # drop old tool outputs
                
            if msg.get('role') == 'assistant':
                new_msg = dict(msg)
                if 'tool_calls' in new_msg:
                    del new_msg['tool_calls']
                # If the assistant message only had tool calls and no content, drop it
                if not new_msg.get('content') or str(new_msg.get('content')).strip() == "":
                    continue
                cleaned_old_msgs.append(new_msg)
            else:
                cleaned_old_msgs.append(msg)
                
        history_msgs = cleaned_old_msgs + recent_msgs
        
    # 2. Enforce MAX_MESSAGES limit
    if len(history_msgs) > MAX_MESSAGES:
        history_msgs = history_msgs[-MAX_MESSAGES:]
        
    final_messages = [system_msg] + history_msgs
    
    # Mutate the original list in place so the agent's live context is trimmed too
    messages[:] = final_messages
    
    try:
        Path(MEMORY_FILE).write_text(json.dumps(final_messages, indent=4), encoding='utf-8')
    except Exception as e:
        print(f"Warning: Could not save memory ({e}).")
        
    return messages
