from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import socketio
from aiohttp import web

from game_engine import (
    GameEngine,
    PHASE_CONTINUOUS,
    PHASE_COUNTDOWN,
    PHASE_GAME_OVER,
    PHASE_PANIC,
    PHASE_READY,
    PHASE_REVEAL,
    PHASE_WAITING,
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
PORT = int(os.environ.get("PORT", "8091"))

sio = socketio.AsyncServer(async_mode="aiohttp", cors_allowed_origins="*")
app = web.Application()
sio.attach(app)


@dataclass
class RoomRuntime:
    engine: GameEngine
    sid_to_role: dict[str, str]
    sid_to_name: dict[str, str]
    spectators: set[str]
    resolution_task: asyncio.Task[Any] | None = None


rooms: dict[str, RoomRuntime] = {}
sid_to_room: dict[str, str] = {}


async def index(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


async def watch(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "watch.html")


app.router.add_get("/", index)
app.router.add_get("/watch", watch)
app.router.add_static("/static/", STATIC_DIR, show_index=False)


def get_room(room_id: str) -> RoomRuntime:
    safe_room = (room_id or "default").strip()[:48] or "default"
    if safe_room not in rooms:
        rooms[safe_room] = RoomRuntime(
            engine=GameEngine(safe_room),
            sid_to_role={},
            sid_to_name={},
            spectators=set(),
        )
    return rooms[safe_room]


def cancel_resolution_task(room: RoomRuntime) -> None:
    if room.resolution_task and not room.resolution_task.done():
        room.resolution_task.cancel()
    room.resolution_task = None


def public_room_state(room: RoomRuntime) -> dict[str, Any]:
    state = room.engine.to_public_state()
    state["roles"] = {
        "p1_sid": next((sid for sid, role in room.sid_to_role.items() if role == "p1"), None),
        "p2_sid": next((sid for sid, role in room.sid_to_role.items() if role == "p2"), None),
        "spectator_count": len(room.spectators),
    }
    return state


async def emit_state(room_id: str) -> None:
    room = get_room(room_id)
    await sio.emit("room_state", public_room_state(room), room=room_id)
    await sio.emit("game_state", room.engine.to_public_state(), room=room_id)
    for sid, role in list(room.sid_to_role.items()):
        await sio.emit("hand_update", {"role": role, "hand": room.engine.hand_for(role)}, to=sid)


async def emit_error(sid: str, message: str) -> None:
    await sio.emit("error_message", {"message": message}, to=sid)


def start_game_failure_reason(room: RoomRuntime) -> str | None:
    state = room.engine.state
    p1 = state.players["p1"]
    p2 = state.players["p2"]
    if state.phase == PHASE_PANIC:
        return "開始できません: Panic / Stop中です。Resetしてください。"
    if state.phase == PHASE_GAME_OVER:
        return "開始できません: ゲーム終了後です。Resetしてください。"
    if state.phase not in {PHASE_WAITING, PHASE_READY}:
        return f"開始できません: 現在のフェーズは {state.phase} です。"
    if not p1.connected:
        return "開始できません: P1が参加していません。"
    if not p2.connected:
        return "開始できません: P2が参加していません。"
    if not p1.ready:
        return "開始できません: P1がReadyではありません。"
    if not p2.ready:
        return "開始できません: P2がReadyではありません。"
    return None


async def run_resolution_sequence(room_id: str) -> None:
    room = get_room(room_id)
    try:
        if room.engine.state.phase != PHASE_REVEAL:
            return
        result = room.engine.resolve_turn()
        await sio.emit("reveal_result", result.to_dict(), room=room_id)
        await emit_state(room_id)
        if room.engine.state.phase == PHASE_GAME_OVER:
            return
        if room.engine.state.phase != PHASE_COUNTDOWN:
            return
        await sio.emit("countdown_start", {"duration_sec": 3}, room=room_id)
        await emit_state(room_id)
        await asyncio.sleep(3)
        if room.engine.state.phase != PHASE_COUNTDOWN:
            return
        continuous = room.engine.enter_continuous()
        await sio.emit("continuous_state", continuous, room=room_id)
        await emit_state(room_id)
        await asyncio.sleep(int(continuous.get("duration_sec", 8)))
        if room.engine.state.phase != PHASE_CONTINUOUS:
            return
        room.engine.finish_continuous_and_next()
        await emit_state(room_id)
    except asyncio.CancelledError:
        return
    except Exception as exc:
        await sio.emit("error_message", {"message": f"resolve error: {exc}"}, room=room_id)
    finally:
        if room.resolution_task and room.resolution_task.done():
            room.resolution_task = None


async def enter_continuous_once(room_id: str) -> None:
    room = get_room(room_id)
    if room.engine.state.phase != PHASE_COUNTDOWN:
        return
    continuous = room.engine.enter_continuous()
    await sio.emit("continuous_state", continuous, room=room_id)
    await emit_state(room_id)
    await asyncio.sleep(int(continuous.get("duration_sec", 8)))
    if room.engine.state.phase != PHASE_CONTINUOUS:
        return
    room.engine.finish_continuous_and_next()
    await emit_state(room_id)


@sio.event
async def connect(sid: str, environ: dict[str, Any]) -> None:
    await sio.emit("server_hello", {"message": "connected", "sid": sid}, to=sid)


@sio.event
async def disconnect(sid: str) -> None:
    room_id = sid_to_room.pop(sid, None)
    if not room_id:
        return
    room = get_room(room_id)
    role = room.sid_to_role.pop(sid, None)
    room.sid_to_name.pop(sid, None)
    room.spectators.discard(sid)
    if role in {"p1", "p2"}:
        room.engine.set_player_connected(role, role.upper(), False)
    await emit_state(room_id)


@sio.on("join_room")
async def join_room(sid: str, payload: dict[str, Any]) -> None:
    room_id = str(payload.get("room_id", "default")).strip()[:48] or "default"
    display_name = str(payload.get("display_name", "Guest")).strip()[:32] or "Guest"
    previous_room_id = sid_to_room.get(sid)
    if previous_room_id and previous_room_id != room_id:
        await sio.leave_room(sid, previous_room_id)
    room = get_room(room_id)
    sid_to_room[sid] = room_id
    room.sid_to_name[sid] = display_name
    await sio.enter_room(sid, room_id)
    await emit_state(room_id)


@sio.on("select_role")
async def select_role(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        await emit_error(sid, "先にルームへ参加してください。")
        return
    room = get_room(room_id)
    requested = str(payload.get("role", "spectator"))
    if requested not in {"p1", "p2", "spectator"}:
        requested = "spectator"
    occupied = {role for other_sid, role in room.sid_to_role.items() if other_sid != sid and role in {"p1", "p2"}}
    reason = ""
    assigned = requested
    if requested in occupied:
        assigned = "spectator"
        reason = f"{requested} is already occupied"
    old_role = room.sid_to_role.get(sid)
    if old_role in {"p1", "p2"} and old_role != assigned:
        room.engine.set_player_connected(old_role, old_role.upper(), False)
    room.sid_to_role[sid] = assigned
    room.spectators.discard(sid)
    if assigned == "spectator":
        room.spectators.add(sid)
    else:
        room.engine.set_player_connected(assigned, room.sid_to_name.get(sid, assigned.upper()), True)
    await sio.emit("role_assigned", {"requested_role": requested, "assigned_role": assigned, "reason": reason}, to=sid)
    await emit_state(room_id)


@sio.on("player_ready")
async def player_ready(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = get_room(room_id)
    role = room.sid_to_role.get(sid)
    if role not in {"p1", "p2"}:
        await emit_error(sid, "観戦者はReadyできません。")
        return
    room.engine.set_ready(role, bool(payload.get("ready", True)))
    await emit_state(room_id)


@sio.on("start_game")
async def start_game(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        await emit_error(sid, "先にルームへ参加してください。")
        return
    room = get_room(room_id)
    role = room.sid_to_role.get(sid)
    if role not in {"p1", "p2"}:
        message = "開始できません: 観戦者はStart Gameできません。"
        await sio.emit("start_game_failed", {"message": message}, to=sid)
        return
    reason = start_game_failure_reason(room)
    if reason:
        room.engine.state.logs.append(reason)
        await sio.emit("start_game_failed", {"message": reason}, to=sid)
        await emit_state(room_id)
        return
    cancel_resolution_task(room)
    room.engine.start_turn()
    await emit_state(room_id)


@sio.on("choose_card")
async def choose_card(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = get_room(room_id)
    role = room.sid_to_role.get(sid)
    if role not in {"p1", "p2"}:
        await emit_error(sid, "観戦者はカード選択できません。")
        return
    try:
        room.engine.choose_card(role, str(payload.get("card_id", "")))
        await sio.emit("card_locked", {"player_id": role}, room=room_id)
        await emit_state(room_id)
        if room.engine.state.phase == PHASE_REVEAL and (room.resolution_task is None or room.resolution_task.done()):
            room.resolution_task = asyncio.create_task(run_resolution_sequence(room_id))
    except Exception as exc:
        await emit_error(sid, str(exc))


@sio.on("panic_stop")
async def panic_stop(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = get_room(room_id)
    cancel_resolution_task(room)
    continuous = room.engine.panic_stop(str(payload.get("reason", "panic")))
    await sio.emit("panic_stop_sync", {"reason": room.engine.state.panic_reason, "continuous_state": continuous}, room=room_id)
    await sio.emit("continuous_state", continuous, room=room_id)
    await emit_state(room_id)


@sio.on("give_up_start")
async def give_up_start(sid: str, payload: dict[str, Any]) -> None:
    await set_give_up_from_sid(sid, True)


@sio.on("give_up_end")
async def give_up_end(sid: str, payload: dict[str, Any]) -> None:
    await set_give_up_from_sid(sid, False)


async def set_give_up_from_sid(sid: str, active: bool) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = get_room(room_id)
    role = room.sid_to_role.get(sid)
    if role in {"p1", "p2"}:
        room.engine.set_give_up(role, active)
        await sio.emit("give_up_sync", {"player_id": role, "active": active}, room=room_id)
        await emit_state(room_id)


@sio.on("skip_countdown")
async def skip_countdown(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = get_room(room_id)
    if room.engine.state.phase != PHASE_COUNTDOWN:
        return
    cancel_resolution_task(room)
    room.resolution_task = asyncio.create_task(enter_continuous_once(room_id))


@sio.on("request_state")
async def request_state(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if room_id:
        await emit_state(room_id)


@sio.on("reset_game")
async def reset_game(sid: str, payload: dict[str, Any]) -> None:
    room_id = sid_to_room.get(sid)
    if not room_id:
        return
    room = get_room(room_id)
    role = room.sid_to_role.get(sid)
    if role not in {"p1", "p2"}:
        await emit_error(sid, "観戦者はリセットできません。")
        return
    cancel_resolution_task(room)
    room.engine.reset_game()
    await emit_state(room_id)


if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=PORT)
