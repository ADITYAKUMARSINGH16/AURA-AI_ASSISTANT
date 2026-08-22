import os
from dotenv import load_dotenv

load_dotenv()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL")
OLLAMA_VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL")

if not OLLAMA_MODEL:
    raise ValueError("OLLAMA_MODEL is missing. Please define it in your .env file.")

if not OLLAMA_VISION_MODEL:
    raise ValueError("OLLAMA_VISION_MODEL is missing. Please define it in your .env file.")
