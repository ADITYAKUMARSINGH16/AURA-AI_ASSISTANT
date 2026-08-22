import json
import os

LTM_FILE = "long_term_memory.json"

def _load_ltm():
    if os.path.exists(LTM_FILE):
        try:
            with open(LTM_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Migration from dict to list
                if isinstance(data, dict):
                    migrated = []
                    import uuid
                    import datetime
                    for k, v in data.items():
                        migrated.append({
                            "id": str(uuid.uuid4()),
                            "category": "important information",
                            "content": f"{k}: {v}",
                            "importance": 5,
                            "timestamp": datetime.datetime.now().isoformat()
                        })
                    return migrated
                return data
        except Exception:
            return []
    return []

def _save_ltm(data):
    try:
        with open(LTM_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving LTM: {e}")

def search_relevant_memories(query: str, top_k: int = 3) -> str:
    """Internal function to search memories based on basic keyword overlap."""
    data = _load_ltm()
    if not data:
        return ""
    
    query_words = set(query.lower().split())
    scored_memories = []
    
    for mem in data:
        content_words = set(mem.get('content', '').lower().split())
        overlap = len(query_words.intersection(content_words))
        if overlap > 0:
            score = overlap + (mem.get('importance', 5) * 0.1)
            scored_memories.append((score, mem))
            
    scored_memories.sort(key=lambda x: x[0], reverse=True)
    
    if not scored_memories:
        return ""
        
    results = [mem['content'] for score, mem in scored_memories[:top_k]]
    return "\n".join(results)

def extract_and_store_memory(user_msg: str, agent_msg: str):
    """Background task to extract facts from the conversation using Ollama."""
    import ollama
    from config import OLLAMA_MODEL
    import uuid
    import datetime
    import logging
    
    prompt = f"""Analyze this exchange and extract any permanent facts, preferences, or important information about the user.
Ignore short-term context. Only extract things worth remembering for months.
User: {user_msg}
AURA: {agent_msg}

Output ONLY a JSON list of objects in this exact format:
[
  {{
    "category": "preferences|projects|devices|important information|recurring tasks",
    "content": "Self-contained fact (e.g. 'User has an RTX 3050 GPU')",
    "importance": 1-10
  }}
]
If nothing is worth remembering, output []."""

    try:
        res = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{'role': 'user', 'content': prompt}]
        )
        content = res['message']['content']
        
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
            
        new_facts = json.loads(content)
        if not new_facts:
            return
            
        data = _load_ltm()
        
        for fact in new_facts:
            fact_words = set(fact['content'].lower().split())
            is_dup = False
            for mem in data:
                mem_words = set(mem.get('content', '').lower().split())
                overlap = len(fact_words.intersection(mem_words))
                union = len(fact_words.union(mem_words))
                if union > 0 and (overlap / union) > 0.5:
                    mem['content'] = fact['content']
                    mem['importance'] = fact.get('importance', 5)
                    mem['timestamp'] = datetime.datetime.now().isoformat()
                    is_dup = True
                    break
                    
            if not is_dup:
                fact['id'] = str(uuid.uuid4())
                fact['timestamp'] = datetime.datetime.now().isoformat()
                data.append(fact)
                
        _save_ltm(data)
        
    except Exception as e:
        logging.error(f"Background memory extraction failed: {e}")

def forget_fact(memory_id_or_content: str) -> str:
    """Deletes a memory matching the provided ID or containing the exact content."""
    data = _load_ltm()
    initial_len = len(data)
    
    target = memory_id_or_content.lower()
    data = [mem for mem in data if mem.get('id') != memory_id_or_content and target not in mem.get('content', '').lower()]
    
    if len(data) < initial_len:
        _save_ltm(data)
        return f"Successfully deleted matching memory."
    return "No matching memory found to delete."

def remember_fact(key: str, value: str) -> str:
    """Saves a fact to long-term memory. Use this when explicitly told to remember something."""
    import uuid
    import datetime
    data = _load_ltm()
    data.append({
        "id": str(uuid.uuid4()),
        "category": "important information",
        "content": f"{key}: {value}",
        "importance": 8,
        "timestamp": datetime.datetime.now().isoformat()
    })
    _save_ltm(data)
    return f"Successfully committed to LTM: '{key}: {value}'"

def search_memory(query: str) -> str:
    """Searches long-term memory for any memories containing the query."""
    data = _load_ltm()
    query = query.lower()
    results = [mem['content'] for mem in data if query in mem.get('content', '').lower()]
    if not results:
        return f"No memories found matching '{query}'"
    return "Found matching memories:\n- " + "\n- ".join(results)

def recall_fact(key: str) -> str:
    """Recalls a specific fact from long-term memory."""
    return search_memory(key)
