// static/js/app.js

import * as auth       from './auth.js';
import * as ui         from './ui.js';
import * as admin      from './admin.js';
import * as department from './department.js';
import * as duty       from './duty.js';
import * as combatCalc from './combat_calc.js';
import * as deptDuty   from './dept_duty.js';
import * as dashboard  from './dashboard.js';
// Подключаем статически — модуль регистрирует window.openSlotHistory
// при импорте, чтобы inline-кнопка в таблице слотов его видела.
import './slot_history.js';
// Центр уведомлений — инициализируется через notifications.initNotifications()
// вызываемый в auth.js после логина (чтобы /notifications не дёргался до JWT).
import * as notifications from './notifications.js';

window.app = {
    deleteUser:      admin.deleteUser,
    // Вызывается из auth.js после подтверждения роли admin
    initDashboard:   () => dashboard.initDashboard(),
};

// ─── Permissions → видимость вкладок управления ──────────────────────────────
//
// Вызывается из auth.js после получения /auth/me: скрывает кнопки-вкладок,
// которых нет в user.permissions. Admin всегда получает полный набор
// (бэкенд так возвращает), поэтому для него ничего не скрывается.
//
// ВАЖНО: это только UI-фильтр. Бэкенд параллельно отклоняет API-вызовы
// через require_permission, поэтому обход через devtools не сработает —
// будет 403.
const PERM_TAB_MAP = {
    'lists':   'dept-main-tab-btn',
    'duty':    'dept-duty-tab-btn',
    'combat':  'cc-dept-tab-btn',
    'tasks':   'dept-tasks-tab-btn',
    'persons': 'dept-persons-tab-btn',
};

export function applyPermissionsToTabs(permissions) {
    const perms = new Set(Array.isArray(permissions) ? permissions : []);
    Object.entries(PERM_TAB_MAP).forEach(([perm, btnId]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.style.display = perms.has(perm) ? '' : 'none';
    });

    // Если текущая активная вкладка скрыта (например админ только что
    // убрал доступ) — переключаемся на первую доступную. Так пользователь
    // не застревает на 404/403.
    const firstAvailable = Object.keys(PERM_TAB_MAP).find(p => perms.has(p));
    if (firstAvailable) {
        const firstBtn = document.getElementById(PERM_TAB_MAP[firstAvailable]);
        const activeHidden = Object.values(PERM_TAB_MAP).some(id => {
            const b = document.getElementById(id);
            return b && b.classList.contains('btn-filled') && b.style.display === 'none';
        });
        if (activeHidden && firstBtn) firstBtn.click();
    }
}

// Делаем доступным без циклического импорта между auth.js и app.js
window._applyPermissionsToTabs = applyPermissionsToTabs;

// ─── Переключение вкладок управления (Department View) ───────────────────────

let _tasksDeptInited   = false;
let _deptPersonsInited = false;

function switchDeptTab(tab) {
    document.getElementById('dept-event-cards')?.classList.add('hidden');
    document.getElementById('dept-content')?.classList.add('hidden');
    document.getElementById('dept-combat-calc')?.classList.add('hidden');
    document.getElementById('dept-duty-panel')?.classList.add('hidden');
    document.getElementById('dept-tasks-panel')?.classList.add('hidden');
    document.getElementById('dept-persons-panel')?.classList.add('hidden');

    // Сбрасываем активный стиль у всех кнопок управления
    const resetBtn = (id) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.remove('btn-filled');
        b.classList.add('btn-outlined');
    };
    ['dept-main-tab-btn', 'cc-dept-tab-btn', 'dept-duty-tab-btn',
     'dept-tasks-tab-btn', 'dept-persons-tab-btn'].forEach(resetBtn);

    const activateBtn = (id) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.remove('btn-outlined');
        b.classList.add('btn-filled');
    };

    if (tab === 'lists') {
        document.getElementById('dept-event-cards')?.classList.remove('hidden');
        activateBtn('dept-main-tab-btn');
    } else if (tab === 'combat') {
        document.getElementById('dept-combat-calc')?.classList.remove('hidden');
        activateBtn('cc-dept-tab-btn');
        combatCalc.loadCombatInstances();
    } else if (tab === 'duty') {
        document.getElementById('dept-duty-panel')?.classList.remove('hidden');
        activateBtn('dept-duty-tab-btn');
        deptDuty.loadDeptSchedules();
    } else if (tab === 'tasks') {
        document.getElementById('dept-tasks-panel')?.classList.remove('hidden');
        activateBtn('dept-tasks-tab-btn');
        import('./tasks.js').then(m => {
            if (!_tasksDeptInited) {
                m.initTasks('tasks-root-dept', false);
                _tasksDeptInited = true;
            } else {
                m.reloadTasks();
            }
        });
    } else if (tab === 'persons') {
        document.getElementById('dept-persons-panel')?.classList.remove('hidden');
        activateBtn('dept-persons-tab-btn');
        // Первый заход — рисуем разметку через _renderShell + грузим.
        // Следующие — только reload данных (сохраняется состояние mode/поиска).
        import('./dept_persons.js').then(m => {
            if (!_deptPersonsInited) {
                m.initDeptPersons();
                _deptPersonsInited = true;
            } else {
                m.loadDeptPersons();
            }
        });
    }
}

// ─── Привязка событий ─────────────────────────────────────────────────────────

function bindEvents() {

    // Auth
    document.getElementById('login-form')?.addEventListener('submit', auth.handleLogin);
    document.getElementById('logout-btn')?.addEventListener('click', auth.logout);

    // Admin Mode Switcher (кнопка переключения вид админа ↔ вид управления)
    document.getElementById('admin-mode-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.currentView === 'admin') {
            ui.showView('department-view');
            btn.dataset.currentView = 'dept';
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                <span>В панель админа</span>
            `;
            switchDeptTab('lists');
            if (document.getElementById('dept-event-id')?.value) {
                department.loadMySlots();
            }
        } else {
            ui.showView('admin-view');
            btn.dataset.currentView = 'admin';
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>Режим заполнения</span>
            `;
        }
    });

    // ── Вкладки панели Администратора ────────────────────────────────────────
    // Порядок: dashboard, editor, history, users, persons, duty, combat, calendar
    const tabMap = ['dashboard', 'editor', 'history', 'users', 'persons', 'duty', 'combat', 'calendar'];
    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => ui.switchAdminTab(tabMap[index] ?? 'dashboard'));
    });

    // ── Действия Администратора ───────────────────────────────────────────────
    document.getElementById('create-event-btn')?.addEventListener('click', admin.handleCreateEvent);
    document.getElementById('instantiate-template-btn')?.addEventListener('click', admin.handleInstantiateTemplate);
    document.getElementById('editor-is-template-cb')?.addEventListener('change', admin.toggleCurrentEventTemplate);
    document.getElementById('add-group-btn')?.addEventListener('click', admin.handleAddGroup);
    document.getElementById('load-editor-btn')?.addEventListener('click', admin.loadAdminEditor);
    // Автозагрузка при выборе шаблона в выпадающем списке
    document.getElementById('editor-event-id')?.addEventListener('change', admin.autoLoadEditorOnChange);
    document.getElementById('editor-toggle-status-btn')?.addEventListener('click', admin.toggleEventStatus);
    document.getElementById('editor-delete-event-btn')?.addEventListener('click', admin.handleDeleteEvent);
    document.getElementById('create-user-btn')?.addEventListener('click', admin.handleCreateUser);
    document.getElementById('export-btn')?.addEventListener('click', admin.exportWord);
    document.getElementById('duty-save-btn')?.addEventListener('click', admin.saveDutyOfficer);

    // Должности
    document.getElementById('add-position-btn')?.addEventListener('click', admin.handleAddPosition);
    document.getElementById('position-event-id')?.addEventListener('change', admin.loadAndRenderPositions);
    document.getElementById('positions-list')?.addEventListener('click', (e) => {
        const delPosId = e.target.dataset.delPosId;
        if (delPosId) admin.handleDeletePosition(delPosId);
    });

    // Делегирование событий для таблицы админа
    const masterTbody = document.getElementById('master-tbody');
    masterTbody?.addEventListener('change', (e) => {
        const slotId = e.target.closest('tr')?.dataset.slotId;
        if (slotId) admin.updateAdminSlot(slotId);
    });
    masterTbody?.addEventListener('click', (e) => {
        const deleteId = e.target.dataset.deleteId;
        const groupId  = e.target.dataset.groupId;
        if (deleteId) admin.deleteSlot(deleteId);
        if (groupId)  admin.addBlankRow(groupId);
    });

    // ── Действия управления (Department) ─────────────────────────────────────
    document.getElementById('load-slots-btn')?.addEventListener('click', department.loadMySlots);
    const slotsTbody = document.getElementById('slots-tbody');
    slotsTbody?.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const slotId = e.target.closest('tr')?.dataset.slotId;
            if (slotId) department.saveSlot(slotId);
        }
    });

    // Вкладки управления (Списки / Графики / Боевой расчёт / Календарь / База людей)
    document.getElementById('dept-main-tab-btn')?.addEventListener('click',    () => switchDeptTab('lists'));
    document.getElementById('cc-dept-tab-btn')?.addEventListener('click',      () => switchDeptTab('combat'));
    document.getElementById('dept-duty-tab-btn')?.addEventListener('click',    () => switchDeptTab('duty'));
    document.getElementById('dept-tasks-tab-btn')?.addEventListener('click',   () => switchDeptTab('tasks'));
    document.getElementById('dept-persons-tab-btn')?.addEventListener('click', () => switchDeptTab('persons'));

    // ── Инициализация UI-компонентов (без API-вызовов) ────────────────────────
    ui.initPersonsTab();
    ui.initAutocomplete();
    admin.initSchedule();
    admin.initUsersTab();   // чекбоксы permissions в форме «+ Добавить пользователя»

    // Графики наряда (Администратор) — только привязка событий
    duty.initDuty();

    // Рендерим сетку расписания когда панель открывается
    document.querySelectorAll('.tool-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.panel === 'panel-schedule') {
                setTimeout(() => admin.renderScheduleGrid(), 50);
            }
        });
    });

    // Графики нарядов (Управление) — только привязка событий, без API
    deptDuty.bindDeptDutyEvents();

    // ВАЖНО: combatCalc.initCombatCalc(false) и dashboard.initDashboard()
    // вызываются в auth.js -> _doInitSession() ПОСЛЕ подтверждения токена,
    // чтобы не провоцировать 401 до авторизации.
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    auth.initializeUserSession();
});
