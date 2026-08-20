import json
import os

LTM_FILE = "long_term_memory.json"

def _load_ltm():
    if os.path.exists(LTM_FILE):
        try:
            with open(LTM_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def _save_ltm(data):
    try:
        with open(LTM_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving LTM: {e}")

def remember_fact(key: str, value: str) -> str:
    """
    Saves a fact or piece of information to long-term memory permanently.
    Use this when the user tells you to remember something, or states a fact about themselves.
    """
    data = _load_ltm()
    data[key] = value
    _save_ltm(data)
    return f"Successfully committed to Long-Term Memory under key: '{key}'"

def recall_fact(key: str) -> str:
    """
    Recalls a specific fact from long-term memory using its exact key.
    """
    data = _load_ltm()
    if key in data:
        return f"Recalled Fact ({key}): {data[key]}"
    return f"Fact not found for key: '{key}'"

def search_memory(query: str) -> str:
    """
    Searches long-term memory for any keys or values containing the query.
    Use this when you don't know the exact key but need to find a remembered fact.
    """
    data = _load_ltm()
    query = query.lower()
    results = {}
    for k, v in data.items():
        if query in k.lower() or query in str(v).lower():
            results[k] = v
            
    if not results:
        return f"No memories found matching '{query}'"
        
    res_str = "Found matching memories:\n"
    for k, v in results.items():
        res_str += f"- {k}: {v}\n"
    return res_str
