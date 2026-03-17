from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import anthropic
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Pydantic Models ---

class ConversationCreate(BaseModel):
    title: Optional[str] = "New Chat"
    model: Optional[str] = None

class ConversationUpdate(BaseModel):
    title: Optional[str] = None

class MessageCreate(BaseModel):
    conversation_id: str
    content: str
    model: Optional[str] = None

class SettingsUpdate(BaseModel):
    anthropic_api_key: Optional[str] = None
    ollama_base_url: Optional[str] = None
    default_model: Optional[str] = None
    use_emergent_key: Optional[bool] = None

# --- Helper Functions ---

def now_iso():
    return datetime.now(timezone.utc).isoformat()

async def get_settings():
    settings = await db.settings.find_one({"type": "app_settings"}, {"_id": 0})
    if not settings:
        settings = {
            "type": "app_settings",
            "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY", ""),
            "emergent_llm_key": os.environ.get("EMERGENT_LLM_KEY", ""),
            "ollama_base_url": os.environ.get("OLLAMA_BASE_URL", ""),
            "default_model": os.environ.get("DEFAULT_MODEL", "claude-opus-4-6"),
            "use_emergent_key": True,
        }
        await db.settings.insert_one(settings)
        settings.pop("_id", None)
    return settings

async def get_anthropic_client():
    settings = await get_settings()
    api_key = settings.get("anthropic_api_key", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured. Go to Settings.")
    return anthropic.Anthropic(api_key=api_key)

# --- Conversations ---

@api_router.post("/conversations")
async def create_conversation(data: ConversationCreate):
    conv = {
        "id": str(uuid.uuid4()),
        "title": data.title or "New Chat",
        "model": data.model or (await get_settings()).get("default_model", "claude-opus-4-6"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "message_count": 0,
    }
    await db.conversations.insert_one(conv)
    conv.pop("_id", None)
    return conv

@api_router.get("/conversations")
async def list_conversations():
    convs = await db.conversations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    return convs

@api_router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = await db.messages.find({"conversation_id": conv_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    conv["messages"] = messages
    return conv

@api_router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    await db.conversations.delete_one({"id": conv_id})
    await db.messages.delete_many({"conversation_id": conv_id})
    return {"status": "deleted"}

@api_router.patch("/conversations/{conv_id}")
async def update_conversation(conv_id: str, data: ConversationUpdate):
    update = {"updated_at": now_iso()}
    if data.title is not None:
        update["title"] = data.title
    await db.conversations.update_one({"id": conv_id}, {"$set": update})
    conv = await db.conversations.find_one({"id": conv_id}, {"_id": 0})
    return conv

# --- Chat / Streaming ---

@api_router.post("/chat/send")
async def send_message(data: MessageCreate):
    settings = await get_settings()
    model = data.model or settings.get("default_model", "claude-opus-4-6")
    
    # Save user message
    user_msg = {
        "id": str(uuid.uuid4()),
        "conversation_id": data.conversation_id,
        "role": "user",
        "content": data.content,
        "model": model,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(user_msg)
    user_msg.pop("_id", None)

    # Get conversation history
    history = await db.messages.find(
        {"conversation_id": data.conversation_id, "role": {"$in": ["user", "assistant"]}},
        {"_id": 0}
    ).sort("created_at", 1).to_list(200)

    messages_for_api = [{"role": m["role"], "content": m["content"]} for m in history]

    # Auto-title on first message
    conv = await db.conversations.find_one({"id": data.conversation_id}, {"_id": 0})
    if conv and conv.get("message_count", 0) == 0:
        title = data.content[:60] + ("..." if len(data.content) > 60 else "")
        await db.conversations.update_one(
            {"id": data.conversation_id},
            {"$set": {"title": title, "model": model}}
        )

    is_ollama = model.startswith("ollama:")
    
    if is_ollama:
        return StreamingResponse(
            stream_ollama(data.conversation_id, model, messages_for_api, settings),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )
    else:
        return StreamingResponse(
            stream_anthropic(data.conversation_id, model, messages_for_api, settings),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

async def stream_anthropic(conversation_id, model, messages, settings):
    # Try Emergent LLM key first (universal key), fallback to direct Anthropic key
    use_emergent = settings.get("use_emergent_key", True)
    emergent_key = settings.get("emergent_llm_key", os.environ.get("EMERGENT_LLM_KEY", ""))
    anthropic_key = settings.get("anthropic_api_key", "")

    if use_emergent and emergent_key:
        # Use emergentintegrations library
        try:
            msg_id = str(uuid.uuid4())
            yield f"data: {json.dumps({'type': 'start', 'message_id': msg_id})}\n\n"

            session_id = f"sma-ai-{conversation_id}"
            chat = LlmChat(
                api_key=emergent_key,
                session_id=session_id,
                system_message="You are SMA-AI, an expert coding assistant specialized in antenna design, radio engineering, React, Python, and full-stack development. You provide clear, accurate code with explanations. Use markdown formatting with code blocks."
            )
            chat.with_model("anthropic", model)

            # Build the last user message
            last_user_msg = messages[-1]["content"] if messages else ""
            user_message = UserMessage(text=last_user_msg)
            
            full_response = await chat.send_message(user_message)

            yield f"data: {json.dumps({'type': 'delta', 'content': full_response})}\n\n"

            assistant_msg = {
                "id": msg_id,
                "conversation_id": conversation_id,
                "role": "assistant",
                "content": full_response,
                "model": model,
                "created_at": now_iso(),
            }
            await db.messages.insert_one(assistant_msg)
            await db.conversations.update_one(
                {"id": conversation_id},
                {"$set": {"updated_at": now_iso()}, "$inc": {"message_count": 2}}
            )
            yield f"data: {json.dumps({'type': 'done', 'message_id': msg_id})}\n\n"
            return

        except Exception as e:
            logger.warning(f"Emergent key failed, falling back to direct Anthropic: {e}")
            # Fall through to direct Anthropic API

    # Direct Anthropic API (streaming)
    api_key = anthropic_key
    if not api_key:
        yield f"data: {json.dumps({'type': 'error', 'content': 'No API key configured. Go to Settings.'})}\n\n"
        return

    try:
        client = anthropic.Anthropic(api_key=api_key)
        full_response = ""
        msg_id = str(uuid.uuid4())

        yield f"data: {json.dumps({'type': 'start', 'message_id': msg_id})}\n\n"

        with client.messages.stream(
            model=model,
            max_tokens=8192,
            system="You are SMA-AI, an expert coding assistant specialized in antenna design, radio engineering, React, Python, and full-stack development. You provide clear, accurate code with explanations. Use markdown formatting with code blocks.",
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                full_response += text
                yield f"data: {json.dumps({'type': 'delta', 'content': text})}\n\n"

        assistant_msg = {
            "id": msg_id,
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": full_response,
            "model": model,
            "created_at": now_iso(),
        }
        await db.messages.insert_one(assistant_msg)
        await db.conversations.update_one(
            {"id": conversation_id},
            {"$set": {"updated_at": now_iso()}, "$inc": {"message_count": 2}}
        )
        yield f"data: {json.dumps({'type': 'done', 'message_id': msg_id})}\n\n"

    except anthropic.AuthenticationError:
        yield f"data: {json.dumps({'type': 'error', 'content': 'Invalid Anthropic API key. Check Settings.'})}\n\n"
    except anthropic.RateLimitError:
        yield f"data: {json.dumps({'type': 'error', 'content': 'Rate limited by Anthropic. Wait a moment and try again.'})}\n\n"
    except Exception as e:
        logger.error(f"Anthropic streaming error: {e}")
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

async def stream_ollama(conversation_id, model, messages, settings):
    ollama_url = settings.get("ollama_base_url", "")
    if not ollama_url:
        yield f"data: {json.dumps({'type': 'error', 'content': 'Ollama URL not configured. Go to Settings.'})}\n\n"
        return

    ollama_model = model.replace("ollama:", "")
    msg_id = str(uuid.uuid4())
    full_response = ""

    try:
        yield f"data: {json.dumps({'type': 'start', 'message_id': msg_id})}\n\n"

        async with httpx.AsyncClient(timeout=120.0) as http_client:
            async with http_client.stream(
                "POST",
                f"{ollama_url.rstrip('/')}/api/chat",
                json={"model": ollama_model, "messages": messages, "stream": True},
            ) as response:
                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            chunk = json.loads(line)
                            if "message" in chunk and "content" in chunk["message"]:
                                text = chunk["message"]["content"]
                                full_response += text
                                yield f"data: {json.dumps({'type': 'delta', 'content': text})}\n\n"
                            if chunk.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue

        assistant_msg = {
            "id": msg_id,
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": full_response,
            "model": model,
            "created_at": now_iso(),
        }
        await db.messages.insert_one(assistant_msg)

        await db.conversations.update_one(
            {"id": conversation_id},
            {"$set": {"updated_at": now_iso()}, "$inc": {"message_count": 2}}
        )

        yield f"data: {json.dumps({'type': 'done', 'message_id': msg_id})}\n\n"

    except httpx.ConnectError:
        yield f"data: {json.dumps({'type': 'error', 'content': f'Cannot connect to Ollama at {ollama_url}. Is it running?'})}\n\n"
    except Exception as e:
        logger.error(f"Ollama streaming error: {e}")
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

# --- Models ---

@api_router.get("/models")
async def list_models():
    settings = await get_settings()
    models = [
        {"id": "claude-opus-4-6", "name": "Claude Opus 4.6", "provider": "anthropic", "description": "1M context, best reasoning"},
        {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "provider": "anthropic", "description": "Fast & capable"},
    ]

    ollama_url = settings.get("ollama_base_url", "")
    if ollama_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as http_client:
                resp = await http_client.get(f"{ollama_url.rstrip('/')}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    for m in data.get("models", []):
                        models.append({
                            "id": f"ollama:{m['name']}",
                            "name": m["name"],
                            "provider": "ollama",
                            "description": f"Local - {m.get('size', 'unknown size')}",
                        })
        except Exception as e:
            logger.warning(f"Could not fetch Ollama models: {e}")

    return models

# --- Settings ---

@api_router.get("/settings")
async def get_settings_endpoint():
    settings = await get_settings()
    settings.pop("type", None)
    key = settings.get("anthropic_api_key", "")
    if key and len(key) > 20:
        settings["anthropic_api_key_masked"] = key[:12] + "..." + key[-6:]
    else:
        settings["anthropic_api_key_masked"] = "Not set"
    settings.pop("anthropic_api_key", None)
    settings.pop("emergent_llm_key", None)
    return settings

@api_router.put("/settings")
async def update_settings(data: SettingsUpdate):
    update = {}
    if data.anthropic_api_key is not None:
        update["anthropic_api_key"] = data.anthropic_api_key
    if data.ollama_base_url is not None:
        update["ollama_base_url"] = data.ollama_base_url
    if data.default_model is not None:
        update["default_model"] = data.default_model
    if data.use_emergent_key is not None:
        update["use_emergent_key"] = data.use_emergent_key

    if update:
        await db.settings.update_one(
            {"type": "app_settings"},
            {"$set": update},
            upsert=True
        )
    
    settings = await get_settings()
    settings.pop("type", None)
    key = settings.get("anthropic_api_key", "")
    if key and len(key) > 20:
        settings["anthropic_api_key_masked"] = key[:12] + "..." + key[-6:]
    settings.pop("anthropic_api_key", None)
    settings.pop("emergent_llm_key", None)
    return settings

# --- Health ---

@api_router.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0", "name": "SMA-AI Dev Workspace"}

# Include router and middleware
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
