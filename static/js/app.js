// static/js/app.js

import * as auth       from './auth.js';
import * as ui         from './ui.js';
import * as admin      from './admin.js';
import * as department from './department.js';
import * as duty       from './duty.js';
import * as combatCalc from './combat_calc.js';

window.app = {
    deleteUser: admin.deleteUser
};

function bindEvents() {
    // Auth
    document.getElementById('login-form')?.addEventListener('submit', auth.handleLogin);
    document.getElementById('logout-btn')?.addEventListener('click', auth.logout);

    // Admin Mode Switcher
    document.getElementById('admin-mode-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.currentView === 'admin') {
            ui.showView('department-view');
            btn.dataset.currentView = 'dept';
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                <span>В панель админа</span>
            `;
            // Если список уже выбран, загружаем его слоты
            if (document.getElementById('dept-event-id')?.value) {
                department.loadMySlots();
            }
        } else {
            ui.showView('admin-view');
            btn.dataset.currentView = 'admin';
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Режим заполнения</span>
            `;
        }
    });

    // UI — вкладки: editor / users / persons / duty / combat
    const tabMap = ['editor', 'users', 'persons', 'duty', 'combat'];
    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.addEventListener('click', () => ui.switchAdminTab(tabMap[index] ?? 'editor'));
    });

    // Admin
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

    // Department
    document.getElementById('load-slots-btn')?.addEventListener('click', department.loadMySlots);
    const slotsTbody = document.getElementById('slots-tbody');
    slotsTbody?.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const slotId = e.target.closest('tr')?.dataset.slotId;
            if (slotId) department.saveSlot(slotId);
        }
    });

    // База людей
    ui.initPersonsTab();

    // Автодополнение ФИО
    ui.initAutocomplete();

    // Планировщик расписания
    admin.initSchedule();

    // Графики наряда
    duty.initDuty();

    // Рендерим сетку расписания когда панель открывается
    document.querySelectorAll('.tool-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.panel === 'panel-schedule') {
                setTimeout(() => admin.renderScheduleGrid(), 50);
            }
        });
    });

    // Инициализация боевого расчёта (для управления)
    combatCalc.initCombatCalc(false);

    // В обработчике переключения на вкладку «Боевой расчёт» (управление)
    document.getElementById('cc-dept-tab-btn')?.addEventListener('click', () => {
        document.getElementById('dept-combat-calc')?.classList.toggle('hidden');
        combatCalc.loadCombatInstances();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    auth.initializeUserSession();
});