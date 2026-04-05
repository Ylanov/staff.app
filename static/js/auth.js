// static/js/auth.js

import { api } from './api.js';
import { showView, formatRole, loadEventsDropdowns, setUserDisplay, showError } from './ui.js';
import { initWebSocket, closeWebSocket } from './websockets.js';

let isInitializing = false;

// ─── Логин ────────────────────────────────────────────────────────────────────

export async function handleLogin(event) {
    event.preventDefault();

    const username     = document.getElementById('username').value;
    const password     = document.getElementById('password').value;
    const loginErrorEl = document.getElementById('login-error');

    loginErrorEl.innerText = '';

    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    try {
        const response = await api.login(formData);

        if (!response.ok) {
            loginErrorEl.innerText = response.status === 401
                ? 'Неверный логин или пароль'
                : `Ошибка сервера (${response.status})`;
            return;
        }

        const data = await response.json();
        localStorage.setItem('token', data.access_token);
        await initializeUserSession();

    } catch {
        loginErrorEl.innerText = 'Ошибка соединения с сервером';
    }
}

// ─── Инициализация сессии ─────────────────────────────────────────────────────

export async function initializeUserSession() {
    if (isInitializing) return;
    isInitializing = true;

    try {
        await _doInitSession();
    } finally {
        isInitializing = false;
    }
}

async function _doInitSession() {
    const token = localStorage.getItem('token');
    if (!token) {
        showView('login-view');
        return;
    }

    let user;
    try {
        user = await api.get('/auth/me');
    } catch (error) {
        const status = error?.status ?? 0;

        if (status === 401 || status === 403) {
            logout();
        } else {
            showView('login-view');
            const loginError = document.getElementById('login-error');
            if (loginError) {
                loginError.innerText = 'Не удалось подключиться к серверу. Попробуйте ещё раз.';
            }
        }
        return;
    }

    // Сохраняем роль глобально, чтобы другие модули могли её использовать
    window.currentUserRole = user.role;

    setUserDisplay(user.username);
    initWebSocket();

    const dataPromises = [loadEventsDropdowns()];
    const adminModeBtn = document.getElementById('admin-mode-btn');

    // ─── ЛОГИКА ДЛЯ АДМИНИСТРАТОРА ───────────────────────────────────────────
    if (user.role === 'admin') {
        showView('admin-view');

        // 1. Динамический импорт: загружаем модули "на лету"
        const admin      = await import('./admin.js');
        const department = await import('./department.js');
        const combatCalc = await import('./combat_calc.js');
        const dashboard  = await import('./dashboard.js');

        // Добавляем специфичный для админа запрос в пул загрузки
        dataPromises.push(admin.loadUsers());

        // 2. Ждем выполнения всех сетевых запросов и обрабатываем ошибки
        const results = await Promise.allSettled(dataPromises);
        results.forEach((result, i) => {
            if (result.status === 'rejected') {
                console.error(`Ошибка инициализации (задача ${i}):`, result.reason);
                showError('Сетевая ошибка при загрузке данных. Обновите страницу.');
            }
        });

        // 3. Запускаем слушатели WS и рендер
        admin.listenForUpdates();
        department.listenForUpdates(); // Админу нужны оба обработчика WS

        if (adminModeBtn) {
            adminModeBtn.classList.remove('hidden');
            adminModeBtn.dataset.currentView = 'admin';
            adminModeBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Режим заполнения</span>
            `;
        }

        // Инициализируем данные Боевого Расчёта и Дашборд
        combatCalc.initCombatCalc(true);
        dashboard.initDashboard();

    // ─── ЛОГИКА ДЛЯ УПРАВЛЕНИЯ ───────────────────────────────────────────────
    } else {
        showView('department-view');
        if (adminModeBtn) adminModeBtn.classList.add('hidden');

        // 1. Динамический импорт: качаем только модули управления
        const department = await import('./department.js');
        const deptDuty   = await import('./dept_duty.js');
        const combatCalc = await import('./combat_calc.js');

        // 2. Ждем выполнения общих запросов (списки)
        const results = await Promise.allSettled(dataPromises);
        results.forEach((result, i) => {
            if (result.status === 'rejected') {
                console.error(`Ошибка инициализации (задача ${i}):`, result.reason);
                showError('Сетевая ошибка при загрузке данных. Обновите страницу.');
            }
        });

        // 3. Запускаем слушатели и инициализацию
        department.listenForUpdates();
        combatCalc.initCombatCalc(false);
        await deptDuty.loadDeptDutyData();
    }
}

// ─── Выход ────────────────────────────────────────────────────────────────────

export function logout() {
    isInitializing = false;
    localStorage.removeItem('token');
    closeWebSocket();
    window.currentUserRole = null;
    showView('login-view');
}