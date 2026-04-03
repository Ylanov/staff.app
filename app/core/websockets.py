# app/core/websockets.py

import json
import asyncio
from typing import List

from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Принимает новое WebSocket-соединение и добавляет его в список активных."""
        try:
            await websocket.accept()
        except Exception:
            # Клиент мог отвалиться до accept
            return

        async with self._lock:
            self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Удаляет соединение из списка активных."""
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        """Рассылает сообщение всем подключённым клиентам."""
        text = json.dumps(message)

        async with self._lock:
            targets = list(self.active_connections)

        failed: List[WebSocket] = []

        for connection in targets:
            try:
                await connection.send_text(text)
            except Exception:
                failed.append(connection)

        if failed:
            async with self._lock:
                for ws in failed:
                    if ws in self.active_connections:
                        self.active_connections.remove(ws)


# Глобальный менеджер подключений
manager = ConnectionManager()


# ─── WebSocket endpoint handler ───────────────────────────────────────────────

async def handle_websocket_connection(websocket: WebSocket) -> None:
    """
    Основной обработчик WebSocket-соединения.
    Вызывается из main.py — вся логика в одном месте, без дублирования.

    - Принимает подключение
    - Отвечает на ping (heartbeat) → pong
    - Корректно различает штатное отключение (WebSocketDisconnect) от ошибок
    - Гарантированно удаляет соединение из менеджера при выходе
    """
    await manager.connect(websocket)
    print("🔌 WebSocket connected")

    try:
        while True:
            data = await websocket.receive_text()

            if not data:
                continue

            try:
                payload = json.loads(data)
            except (json.JSONDecodeError, AttributeError):
                print(f"⚠️  WS invalid JSON: {data!r}")
                continue

            if payload.get("type") == "ping":
                try:
                    await websocket.send_text('{"type":"pong"}')
                except Exception:
                    # Не удалось отправить pong — соединение мертво
                    break

    except WebSocketDisconnect:
        # Штатное отключение клиента — не ошибка, не логируем как ошибку
        print("❌ WebSocket disconnected")

    except Exception as error:
        print(f"🔥 WebSocket error: {error}")

    finally:
        # Гарантированно очищаем — выполняется при любом исходе
        await manager.disconnect(websocket)