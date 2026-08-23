#!/usr/bin/env python3
"""Small HTTP boundary between AutoPR and the official CUA Driver SDK."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import signal
import subprocess
import threading
from concurrent.futures import Future, TimeoutError as FutureTimeoutError
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Awaitable, Mapping
from urllib.parse import urlparse

from cua_driver import (
    ClickButton,
    ClickInput,
    CuaDriver,
    DragInput,
    GetCursorPositionInput,
    GetDesktopStateInput,
    GetScreenSizeInput,
    HotkeyInput,
    MoveCursorInput,
    PressKeyInput,
    ScrollBy,
    ScrollDirection,
    ScrollInput,
    TypeTextInput,
    __version__ as CUA_DRIVER_VERSION,
)
# Driver 0.21 ships these generated types but omits their root-package
# re-exports. Keeping the wheel pinned makes this SDK contract deterministic.
from cua_driver._native_contract import (
    ActionTarget,
    ClipboardReadInput,
    ClipboardWriteInput,
    CaptureScope,
    GetSessionInput,
    StartSessionInput,
)


GATEWAY_PACKAGE = "autopr-cua-gateway"
GATEWAY_VERSION = "1.3.0"
PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 1024 * 1024
REQUEST_BODY_TIMEOUT_SECONDS = 10
# End native work before the 55-second HTTP attempt so cancellation is observed.
SDK_CALL_TIMEOUT_SECONDS = 50
WINDOW_ID_PATTERN = re.compile(r"^(?:0x)?[0-9a-fA-F]+$")

COMMANDS = {
    "version",
    "open",
    "get_current_window_id",
    "get_application_windows",
    "get_window_name",
    "get_window_size",
    "get_window_position",
    "activate_window",
    "maximize_window",
    "move_cursor",
    "left_click",
    "middle_click",
    "right_click",
    "double_click",
    "drag",
    "scroll_direction",
    "type_text",
    "press_key",
    "hotkey",
    "get_desktop_state",
    "screenshot",
    "get_cursor_position",
    "get_screen_size",
    "get_agent_cursor_state",
    "copy_to_clipboard",
    "set_clipboard",
}


class GatewayInputError(ValueError):
    pass


class SessionEndedError(RuntimeError):
    pass


def _record(value: Any, name: str = "params") -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise GatewayInputError(f"{name} must be an object")
    return value


def _string(params: Mapping[str, Any], key: str, *, allow_empty: bool = False) -> str:
    value = params.get(key)
    if not isinstance(value, str) or (not allow_empty and not value):
        raise GatewayInputError(f"{key} must be a string")
    return value


def _number(params: Mapping[str, Any], key: str) -> float:
    value = params.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise GatewayInputError(f"{key} must be a number")
    return float(value)


def _integer(params: Mapping[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise GatewayInputError(f"{key} must be an integer between {minimum} and {maximum}")
    return value


def _window_id(value: Any) -> str:
    if isinstance(value, int) and value >= 0:
        return hex(value)
    if isinstance(value, str) and WINDOW_ID_PATTERN.fullmatch(value):
        return value if value.lower().startswith("0x") else f"0x{value}"
    raise GatewayInputError("window_id must be a numeric X11 window ID")


def _enum_name(value: Any) -> str | None:
    if value is None:
        return None
    name = getattr(value, "name", None)
    return str(name if name is not None else value).lower()


def _run(*args: str) -> str:
    completed = subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    return completed.stdout.strip()


def _windows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in _run("wmctrl", "-lGx").splitlines():
        fields = line.split(None, 8)
        if len(fields) < 8:
            continue
        window_id, desktop, x, y, width, height, host, wm_class = fields[:8]
        title = fields[8] if len(fields) == 9 else ""
        try:
            rows.append({
                "id": window_id,
                "desktop": int(desktop),
                "x": int(x),
                "y": int(y),
                "width": int(width),
                "height": int(height),
                "host": host,
                "class": wm_class,
                "name": title,
            })
        except ValueError:
            continue
    return rows


def _window(params: Mapping[str, Any]) -> dict[str, Any]:
    wanted = int(_window_id(params.get("window_id")), 16)
    for window in _windows():
        if int(str(window["id"]), 16) == wanted:
            return window
    raise GatewayInputError(f"X11 window {hex(wanted)} was not found")


def _structured_result(result: Any) -> dict[str, Any]:
    if result.is_error:
        detail = result.text or "CUA Driver command failed"
        if result.error_code:
            detail = f"{detail} ({result.error_code})"
        return {
            "success": False,
            "error": detail,
            "error_code": result.error_code,
        }

    data: dict[str, Any] = {}
    if result.structured_json:
        parsed = json.loads(result.structured_json)
        if isinstance(parsed, dict):
            data.update(parsed)
    if result.degraded:
        data.setdefault("degraded", True)
    return {"success": True, **data}


class CuaGatewayRuntime:
    """Own one embedded CUA runtime and keep all SDK calls on its asyncio loop."""

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, name="cua-sdk", daemon=True)
        self._thread.start()
        self._driver: Any = None
        self._lock: asyncio.Lock | None = None
        self._submit(self._initialize()).result(timeout=15)

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _submit(self, coroutine: Awaitable[dict[str, Any] | None]) -> Future[dict[str, Any] | None]:
        return asyncio.run_coroutine_threadsafe(coroutine, self._loop)

    async def _initialize(self) -> None:
        self._lock = asyncio.Lock()
        # The official application boundary is an SDK-owned same-process
        # runtime. This avoids a daemon socket, a second readiness loop, and a
        # separate runtime generation that can wedge while the desktop is live.
        driver = CuaDriver.create()
        await asyncio.wait_for(driver.metadata(), timeout=5)
        self._driver = driver
        await self._start_implicit_session()

    async def _start_implicit_session(self) -> None:
        await asyncio.wait_for(
            self._driver.start_session(StartSessionInput(
                session=None,
                capture_scope=CaptureScope.DESKTOP,
                cursor_theme=None,
            )),
            timeout=5,
        )

    def call(self, command: str, params: dict[str, Any]) -> dict[str, Any]:
        future = self._submit(self._dispatch_serialized(command, params))
        try:
            result = future.result(timeout=SDK_CALL_TIMEOUT_SECONDS)
        except FutureTimeoutError as error:
            # Cancelling the submitted coroutine releases the serialization lock
            # and prevents a timed-out GUI action from continuing behind the HTTP error.
            future.cancel()
            raise TimeoutError(
                f"CUA Driver command timed out after {SDK_CALL_TIMEOUT_SECONDS} seconds"
            ) from error
        if result is None:
            raise RuntimeError("CUA gateway returned no result")
        return result

    async def _dispatch_serialized(self, command: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._lock is None:
            raise RuntimeError("CUA Driver is not initialized")
        async with self._lock:
            try:
                result = await self._dispatch(command, params)
            except SessionEndedError:
                await self._start_implicit_session()
                return await self._dispatch(command, params)

            if result.get("success") is False and result.get("error_code") == "session_ended":
                await self._start_implicit_session()
                return await self._dispatch(command, params)

            return result

    @staticmethod
    def _target() -> Any:
        return ActionTarget.DESKTOP(display_id="primary")

    async def _cursor(self) -> tuple[float, float]:
        result = await self._driver.get_cursor_position(GetCursorPositionInput(session=None))
        data = _structured_result(result)
        if not data.get("success"):
            if data.get("error_code") == "session_ended":
                raise SessionEndedError(str(data.get("error")))
            raise RuntimeError(str(data.get("error", "CUA Driver cannot read the cursor")))
        return float(data["x"]), float(data["y"])

    async def _click(self, params: Mapping[str, Any], button: Any, count: int) -> dict[str, Any]:
        result = await self._driver.click(ClickInput(
            x=_number(params, "x"),
            y=_number(params, "y"),
            target=self._target(),
            scope=None,
            session=None,
            button=button,
            count=count,
        ))
        return _structured_result(result)

    async def _dispatch(self, command: str, params: dict[str, Any]) -> dict[str, Any]:
        if command == "version":
            return {
                "success": True,
                "protocol": PROTOCOL_VERSION,
                "package": GATEWAY_PACKAGE,
                "version": GATEWAY_VERSION,
                "driver_version": CUA_DRIVER_VERSION,
            }
        if command == "get_screen_size":
            data = _structured_result(
                await self._driver.get_screen_size(GetScreenSizeInput(session=None))
            )
            if not data.get("success"):
                return data
            return {"success": True, "size": {"width": int(data["width"]), "height": int(data["height"])}}
        if command == "get_cursor_position":
            x, y = await self._cursor()
            return {"success": True, "position": {"x": int(x), "y": int(y)}}
        if command in {"get_desktop_state", "screenshot"}:
            result = await self._driver.get_desktop_state(
                GetDesktopStateInput(session=None, screenshot_out_file=None)
            )
            data = _structured_result(result)
            if not data.get("success"):
                return data
            if not result.images:
                return {"success": False, "error": "CUA Driver returned no desktop image"}
            image = result.images[0]
            if command == "screenshot":
                return {
                    "success": True,
                    "image_data": image.data_base64,
                    "format": image.mime_type.split("/", 1)[-1],
                }
            return {
                **data,
                # The SDK image and image_data contain the same PNG. Returning
                # one copy avoids doubling every screenshot over the preview proxy.
                "image_data": image.data_base64,
                "format": image.mime_type.split("/", 1)[-1],
            }
        if command == "move_cursor":
            return _structured_result(await self._driver.move_cursor(MoveCursorInput(
                x=_number(params, "x"),
                y=_number(params, "y"),
                target=self._target(),
                scope=None,
                session=None,
            )))
        if command == "left_click":
            return await self._click(params, ClickButton.LEFT, 1)
        if command == "middle_click":
            return await self._click(params, ClickButton.MIDDLE, 1)
        if command == "right_click":
            return await self._click(params, ClickButton.RIGHT, 1)
        if command == "double_click":
            return await self._click(params, ClickButton.LEFT, 2)
        if command == "drag":
            path = params.get("path")
            if not isinstance(path, list) or len(path) < 2:
                raise GatewayInputError("path must contain at least two points")
            points: list[tuple[float, float]] = []
            for point in path:
                if not isinstance(point, list) or len(point) != 2:
                    raise GatewayInputError("each drag point must be [x, y]")
                x, y = point
                if (
                    isinstance(x, bool)
                    or isinstance(y, bool)
                    or not isinstance(x, (int, float))
                    or not isinstance(y, (int, float))
                ):
                    raise GatewayInputError("each drag point must contain numeric coordinates")
                points.append((float(x), float(y)))
            button = {
                "left": ClickButton.LEFT,
                "middle": ClickButton.MIDDLE,
                "right": ClickButton.RIGHT,
            }.get(params.get("button", "left"))
            if button is None:
                raise GatewayInputError("button must be left, middle, or right")
            duration = params.get("duration", 0.5)
            if isinstance(duration, bool) or not isinstance(duration, (int, float)):
                raise GatewayInputError("duration must be a number")
            duration_ms = max(0, min(10_000, int(float(duration) * 1000)))
            segments = list(zip(points, points[1:]))
            distances = [math.hypot(end[0] - start[0], end[1] - start[1]) for start, end in segments]
            total_distance = sum(distances)
            allocated_duration_ms = 0
            result: dict[str, Any] = {"success": True}
            cumulative_distance = 0.0
            for index, ((start, end), distance) in enumerate(zip(segments, distances)):
                cumulative_distance += distance
                if index == len(segments) - 1:
                    segment_duration_ms = duration_ms - allocated_duration_ms
                elif total_distance > 0:
                    next_duration_ms = round(duration_ms * cumulative_distance / total_distance)
                    segment_duration_ms = next_duration_ms - allocated_duration_ms
                else:
                    next_duration_ms = round(duration_ms * (index + 1) / len(segments))
                    segment_duration_ms = next_duration_ms - allocated_duration_ms
                allocated_duration_ms += segment_duration_ms
                result = _structured_result(await self._driver.drag(DragInput(
                    from_x=start[0],
                    from_y=start[1],
                    to_x=end[0],
                    to_y=end[1],
                    target=self._target(),
                    scope=None,
                    session=None,
                    duration_ms=segment_duration_ms,
                    steps=1,
                    button=button,
                    modifier=None,
                )))
                if not result.get("success"):
                    return result
            return result
        if command == "scroll_direction":
            direction = {
                "up": ScrollDirection.UP,
                "down": ScrollDirection.DOWN,
                "left": ScrollDirection.LEFT,
                "right": ScrollDirection.RIGHT,
            }.get(params.get("direction"))
            if direction is None:
                raise GatewayInputError("direction must be up, down, left, or right")
            x, y = await self._cursor()
            return _structured_result(await self._driver.scroll(ScrollInput(
                x=x,
                y=y,
                direction=direction,
                target=self._target(),
                scope=None,
                session=None,
                by=ScrollBy.LINE,
                amount=_integer(params, "clicks", 1, 1, 50),
            )))
        if command == "type_text":
            return _structured_result(await self._driver.type_text(TypeTextInput(
                text=_string(params, "text", allow_empty=True),
                target=self._target(),
                scope=None,
                session=None,
            )))
        if command == "press_key":
            return _structured_result(await self._driver.press_key(PressKeyInput(
                key=_string(params, "key"),
                target=self._target(),
                scope=None,
                session=None,
                modifiers=None,
            )))
        if command == "hotkey":
            keys = params.get("keys")
            if not isinstance(keys, list) or not keys or not all(isinstance(key, str) and key for key in keys):
                raise GatewayInputError("keys must be a non-empty string array")
            return _structured_result(await self._driver.hotkey(HotkeyInput(
                keys=keys,
                target=self._target(),
                scope=None,
                session=None,
            )))
        if command == "copy_to_clipboard":
            data = _structured_result(await self._driver.clipboard_read(
                ClipboardReadInput(include_text=True, session=None)
            ))
            if data.get("success"):
                data["content"] = data.get("text", "")
            return data
        if command == "set_clipboard":
            return _structured_result(await self._driver.clipboard_write(ClipboardWriteInput(
                text=_string(params, "text", allow_empty=True),
                image_path=None,
                file_path=None,
                session=None,
            )))
        if command == "get_agent_cursor_state":
            state = await self._driver.get_session(GetSessionInput(session=None))
            return {
                "success": True,
                "session": state.session,
                "implicit": state.implicit,
                "enabled": state.cursor_visible,
                "label_visible": state.session is not None,
                "theme": {"id": "cua.default"},
                "runtime_mode": "embedded",
            }
        if command == "open":
            target = _string(params, "target")
            parsed = urlparse(target)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise GatewayInputError("target must be an absolute HTTP(S) URL")
            return _structured_result(
                await self._driver.call_tool(
                    "launch_app",
                    json.dumps({"urls": [target]}, separators=(",", ":")),
                )
            )
        if command == "get_application_windows":
            app = params.get("app")
            windows = _windows()
            if isinstance(app, str) and app:
                needle = app.casefold()
                windows = [
                    window for window in windows
                    if needle in str(window["class"]).casefold() or needle in str(window["name"]).casefold()
                ]
            return {"success": True, "windows": [window["id"] for window in windows]}
        if command == "get_current_window_id":
            output = _run("xprop", "-root", "_NET_ACTIVE_WINDOW")
            match = re.search(r"0x[0-9a-fA-F]+", output)
            if match is None or int(match.group(0), 16) == 0:
                return {"success": True, "window_id": None}
            return {"success": True, "window_id": match.group(0)}
        if command == "get_window_name":
            return {"success": True, "name": _window(params)["name"]}
        if command == "get_window_size":
            window = _window(params)
            return {"success": True, "width": window["width"], "height": window["height"]}
        if command == "get_window_position":
            window = _window(params)
            return {"success": True, "x": window["x"], "y": window["y"]}
        if command == "activate_window":
            window_id = _window_id(params.get("window_id"))
            _run("wmctrl", "-ia", window_id)
            return {"success": True, "window_id": window_id}
        if command == "maximize_window":
            window_id = _window_id(params.get("window_id"))
            _run("wmctrl", "-ir", window_id, "-b", "add,maximized_vert,maximized_horz")
            return {"success": True, "window_id": window_id}
        raise GatewayInputError(f"unsupported command: {command}")

    def close(self) -> None:
        if self._loop.is_closed():
            return

        async def shutdown() -> None:
            if self._driver is not None:
                await self._driver.shutdown()

        try:
            self._submit(shutdown()).result(timeout=10)
        finally:
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(timeout=5)
            self._loop.close()


class GatewayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], runtime: CuaGatewayRuntime) -> None:
        super().__init__(address, GatewayHandler)
        self.runtime = runtime


class GatewayHandler(BaseHTTPRequestHandler):
    server: GatewayServer

    def log_message(self, fmt: str, *args: Any) -> None:
        logging.info("%s %s", self.client_address[0], fmt % args)

    def _json(self, status: HTTPStatus, value: Mapping[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:
        if self.path == "/status":
            self._json(HTTPStatus.OK, {
                "status": "ok",
                "os_type": "linux",
                "backend": "cua-driver",
                "features": ["official-cua-sdk", "desktop", "clipboard", "x11-windows"],
            })
            return
        if self.path == "/commands":
            self._json(HTTPStatus.OK, {
                "commands": {name: {} for name in sorted(COMMANDS)}
            })
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/cmd":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length < 1 or content_length > MAX_REQUEST_BYTES:
                raise GatewayInputError("invalid request body size")
            try:
                self.connection.settimeout(REQUEST_BODY_TIMEOUT_SECONDS)
                body = self.rfile.read(content_length)
            except TimeoutError:
                self.close_connection = True
                self._json(HTTPStatus.REQUEST_TIMEOUT, {
                    "success": False,
                    "error": "request body timed out",
                })
                return
            payload = json.loads(body)
            payload = _record(payload, "body")
            command = _string(payload, "command")
            if command not in COMMANDS:
                raise GatewayInputError(f"unsupported command: {command}")
            result = self.server.runtime.call(command, _record(payload.get("params")))
            self._json(HTTPStatus.OK, result)
        except (GatewayInputError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"success": False, "error": str(error)})
        except Exception as error:
            logging.exception("CUA gateway command failed")
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                "success": False,
                "error": str(error) or type(error).__name__,
            })


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("CUA_GATEWAY_LOG_LEVEL", "WARNING").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    host = os.environ.get("CUA_GATEWAY_HOST", "0.0.0.0")
    port = int(os.environ.get("CUA_PORT", "8765"))
    runtime = CuaGatewayRuntime()
    server = GatewayServer((host, port), runtime)

    def stop_server(_signum: int, _frame: Any) -> None:
        threading.Thread(target=server.shutdown, name="gateway-shutdown", daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    signal.signal(signal.SIGINT, stop_server)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        runtime.close()


if __name__ == "__main__":
    main()
