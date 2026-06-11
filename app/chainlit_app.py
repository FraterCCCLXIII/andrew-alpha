from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chainlit as cl
from chainlit.chat_context import chat_context

from rag.config import get_settings
from rag.modes import CHAT_PROFILES, MODE_ANDREW_ALPHA, MODE_ARCHIVE
from rag.prompts import build_system_prompt, build_user_prompt
from rag.providers import stream_completion
from rag.retrieve import retrieve_passages

settings = get_settings()

PROFILE_TO_MODE = {
    CHAT_PROFILES[MODE_ARCHIVE]["name"]: MODE_ARCHIVE,
    CHAT_PROFILES[MODE_ANDREW_ALPHA]["name"]: MODE_ANDREW_ALPHA,
}

SESSION_MODE_KEY = "response_mode"
PENDING_SOURCES_KEY = "pending_sources"
SOURCE_EXCERPT_LENGTH = 500


def absolute_url(path: str) -> str:
    if not path:
        return settings.site_base_url
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{settings.site_base_url}{path}"


def build_source_elements(passages: list[dict]) -> list[cl.Text]:
    elements: list[cl.Text] = []
    for passage in passages:
        url = absolute_url(passage.get("url", ""))
        text = passage.get("text", "")
        excerpt = text[:SOURCE_EXCERPT_LENGTH].replace("\n", " ")
        if len(text) > SOURCE_EXCERPT_LENGTH:
            excerpt += "..."
        elements.append(
            cl.Text(
                name=passage.get("title", "Source"),
                display="inline",
                content=f"{excerpt}\n\n[Read on site]({url})",
            )
        )
    return elements


def store_pending_sources(message_id: str, passages: list[dict]) -> None:
    pending = cl.user_session.get(PENDING_SOURCES_KEY) or {}
    pending[message_id] = passages
    cl.user_session.set(PENDING_SOURCES_KEY, pending)


def get_pending_sources(message_id: str) -> list[dict]:
    pending = cl.user_session.get(PENDING_SOURCES_KEY) or {}
    return pending.get(message_id, [])


def find_message(message_id: str) -> cl.Message | None:
    for message in chat_context.get():
        if message.id == message_id:
            return message
    return None


def show_sources_action(message_id: str, count: int) -> cl.Action:
    return cl.Action(
        name="show_sources",
        payload={"message_id": message_id},
        label=f"Show sources ({count})",
    )


def hide_sources_action(message_id: str) -> cl.Action:
    return cl.Action(
        name="hide_sources",
        payload={"message_id": message_id},
        label="Hide sources",
    )


def get_response_mode() -> str:
    stored = cl.user_session.get(SESSION_MODE_KEY)
    if stored in (MODE_ARCHIVE, MODE_ANDREW_ALPHA):
        return stored
    profile_name = cl.user_session.get("chat_profile")
    return PROFILE_TO_MODE.get(profile_name, MODE_ARCHIVE)


def apply_mode_for_profile(session, profile_name: str) -> str | None:
    from chainlit.user_session import user_sessions

    mode = PROFILE_TO_MODE.get(profile_name)
    if not mode:
        return None

    session.chat_profile = profile_name
    bucket = user_sessions.setdefault(session.id, {})
    bucket[SESSION_MODE_KEY] = mode
    bucket["chat_profile"] = profile_name
    bucket["id"] = session.id
    return mode


@cl.set_chat_profiles
async def chat_profiles() -> list[cl.ChatProfile]:
    return [
        cl.ChatProfile(
            name=CHAT_PROFILES[MODE_ARCHIVE]["name"],
            markdown_description=CHAT_PROFILES[MODE_ARCHIVE]["description"],
            default=True,
            starters=[
                cl.Starter(
                    label="Five Tenets",
                    message="What are the Five Tenets of Evolutionary Enlightenment?",
                ),
                cl.Starter(
                    label="Clarity of Intention",
                    message="What did Andrew Cohen teach about clarity of intention?",
                ),
                cl.Starter(
                    label="Evolutionary Enlightenment",
                    message="What is Evolutionary Enlightenment?",
                ),
                cl.Starter(
                    label="Meditation practice",
                    message="How does Andrew Cohen describe meditation practice?",
                ),
            ],
        ),
        cl.ChatProfile(
            name=CHAT_PROFILES[MODE_ANDREW_ALPHA]["name"],
            markdown_description=CHAT_PROFILES[MODE_ANDREW_ALPHA]["description"],
            starters=[
                cl.Starter(
                    label="Who are you?",
                    message="Who are you, Andrew Alpha, and how are you different from Andrew Cohen himself?",
                ),
                cl.Starter(
                    label="Clarity of intention",
                    message="What is clarity of intention, and why does it matter?",
                ),
                cl.Starter(
                    label="Five Tenets",
                    message="Walk me through the Five Tenets as you understand them.",
                ),
                cl.Starter(
                    label="Meditation",
                    message="How do you teach meditation?",
                ),
            ],
        ),
    ]


@cl.on_chat_start
async def on_chat_start() -> None:
    from chainlit.context import context

    profile_name = cl.user_session.get("chat_profile") or CHAT_PROFILES[MODE_ARCHIVE]["name"]
    apply_mode_for_profile(context.session, profile_name)


@cl.on_app_startup
async def register_archive_routes() -> None:
    from chainlit.context import init_ws_context
    from chainlit.server import app
    from chainlit.session import WebsocketSession
    from fastapi import Request
    from fastapi.responses import JSONResponse

    @app.get("/archive/session")
    async def archive_session(request: Request) -> JSONResponse:
        session_id = request.cookies.get("X-Chainlit-Session-id")
        if not session_id:
            return JSONResponse({"sessionId": None, "mode": None, "profile": None})

        session = WebsocketSession.get_by_id(session_id)
        if not session:
            return JSONResponse({"sessionId": session_id, "mode": None, "profile": None})

        from chainlit.user_session import user_sessions

        bucket = user_sessions.get(session_id, {})
        mode = bucket.get(SESSION_MODE_KEY)
        profile = bucket.get("chat_profile") or session.chat_profile
        return JSONResponse(
            {
                "sessionId": session_id,
                "mode": mode,
                "profile": profile,
            }
        )

    @app.post("/archive/set-mode")
    async def archive_set_mode(request: Request) -> JSONResponse:
        session_id = request.cookies.get("X-Chainlit-Session-id")
        if not session_id:
            return JSONResponse(
                {"success": False, "detail": "Missing session"},
                status_code=400,
            )

        session = WebsocketSession.get_by_id(session_id)
        if not session:
            return JSONResponse(
                {"success": False, "detail": "Session not found"},
                status_code=404,
            )

        body = await request.json()
        profile_name = body.get("profile")
        if profile_name not in PROFILE_TO_MODE:
            return JSONResponse(
                {"success": False, "detail": "Invalid profile"},
                status_code=400,
            )

        init_ws_context(session)
        mode = apply_mode_for_profile(session, profile_name)

        return JSONResponse(
            {
                "success": True,
                "mode": mode,
                "profile": profile_name,
                "sessionId": session_id,
            }
        )


@cl.action_callback("switch_mode_archive")
async def switch_mode_archive(_action: cl.Action) -> None:
    from chainlit.context import context

    apply_mode_for_profile(context.session, CHAT_PROFILES[MODE_ARCHIVE]["name"])


@cl.action_callback("switch_mode_alpha")
async def switch_mode_alpha(_action: cl.Action) -> None:
    from chainlit.context import context

    apply_mode_for_profile(context.session, CHAT_PROFILES[MODE_ANDREW_ALPHA]["name"])


@cl.action_callback("show_sources")
async def on_show_sources(action: cl.Action) -> None:
    message_id = action.payload["message_id"]
    passages = get_pending_sources(message_id)
    message = find_message(message_id)
    if not message or not passages:
        return

    message.elements = build_source_elements(passages)
    await message.remove_actions()
    message.actions = [hide_sources_action(message_id)]
    await message.update()


@cl.action_callback("hide_sources")
async def on_hide_sources(action: cl.Action) -> None:
    message_id = action.payload["message_id"]
    passages = get_pending_sources(message_id)
    message = find_message(message_id)
    if not message:
        return

    for element in message.elements:
        await element.remove()
    message.elements = []
    await message.remove_actions()
    message.actions = [show_sources_action(message_id, len(passages))]
    await message.update()


@cl.on_message
async def on_message(message: cl.Message) -> None:
    question = message.content.strip()
    if not question:
        await cl.Message(content="Please enter a question about the archive.").send()
        return

    mode = get_response_mode()

    try:
        passages = retrieve_passages(question, settings=settings)
    except RuntimeError as error:
        await cl.Message(content=str(error)).send()
        return

    response = cl.Message(content="")
    await response.send()

    messages = [
        {"role": "system", "content": build_system_prompt(settings, mode=mode)},
        {
            "role": "user",
            "content": build_user_prompt(
                question,
                [
                    {
                        **passage,
                        "url": absolute_url(passage.get("url", "")),
                    }
                    for passage in passages
                ],
                mode=mode,
            ),
        },
    ]

    try:
        for chunk in stream_completion(messages, settings=settings):
            delta = chunk.choices[0].delta
            token = getattr(delta, "content", None) or ""
            if token:
                await response.stream_token(token)
    except Exception as error:
        await response.stream_token(
            f"\n\n_Sorry, the model request failed: {error}_"
        )

    await response.update()

    if passages:
        store_pending_sources(response.id, passages)
        response.actions = [show_sources_action(response.id, len(passages))]
        await response.update()
