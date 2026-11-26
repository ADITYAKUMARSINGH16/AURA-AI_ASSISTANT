"""Unified LLM provider router for AURA (Ollama local + Groq, NVIDIA NIM, Google Gemini, OpenAI)."""

from __future__ import annotations

import inspect
import json
import logging
import os
import time
import typing
from typing import Any, Callable, Dict, Iterator, List, Optional

import httpx
import ollama

from config import OLLAMA_KEEP_ALIVE, OLLAMA_MODEL, chat_options

PROVIDERS: Dict[str, Dict[str, Any]] = {
    "ollama": {
        "label": "Ollama (Local)",
        "base_url": None,
        "api_key_env": None,
        "model_env": "OLLAMA_MODEL",
        "default_model": "gemma4:e2b",
        "curated_models": [],
    },
    "groq": {
        "label": "Groq Cloud",
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        "model_env": "GROQ_MODEL",
        "default_model": "llama-3.3-70b-versatile",
        "curated_models": [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "meta-llama/llama-4-scout-17b-16e-instruct",
            "qwen/qwen3-32b",
            "openai/gpt-oss-120b",
        ],
    },
    "nvidia": {
        "label": "NVIDIA NIM",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "api_key_env": "NVIDIA_API_KEY",
        "model_env": "NVIDIA_MODEL",
        "default_model": "meta/llama-3.3-70b-instruct",
        "curated_models": [
            "meta/llama-3.3-70b-instruct",
            "nvidia/llama-3.1-nemotron-ultra-253b-v1",
            "qwen/qwen2.5-72b-instruct",
            "deepseek-ai/deepseek-r1",
            "mistralai/mistral-large-2-instruct",
        ],
    },
    "gemini": {
        "label": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "model_env": "GEMINI_MODEL",
        "default_model": "gemini-2.5-flash",
        "curated_models": [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
        ],
    },
    "openai": {
        "label": "OpenAI / ChatGPT",
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "model_env": "OPENAI_MODEL",
        "default_model": "gpt-4o-mini",
        "curated_models": [
            "gpt-4o-mini",
            "gpt-4o",
            "gpt-4.1-mini",
            "gpt-4.1",
            "o4-mini",
        ],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "model_env": "OPENROUTER_MODEL",
        "default_model": "openai/gpt-4o-mini",
        "curated_models": [
            "openai/gpt-4o-mini",
            "anthropic/claude-sonnet-4",
            "google/gemini-2.5-flash",
            "deepseek/deepseek-chat-v3-0324:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "openrouter/auto",
        ],
    },
}


def get_active_provider() -> str:
    """Return normalized active LLM provider name."""
    raw = os.environ.get("AURA_LLM_PROVIDER", "ollama").strip().lower()
    return raw if raw in PROVIDERS else "ollama"


def get_active_model(provider: Optional[str] = None) -> str:
    """Return active model identifier for the given (or currently active) provider."""
    prov = (provider or get_active_provider()).strip().lower()
    spec = PROVIDERS.get(prov, PROVIDERS["ollama"])
    if prov == "ollama":
        import config
        return os.environ.get("OLLAMA_MODEL") or getattr(config, "OLLAMA_MODEL", spec["default_model"])
    return os.environ.get(spec["model_env"]) or spec["default_model"]


def get_provider_api_key(provider: str) -> str:
    """Return configured API key for a cloud provider, or empty string."""
    spec = PROVIDERS.get(provider.strip().lower(), {})
    env_name = spec.get("api_key_env")
    if not env_name:
        return ""
    return (os.environ.get(env_name) or "").strip()


def _py_type_to_json_schema(ann: Any) -> Dict[str, Any]:
    """Map Python type annotations to OpenAI JSON Schema parameter types."""
    if ann is inspect.Parameter.empty or ann is Any:
        return {"type": "string"}
    origin = typing.get_origin(ann)
    if origin is typing.Union:
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        if len(args) == 1:
            return _py_type_to_json_schema(args[0])
    if origin in (list, List):
        return {"type": "array", "items": {"type": "string"}}
    if origin in (dict, Dict):
        return {"type": "object"}
    if ann in (int, "int"):
        return {"type": "integer"}
    if ann in (float, "float"):
        return {"type": "number"}
    if ann in (bool, "bool"):
        return {"type": "boolean"}
    return {"type": "string"}


def functions_to_openai_tools(tools: Optional[List[Callable[..., Any]]]) -> Optional[List[Dict[str, Any]]]:
    """Convert Python tool callables into OpenAI-compatible function tool schemas."""
    if not tools:
        return None
    schemas: List[Dict[str, Any]] = []
    for fn in tools:
        sig = inspect.signature(fn)
        try:
            hints = typing.get_type_hints(fn)
        except Exception:
            hints = {}
        props: Dict[str, Any] = {}
        required: List[str] = []
        for param_name, param in sig.parameters.items():
            if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                continue
            props[param_name] = _py_type_to_json_schema(hints.get(param_name, param.annotation))
            if param.default is inspect.Parameter.empty:
                required.append(param_name)
        doc = (inspect.getdoc(fn) or fn.__name__).strip()
        schemas.append({
            "type": "function",
            "function": {
                "name": fn.__name__,
                "description": doc[:1024],
                "parameters": {
                    "type": "object",
                    "properties": props,
                    "required": required,
                },
            },
        })
    return schemas


def normalize_messages_for_openai(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Translate internal Ollama-style chat history into strict OpenAI Chat Completions format."""
    out: List[Dict[str, Any]] = []
    pending_tool_ids: List[str] = []
    call_seq = 0

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content")
        if content is None:
            content = ""

        if role == "assistant":
            raw_tcs = msg.get("tool_calls") or []
            if raw_tcs:
                oai_tcs = []
                pending_tool_ids = []
                for tc in raw_tcs:
                    call_seq += 1
                    tc_id = tc.get("id") or f"call_{call_seq}"
                    fn = tc.get("function") or {}
                    args = fn.get("arguments", {})
                    if not isinstance(args, str):
                        args = json.dumps(args, default=str)
                    oai_tcs.append({
                        "id": tc_id,
                        "type": "function",
                        "function": {
                            "name": fn.get("name", ""),
                            "arguments": args,
                        },
                    })
                    pending_tool_ids.append(tc_id)
                out.append({
                    "role": "assistant",
                    "content": content or None,
                    "tool_calls": oai_tcs,
                })
            else:
                pending_tool_ids = []
                out.append({"role": "assistant", "content": content})
        elif role == "tool":
            tc_id = msg.get("tool_call_id")
            if not tc_id:
                tc_id = pending_tool_ids.pop(0) if pending_tool_ids else f"call_{call_seq}"
            out.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": str(content),
            })
        else:
            out.append({"role": role, "content": content})
    return out


def _build_cloud_headers(provider: str, api_key: str, json_body: bool = False) -> Dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    if provider == "openrouter":
        headers["HTTP-Referer"] = "http://127.0.0.1:8000"
        headers["X-Title"] = "AURA AI Assistant"
    return headers


def _require_cloud_credentials(provider: str) -> tuple[str, str, str]:
    spec = PROVIDERS.get(provider)
    if not spec or not spec.get("base_url"):
        raise ValueError(f"Unsupported cloud provider: {provider!r}")
    api_key = get_provider_api_key(provider)
    if not api_key:
        raise ValueError(
            f"Missing {spec['api_key_env']} for {spec['label']}. "
            f"Add it in Settings -> AI & Models -> Cloud AI API Keys."
        )
    return spec["base_url"], api_key, get_active_model(provider)


def chat_once(
    messages: List[Dict[str, Any]],
    *,
    tools: Optional[List[Callable[..., Any]]] = None,
    response_format: Optional[str] = None,
    num_predict: Optional[int] = None,
    provider: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a single non-streaming completion on the configured provider and return {'content': str}."""
    prov = (provider or get_active_provider()).strip().lower()
    if prov == "ollama":
        kwargs: Dict[str, Any] = {
            "model": get_active_model("ollama"),
            "messages": messages,
            "options": chat_options(num_predict=num_predict),
            "keep_alive": OLLAMA_KEEP_ALIVE,
        }
        if tools:
            kwargs["tools"] = tools
        if response_format:
            kwargs["format"] = response_format
        res = ollama.chat(**kwargs)
        msg = res.get("message", {}) if isinstance(res, dict) else getattr(res, "message", {})
        content = msg.get("content", "") if isinstance(msg, dict) else getattr(msg, "content", "")
        return {"content": content or ""}

    base_url, api_key, model = _require_cloud_credentials(prov)
    payload: Dict[str, Any] = {
        "model": model,
        "messages": normalize_messages_for_openai(messages),
    }
    if num_predict:
        payload["max_tokens"] = int(num_predict)
    if response_format == "json":
        payload["response_format"] = {"type": "json_object"}
    oai_tools = functions_to_openai_tools(tools)
    if oai_tools:
        payload["tools"] = oai_tools
        payload["tool_choice"] = "auto"

    headers = _build_cloud_headers(prov, api_key, json_body=True)
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(f"{PROVIDERS[prov]['label']} HTTP {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
    choices = data.get("choices") or []
    msg = choices[0].get("message", {}) if choices else {}
    return {"content": msg.get("content") or ""}


def stream_chat(
    messages: List[Dict[str, Any]],
    *,
    tools: Optional[List[Callable[..., Any]]] = None,
    provider: Optional[str] = None,
) -> Iterator[Dict[str, Any]]:
    """Yield normalized streaming chunks compatible with AuraAgent.iter_chat_events()."""
    prov = (provider or get_active_provider()).strip().lower()
    if prov == "ollama":
        stream = ollama.chat(
            model=get_active_model("ollama"),
            messages=messages,
            tools=tools if tools else None,
            options=chat_options(),
            keep_alive=OLLAMA_KEEP_ALIVE,
            stream=True,
        )
        for chunk in stream:
            yield chunk
        return

    base_url, api_key, model = _require_cloud_credentials(prov)
    payload: Dict[str, Any] = {
        "model": model,
        "messages": normalize_messages_for_openai(messages),
        "stream": True,
    }
    oai_tools = functions_to_openai_tools(tools)
    if oai_tools:
        payload["tools"] = oai_tools
        payload["tool_choice"] = "auto"

    headers = _build_cloud_headers(prov, api_key, json_body=True)
    t0 = time.perf_counter()
    with httpx.Client(timeout=120.0) as client:
        with client.stream("POST", f"{base_url}/chat/completions", headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = resp.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"{PROVIDERS[prov]['label']} HTTP {resp.status_code}: {body[:300]}")
            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.strip()
                if not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    ev = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                out_chunk: Dict[str, Any] = {"message": {}}
                choices = ev.get("choices") or []
                if choices:
                    delta = choices[0].get("delta") or {}
                    if delta.get("content"):
                        out_chunk["message"]["content"] = delta["content"]
                    if delta.get("tool_calls"):
                        out_chunk["message"]["tool_calls"] = delta["tool_calls"]

                usage = ev.get("usage") or {}
                if usage:
                    if usage.get("prompt_tokens"):
                        out_chunk["prompt_eval_count"] = usage["prompt_tokens"]
                    if usage.get("completion_tokens"):
                        out_chunk["eval_count"] = usage["completion_tokens"]
                        out_chunk["eval_duration"] = max(1, int((time.perf_counter() - t0) * 1e9))

                if out_chunk["message"] or "eval_count" in out_chunk or "prompt_eval_count" in out_chunk:
                    yield out_chunk


_NON_CHAT_MODEL_PREFIXES: Dict[str, tuple] = {
    "openai": (
        "whisper-", "tts-", "dall-e-", "text-embedding-", "embedding-",
        "omni-moderation-", "text-moderation-", "babbage-", "davinci-",
        "gpt-image-", "sora-",
    ),
    "groq": ("whisper-", "distil-whisper-", "playai-tts"),
    "gemini": ("embedding-", "text-embedding-", "gemini-embedding-", "imagen-", "veo-", "aqa"),
}


def _is_chat_capable_model(provider: str, model_id: str) -> bool:
    """Return True if model_id is a chat/reasoning model rather than TTS/STT/embedding/image."""
    low = (model_id or "").strip().lower()
    if not low:
        return False
    prefixes = _NON_CHAT_MODEL_PREFIXES.get(provider, ())
    return not any(low.startswith(p) for p in prefixes)


def fetch_provider_models(provider: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    """Validate an API key against <provider>/models and return live model IDs."""
    prov = (provider or "").strip().lower()
    if prov not in PROVIDERS or prov == "ollama":
        return {"ok": False, "error": f"Unknown cloud provider: {provider}"}
    spec = PROVIDERS[prov]
    key = (api_key if api_key is not None else get_provider_api_key(prov)).strip()
    if not key:
        return {"ok": False, "error": f"{spec['api_key_env']} is empty."}

    headers = _build_cloud_headers(prov, key)
    try:
        with httpx.Client(timeout=15.0) as client:
            if prov == "openrouter":
                # OpenRouter /models is public; check /key first so invalid keys fail accurately.
                key_resp = client.get(f"{spec['base_url']}/key", headers=headers)
                if key_resp.status_code >= 400:
                    return {"ok": False, "error": f"HTTP {key_resp.status_code}: {key_resp.text[:200]}"}
            resp = client.get(f"{spec['base_url']}/models", headers=headers)
        if resp.status_code >= 400:
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
        payload = resp.json()
        raw_models = payload.get("data") or payload.get("models") or []
        ids: List[str] = []
        for item in raw_models:
            if isinstance(item, dict):
                mid = item.get("id") or item.get("name")
                if mid:
                    # Gemini /v1beta/openai/models returns "models/gemini-2.5-flash"; strip prefix
                    if prov == "gemini" and str(mid).startswith("models/"):
                        mid = str(mid)[7:]
                    ids.append(str(mid))
        ids = sorted(set(ids))
        chat_ids = [m for m in ids if _is_chat_capable_model(prov, m)]
        final_ids = chat_ids or ids
        return {"ok": True, "provider": prov, "models": final_ids, "count": len(final_ids)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
