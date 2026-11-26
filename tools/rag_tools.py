"""
AURA Desktop Semantic RAG (Retrieval-Augmented Generation) Tools
================================================================
Provides local vector-indexed search over desktop files, documents, and notes.
Uses SQLite for persistent storage with Ollama embedding integration and an
instant local fallback vectorizer.
"""

import os
import sys
import sqlite3
import json
import uuid
import datetime
import logging
import math
import re
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from config import project_path

RAG_DB_PATH = project_path("desktop_rag.db")
EMBEDDING_DIM = 384

# Supported extensions for local document parsing
TEXT_EXTENSIONS = {
    ".txt", ".md", ".py", ".json", ".csv", ".log",
    ".yaml", ".yml", ".ini", ".cfg", ".toml",
    ".js", ".ts", ".html", ".css", ".sql", ".sh", ".bat"
}


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(RAG_DB_PATH, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding BLOB NOT NULL,
            char_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_file_path ON documents(file_path);")
    return conn


_STOP_WORDS = {
    "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "with",
    "is", "was", "are", "were", "of", "by", "from", "that", "this", "it"
}

def _hash_token(token: str, dim: int) -> int:
    """Deterministic hash index across Python processes."""
    import hashlib
    digest = hashlib.md5(token.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % dim

def _local_fallback_embedding(text: str, dim: int = EMBEDDING_DIM) -> np.ndarray:
    """Deterministic, normalized pseudo-semantic feature vector for offline fallback.
    Uses token hashing, stopword filtering, and subword n-grams.
    """
    vec = np.zeros(dim, dtype=np.float32)
    all_tokens = re.findall(r"\w+", text.lower())
    tokens = [t for t in all_tokens if t not in _STOP_WORDS]
    if not tokens:
        tokens = all_tokens
    if not tokens:
        return vec

    for i, token in enumerate(tokens):
        idx = _hash_token(token, dim)
        weight = 1.0 / (1.0 + 0.1 * i)
        vec[idx] += weight

        # Subword 3-grams
        if len(token) >= 3:
            for j in range(len(token) - 2):
                tri = token[j:j + 3]
                idx_tri = _hash_token(tri, dim)
                vec[idx_tri] += 0.4 * weight

    norm = np.linalg.norm(vec)
    if norm > 1e-6:
        vec /= norm
    return vec


def _compute_embedding(text: str) -> np.ndarray:
    """Attempts to generate embeddings via Ollama; falls back to local vectorizer if offline."""
    clean_text = text.strip()[:2048]
    if not clean_text:
        return np.zeros(EMBEDDING_DIM, dtype=np.float32)

    try:
        import ollama
        from config import OLLAMA_MODEL
        # Check if Ollama has an embedding endpoint available
        res = ollama.embeddings(model=OLLAMA_MODEL, prompt=clean_text)
        if "embedding" in res and res["embedding"]:
            arr = np.array(res["embedding"], dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 1e-6:
                arr /= norm
            return arr
    except Exception as e:
        logging.debug(f"[RAG] Ollama embedding fallback used: {e}")

    return _local_fallback_embedding(clean_text)


def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[str]:
    """Splits text into overlapping sliding-window chunks along line/word boundaries."""
    if len(text) <= chunk_size:
        return [text.strip()] if text.strip() else []

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            # Try finding natural line break or space
            last_newline = text.rfind("\n", start + overlap, end)
            if last_newline != -1:
                end = last_newline + 1
            else:
                last_space = text.rfind(" ", start + overlap, end)
                if last_space != -1:
                    end = last_space + 1

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break
        start = max(start + 1, end - overlap)

    return chunks


def _read_file_content(path: str) -> Optional[str]:
    """Reads file content safely, handling encoding errors."""
    try:
        ext = os.path.splitext(path)[1].lower()
        if ext in TEXT_EXTENSIONS:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        elif ext == ".pdf":
            try:
                import pypdf
                reader = pypdf.PdfReader(path)
                pages = [page.extract_text() or "" for page in reader.pages]
                return "\n".join(pages)
            except Exception:
                return None
    except Exception as e:
        logging.warning(f"[RAG] Failed to read {path}: {e}")
    return None


def index_desktop_directory(directory_path: str, max_files: int = 40) -> Dict[str, Any]:
    """Scans and indexes files in a directory into the local semantic vector database.

    Args:
        directory_path: Absolute or relative directory path to index (e.g. 'C:/Users/.../Documents').
        max_files: Maximum number of eligible document files to index in this pass (default: 40).

    Returns:
        Dict summarizing indexed files, total chunks, and status.
    """
    norm_path = os.path.abspath(directory_path)
    if not os.path.exists(norm_path) or not os.path.isdir(norm_path):
        return {
            "status": "error",
            "message": f"Directory not found: '{directory_path}'",
            "indexed_files": 0,
            "total_chunks": 0
        }

    eligible_files = []
    for root, _, files in os.walk(norm_path):
        # Skip cache, git, venv, and binary build directories
        if any(ignored in root.lower() for ignored in [".git", ".venv", "__pycache__", "node_modules", "models"]):
            continue
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in TEXT_EXTENSIONS or ext == ".pdf":
                eligible_files.append(os.path.join(root, file))
                if len(eligible_files) >= max_files:
                    break
        if len(eligible_files) >= max_files:
            break

    if not eligible_files:
        return {
            "status": "warning",
            "message": f"No eligible document files found in '{directory_path}'.",
            "indexed_files": 0,
            "total_chunks": 0
        }

    conn = _get_db()
    indexed_count = 0
    total_chunks = 0
    now_iso = datetime.datetime.now().isoformat()

    try:
        with conn:
            for file_path in eligible_files:
                content = _read_file_content(file_path)
                if not content or not content.strip():
                    continue

                chunks = _chunk_text(content)
                if not chunks:
                    continue

                # Remove existing chunks for this file before re-indexing
                conn.execute("DELETE FROM documents WHERE file_path = ?", (file_path,))

                filename = os.path.basename(file_path)
                for idx, chunk in enumerate(chunks):
                    emb = _compute_embedding(chunk)
                    emb_bytes = emb.astype(np.float32).tobytes()
                    chunk_id = str(uuid.uuid4())
                    conn.execute("""
                        INSERT INTO documents (id, file_path, filename, chunk_index, content, embedding, char_count, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (chunk_id, file_path, filename, idx, chunk, emb_bytes, len(chunk), now_iso))
                    total_chunks += 1

                indexed_count += 1
    finally:
        conn.close()

    return {
        "status": "success",
        "message": f"Successfully indexed {indexed_count} files ({total_chunks} chunks) from '{directory_path}'.",
        "indexed_files": indexed_count,
        "total_chunks": total_chunks,
        "sample_files": [os.path.basename(p) for p in eligible_files[:5]]
    }


def query_desktop_knowledge(query: str, top_k: int = 5) -> Dict[str, Any]:
    """Performs semantic similarity search over the indexed desktop document chunks.

    Args:
        query: Search question, topic, or keyword phrase.
        top_k: Number of most relevant document excerpts to return (default: 5).

    Returns:
        Dict with status, match count, and list of relevant document matches with scores and snippets.
    """
    clean_query = query.strip()
    if not clean_query:
        return {"status": "error", "message": "Query cannot be empty.", "matches": []}

    conn = _get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, file_path, filename, chunk_index, content, embedding FROM documents")
        rows = cursor.fetchall()
        if not rows:
            return {
                "status": "empty",
                "message": "Desktop knowledge database is empty. Use index_desktop_directory() first.",
                "matches": []
            }

        q_vec = _compute_embedding(clean_query)
        q_norm = np.linalg.norm(q_vec)

        scored = []
        for doc_id, file_path, filename, chunk_idx, content, emb_bytes in rows:
            doc_vec = np.frombuffer(emb_bytes, dtype=np.float32)
            # Dot product for cosine similarity (both are L2 normalized)
            if q_norm > 1e-6 and len(doc_vec) == len(q_vec):
                sim = float(np.dot(q_vec, doc_vec))
            else:
                sim = 0.0

            # Lexical keyword boost if query terms appear directly in chunk
            overlap = sum(1 for term in clean_query.lower().split() if term in content.lower())
            final_score = sim + (0.15 * min(overlap, 4))

            scored.append({
                "id": doc_id,
                "file_path": file_path,
                "filename": filename,
                "chunk_index": chunk_idx,
                "content": content,
                "score": round(float(final_score), 4)
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        top_matches = scored[:top_k]

        return {
            "status": "success",
            "query": clean_query,
            "total_documents_searched": len(rows),
            "match_count": len(top_matches),
            "matches": top_matches
        }
    finally:
        conn.close()


def list_indexed_documents() -> Dict[str, Any]:
    """Lists all files currently indexed in the desktop semantic knowledge database."""
    conn = _get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT file_path, filename, COUNT(*) as chunks, SUM(char_count) as total_chars, MAX(created_at) as last_indexed
            FROM documents
            GROUP BY file_path, filename
            ORDER BY last_indexed DESC
        """)
        rows = cursor.fetchall()
        files = []
        for r in rows:
            files.append({
                "file_path": r[0],
                "filename": r[1],
                "chunks": r[2],
                "total_chars": r[3],
                "last_indexed": r[4]
            })
        return {
            "status": "success",
            "indexed_file_count": len(files),
            "files": files
        }
    finally:
        conn.close()


def clear_indexed_documents(path_prefix: Optional[str] = None) -> Dict[str, Any]:
    """Clears indexed documents from the semantic RAG database.

    Args:
        path_prefix: Optional directory path prefix to remove only matching files.
                     If omitted or None, clears all indexed documents.
    """
    conn = _get_db()
    try:
        with conn:
            if path_prefix:
                cur = conn.execute("DELETE FROM documents WHERE file_path LIKE ?", (f"{path_prefix}%",))
                deleted = cur.rowcount
                msg = f"Cleared {deleted} chunk(s) matching prefix '{path_prefix}'."
            else:
                cur = conn.execute("DELETE FROM documents")
                deleted = cur.rowcount
                msg = f"Cleared entire desktop knowledge database ({deleted} chunks removed)."
        return {"status": "success", "message": msg, "deleted_chunks": deleted}
    finally:
        conn.close()
