// static/js/dept_duty.js
/**
 * Графики наряда для управлений.
 * Аналог duty.js, но работает с /api/v1/dept/schedules
 * и показывает только графики текущего управления.
 */

import { api }         from './api.js';

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ─── Состояние ────────────────────────────────────────────────────────────────

let _schedules   = [];
let _currentId   = null;
let _persons     = [];   // люди в текущем графике
let _marks       = {};   // "YYYY-MM-DD:person_id" → true
let _positions   = [];   // для выбора при создании
let _viewYear    = new Date().getFullYear();
let _viewMonth   = new Date().getMonth() + 1;

// ─── Инициализация ────────────────────────────────────────────────────────────

// Только привязка событий — без API-вызовов (безопасно до авторизации)
export function bindDeptDutyEvents() {
    _bindUI();
}

// Загрузка данных — только после авторизации
export async function loadDeptDutyData() {
    await _loadPositions();
    await loadDeptSchedules();
}

// Оставлено для обратной совместимости, если где-то вызывается
export function initDeptDuty() {
    _bindUI();
}

function _bindUI() {
    document.getElementById('dept-duty-add-schedule-btn')
        ?.addEventListener('click', _showCreateForm);
    document.getElementById('dept-duty-create-save')
        ?.addEventListener('click', _handleCreate);
    document.getElementById('dept-duty-create-cancel')
        ?.addEventListener('click', _hideCreateForm);
    document.getElementById('dept-duty-create-position')
        ?.addEventListener('change', _suggestTitle);

    document.getElementById('dept-duty-prev-month')
        ?.addEventListener('click', () => { _changeMonth(-1); });
    document.getElementById('dept-duty-next-month')
        ?.addEventListener('click', () => { _changeMonth(1); });
    document.getElementById('dept-duty-today-month')
        ?.addEventListener('click', () => {
            const now = new Date();
            _viewYear  = now.getFullYear();
            _viewMonth = now.getMonth() + 1;
            if (_currentId) _loadMarksAndRender();
        });

    document.getElementById('dept-duty-add-person-btn')
        ?.addEventListener('click', _showPersonSearch);
    document.getElementById('dept-duty-person-search-input')
        ?.addEventListener('input', _handlePersonSearch);
}

// ─── Должности (для формы создания) ──────────────────────────────────────────

async function _loadPositions() {
    try {
        // Запрос к публичному эндпоинту, доступному всем авторизованным пользователям
        _positions = await api.get('/positions');
    } catch {
        _positions = [];
    }
}

// ─── Форма создания ───────────────────────────────────────────────────────────

function _showCreateForm() {
    const sel = document.getElementById('dept-duty-create-position');
    if (sel) {
        sel.innerHTML = '<option value="">— без привязки к должности —</option>'
            + _positions.map(p =>
                `<option value="${p.id}" data-name="${esc(p.name)}">${esc(p.name)}</option>`
            ).join('');
    }
    const inp = document.getElementById('dept-duty-create-title');
    if (inp) inp.value = '';
    document.getElementById('dept-duty-create-form')?.classList.remove('hidden');
}

function _hideCreateForm() {
    document.getElementById('dept-duty-create-form')?.classList.add('hidden');
}

function _suggestTitle() {
    const sel  = document.getElementById('dept-duty-create-position');
    const inp  = document.getElementById('dept-duty-create-title');
    if (!sel || !inp) return;
    const name = sel.selectedOptions[0]?.dataset?.name || '';
    inp.value = name ? `График ${name.toLowerCase()}ов` : '';
}

async function _handleCreate() {
    const title  = document.getElementById('dept-duty-create-title')?.value.trim();
    const sel    = document.getElementById('dept-duty-create-position');
    const posId  = sel?.value ? parseInt(sel.value) : null;
    const posName = sel?.selectedOptions[0]?.dataset?.name || null;

    if (!title) { window.showSnackbar?.('Введите название графика', 'error'); return; }

    try {
        await api.post('/dept/schedules', {
            title,
            position_id:   posId,
            position_name: posName,
        });
        _hideCreateForm();
        window.showSnackbar?.('График создан', 'success');
        await loadDeptSchedules();
    } catch (err) {
        window.showSnackbar?.(`Ошибка: ${err?.message || err}`, 'error');
    }
}

// ─── Список графиков ──────────────────────────────────────────────────────────

export async function loadDeptSchedules() {
    try {
        _schedules = await api.get('/dept/schedules');
    } catch {
        _schedules = [];
    }
    _renderScheduleList();
}

function _renderScheduleList() {
    const container = document.getElementById('dept-duty-schedules-list');
    if (!container) return;

    if (_schedules.length === 0) {
        container.innerHTML = '<p class="hint" style="padding:12px 0;">Нет графиков — создайте первый</p>';
        return;
    }

    container.innerHTML = _schedules.map(s => `
        <div class="duty-sched-item${s.id === _currentId ? ' duty-sched-item--active' : ''}"
             data-sched-id="${s.id}">
            <div class="duty-sched-item__title">${esc(s.title)}</div>
            ${s.position_name ? `<div class="duty-sched-item__sub">${esc(s.position_name)}</div>` : ''}
            <button class="duty-sched-item__del btn btn-danger btn-xs"
                    data-sched-id="${s.id}" type="button">✕</button>
        </div>
    `).join('');

    container.querySelectorAll('.duty-sched-item').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.closest('.duty-sched-item__del')) return;
            _selectSchedule(parseInt(el.dataset.schedId));
        });
    });

    container.querySelectorAll('.duty-sched-item__del').forEach(btn => {
        btn.addEventListener('click', () => _deleteSchedule(parseInt(btn.dataset.schedId)));
    });
}

async function _selectSchedule(id) {
    _currentId = id;
    const now = new Date();
    _viewYear  = now.getFullYear();
    _viewMonth = now.getMonth() + 1;

    _renderScheduleList();
    document.getElementById('dept-duty-grid-empty')?.classList.add('hidden');
    document.getElementById('dept-duty-grid-container')?.classList.remove('hidden');

    await _loadPersonsAndMarks();
}

async function _deleteSchedule(id) {
    if (!confirm('Удалить этот график?')) return;
    try {
        await api.delete(`/dept/schedules/${id}`);
        if (_currentId === id) {
            _currentId = null;
            document.getElementById('dept-duty-grid-empty')?.classList.remove('hidden');
            document.getElementById('dept-duty-grid-container')?.classList.add('hidden');
        }
        await loadDeptSchedules();
    } catch (err) {
        window.showSnackbar?.(`Ошибка удаления: ${err?.message || err}`, 'error');
    }
}

// ─── Люди в графике ───────────────────────────────────────────────────────────

async function _loadPersonsAndMarks() {
    await Promise.all([_loadPersons(), _loadMarksAndRender()]);
}

async function _loadPersons() {
    if (!_currentId) return;
    try {
        _persons = await api.get(`/dept/schedules/${_currentId}/persons`);
    } catch {
        _persons = [];
    }
}

function _showPersonSearch() {
    const wrap = document.getElementById('dept-duty-person-search-wrap');
    wrap?.classList.remove('hidden');
    document.getElementById('dept-duty-person-search-input')?.focus();
}

let _searchTimer = null;
async function _handlePersonSearch(e) {
    clearTimeout(_searchTimer);
    const q = e.target.value.trim();
    const results = document.getElementById('dept-duty-person-results');
    if (!results) return;
    if (q.length < 2) { results.innerHTML = ''; return; }

    _searchTimer = setTimeout(async () => {
        try {
            // Ищем только своих людей (persons фильтруются по department на бэке)
            const persons = await api.get(`/persons/search?q=${encodeURIComponent(q)}&limit=8`);
            results.innerHTML = persons.map(p => `
                <div class="duty-person-result" data-pid="${p.id}"
                     style="padding:6px 10px; cursor:pointer; border-bottom:1px solid var(--md-outline-variant); font-size:0.85rem;">
                    <strong>${esc(p.full_name)}</strong>
                    ${p.rank ? `<span style="color:var(--md-on-surface-hint); margin-left:6px;">${esc(p.rank)}</span>` : ''}
                </div>
            `).join('');
            results.querySelectorAll('.duty-person-result').forEach(el => {
                el.addEventListener('click', () => _addPerson(parseInt(el.dataset.pid)));
            });
        } catch { results.innerHTML = ''; }
    }, 250);
}

async function _addPerson(personId) {
    if (!_currentId) return;
    try {
        await api.post(`/dept/schedules/${_currentId}/persons`, { person_id: personId });
        window.showSnackbar?.('Человек добавлен в график', 'success');
        document.getElementById('dept-duty-person-search-wrap')?.classList.add('hidden');
        document.getElementById('dept-duty-person-search-input').value = '';
        document.getElementById('dept-duty-person-results').innerHTML = '';
        await _loadPersonsAndMarks();
    } catch (err) {
        const msg = err?.status === 409 ? 'Уже в графике' : `Ошибка: ${err?.message || err}`;
        window.showSnackbar?.(msg, 'error');
    }
}

async function _removePerson(personId) {
    if (!_currentId) return;
    try {
        await api.delete(`/dept/schedules/${_currentId}/persons/${personId}`);
        await _loadPersonsAndMarks();
    } catch (err) {
        window.showSnackbar?.(`Ошибка: ${err?.message || err}`, 'error');
    }
}

// ─── Сетка (marks) ───────────────────────────────────────────────────────────

function _changeMonth(delta) {
    _viewMonth += delta;
    if (_viewMonth > 12) { _viewMonth = 1; _viewYear++; }
    if (_viewMonth < 1)  { _viewMonth = 12; _viewYear--; }
    if (_currentId) _loadMarksAndRender();
}

async function _loadMarksAndRender() {
    if (!_currentId) return;
    try {
        const raw = await api.get(`/dept/schedules/${_currentId}/marks?year=${_viewYear}&month=${_viewMonth}`);
        _marks = {};
        raw.forEach(m => { _marks[`${m.duty_date}:${m.person_id}`] = true; });
    } catch {
        _marks = {};
    }
    _renderGrid();
}

function _renderGrid() {
    const label = document.getElementById('dept-duty-month-label');
    const table = document.getElementById('dept-duty-grid-table');
    if (!label || !table) return;

    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                        'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    label.textContent = `${monthNames[_viewMonth - 1]} ${_viewYear}`;

    const daysInMonth = new Date(_viewYear, _viewMonth, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);
    const days = Array.from({ length: daysInMonth }, (_, i) => {
        const d = String(i + 1).padStart(2, '0');
        const m = String(_viewMonth).padStart(2, '0');
        return `${_viewYear}-${m}-${d}`;
    });

    // Заголовок — дни
    const thead = `<thead><tr>
        <th style="min-width:140px; text-align:left; padding:6px 8px; font-size:0.75rem;">Сотрудник</th>
        ${days.map(d => {
            const day = parseInt(d.slice(8));
            const dow = new Date(d).getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isToday = d === today;
            return `<th style="min-width:32px; text-align:center; padding:4px 2px; font-size:0.7rem;
                ${isToday ? 'background:var(--md-primary-light); color:var(--md-primary);' : ''}
                ${isWeekend ? 'color:var(--md-error);' : ''}">
                ${day}
            </th>`;
        }).join('')}
        <th style="width:32px;"></th>
    </tr></thead>`;

    // Строки — люди
    const tbody = `<tbody>${_persons.map(p => `
        <tr>
            <td style="font-size:0.8rem; padding:4px 8px; white-space:nowrap;">
                ${esc(p.full_name)}
                ${p.rank ? `<span style="color:var(--md-on-surface-hint); font-size:0.7rem;"> ${esc(p.rank)}</span>` : ''}
            </td>
            ${days.map(d => {
                const key     = `${d}:${p.person_id}`;
                const marked  = _marks[key] ? ' duty-cell--marked' : '';
                const isToday = d === today ? ' duty-cell--today' : '';
                return `<td class="duty-cell${marked}${isToday}"
                            data-date="${d}" data-pid="${p.person_id}"
                            style="text-align:center; cursor:pointer; padding:2px;">
                    ${_marks[key] ? '●' : ''}
                </td>`;
            }).join('')}
            <td style="text-align:center;">
                <button class="btn btn-danger btn-xs dept-duty-remove-person"
                        data-pid="${p.person_id}" type="button" title="Убрать из графика">✕</button>
            </td>
        </tr>
    `).join('')}
    ${_persons.length === 0 ? `<tr><td colspan="${daysInMonth + 2}" style="padding:24px; text-align:center; color:var(--md-on-surface-hint); font-size:0.85rem;">
        Добавьте сотрудников через кнопку «+ Добавить человека»
    </td></tr>` : ''}
    </tbody>`;

    table.innerHTML = thead + tbody;

    // Клик по ячейке → toggle mark
    table.querySelectorAll('.duty-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            _toggleMark(cell.dataset.date, parseInt(cell.dataset.pid));
        });
    });

    // Удалить из графика
    table.querySelectorAll('.dept-duty-remove-person').forEach(btn => {
        btn.addEventListener('click', () => _removePerson(parseInt(btn.dataset.pid)));
    });
}

async function _toggleMark(date, personId) {
    if (!_currentId) return;
    try {
        const result = await api.post(`/dept/schedules/${_currentId}/marks`, {
            person_id: personId,
            duty_date: date,
        });
        // Обновляем локальный кеш
        const key = `${date}:${personId}`;
        if (result.action === 'removed') {
            delete _marks[key];
        } else {
            _marks[key] = true;
            if (result.filled_slots_count > 0) {
                window.showSnackbar?.(
                    `Автозаполнено ${result.filled_slots_count} слот(ов) в списках`,
                    'success'
                );
            }
        }
        _renderGrid();
    } catch (err) {
        window.showSnackbar?.(`Ошибка: ${err?.message || err}`, 'error');
    }
}