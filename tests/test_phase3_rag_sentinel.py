"""
Comprehensive test suite for Phase 3: Semantic Memory & Ambient RAG.
Tests local SQLite vector indexing, document chunking, semantic similarity retrieval,
active application tracking, clipboard intelligence, and contextual suggestion synthesis.
"""

import os
import sys
import tempfile
import shutil
import json

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from fastapi.testclient import TestClient
from api import app
from agent import tool_map, available_tools, TOOL_CATEGORIES
from tools.rag_tools import (
    index_desktop_directory,
    query_desktop_knowledge,
    list_indexed_documents,
    clear_indexed_documents,
    _compute_embedding,
    _chunk_text
)
from tools.ambient_tools import get_ambient_context as tool_get_ambient
from backend.ambient_sentinel import (
    get_ambient_context as sentinel_get_ambient,
    _generate_suggestions,
    _get_clipboard_intel
)

client = TestClient(app, raise_server_exceptions=False)


def test_phase3_tool_registration():
    """Verify all Phase 3 tools are registered in agent tool_map and categories."""
    p3_tools = [
        "index_desktop_directory",
        "query_desktop_knowledge",
        "list_indexed_documents",
        "clear_indexed_documents",
        "get_ambient_context"
    ]
    for name in p3_tools:
        assert name in tool_map, f"Tool {name} missing from agent.tool_map"
        tool_fn = tool_map[name]
        assert callable(tool_fn), f"Tool {name} is not callable"
        assert tool_fn.__doc__, f"Tool {name} is missing a docstring"

    assert len(available_tools) == len(tool_map), "Mismatch between available_tools and tool_map"
    assert "query_desktop_knowledge" in [t.__name__ for t in TOOL_CATEGORIES["FILE"]]
    assert "get_ambient_context" in [t.__name__ for t in TOOL_CATEGORIES["SYSTEM"]]
    assert "get_ambient_context" in [t.__name__ for t in TOOL_CATEGORIES["COMPUTER_CONTROL"]]


def test_text_chunking():
    """Verify text chunking preserves content and handles overlaps properly."""
    sample = "Line 1: AURA initialization.\n" * 20
    chunks = _chunk_text(sample, chunk_size=150, overlap=30)
    assert len(chunks) > 1, f"Expected multiple chunks, got {len(chunks)}"
    for c in chunks:
        assert len(c) > 0


def test_embedding_generation():
    """Verify embedding generator returns normalized 384-dim float32 vectors."""
    vec1 = _compute_embedding("Quantum computing and neural network models")
    vec2 = _compute_embedding("Neural network models and quantum computing algorithms")
    vec3 = _compute_embedding("Cooking delicious chocolate chip cookies with butter and sugar")

    assert len(vec1) == 384
    assert len(vec2) == 384
    assert len(vec3) == 384

    # Both quantum/neural queries should be significantly more similar to each other than to baking cookies
    sim_ai = float(sum(a * b for a, b in zip(vec1, vec2)))
    sim_diff = float(sum(a * b for a, b in zip(vec1, vec3)))
    assert sim_ai > sim_diff, f"Expected sim_ai ({sim_ai}) > sim_diff ({sim_diff})"


def test_rag_end_to_end_indexing_and_search():
    """Verify end-to-end directory indexing, vector search, and clear operations."""
    temp_dir = tempfile.mkdtemp(prefix="aura_rag_test_")
    try:
        # Create test documents
        doc1_path = os.path.join(temp_dir, "meeting_notes.md")
        with open(doc1_path, "w", encoding="utf-8") as f:
            f.write("# Project Falcon Notes\nDeadline is December 15. The primary database will be PostgreSQL.")

        doc2_path = os.path.join(temp_dir, "recipe.txt")
        with open(doc2_path, "w", encoding="utf-8") as f:
            f.write("Pasta Carbonara recipe:\nBoil spaghetti, mix eggs with pecorino cheese and guanciale.")

        # Index directory
        idx_res = index_desktop_directory(temp_dir)
        assert idx_res.get("status") == "success", f"Index failed: {idx_res}"
        assert idx_res.get("indexed_files") == 2
        assert idx_res.get("total_chunks") >= 2

        # Verify listing
        list_res = list_indexed_documents()
        assert list_res.get("status") == "success"
        filenames = [f["filename"] for f in list_res.get("files", [])]
        assert "meeting_notes.md" in filenames
        assert "recipe.txt" in filenames

        # Semantic Query
        query_res = query_desktop_knowledge("When is the project falcon deadline and what database?")
        assert query_res.get("status") == "success"
        matches = query_res.get("matches", [])
        assert len(matches) > 0, "Expected at least 1 match"
        top_match = matches[0]
        assert "meeting_notes.md" in top_match["filename"]
        assert "December 15" in top_match["content"]
        assert top_match["score"] > 0.0

        # Recipe Query
        recipe_query = query_desktop_knowledge("How do you cook pasta carbonara?")
        assert recipe_query.get("status") == "success"
        assert len(recipe_query.get("matches", [])) > 0
        assert "recipe.txt" in recipe_query["matches"][0]["filename"]

        # Clear test directory chunks
        clear_res = clear_indexed_documents(path_prefix=temp_dir)
        assert clear_res.get("status") == "success"
        assert clear_res.get("deleted_chunks") >= 2

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_ambient_sentinel_context():
    """Verify ambient context sentinel returns structured environment intel."""
    ctx = sentinel_get_ambient(force_refresh=True)
    assert isinstance(ctx, dict)
    assert "timestamp" in ctx
    assert "active_window" in ctx
    assert "clipboard" in ctx
    assert "suggestions" in ctx
    assert "app_name" in ctx["active_window"]
    assert "title" in ctx["active_window"]
    assert isinstance(ctx["suggestions"], list)
    assert len(ctx["suggestions"]) > 0

    tool_ctx = tool_get_ambient()
    assert isinstance(tool_ctx, dict)
    assert "active_window" in tool_ctx


def test_ambient_proactive_suggestions():
    """Verify suggestions change intelligently based on active app and clipboard type."""
    # Test error traceback suggestion
    clip_err = {
        "has_content": True,
        "content_type": "error_traceback",
        "preview": "Traceback (most recent call last): ..."
    }
    app_code = {"app_name": "Visual Studio Code", "process_name": "code.exe"}
    suggs_err = _generate_suggestions(app_code, clip_err)
    titles_err = [s["title"] for s in suggs_err]
    assert "Fix Copied Error" in titles_err

    # Test code snippet suggestion
    clip_code = {
        "has_content": True,
        "content_type": "code",
        "preview": "def calculate_orbit(mass, velocity): ..."
    }
    suggs_code = _generate_suggestions(app_code, clip_code)
    titles_code = [s["title"] for s in suggs_code]
    assert "Review Copied Code" in titles_code

    # Test URL suggestion
    clip_url = {
        "has_content": True,
        "content_type": "url",
        "preview": "https://en.wikipedia.org/wiki/Artificial_intelligence"
    }
    app_browser = {"app_name": "Google Chrome", "process_name": "chrome.exe"}
    suggs_url = _generate_suggestions(app_browser, clip_url)
    titles_url = [s["title"] for s in suggs_url]
    assert "Summarize Copied URL" in titles_url


def test_api_ambient_and_rag_endpoints():
    """Verify REST API endpoints for ambient context, telemetry, and RAG."""
    res_amb = client.get("/api/ambient")
    assert res_amb.status_code == 200
    amb_data = res_amb.json()
    assert "active_window" in amb_data
    assert "suggestions" in amb_data

    res_tel = client.get("/api/telemetry")
    assert res_tel.status_code == 200
    tel_data = res_tel.json()
    assert "ambient" in tel_data

    res_docs = client.get("/api/rag/documents")
    assert res_docs.status_code == 200
    docs_data = res_docs.json()
    assert "indexed_file_count" in docs_data

    # Test query endpoint
    res_q = client.post("/api/rag/query", json={"query": "test query", "top_k": 3})
    assert res_q.status_code == 200
    assert "matches" in res_q.json()


if __name__ == "__main__":
    print("Running Phase 3 Semantic Memory & Ambient RAG tests...")
    test_phase3_tool_registration()
    print("  [PASS] test_phase3_tool_registration")
    test_text_chunking()
    print("  [PASS] test_text_chunking")
    test_embedding_generation()
    print("  [PASS] test_embedding_generation")
    test_rag_end_to_end_indexing_and_search()
    print("  [PASS] test_rag_end_to_end_indexing_and_search")
    test_ambient_sentinel_context()
    print("  [PASS] test_ambient_sentinel_context")
    test_ambient_proactive_suggestions()
    print("  [PASS] test_ambient_proactive_suggestions")
    test_api_ambient_and_rag_endpoints()
    print("  [PASS] test_api_ambient_and_rag_endpoints")
    print("\nALL PHASE 3 TESTS PASSED!")
