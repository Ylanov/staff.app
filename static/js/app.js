// static/js/app.js

import * as auth       from './auth.js';
import * as ui         from './ui.js';
import * as admin      from './admin.js';
import * as department from './department.js';
import * as duty       from './duty.js';
import * as combatCalc from './combat_calc.js';
import * as deptDuty   from './dept_duty.js';
import * as dashboard  from './dashboard.js';

window.app = {
    deleteUser:      admin.deleteUser,
    // Вызывается из auth.js после подтверждения роли admin
    initDashboard:   () => dashboard.initDashboard(),
};

// ─── Переключение вкладок управления (Department View) ───────────────────────

function switchDeptTab(tab) {
    document.getElementById('dept-event-cards')?.classList.add('hidden');
    document.getElementById('dept-content')?.classList.add('hidden');
    document.getElementById('dept-combat-calc')?.classList.add('hidden');
    document.getElementById('dept-duty-panel')?.classList.add('hidden');

    // Сбрасываем активный стиль у всех кнопок управления
    document.getElementById('dept-main-tab-btn')?.classList.remove('btn-filled');
    document.getElementById('dept-main-tab-btn')?.classList.add('btn-outlined');
    document.getElementById('cc-dept-tab-btn')?.classList.remove('btn-filled');
    document.getElementById('cc-dept-tab-btn')?.classList.add('btn-outlined');
    document.getElementById('dept-duty-tab-btn')?.classList.remove('btn-filled');
    document.getElementById('dept-duty-tab-btn')?.classList.add('btn-outlined');

    if (tab === 'lists') {
        document.getElementById('dept-event-cards')?.classList.remove('hidden');
        document.getElementById('dept-main-tab-btn')?.classList.remove('btn-outlined');
        document.getElementById('dept-main-tab-btn')?.classList.add('btn-filled');
    } else if (tab === 'combat') {
        document.getElementById('dept-combat-calc')?.classList.remove('hidden');
        document.getElementById('cc-dept-tab-btn')?.classList.remove('btn-outlined');
        document.getElementById('cc-dept-tab-btn')?.classList.add('btn-filled');
        combatCalc.loadCombatInstances();
    } else if (tab === 'duty') {
        document.getElementById('dept-duty-panel')?.classList.remove('hidden');
        document.getElementById('dept-duty-tab-btn')?.classList.remove('btn-outlined');
        document.getElementById('dept-duty-tab-btn')?.classList.add('btn-filled');
        deptDuty.loadDeptSchedules();
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
    // Порядок: dashboard, editor, users, persons, duty, combat
    const tabMap = ['dashboard', 'editor', 'users', 'persons', 'duty', 'combat'];
    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => ui.switchAdminTab(tabMap[index] ?? 'dashboard'));
    });

    // ── Действия Администратора ───────────────────────────────────────────────
    document.getElementById('create-event-btn')?.addEventListener('click', admin.handleCreateEvent);
    document.getElementById('instantiate-template-btn')?.addEventListener('click', admin.handleInstantiateTemplate);
    document.getElementById('editor-is-template-cb')?.addEventListener('change', admin.toggleCurrentEventTemplate);
    document.getElementById('add-group-btn')?.addEventListener('click', admin.handleAddGroup);
    document.getElementById('load-editor-btn')?.addEventListener('click', admin.loadAdminEditor);
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

    // Вкладки управления (Списки / Графики / Боевой расчёт)
    document.getElementById('dept-main-tab-btn')?.addEventListener('click', () => switchDeptTab('lists'));
    document.getElementById('cc-dept-tab-btn')?.addEventListener('click',   () => switchDeptTab('combat'));
    document.getElementById('dept-duty-tab-btn')?.addEventListener('click', () => switchDeptTab('duty'));

    // ── Инициализация UI-компонентов (без API-вызовов) ────────────────────────
    ui.initPersonsTab();
    ui.initAutocomplete();
    admin.initSchedule();

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