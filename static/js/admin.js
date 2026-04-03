// static/js/admin.js

import { api } from './api.js';
import { showError, showSuccess, formatRole, loadEventsDropdowns, getCachedEvents } from './ui.js';

// ─── Локальный кэш ────────────────────────────────────────────────────────────
let availablePositions   = [];
let availableDepartments = [];
let currentEditorEventId = null;
let currentColumns       = []; // активная конфигурация столбцов загруженного списка

// ─── Столбцы по умолчанию (зеркало Python DEFAULT_COLUMNS) ───────────────────
const DEFAULT_COLUMNS = [
    { key: 'full_name',   label: 'ФИО',         type: 'text',            order: 0, visible: true },
    { key: 'rank',        label: 'Звание',       type: 'text',            order: 1, visible: true },
    { key: 'doc_number',  label: '№ Документа',  type: 'text',            order: 2, visible: true },
    { key: 'position_id', label: 'Должность',    type: 'select_position', order: 3, visible: true },
    { key: 'callsign',    label: 'Позывной',     type: 'text',            order: 4, visible: true },
    { key: 'department',  label: 'Квота',        type: 'select_dept',     order: 5, visible: true },
    { key: 'note',        label: 'Примечание',   type: 'text',            order: 6, visible: true },
];

// Встроенные ключи: у них есть своё поле в Slot; остальные — кастомные (extra_data)
const BUILTIN_KEYS = new Set(['full_name','rank','doc_number','position_id','callsign','department','note']);

// Маппинг key → префикс id инпута (совместимость с автодополнением ui.js)
const FIELD_INPUT_PREFIX = {
    full_name:  'name',
    rank:       'rank',
    doc_number: 'doc',
    callsign:   'call',
    note:       'note',
};

// ─── Хелперы ─────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function esc(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');
}

function notify(message, type = 'success') {
    if (typeof window.showSnackbar === 'function') window.showSnackbar(message, type);
}

// ─── Управление списками ──────────────────────────────────────────────────────

export async function handleCreateEvent() {
    const title      = el('event-title').value.trim();
    const isTemplate = el('event-is-template')?.checked || false;
    if (!title) return showError('Введите название списка');
    try {
        await api.post('/admin/events', { title, is_template: isTemplate });
        notify('Список создан!');
        el('event-title').value = '';
        if (el('event-is-template')) el('event-is-template').checked = false;
        await loadEventsDropdowns();
    } catch (e) { console.error('handleCreateEvent:', e); showError('Ошибка создания списка'); }
}

export async function handleAddGroup() {
    const eventId   = el('group-event-id').value;
    const groupName = el('group-name').value.trim();
    if (!eventId || !groupName) return showError('Выберите список и введите название группы');
    try {
        await api.post(`/admin/events/${eventId}/groups`, { name: groupName, order_num: 1 });
        notify('Группа добавлена!');
        el('group-name').value = '';
    } catch (e) { console.error('handleAddGroup:', e); showError('Ошибка добавления группы'); }
}

export async function handleDeleteEvent() {
    if (!currentEditorEventId) return;
    if (!confirm('Вы уверены, что хотите удалить этот список?\n\nВсе группы, добавленные должности и заполненные управлениями данные будут безвозвратно удалены!')) return;
    try {
        await api.delete(`/admin/events/${currentEditorEventId}`);
        notify('Список успешно удалён');
        currentEditorEventId = null;
        el('editor-container').classList.add('hidden');
        el('editor-empty').classList.remove('hidden');
        await loadEventsDropdowns();
    } catch (e) { console.error('handleDeleteEvent:', e); showError('Ошибка при удалении списка'); }
}

// ─── Управление должностями ───────────────────────────────────────────────────

export async function loadAndRenderPositions() {
    const eventId   = el('position-event-id').value;
    const container = el('positions-list');
    if (!container) return;
    if (!eventId) { container.innerHTML = '<p class="hint">Выберите список</p>'; return; }
    try {
        const positions = await api.get(`/admin/events/${eventId}/positions`);
        container.innerHTML = positions.length
            ? positions.map(p => `
                <div class="position-item">
                    <span>${esc(p.name)}</span>
                    <button class="btn-tiny-danger" data-del-pos-id="${p.id}" title="Удалить должность">✕</button>
                </div>`).join('')
            : '<p class="hint">Нет должностей — добавьте первую</p>';
    } catch (e) { console.error('loadAndRenderPositions:', e); showError('Ошибка загрузки должностей'); }
}

export async function handleAddPosition() {
    const eventId   = el('position-event-id').value;
    const nameInput = el('new-position-name');
    const name      = nameInput?.value.trim();
    if (!eventId || !name) return showError('Сначала выберите список, затем введите название должности');
    try {
        await api.post(`/admin/events/${eventId}/positions`, { name });
        nameInput.value = '';
        await loadAndRenderPositions();
    } catch (e) { console.error('handleAddPosition:', e); showError('Ошибка добавления должности'); }
}

export async function handleDeletePosition(positionId) {
    if (!confirm('Удалить должность? Она будет убрана у всех сотрудников.')) return;
    try {
        await api.delete(`/admin/positions/${positionId}`);
        notify('Должность удалена');
        await loadAndRenderPositions();
    } catch (e) { console.error('handleDeletePosition:', e); showError('Ошибка удаления должности'); }
}

// ─── Редактор таблицы ─────────────────────────────────────────────────────────

function buildPositionOptions(selectedId) {
    return availablePositions.reduce(
        (html, p) => html + `<option value="${p.id}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`,
        '<option value="">— Должность —</option>'
    );
}

function buildDeptOptions(selectedDept) {
    return availableDepartments.reduce(
        (html, username) => html + `<option value="${username}"${username === selectedDept ? ' selected' : ''}>${esc(formatRole(username))}</option>`,
        '<option value="">— Управление —</option>'
    );
}

/**
 * Строит <td> для одного столбца в одной строке (слоте).
 */
function buildCell(col, slot) {
    switch (col.type) {
        case 'select_position':
            return `<td><select id="pos-${slot.id}">${buildPositionOptions(slot.position_id)}</select></td>`;

        case 'select_dept':
            return `<td><select id="dept-${slot.id}">${buildDeptOptions(slot.department)}</select></td>`;

        default: { // text + кастомные
            let inputId, rawVal;
            if (FIELD_INPUT_PREFIX[col.key]) {
                // Стандартный текстовый столбец — legacy-id для совместимости с автодополнением
                inputId = `${FIELD_INPUT_PREFIX[col.key]}-${slot.id}`;
                rawVal  = slot[col.key] ?? '';
            } else {
                // Кастомный столбец — читаем из extra_data
                inputId = `cx-${col.key}-${slot.id}`;
                rawVal  = slot.extra_data?.[col.key] ?? '';
            }
            return `<td><input id="${inputId}" value="${esc(rawVal)}" placeholder="${esc(col.label)}"></td>`;
        }
    }
}

async function renderAdminEditor(eventId, isSilentUpdate = false) {
    const focusId    = isSilentUpdate ? document.activeElement?.id    : null;
    const focusValue = isSilentUpdate ? document.activeElement?.value : null;

    try {
        const [positions, data] = await Promise.all([
            api.get(`/admin/events/${eventId}/positions`),
            api.get(`/admin/events/${eventId}/full`),
        ]);

        availablePositions = positions;

        // Сохраняем конфигурацию столбцов
        const allCols = data.columns || DEFAULT_COLUMNS;
        currentColumns = [...allCols].sort((a, b) => a.order - b.order);
        const visibleCols = currentColumns.filter(c => c.visible !== false);

        el('editor-container')?.classList.remove('hidden');
        el('editor-empty')?.classList.add('hidden');

        if (el('editor-title')) el('editor-title').textContent = data.event.title;

        const toggleWrap = el('editor-template-toggle-wrap');
        const cb = el('editor-is-template-cb');
        if (toggleWrap && cb) {
            toggleWrap.classList.remove('hidden');
            cb.checked = data.event.is_template;
        }

        const statusBtn = el('editor-toggle-status-btn');
        if (statusBtn) {
            if (data.event.is_template) {
                statusBtn.classList.add('hidden');
            } else {
                statusBtn.classList.remove('hidden');
                const isActive       = data.event.status === 'active';
                statusBtn.textContent    = isActive ? '⏸ Деактивировать' : '▶ Активировать для управлений';
                statusBtn.className      = `btn btn-sm ${isActive ? 'btn-outlined' : 'btn-success'}`;
                statusBtn.dataset.status = data.event.status;
            }
        }

        // Инжектируем кнопку «⚙ Столбцы» в тулбар (только один раз)
        if (!el('editor-columns-btn')) {
            const toolbar = document.querySelector('.editor-toolbar__right');
            if (toolbar) {
                const colBtn       = document.createElement('button');
                colBtn.id          = 'editor-columns-btn';
                colBtn.type        = 'button';
                colBtn.className   = 'btn btn-outlined btn-sm';
                colBtn.style.marginTop = '18px';
                colBtn.innerHTML   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Столбцы`;
                colBtn.addEventListener('click', openColumnEditor);
                toolbar.appendChild(colBtn);
            }
        }

        // ── Динамический заголовок таблицы ────────────────────────────────────
        const thead = el('master-table')?.querySelector('thead');
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th style="width:30px;">№</th>
                    ${visibleCols.map(col => `<th>${esc(col.label)}</th>`).join('')}
                    <th style="width:40px;"></th>
                </tr>`;
        }

        // ── Тело таблицы ──────────────────────────────────────────────────────
        let globalIndex = 1;
        const colspan   = visibleCols.length + 2; // № + столбцы + кнопка удаления

        const tableHtml = data.groups.map(group => {
            const slotRows = group.slots.map(slot => `
                <tr data-slot-id="${slot.id}" data-version="${slot.version || 1}">
                    <td style="text-align:center; color:var(--md-on-surface-hint); font-size:0.78rem;">${globalIndex++}</td>
                    ${visibleCols.map(col => buildCell(col, slot)).join('')}
                    <td style="text-align:center;">
                        <button class="btn-tiny-danger" data-delete-id="${slot.id}" title="Удалить строку">✕</button>
                    </td>
                </tr>`).join('');

            return `
                <tr class="group-header">
                    <td colspan="${colspan}">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="group-header__name">${esc(group.name)}</span>
                            <div style="display:flex; gap:6px;">
                                <button class="btn btn-success btn-xs" data-group-id="${group.id}">+ Строку</button>
                                <button class="btn btn-outlined btn-xs group-delete-btn" data-group-id="${group.id}" title="Удалить группу">✕ Группу</button>
                            </div>
                        </div>
                    </td>
                </tr>
                ${slotRows}`;
        }).join('');

        el('master-tbody').innerHTML = tableHtml;

        if (focusId) {
            const focused = el(focusId);
            if (focused) {
                focused.focus();
                if (focused.tagName === 'INPUT') { focused.value = ''; focused.value = focusValue; }
            }
        }
    } catch (e) {
        console.error('renderAdminEditor:', e);
        showError(`Ошибка загрузки редактора: ${e.message ?? e}`);
    }
}

// ─── Действия со строками ─────────────────────────────────────────────────────

export async function updateAdminSlot(slotId) {
    const tr             = document.querySelector(`tr[data-slot-id="${slotId}"]`);
    const currentVersion = tr?.dataset.version ? parseInt(tr.dataset.version, 10) : 1;

    const data = {
        version:     currentVersion,
        position_id: el(`pos-${slotId}`)?.value ? parseInt(el(`pos-${slotId}`).value, 10) : null,
        department:  el(`dept-${slotId}`)?.value ?? '',
        callsign:    el(`call-${slotId}`)?.value || null,
        note:        el(`note-${slotId}`)?.value || null,
        full_name:   el(`name-${slotId}`)?.value || null,
        rank:        el(`rank-${slotId}`)?.value || null,
        doc_number:  el(`doc-${slotId}`)?.value  || null,
    };

    // Собираем значения кастомных столбцов → extra_data
    const extraData = {};
    let hasExtra = false;
    currentColumns.forEach(col => {
        if (!BUILTIN_KEYS.has(col.key)) {
            const input = el(`cx-${col.key}-${slotId}`);
            if (input) { extraData[col.key] = input.value || null; hasExtra = true; }
        }
    });
    if (hasExtra) data.extra_data = extraData;

    try {
        const updatedSlot = await api.put(`/admin/slots/${slotId}`, data);
        if (tr && updatedSlot?.version != null) tr.dataset.version = updatedSlot.version;
    } catch (e) {
        console.error('updateAdminSlot:', e);
        if (e.status === 409) showError('Конфликт! Данные были изменены другим пользователем. Таблица обновляется.');
        else showError('Ошибка сохранения строки');
    }
}

export function loadAdminEditor() {
    const eventId = el('editor-event-id').value;
    if (!eventId) return showError('Выберите список для загрузки редактора');
    currentEditorEventId = eventId;
    renderAdminEditor(eventId);
}

export async function deleteSlot(slotId) {
    if (!confirm('Удалить эту строку?')) return;
    try { await api.delete(`/admin/slots/${slotId}`); notify('Строка удалена'); }
    catch (e) { console.error('deleteSlot:', e); showError('Ошибка удаления строки'); }
}

export async function addBlankRow(groupId) {
    const defaultDept = availableDepartments[0] ?? 'department';
    try { await api.post(`/admin/groups/${groupId}/slots`, { department: defaultDept, position_id: null }); }
    catch (e) { console.error('addBlankRow:', e); showError('Ошибка добавления строки'); }
}

export async function deleteGroup(groupId) {
    if (!confirm('Удалить группу вместе со всеми строками внутри?')) return;
    try { await api.delete(`/admin/groups/${groupId}`); notify('Группа удалена'); }
    catch (e) { console.error('deleteGroup:', e); showError('Ошибка удаления группы'); }
}

// ─── Редактор столбцов ────────────────────────────────────────────────────────

export async function openColumnEditor() {
    if (!currentEditorEventId) return showError('Сначала загрузите список');
    try {
        const cols = await api.get(`/admin/events/${currentEditorEventId}/columns`);
        _showColumnModal(cols);
    } catch (e) {
        console.error('openColumnEditor:', e);
        showError('Ошибка загрузки конфигурации столбцов');
    }
}

function _showColumnModal(columns) {
    el('col-editor-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'col-editor-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
        <div style="background:var(--md-surface);border-radius:var(--md-radius-lg);padding:24px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong style="font-size:1rem;">⚙ Настройка столбцов</strong>
                <button id="col-editor-close" class="btn btn-outlined btn-xs">✕ Закрыть</button>
            </div>
            <p style="font-size:0.78rem;color:var(--md-on-surface-hint);margin-bottom:14px;line-height:1.5;">
                Переименуйте, скройте, удалите или добавьте столбцы.<br>
                Стандартные столбцы можно переименовывать и скрывать, но не удалять.
            </p>
            <div id="col-editor-rows" style="display:flex;flex-direction:column;gap:6px;"></div>
            <div style="display:flex;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid var(--md-outline-variant);">
                <button id="col-add-btn"   class="btn btn-outlined btn-sm">+ Новый столбец</button>
                <div style="margin-left:auto;display:flex;gap:8px;">
                    <button id="col-reset-btn" class="btn btn-outlined btn-sm" title="Сбросить к стандартным столбцам">Сбросить</button>
                    <button id="col-save-btn"  class="btn btn-filled btn-sm">Сохранить</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    _renderColumnRows(columns);

    modal.addEventListener('click', e => { if (e.target === modal) _closeColumnModal(); });
    el('col-editor-close')?.addEventListener('click', _closeColumnModal);
    el('col-add-btn')?.addEventListener('click', _addColumnRow);
    el('col-reset-btn')?.addEventListener('click', () => {
        if (confirm('Сбросить к стандартным столбцам? Кастомные столбцы будут удалены из конфигурации (данные в строках сохранятся).')) {
            _renderColumnRows(JSON.parse(JSON.stringify(DEFAULT_COLUMNS)));
        }
    });
    el('col-save-btn')?.addEventListener('click', _saveColumnConfig);
}

function _renderColumnRows(columns) {
    const container = el('col-editor-rows');
    if (!container) return;

    container.innerHTML = columns.map((col, idx) => {
        const isBuiltin = BUILTIN_KEYS.has(col.key);
        const isVisible = col.visible !== false;
        const isFirst   = idx === 0;
        const isLast    = idx === columns.length - 1;

        const eyeOn  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
        const eyeOff = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

        return `
        <div class="col-row" data-idx="${idx}" data-key="${esc(col.key)}" data-type="${esc(col.type||'text')}"
             style="display:flex;align-items:center;gap:6px;padding:7px 10px;
                    background:var(--md-surface-variant);border-radius:var(--md-radius-sm);
                    border:1px solid ${isVisible ? 'var(--md-outline-variant)' : 'transparent'};
                    opacity:${isVisible ? '1' : '0.55'};">
            <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0;">
                <button class="col-row-up  btn-tiny" data-idx="${idx}" ${isFirst ? 'disabled' : ''} style="padding:1px 5px;font-size:0.6rem;line-height:1.2;">▲</button>
                <button class="col-row-down btn-tiny" data-idx="${idx}" ${isLast  ? 'disabled' : ''} style="padding:1px 5px;font-size:0.6rem;line-height:1.2;">▼</button>
            </div>
            <input class="col-row-label" value="${esc(col.label)}" placeholder="Название"
                   style="flex:1;padding:5px 8px;border:1px solid var(--md-outline);
                          border-radius:var(--md-radius-sm);font-size:0.85rem;
                          background:var(--md-surface);min-width:0;">
            <span style="font-size:0.65rem;color:var(--md-on-surface-hint);font-family:var(--md-font-mono);
                         flex-shrink:0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="${esc(col.key)}">${esc(col.key)}</span>
            <button class="col-row-vis btn btn-xs ${isVisible ? 'btn-filled' : 'btn-outlined'}"
                    data-idx="${idx}" title="${isVisible ? 'Скрыть' : 'Показать'}"
                    style="flex-shrink:0;min-width:30px;padding:4px 6px;">
                ${isVisible ? eyeOn : eyeOff}
            </button>
            ${!isBuiltin
                ? `<button class="col-row-del btn-tiny-danger" data-idx="${idx}" title="Удалить столбец" style="flex-shrink:0;">✕</button>`
                : `<span style="width:22px;flex-shrink:0;"></span>`}
        </div>`;
    }).join('');

    container.querySelectorAll('.col-row-up').forEach(btn =>
        btn.addEventListener('click', () => _moveColumnRow(parseInt(btn.dataset.idx), -1)));
    container.querySelectorAll('.col-row-down').forEach(btn =>
        btn.addEventListener('click', () => _moveColumnRow(parseInt(btn.dataset.idx), 1)));
    container.querySelectorAll('.col-row-vis').forEach(btn =>
        btn.addEventListener('click', () => _toggleColumnVis(parseInt(btn.dataset.idx))));
    container.querySelectorAll('.col-row-del').forEach(btn =>
        btn.addEventListener('click', () => _deleteColumnRow(parseInt(btn.dataset.idx))));
}

function _getColumnsFromModal() {
    return Array.from(document.querySelectorAll('#col-editor-rows .col-row')).map((row, idx) => ({
        key:     row.dataset.key,
        label:   row.querySelector('.col-row-label')?.value.trim() || row.dataset.key,
        type:    row.dataset.type || 'text',
        order:   idx,
        visible: row.querySelector('.col-row-vis')?.classList.contains('btn-filled') ?? true,
    }));
}

function _moveColumnRow(idx, dir) {
    const cols = _getColumnsFromModal();
    const to   = idx + dir;
    if (to < 0 || to >= cols.length) return;
    [cols[idx], cols[to]] = [cols[to], cols[idx]];
    cols.forEach((c, i) => { c.order = i; });
    _renderColumnRows(cols);
}

function _toggleColumnVis(idx) {
    const cols = _getColumnsFromModal();
    cols[idx].visible = !cols[idx].visible;
    _renderColumnRows(cols);
}

function _deleteColumnRow(idx) {
    if (!confirm('Удалить этот столбец из конфигурации?\nДанные уже заполненных строк останутся в базе.')) return;
    const cols = _getColumnsFromModal();
    cols.splice(idx, 1);
    cols.forEach((c, i) => { c.order = i; });
    _renderColumnRows(cols);
}

function _addColumnRow() {
    const cols = _getColumnsFromModal();
    cols.push({ key: `cx_${Date.now()}`, label: 'Новый столбец', type: 'text', order: cols.length, visible: true });
    _renderColumnRows(cols);
    const rows = document.querySelectorAll('#col-editor-rows .col-row');
    rows[rows.length - 1]?.querySelector('.col-row-label')?.focus();
}

async function _saveColumnConfig() {
    const cols = _getColumnsFromModal();
    if (!cols.length) return showError('Нельзя сохранить пустую конфигурацию');
    try {
        await api.put(`/admin/events/${currentEditorEventId}/columns`, { columns: cols });
        currentColumns = [...cols].sort((a, b) => a.order - b.order);
        notify('Конфигурация столбцов сохранена');
        _closeColumnModal();
        renderAdminEditor(currentEditorEventId, false);
    } catch (e) {
        console.error('_saveColumnConfig:', e);
        showError('Ошибка сохранения конфигурации');
    }
}

function _closeColumnModal() { el('col-editor-modal')?.remove(); }

// ─── Управление пользователями ────────────────────────────────────────────────

export async function loadUsers() {
    try {
        const users = await api.get('/admin/users');

        availableDepartments = users.filter(u => u.is_active).map(u => u.username);
        window.availableRoles = users.map(u => u.username);

        el('users-tbody').innerHTML = users.map(u => {
            const roleBadge = u.role === 'admin'
                ? `<span class="role-badge role-badge--admin">Администратор</span>`
                : `<span class="role-badge role-badge--department">Управление</span>`;

            const statusBadge = u.is_active ? '' :
                `<span class="role-badge" style="background:var(--md-warning-light); color:var(--md-warning); border-color:#f0d9b8; margin-left:6px;">Деактивирован</span>`;

            const action = u.username === 'admin'
                ? `<span style="font-size:0.75rem; color:var(--md-on-surface-hint);">Защищён</span>`
                : `<button class="btn btn-danger btn-xs" onclick="window.app.deleteUser(${u.id})">Удалить</button>`;

            return `
                <tr>
                    <td style="font-family:var(--md-font-mono); font-size:0.72rem; color:var(--md-on-surface-hint);">${u.id}</td>
                    <td>
                        <strong>${esc(formatRole(u.username))}</strong>
                        <span style="font-size:0.75rem; color:var(--md-on-surface-hint); margin-left:4px;">(${esc(u.username)})</span>
                        ${statusBadge}
                    </td>
                    <td>${roleBadge}</td>
                    <td>${action}</td>
                </tr>`;
        }).join('');
    } catch (e) { console.error('loadUsers:', e); showError('Не удалось загрузить пользователей'); }
}

export async function handleCreateUser() {
    const username = el('new-username')?.value.trim();
    const password = el('new-password')?.value;
    const role     = el('new-role')?.value;
    if (!username || !password) return showError('Заполните логин и пароль');
    try {
        await api.post('/admin/users', { username, password, role });
        el('new-username').value = '';
        el('new-password').value = '';
        notify(`Пользователь «${username}» создан`);
        await loadUsers();
    } catch (e) {
        console.error('handleCreateUser:', e);
        showError(e.status === 409 ? 'Пользователь с таким логином уже существует' : `Ошибка создания: ${e.message ?? e}`);
    }
}

export async function deleteUser(userId) {
    if (!confirm('Удалить этого пользователя?')) return;
    try { await api.delete(`/admin/users/${userId}`); notify('Пользователь удалён'); await loadUsers(); }
    catch (e) {
        console.error('deleteUser:', e);
        showError(e.status === 403 ? e.message ?? 'Удаление запрещено' : 'Ошибка удаления пользователя');
    }
}

// ─── Дежурный ─────────────────────────────────────────────────────────────────

export async function loadDutyOfficer() {
    try {
        const s = await api.get('/settings');
        const rankEl = el('duty-rank'), nameEl = el('duty-name');
        if (rankEl) rankEl.value = s.duty_rank || '';
        if (nameEl) nameEl.value = s.duty_name || '';
    } catch (e) { console.error('loadDutyOfficer:', e); }
}

export async function saveDutyOfficer() {
    const rank = el('duty-rank')?.value.trim() ?? '';
    const name = el('duty-name')?.value.trim() ?? '';
    try {
        await api.patch('/settings', { duty_rank: rank, duty_name: name });
        notify(`Дежурный сохранён: ${rank} ${name}`.trim());
    } catch (e) { console.error('saveDutyOfficer:', e); showError('Ошибка сохранения дежурного'); }
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

export async function exportWord() {
    const eventId = el('export-event-id').value;
    if (!eventId) return showError('Выберите список для выгрузки');
    try {
        const blob = await api.download(`/export/events/${eventId}/export-word`);
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: 'Список_выгрузка.docx' });
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    } catch (e) { console.error('exportWord:', e); showError('Ошибка выгрузки в Word'); }
}

// ─── WS-обновления ───────────────────────────────────────────────────────────

export async function toggleEventStatus() {
    if (!currentEditorEventId) return;
    try {
        const res      = await api.patch(`/admin/events/${currentEditorEventId}/status`);
        const isActive = res.status === 'active';
        notify(isActive ? 'Список активирован — управления его видят' : 'Список деактивирован — скрыт от управлений');
        renderAdminEditor(currentEditorEventId, false);
    } catch (e) { console.error('toggleEventStatus:', e); showError(e.message ?? 'Ошибка изменения статуса'); }
}

export function listenForUpdates() {
    loadDutyOfficer();
    document.addEventListener('datachanged', ({ detail }) => {
        if (currentEditorEventId && currentEditorEventId == detail.eventId) {
            renderAdminEditor(currentEditorEventId, true);
        }
        if (!detail.eventId) loadEventsDropdowns();
    });

    el('master-tbody')?.addEventListener('click', (e) => {
        const groupDeleteBtn = e.target.closest('.group-delete-btn');
        if (groupDeleteBtn) deleteGroup(groupDeleteBtn.dataset.groupId);
    });
}

// ─── Шаблоны ─────────────────────────────────────────────────────────────────

function getTargetDates() {
    const today     = new Date();
    const dayOfWeek = today.getDay();
    const addDays   = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d; };
    const fmt       = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return dayOfWeek === 5 ? [fmt(addDays(1)), fmt(addDays(2)), fmt(addDays(3))] : [fmt(addDays(1))];
}

export async function handleInstantiateTemplate() {
    const templateId = el('template-select-id')?.value;
    if (!templateId) return showError('Выберите шаблон из списка');
    const dates    = getTargetDates();
    const WEEKDAYS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const dateStrings = dates.map(d => {
        const obj = new Date(d);
        return `${d.split('-').reverse().join('.')} (${WEEKDAYS[obj.getUTCDay()]})`;
    }).join('\n📅 ');
    if (!confirm(`Развернуть шаблон на следующие даты?\n\n📅 ${dateStrings}`)) return;
    try {
        await api.post(`/admin/events/${templateId}/instantiate`, { dates });
        notify('Списки успешно сгенерированы!');
        await loadEventsDropdowns();
    } catch (e) {
        console.error('handleInstantiateTemplate:', e);
        showError(e.status === 400 ? (e.message ?? 'Это не шаблон') : 'Ошибка генерации по шаблону');
    }
}

export async function toggleCurrentEventTemplate() {
    if (!currentEditorEventId) return;
    const isTemplate = el('editor-is-template-cb')?.checked;
    try {
        await api.patch(`/admin/events/${currentEditorEventId}/template`, { is_template: isTemplate });
        notify(`Список ${isTemplate ? 'помечен как шаблон' : 'снят с шаблонов'}`);
        await loadEventsDropdowns();
    } catch (e) {
        console.error('toggleCurrentEventTemplate:', e);
        showError('Ошибка изменения статуса');
        if (el('editor-is-template-cb')) el('editor-is-template-cb').checked = !isTemplate;
    }
}

// ─── Планировщик расписания ────────────────────────────────────────────────────

const SCHEDULE_KEY = 'weekly_schedule_v2';

const DAY_NAMES = [
    { key: 1, short: 'Пн', full: 'Понедельник' },
    { key: 2, short: 'Вт', full: 'Вторник'     },
    { key: 3, short: 'Ср', full: 'Среда'        },
    { key: 4, short: 'Чт', full: 'Четверг'      },
    { key: 5, short: 'Пт', full: 'Пятница'      },
    { key: 6, short: 'Сб', full: 'Суббота'      },
    { key: 0, short: 'Вс', full: 'Воскресенье'  },
];

let schedWeekOffset = 0;

function loadSchedule() {
    try {
        const raw = localStorage.getItem(SCHEDULE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const result = {};
        for (const [k, v] of Object.entries(parsed)) result[k] = Array.isArray(v) ? v : (v ? [v] : []);
        return result;
    } catch { return {}; }
}

function saveScheduleToStorage(s) { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(s)); }

function getWeekDates(offsetWeeks = 0) {
    const now = new Date();
    const day = now.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon + offsetWeeks * 7);
    mon.setHours(0, 0, 0, 0);
    return DAY_NAMES.map(({ key }, i) => {
        const d = new Date(mon); d.setDate(mon.getDate() + i);
        return { dayKey: key, date: d };
    });
}

function fmtDate(d)  { return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtIso(d)   { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function isToday(d)  { const t = new Date(); return d.getFullYear()===t.getFullYear() && d.getMonth()===t.getMonth() && d.getDate()===t.getDate(); }
function isPast(d)   { const t = new Date(); t.setHours(0,0,0,0); return d < t; }

function buildTemplateOptions(selectedId) {
    const src = document.getElementById('template-select-id');
    if (!src) return '<option value="">— Шаблон —</option>';
    let html = '<option value="">— Шаблон —</option>';
    Array.from(src.options).forEach(opt => {
        if (!opt.value) return;
        const sel = String(opt.value) === String(selectedId) ? ' selected' : '';
        html += `<option value="${opt.value}"${sel}>${esc(opt.text)}</option>`;
    });
    return html;
}

function buildTemplateRow(dayKey, tplId, rowIndex, disabled) {
    return `
        <div class="sched-tpl-row" data-day-key="${dayKey}" data-row="${rowIndex}">
            <select class="sched-day__select" data-day-key="${dayKey}" ${disabled ? 'disabled' : ''}>
                ${buildTemplateOptions(tplId)}
            </select>
            ${!disabled ? `<button class="sched-tpl-remove btn-tiny-danger" data-day-key="${dayKey}" data-row="${rowIndex}" title="Убрать">✕</button>` : ''}
        </div>`;
}

export function renderScheduleGrid() {
    const grid  = document.getElementById('sched-grid');
    const label = document.getElementById('sched-week-label');
    if (!grid || !label) return;

    const schedule  = loadSchedule();
    const dates     = getWeekDates(schedWeekOffset);
    const allEvents = getCachedEvents();

    const isCurrent = schedWeekOffset === 0;
    const mon = dates[0].date, sun = dates[6].date;
    label.textContent = `${fmtDate(mon)} – ${fmtDate(sun)}.${sun.getFullYear()}${isCurrent ? '  (текущая)' : ''}`;

    grid.innerHTML = dates.map(({ dayKey, date }, i) => {
        const dayInfo = DAY_NAMES[i];
        const past    = isPast(date);
        const today   = isToday(date);
        const weekend = dayKey === 0 || dayKey === 6;
        const tplList = schedule[dayKey] ?? [];

        const rows = tplList.length > 0
            ? tplList.map((id, ri) => buildTemplateRow(dayKey, id, ri, past)).join('')
            : buildTemplateRow(dayKey, '', 0, past);

        const addBtn = !past
            ? `<button class="sched-add-tpl btn btn-outlined btn-xs" data-day-key="${dayKey}" type="button">+ список</button>`
            : '';

        const count = tplList.filter(Boolean).length;
        const countBadge = count > 0
            ? `<span class="sched-count-badge">${count} ${count===1?'список':count<5?'списка':'списков'}</span>`
            : '';

        const isoDate = fmtIso(date);
        const generated = allEvents.filter(e => !e.is_template && e.date === isoDate);
        const generatedHtml = generated.length > 0 ? `
            <div class="sched-generated-section">
                <span class="sched-generated-label">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Создано (${generated.length}):
                </span>
                ${generated.map(e => `
                    <div class="sched-generated-item" title="${esc(e.title)}" style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
                            <span class="sched-gen-status sched-gen-status--${e.status==='active'?'active':'draft'}"></span>
                            <span class="sched-gen-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(e.title)}</span>
                        </div>
                        <button class="sched-gen-del-btn btn-tiny-danger" data-event-id="${e.id}" title="Удалить этот список навсегда" style="width:18px; height:18px; font-size:0.6rem; margin-left:4px; flex-shrink:0;">✕</button>
                    </div>`).join('')}
            </div>` : '';

        return `
            <div class="sched-day${today?' sched-day--today':''}${past?' sched-day--past':''}${weekend?' sched-day--weekend':''}">
                <div class="sched-day__head">
                    <span class="sched-day__short">${dayInfo.short}</span>
                    <span class="sched-day__date">${fmtDate(date)}</span>
                    ${today ? '<span class="sched-day__badge">сегодня</span>' : ''}
                    ${countBadge}
                </div>
                ${generatedHtml}
                <div class="sched-tpl-list" id="tpl-list-${dayKey}">${rows}</div>
                ${addBtn}
            </div>`;
    }).join('');

    _bindSchedGridEvents(grid);
}

function _bindSchedGridEvents(grid) {
    const fresh = grid.cloneNode(true);
    grid.parentNode.replaceChild(fresh, grid);
    const g = document.getElementById('sched-grid');

    g.addEventListener('click', async (e) => {
        const addBtn    = e.target.closest('.sched-add-tpl');
        const removeBtn = e.target.closest('.sched-tpl-remove');
        const delGenBtn = e.target.closest('.sched-gen-del-btn'); // Кнопка удаления готового списка

        // 1. Удаление сгенерированного списка прямо из расписания
        if (delGenBtn) {
            const eventId = delGenBtn.dataset.eventId;
            if (!confirm('Вы уверены, что хотите удалить этот список?\n\nВсе данные, уже заполненные управлениями на этот день, будут безвозвратно удалены!')) return;

            try {
                await api.delete(`/admin/events/${eventId}`);
                window.showSnackbar?.('Список успешно удалён', 'success');

                // Если этот список прямо сейчас открыт в главном редакторе — очищаем редактор
                if (currentEditorEventId == eventId) {
                    currentEditorEventId = null;
                    document.getElementById('editor-container')?.classList.add('hidden');
                    document.getElementById('editor-empty')?.classList.remove('hidden');
                }

                // Перезагружаем выпадающие меню и перерисовываем сетку
                await loadEventsDropdowns();
                renderScheduleGrid();
            } catch (err) {
                console.error('Delete generated event:', err);
                window.showSnackbar?.('Ошибка при удалении списка', 'error');
            }
            return;
        }

        // 2. Добавление пустой строки шаблона
        if (addBtn) {
            const dayKey = addBtn.dataset.dayKey;
            const list   = document.getElementById(`tpl-list-${dayKey}`);
            if (!list) return;
            const newRow = document.createElement('div');
            newRow.innerHTML = buildTemplateRow(dayKey, '', list.querySelectorAll('.sched-tpl-row').length, false);
            list.appendChild(newRow.firstElementChild);
        }

        // 3. Удаление строки шаблона
        if (removeBtn) {
            const dayKey = removeBtn.dataset.dayKey;
            const rowIdx = parseInt(removeBtn.dataset.row);
            const list   = document.getElementById(`tpl-list-${dayKey}`);
            const rows   = list?.querySelectorAll('.sched-tpl-row');
            if (!rows) return;
            if (rows.length <= 1) rows[0].querySelector('select').value = '';
            else rows[rowIdx]?.remove();
        }
    });
}

function readScheduleFromGrid() {
    const schedule = {};
    DAY_NAMES.forEach(({ key }) => {
        const list = document.getElementById(`tpl-list-${key}`);
        if (!list) return;
        schedule[key] = Array.from(list.querySelectorAll('.sched-day__select')).map(s => s.value).filter(Boolean);
    });
    return schedule;
}

export function initSchedule() {
    document.getElementById('sched-prev-week')?.addEventListener('click',  () => { schedWeekOffset--; renderScheduleGrid(); });
    document.getElementById('sched-next-week')?.addEventListener('click',  () => { schedWeekOffset++; renderScheduleGrid(); });
    document.getElementById('sched-today-week')?.addEventListener('click', () => { schedWeekOffset = 0; renderScheduleGrid(); });

    document.getElementById('sched-save-btn')?.addEventListener('click', () => {
        saveScheduleToStorage(readScheduleFromGrid());
        window.showSnackbar?.('Расписание сохранено', 'success');
        renderScheduleGrid();
    });

    document.getElementById('sched-generate-btn')?.addEventListener('click', async () => {
        const current = readScheduleFromGrid();
        const dates   = getWeekDates(schedWeekOffset);

        const jobs = {};
        dates.forEach(({ dayKey, date }) => {
            (current[dayKey] ?? []).filter(Boolean).forEach(tplId => {
                if (!jobs[tplId]) jobs[tplId] = [];
                jobs[tplId].push(fmtIso(date));
            });
        });

        if (Object.keys(jobs).length === 0) { window.showSnackbar?.('Нет дней с назначенными шаблонами', 'error'); return; }

        const previewLines = dates.map(({ dayKey, date }, i) => {
            const tplIds = (current[dayKey] ?? []).filter(Boolean);
            if (!tplIds.length) return null;
            const names = tplIds.map(id => document.querySelector(`#template-select-id option[value="${id}"]`)?.text ?? `#${id}`);
            return `${DAY_NAMES[i].full} ${fmtDate(date)}: ${names.join(', ')}`;
        }).filter(Boolean).join('\n');

        const totalLists = Object.values(jobs).reduce((sum, arr) => sum + arr.length, 0);
        if (!confirm(`Создать ${totalLists} ${totalLists===1?'список':totalLists<5?'списка':'списков'}?\n\n${previewLines}`)) return;

        let successCount = 0, skipCount = 0;
        for (const [tplId, tplDates] of Object.entries(jobs)) {
            try {
                await api.post(`/admin/events/${tplId}/instantiate`, { dates: tplDates });
                successCount += tplDates.length;
            } catch (e) {
                console.error(`instantiate template ${tplId}:`, e);
                if (e.status === 400) {
                    const name = document.querySelector(`#template-select-id option[value="${tplId}"]`)?.text ?? `#${tplId}`;
                    window.showSnackbar?.(`«${name}»: ${e.message ?? 'уже создан на одну из выбранных дат'}`, 'error');
                    skipCount++;
                } else {
                    window.showSnackbar?.(`Ошибка для шаблона #${tplId}: ${e.message ?? 'неизвестная ошибка'}`, 'error');
                }
            }
        }

        if (successCount > 0)                         window.showSnackbar?.(`Создано ${successCount} ${successCount===1?'список':successCount<5?'списка':'списков'}`, 'success');
        else if (skipCount > 0 && successCount === 0)  window.showSnackbar?.('Все выбранные списки уже созданы на эти даты', 'error');

        await loadEventsDropdowns();
        renderScheduleGrid();
    });
}