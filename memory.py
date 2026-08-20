import json
import os

MEMORY_FILE = "memory.json"
MAX_MESSAGES = 20

def load_memory():
    """Loads the conversation history from the JSON file."""
    if os.path.exists(MEMORY_FILE):
        try:
            with open(MEMORY_FILE, 'r', encoding='utf-8') as f:
                messages = json.load(f)
                return messages
        except Exception as e:
            print(f"Warning: Could not load memory ({e}). Starting fresh.")
            return []
    return []

def save_memory(messages):
    """Saves the conversation history to the JSON file, keeping only recent messages."""
    # Ensure we don't exceed max messages to prevent token limits
    if len(messages) > MAX_MESSAGES + 1:
        # We assume messages[0] is the system instruction, which we must always keep
        system_msg = messages[0]
        # Keep the most recent messages
        recent_msgs = messages[-MAX_MESSAGES:]
        messages = [system_msg] + recent_msgs
        
    try:
        with open(MEMORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(messages, f, indent=4)
    except Exception as e:
        print(f"Warning: Could not save memory ({e}).")
        
    return messages
