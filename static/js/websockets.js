// static/js/websockets.js

// ─── Состояние модуля ─────────────────────────────────────────────────────────
let ws                = null;
let reconnectTimeout  = null;
let reconnectAttempts = 0;
let heartbeatInterval = null;

// 🔥 Контроль последнего pong
let lastPongTimestamp = Date.now();

const MAX_RECONNECT_DELAY = 30_000; // максимум 30 сек
const BASE_DELAY          = 1_000;  // старт 1 сек

// ─── Создание соединения ──────────────────────────────────────────────────────

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl    = `${protocol}//${window.location.host}/ws`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
        console.log('✅ WebSocket connected');
        reconnectAttempts = 0;

        // Сбрасываем таймер pong
        lastPongTimestamp = Date.now();

        startHeartbeat();
    };

    ws.onmessage = function (event) {
        try {
            const data = JSON.parse(event.data);

            // Обработка pong
            if (data.type === 'pong') {
                lastPongTimestamp = Date.now();
                console.log('💓 pong received');
                return;
            }

            // Игнорируем служебные сообщения (pong и т.п.), реагируем на обновления
            if (data.action === 'update') {
                console.log('📩 WS message [update]:', data);
                document.dispatchEvent(
                    new CustomEvent('datachanged', { detail: { eventId: data.event_id } })
                );
            }

            // Обновления боевого расчёта
            if (data.action === 'combat_calc_update' || data.action === 'combat_calc_slot_update') {
                console.log(`📩 WS message [${data.action}]:`, data);
                document.dispatchEvent(
                    new CustomEvent('datachanged', { detail: data })
                );
            }

        } catch (error) {
            console.error('❌ WS JSON parse error:', error);
        }
    };

    ws.onclose = function (event) {
        console.warn(`⚠️ WebSocket closed: code=${event.code}, reason=${event.reason}`);
        stopHeartbeat();
        scheduleReconnect();
    };

    ws.onerror = function (error) {
        // onerror всегда сопровождается onclose — реконнект запустится там.
        // Здесь только логируем, явный ws.close() не нужен: браузер закроет сам.
        console.error('🔥 WebSocket error:', error);
    };
}

// ─── Реконнект с экспоненциальной задержкой ───────────────────────────────────

function scheduleReconnect() {
    // Если таймер уже запущен — не дублируем
    if (reconnectTimeout) return;

    reconnectAttempts += 1;

    const delay = Math.min(BASE_DELAY * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
    console.log(`🔄 Reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts})`);

    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
    }, delay);
}

// ─── Heartbeat — держим соединение живым ──────────────────────────────────────

function startHeartbeat() {
    stopHeartbeat(); // защита от двойного запуска

    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {

            // Проверка "живости" соединения
            const now = Date.now();
            const timeSinceLastPong = now - lastPongTimestamp;

            if (timeSinceLastPong > 30000) {
                console.warn('💀 No pong received for 30s, reconnecting...');
                ws.close();
                return;
            }

            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 10_000); // каждые 10 сек
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// ─── Публичный API ────────────────────────────────────────────────────────────

/**
 * Безопасная отправка сообщения.
 * Если соединение не готово — сообщение молча отбрасывается с предупреждением.
 */
export function sendMessage(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('⚠️ WebSocket not ready, message not sent');
        return;
    }
    ws.send(JSON.stringify(data));
}

/**
 * Инициализация соединения.
 * Проверяем оба «живых» состояния — CONNECTING и OPEN.
 */
export function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('ℹ️ WebSocket already active');
        return;
    }
    connect();
}

/**
 * Ручное закрытие (при logout).
 */
export function closeWebSocket() {
    console.log('🛑 Closing WebSocket manually');

    // Отменяем запланированный реконнект, если есть
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    stopHeartbeat();

    // Сбрасываем счётчик попыток, чтобы следующая сессия начиналась с 1 секунды
    reconnectAttempts = 0;

    if (ws) {
        ws.onclose = null; // отключаем авто-реконнект перед принудительным закрытием
        ws.onerror = null; // убираем и onerror, чтобы не получить лишний лог после close
        ws.close();
        ws = null;
    }
}