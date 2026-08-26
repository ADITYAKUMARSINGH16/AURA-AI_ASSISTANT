import json
import uuid
import datetime
import logging
import threading
from pathlib import Path

from config import project_path

# Anchor to the project root (tools/../) so the path never depends on CWD.
LTM_FILE = Path(project_path("ltm_db.json"))

# Serializes every read-modify-write of ltm_db.json. Without it, background
# memory extraction, explicit remember/forget calls and HUD deletions can
# interleave load->save cycles and silently drop each other's writes.
_LTM_LOCK = threading.RLock()

def _load_ltm():
    db = {"semantic": [], "episodic": [], "procedural": []}

    if LTM_FILE.exists():
        try:
            db.update(json.loads(LTM_FILE.read_text(encoding='utf-8')))
        except Exception as e:
            logging.error(f"Failed to load memory DB: {e}")

    return db

def _save_ltm(data):
    try:
        LTM_FILE.write_text(json.dumps(data, indent=4), encoding='utf-8')
    except Exception as e:
        logging.error(f"Error saving LTM: {e}")

def _calculate_recency_bonus(timestamp_str):
    try:
        mem_time = datetime.datetime.fromisoformat(timestamp_str)
        days_old = (datetime.datetime.now() - mem_time).days
        if days_old == 0: return 2.0
        if days_old < 7: return 1.0
        if days_old < 30: return 0.5
    except:
        pass
    return 0.0

def search_relevant_memories(query: str, top_k_per_layer: int = 2) -> str:
    """Internal function to search memories across all 3 layers and return formatted context."""
    db = _load_ltm()
    query_words = set(query.lower().split())
    
    context_blocks = []
    
    for layer in ["semantic", "episodic", "procedural"]:
        scored_memories = []
        for mem in db.get(layer, []):
            content_words = set(mem.get('content', '').lower().split())
            overlap = len(query_words.intersection(content_words))
            if overlap > 0:
                recency = _calculate_recency_bonus(mem.get('timestamp', ''))
                score = overlap + (mem.get('importance', 5) * 0.2) + recency
                scored_memories.append((score, mem))
                
        scored_memories.sort(key=lambda x: x[0], reverse=True)
        if scored_memories:
            layer_context = f"[{layer.capitalize()} Context]\n"
            for score, mem in scored_memories[:top_k_per_layer]:
                layer_context += f"- {mem.get('content')}\n"
            context_blocks.append(layer_context)
            
    if not context_blocks:
        return ""
        
    return "\n".join(context_blocks)

def extract_and_store_memory(user_msg: str, agent_msg: str):
    """Background task to extract layered memory from the conversation."""
    import ollama
    from config import OLLAMA_MODEL
    
    prompt = f"""Analyze this exchange and extract information worth remembering for months.
Classify the information into one of three layers:
1. "semantic": Facts, preferences, user devices, project details.
2. "episodic": Important past interactions, completed tasks, significant events.
3. "procedural": Learned workflows, reusable task procedures, user-defined routines.

Ignore casual chit-chat.
User: {user_msg}
AURA: {agent_msg}

Output ONLY a JSON list of objects in this exact format:
[
  {{
    "layer": "semantic", 
    "category": "preferences",
    "content": "Self-contained fact or event description",
    "importance": 1-10
  }}
]
If nothing is worth remembering, output []."""

    try:
        res = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{'role': 'user', 'content': prompt}],
            options={"num_ctx": 4096, "num_predict": 512}
        )
        content = res['message']['content'].strip()

        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()

        start, end = content.find('['), content.rfind(']')
        if start != -1 and end > start:
            content = content[start:end + 1]
        else:
            # Output was likely truncated mid-object; drop the partial tail
            # entry so the remaining complete objects still parse.
            start = content.find('[')
            if start != -1:
                last_complete = content.rfind('}')
                if last_complete > start:
                    content = content[start:last_complete + 1] + ']'

        try:
            new_facts = json.loads(content)
        except json.JSONDecodeError as e:
            logging.warning(f"Memory extraction skipped: model output was not valid JSON ({e})")
            return
        if not new_facts:
            return

        with _LTM_LOCK:
            db = _load_ltm()

            for fact in new_facts:
                layer = fact.get('layer', 'semantic').lower()
                if layer not in db: layer = 'semantic'

                fact_words = set(fact['content'].lower().split())
                is_dup = False

                # Duplicate detection within the layer
                for mem in db[layer]:
                    mem_words = set(mem.get('content', '').lower().split())
                    overlap = len(fact_words.intersection(mem_words))
                    union = len(fact_words.union(mem_words))
                    if union > 0 and (overlap / union) > 0.6: # 60% overlap threshold
                        mem['content'] = fact['content']
                        mem['importance'] = fact.get('importance', 5)
                        mem['timestamp'] = datetime.datetime.now().isoformat()
                        mem['source_context'] = f"Updated via: {user_msg[:50]}..."
                        is_dup = True
                        break

                if not is_dup:
                    fact['id'] = str(uuid.uuid4())
                    fact['timestamp'] = datetime.datetime.now().isoformat()
                    fact['source_context'] = f"Extracted from: {user_msg[:50]}..."
                    db[layer].append(fact)

            _save_ltm(db)

    except Exception as e:
        logging.error(f"Background memory extraction failed: {e}")

def forget_memory(query_or_id: str) -> str:
    """Deletes a memory matching the provided ID or exact content from any layer.
    Substring matching is only allowed for queries long enough (>= 6 chars) to be
    specific, so a short/common word cannot wipe out half the database."""
    target = query_or_id.strip()
    deleted = []
    with _LTM_LOCK:
        db = _load_ltm()

        for layer in ["semantic", "episodic", "procedural"]:
            kept = []
            for mem in db[layer]:
                content = mem.get('content', '')
                is_match = (
                    mem.get('id') == query_or_id
                    or content.lower() == target.lower()
                    or (len(target) >= 6 and target.lower() in content.lower())
                )
                if is_match:
                    deleted.append(f"[{layer}] {content}")
                else:
                    kept.append(mem)
            db[layer] = kept

        if deleted:
            _save_ltm(db)

    if deleted:
        return f"Successfully deleted {len(deleted)} memory/memories:\n- " + "\n- ".join(deleted[:10])
    return "No matching memory found to delete."

def remember_fact(key_or_content: str, value: str = "", layer: str = "semantic", category: str = "general") -> str:
    """Saves a fact, event, or workflow to long-term memory. Layer must be semantic, episodic, or procedural."""
    db = _load_ltm()
    layer = layer.lower()
    if layer not in ["semantic", "episodic", "procedural"]:
        layer = "semantic"
        
    content = f"{key_or_content}: {value}" if value else key_or_content

    with _LTM_LOCK:
        db = _load_ltm()
        db[layer].append({
            "id": str(uuid.uuid4()),
            "layer": layer,
            "category": category,
            "content": content,
            "importance": 8,
            "timestamp": datetime.datetime.now().isoformat(),
            "source_context": "Explicitly requested by user tool call."
        })
        _save_ltm(db)
    return f"Successfully committed to {layer.capitalize()} memory: '{content}'"

def search_memory(query: str) -> str:
    """Searches long-term memory (across all layers) for any memories containing the query."""
    db = _load_ltm()
    query = query.lower()
    
    results = []
    for layer in ["semantic", "episodic", "procedural"]:
        for mem in db.get(layer, []):
            if query in mem.get('content', '').lower():
                results.append(f"[{layer.upper()}] {mem['content']}")
                
    if not results:
        return f"No memories found matching '{query}'"
    return "Found matching memories:\n- " + "\n- ".join(results)

# Aliases for backwards compatibility with old agent/skills
def forget_fact(memory_id_or_content: str) -> str:
    """Alias for forget_memory"""
    return forget_memory(memory_id_or_content)

def recall_fact(key: str) -> str:
    """Alias for search_memory"""
    return search_memory(key)
