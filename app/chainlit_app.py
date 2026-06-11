from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chainlit as cl
from chainlit.chat_context import chat_context
from starlette.requests import Request
from starlette.responses import JSONResponse

import re

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
MODE_MESSAGE_PATTERN = re.compile(
    r"^\u200B(\u200C|\u200D)\s*",
)


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
    from chainlit.context import context
    from chainlit.user_session import user_sessions

    session = context.session
    if not session:
        return MODE_ARCHIVE

    bucket = user_sessions.get(session.id, {})
    stored = bucket.get(SESSION_MODE_KEY)
    if stored in (MODE_ARCHIVE, MODE_ANDREW_ALPHA):
        return stored

    profile_name = bucket.get("chat_profile") or session.chat_profile
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
    cl.user_session.set(SESSION_MODE_KEY, mode)
    return mode


def apply_mode_from_client(profile_name: str) -> str | None:
    from chainlit.context import context

    if not context.session:
        return None
    if profile_name not in PROFILE_TO_MODE:
        return None
    return apply_mode_for_profile(context.session, profile_name)


def parse_question_mode(question: str) -> tuple[str, str | None]:
    match = MODE_MESSAGE_PATTERN.match(question)
    if not match:
        return question, None

    cleaned = MODE_MESSAGE_PATTERN.sub("", question, count=1).strip()
    if match.group(1) == "\u200D":
        return cleaned, MODE_ANDREW_ALPHA
    return cleaned, MODE_ARCHIVE


def resolve_response_mode(
    question: str,
    metadata: dict | None = None,
) -> tuple[str, str]:
    from chainlit.context import context, get_context

    cleaned, message_mode = parse_question_mode(question)
    mode = message_mode

    if not mode and isinstance(metadata, dict):
        profile_name = metadata.get("archive_profile")
        if isinstance(profile_name, str) and profile_name in PROFILE_TO_MODE:
            mode = PROFILE_TO_MODE[profile_name]

    try:
        get_context()
        session = context.session
    except Exception:
        session = None

    if mode and session:
        apply_mode_for_profile(session, CHAT_PROFILES[mode]["name"])
        return cleaned, mode

    return cleaned, get_response_mode()


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
    from chainlit.user_session import user_sessions

    bucket = user_sessions.get(context.session.id, {})
    if bucket.get(SESSION_MODE_KEY) in (MODE_ARCHIVE, MODE_ANDREW_ALPHA):
        return

    profile_name = context.session.chat_profile or CHAT_PROFILES[MODE_ARCHIVE]["name"]
    apply_mode_for_profile(context.session, profile_name)


@cl.on_window_message
async def on_window_message(data: dict) -> None:
    if not isinstance(data, dict) or data.get("type") != "archive_set_mode":
        return
    profile_name = data.get("profile")
    if isinstance(profile_name, str):
        apply_mode_from_client(profile_name)


async def archive_session_handler(request: Request) -> JSONResponse:
    from chainlit.session import WebsocketSession
    from chainlit.user_session import user_sessions

    session_id = request.cookies.get("X-Chainlit-Session-id")
    if not session_id:
        return JSONResponse({"sessionId": None, "mode": None, "profile": None})

    session = WebsocketSession.get_by_id(session_id)
    if not session:
        return JSONResponse({"sessionId": session_id, "mode": None, "profile": None})

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


async def archive_set_mode_handler(request: Request) -> JSONResponse:
    from chainlit.context import init_ws_context
    from chainlit.session import WebsocketSession

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


def _insert_routes_before_catch_all(app, routes: list) -> None:
    catch_all_index = next(
        (
            index
            for index, route in enumerate(app.routes)
            if getattr(route, "path", None) == "/{full_path:path}"
        ),
        len(app.routes),
    )
    for offset, route in enumerate(routes):
        app.routes.insert(catch_all_index + offset, route)


@cl.on_app_startup
async def register_archive_routes() -> None:
    from chainlit.server import app
    from starlette.routing import Route

    if getattr(app.state, "archive_routes_registered", False):
        return

    archive_routes = [
        Route("/archive/session", archive_session_handler, methods=["GET"]),
        Route("/archive/set-mode", archive_set_mode_handler, methods=["POST"]),
    ]
    _insert_routes_before_catch_all(app, archive_routes)
    app.state.archive_routes_registered = True


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
    raw_question = message.content.strip()
    if not raw_question:
        await cl.Message(content="Please enter a question about the archive.").send()
        return

    metadata = message.metadata if isinstance(message.metadata, dict) else {}
    question, mode = resolve_response_mode(raw_question, metadata)
    if not question:
        await cl.Message(content="Please enter a question about the archive.").send()
        return

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
