// static/js/department.js

import { api } from './api.js';
import { showError, updateDeptCardProgress, formatRole } from './ui.js';

// ─── Состояние модуля ─────────────────────────────────────────────────────────
let groupedData    = {};
let activeGroup    = null;
let isListening    = false;
let currentEventId = null; // кэш, чтобы не читать DOM при каждом WS-событии

// ─── Вспомогательные функции ──────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

function esc(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── Группировка данных ───────────────────────────────────────────────────────

function groupBy(array, keyFn) {
    return array.reduce((acc, item) => {
        const key = keyFn(item);
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});
}

// ─── Основной рендер ──────────────────────────────────────────────────────────

async function renderMySlots(eventId, isSilentUpdate = false) {
    const focusId = isSilentUpdate ? document.activeElement?.id : null;

    try {
        const slots = await api.get(`/slots/events/${eventId}/my-slots`);

        groupedData = groupBy(slots, slot => slot.group.name);

        updateDeptCardProgress(eventId, slots);

        renderGroupButtons();

        const targetGroup = (activeGroup && groupedData[activeGroup])
            ? activeGroup
            : Object.keys(groupedData)[0];

        if (targetGroup) {
            renderGroupTable(targetGroup);
        } else {
            const tableWrap = el('slots-table-wrap');
            if (tableWrap) tableWrap.classList.add('hidden');
        }

        if (focusId) {
            const focused = el(focusId);
            if (focused) {
                focused.focus();
                const len = focused.value.length;
                focused.setSelectionRange(len, len);
            }
        }

    } catch (error) {
        console.error(error);
        showError('Ошибка загрузки задач');
    }
}

// ─── Кнопки групп ────────────────────────────────────────────────────────────

function renderGroupButtons() {
    const container = el('groups-container');
    container.innerHTML = '';

    Object.keys(groupedData).forEach(groupName => {
        const button = document.createElement('div');
        button.className = 'chip';
        button.textContent = groupName;

        if (groupName === activeGroup) {
            button.classList.add('active');
        }

        button.addEventListener('click', () => {
            activeGroup = groupName;

            container.querySelectorAll('.chip').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');

            renderGroupTable(groupName);
        });

        container.appendChild(button);
    });
}

// ─── Таблица группы ───────────────────────────────────────────────────────────

function renderGroupTable(groupName) {
    activeGroup = groupName;

    const tbody     = el('slots-tbody');
    const tableWrap = el('slots-table-wrap');
    const groupSlots = groupedData[groupName] || [];

    const isAdmin = window.currentUserRole === 'admin';

    tbody.innerHTML = groupSlots.map(slot => `
        <tr data-slot-id="${slot.id}" data-version="${slot.version || 1}">
            <td>
                ${esc(slot.position?.name || '-')}
                ${isAdmin ? `<br><span style="font-size:0.75em; color:var(--md-primary); font-weight:500;">Квота: ${esc(formatRole(slot.department))}</span>` : ''}
            </td>
            <td><input id="rank-${slot.id}" value="${esc(slot.rank)}" placeholder="Звание"></td>
            <td><input id="name-${slot.id}" value="${esc(slot.full_name)}" placeholder="Фамилия Имя Отчество"></td>
            <td><input id="doc-${slot.id}"  value="${esc(slot.doc_number)}" placeholder="Номер документа"></td>
            <td>${esc(slot.callsign || '-')}</td>
            <td>
                <button class="btn btn-success btn-sm" data-slot-id="${slot.id}">
                    Сохранить
                </button>
            </td>
        </tr>
    `).join('');

    if (tableWrap) {
        tableWrap.classList.remove('hidden');
    }
}

// ─── Загрузка ─────────────────────────────────────────────────────────────────

export function loadMySlots() {
    const eventId = el('dept-event-id').value;

    if (!eventId) return showError('Выберите список из выпадающего меню');

    currentEventId = eventId;
    renderMySlots(eventId);
}

// ─── Сохранение ───────────────────────────────────────────────────────────────

export async function saveSlot(slotId) {
    const tr             = document.querySelector(`tr[data-slot-id="${slotId}"]`);
    const currentVersion = tr && tr.dataset.version ? parseInt(tr.dataset.version, 10) : 1;

    const data = {
        version:    currentVersion,
        rank:       el(`rank-${slotId}`).value,
        full_name:  el(`name-${slotId}`).value,
        doc_number: el(`doc-${slotId}`).value,
    };

    try {
        const updatedSlot = await api.patch(`/slots/${slotId}`, data);

        if (tr && updatedSlot?.version != null) {
            tr.dataset.version = updatedSlot.version;
        }

        if (window.showSnackbar) {
            window.showSnackbar('Данные успешно сохранены', 'success');
        }
    } catch (error) {
        console.error('saveSlot error:', error);

        if (error.status === 409) {
            showError('Внимание! Кто-то уже изменил эту строку. Данные сейчас обновятся, проверьте их перед сохранением.');
        } else {
            showError('Ошибка сохранения');
        }
    }
}

// ─── WS-обновления ───────────────────────────────────────────────────────────

export function listenForUpdates() {
    if (isListening) return;
    isListening = true;

    document.addEventListener('datachanged', ({ detail }) => {
        if (currentEventId && currentEventId == detail.eventId) {
            renderMySlots(currentEventId, true);
        }
    });

    // Кнопка "К спискам"
    const backBtn = document.getElementById('dept-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('dept-content')?.classList.add('hidden');
            document.querySelectorAll('.dept-event-card').forEach(c => c.classList.remove('active'));
            currentEventId = null;
        });
    }

    // Обработка клика по карточкам списков
    const grid = document.getElementById('dept-event-cards');
    if (grid) {
        grid.addEventListener('click', (e) => {
            const card = e.target.closest('.dept-event-card');
            if (!card) return;

            const eventId    = card.dataset.eventId;
            const eventTitle = card.dataset.eventTitle;

            grid.querySelectorAll('.dept-event-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            // Синхронизируем скрытый select (совместимость с ui.js)
            const selectEl = el('dept-event-id');
            if (selectEl) selectEl.value = eventId;

            const content = document.getElementById('dept-content');
            if (content) content.classList.remove('hidden');

            setTimeout(() => {
                content?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 60);

            currentEventId = eventId;
            renderMySlots(eventId);
        });
    }
}