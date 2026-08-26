import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Root of the project (config.py always lives at the top level).
PROJECT_ROOT = Path(__file__).resolve().parent


def project_path(*parts: str) -> str:
    """Absolute path for a fixed project resource, containment-checked.

    Every file read/write below must target a known filename inside the
    project tree; resolving against PROJECT_ROOT and asserting membership
    guarantees a constructed path can never escape it via '..' segments.
    """
    p = (PROJECT_ROOT.joinpath(*parts)).resolve()
    if p != PROJECT_ROOT and PROJECT_ROOT not in p.parents:
        raise ValueError(f"Path escapes project root: {p}")
    return str(p)

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL")
OLLAMA_VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL")

if not OLLAMA_MODEL:
    raise ValueError("OLLAMA_MODEL is missing. Please define it in your .env file.")

if not OLLAMA_VISION_MODEL:
    raise ValueError("OLLAMA_VISION_MODEL is missing. Please define it in your .env file.")

# Context window handed to Ollama. Unbounded/default context allocation can
# exhaust a small VRAM budget (e.g. 4 GB), forcing heavy CPU offload.
# Override in .env if you have headroom to spare.
def _env_int(name, default):
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default

OLLAMA_NUM_CTX = _env_int("OLLAMA_NUM_CTX", 8192)

# Seconds an unused model stays resident in Ollama before unloading.
# Keeping both models resident is impossible on 4 GB VRAM; the default
# below lets sequential LLM->VLM->LLM calls within one task reuse warm
# weights without pinning memory forever.
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "5m")

def chat_options(num_predict: int = None) -> dict:
    """Standard Ollama options applied to every chat call so VRAM use stays bounded."""
    opts = {"num_ctx": OLLAMA_NUM_CTX}
    if num_predict:
        opts["num_predict"] = num_predict
    return opts
