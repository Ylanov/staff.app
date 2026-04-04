// static/js/auth.js

import { api } from './api.js';
import { showView, formatRole, loadEventsDropdowns, setUserDisplay } from './ui.js';
import { initWebSocket, closeWebSocket } from './websockets.js';
import { loadUsers, listenForUpdates as listenForAdminUpdates } from './admin.js';
import { listenForUpdates as listenForDeptUpdates } from './department.js';
import * as deptDuty   from './dept_duty.js';
import * as combatCalc from './combat_calc.js';

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

    // Загружаем списки (бэкенд сам отфильтрует шаблоны для department)
    const dataPromises = [loadEventsDropdowns()];
    if (user.role === 'admin') {
        dataPromises.push(loadUsers());
    }

    const results = await Promise.allSettled(dataPromises);
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            console.error(`Ошибка инициализации (задача ${i}):`, result.reason);
        }
    });

    const adminModeBtn = document.getElementById('admin-mode-btn');

    if (user.role === 'admin') {
        showView('admin-view');
        listenForAdminUpdates();
        listenForDeptUpdates(); // Админу нужны оба обработчика WS

        if (adminModeBtn) {
            adminModeBtn.classList.remove('hidden');
            adminModeBtn.dataset.currentView = 'admin';
            adminModeBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Режим заполнения</span>
            `;
        }

        // Инициализируем данные Боевого Расчёта для Админа
        combatCalc.initCombatCalc(true);

    } else {
        showView('department-view');
        listenForDeptUpdates();
        if (adminModeBtn) adminModeBtn.classList.add('hidden');

        // ✅ Инициализируем графики и Боевой Расчёт ТОЛЬКО после успешной авторизации
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