// static/js/duty.js
/**
 * Редактор графиков наряда.
 */

import { api } from './api.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _schedules      = [];
let _currentId      = null;
let _currentPersons = [];
let _currentMarks   = [];
let _year           = new Date().getFullYear();
let _month          = new Date().getMonth() + 1;   // 1-based
let _positions      = [];
let _searchTimeout  = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initDuty() {
    document.getElementById('duty-add-schedule-btn')
        ?.addEventListener('click', () => _showCreateForm());

    document.getElementById('duty-create-cancel')
        ?.addEventListener('click', () => _hideCreateForm());

    document.getElementById('duty-create-save')
        ?.addEventListener('click', () => _handleCreate());

    document.getElementById('duty-prev-month')
        ?.addEventListener('click', () => _shiftMonth(-1));

    document.getElementById('duty-next-month')
        ?.addEventListener('click', () => _shiftMonth(+1));

    document.getElementById('duty-today-month')
        ?.addEventListener('click', () => {
            const now = new Date();
            _year  = now.getFullYear();
            _month = now.getMonth() + 1;
            _loadGrid();
        });

    document.getElementById('duty-add-person-btn')
        ?.addEventListener('click', () => {
            const wrap = document.getElementById('duty-person-search-wrap');
            wrap?.classList.toggle('hidden');
            if (!wrap?.classList.contains('hidden')) {
                document.getElementById('duty-person-search-input')?.focus();
            }
        });

    document.getElementById('duty-person-search-input')
        ?.addEventListener('input', (e) => _onPersonSearch(e.target.value));

    document.getElementById('duty-create-position')
        ?.addEventListener('change', () => _suggestTitle());
}

// ─── Create form ──────────────────────────────────────────────────────────────

async function _showCreateForm() {
    // Загружаем должности для выпадающего списка
    try {
        _positions = await api.get('/admin/positions');
        console.log('[duty] Loaded positions:', _positions);
    } catch (err) {
        console.error('[duty] Failed to load positions:', err);
        _positions = [];
    }

    const sel = document.getElementById('duty-create-position');
    if (sel) {
        sel.innerHTML = '<option value="">— без привязки к должности —</option>'
            + _positions.map(p =>
                `<option value="${p.id}" data-name="${_esc(p.name)}">${_esc(p.name)}</option>`
              ).join('');
    }

    const titleInput = document.getElementById('duty-create-title');
    if (titleInput) titleInput.value = '';

    document.getElementById('duty-create-form')?.classList.remove('hidden');
}

function _hideCreateForm() {
    document.getElementById('duty-create-form')?.classList.add('hidden');
}

function _suggestTitle() {
    const sel  = document.getElementById('duty-create-position');
    const inp  = document.getElementById('duty-create-title');
    if (!sel || !inp) return;
    const opt  = sel.options[sel.selectedIndex];
    const name = opt?.dataset?.name || '';
    if (!name) { inp.value = ''; return; }
    // Автоподстановка: "Оператор" → "График операторов АМГ"
    inp.value = `График ${name.toLowerCase()}ов АМГ`;
}

async function _handleCreate() {
    const titleInput = document.getElementById('duty-create-title');
    const title      = titleInput?.value.trim();
    const sel        = document.getElementById('duty-create-position');
    const posIdStr   = sel?.value;
    const posId      = posIdStr ? parseInt(posIdStr) : null;
    const posName    = sel?.selectedOptions[0]?.dataset?.name || null;

    if (!title) {
        window.showSnackbar?.('Введите название графика', 'error');
        return;
    }

    console.log('[duty] Creating schedule:', { title, posId, posName });

    try {
        const result = await api.post('/admin/schedules', {
            title,
            position_id:   posId,
            position_name: posName,
        });
        console.log('[duty] Schedule created:', result);
        _hideCreateForm();
        window.showSnackbar?.('График создан', 'success');
        await loadSchedules();
    } catch (err) {
        // Логируем подробности — теперь видно в консоли что именно сломалось
        console.error('[duty] Create schedule error:', err);
        const detail = err?.message || `HTTP ${err?.status || '?'}`;
        window.showSnackbar?.(`Ошибка создания графика: ${detail}`, 'error');
    }
}

// ─── Schedules list ───────────────────────────────────────────────────────────

export async function loadSchedules() {
    try {
        _schedules = await api.get('/admin/schedules');
        console.log('[duty] Schedules:', _schedules);
    } catch (err) {
        console.error('[duty] loadSchedules error:', err);
        _schedules = [];
    }
    _renderScheduleList();
}

function _renderScheduleList() {
    const container = document.getElementById('duty-schedules-list');
    if (!container) return;

    if (_schedules.length === 0) {
        container.innerHTML = '<p class="hint" style="padding:12px 0;">Нет графиков — создайте первый</p>';
        return;
    }

    container.innerHTML = _schedules.map(s => `
        <div class="duty-sched-item${s.id === _currentId ? ' duty-sched-item--active' : ''}"
             data-sched-id="${s.id}">
            <div class="duty-sched-item__body">
                <span class="duty-sched-item__title">${_esc(s.title)}</span>
                ${s.position_name
                    ? `<span class="duty-sched-item__pos">${_esc(s.position_name)}</span>`
                    : ''}
            </div>
            <button class="duty-sched-item__del" data-del-sched="${s.id}" title="Удалить график">✕</button>
        </div>
    `).join('');

    container.onclick = async (e) => {
        const delBtn = e.target.closest('[data-del-sched]');
        const item   = e.target.closest('[data-sched-id]');

        if (delBtn) {
            e.stopPropagation();
            await _deleteSchedule(parseInt(delBtn.dataset.delSched));
            return;
        }
        if (item) {
            await _selectSchedule(parseInt(item.dataset.schedId));
        }
    };
}

async function _deleteSchedule(id) {
    const s = _schedules.find(x => x.id === id);
    if (!confirm(`Удалить график «${s?.title}»?\nВсе отметки наряда будут удалены.`)) return;
    try {
        await api.delete(`/admin/schedules/${id}`);
        if (_currentId === id) {
            _currentId = null;
            _showGridEmpty();
        }
        await loadSchedules();
    } catch (err) {
        console.error('[duty] deleteSchedule error:', err);
        window.showSnackbar?.('Ошибка удаления', 'error');
    }
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

async function _selectSchedule(id) {
    _currentId = id;
    _renderScheduleList();
    await _loadGrid();
}

async function _loadGrid() {
    if (!_currentId) return;

    document.getElementById('duty-grid-empty')?.classList.add('hidden');
    document.getElementById('duty-grid-container')?.classList.remove('hidden');
    document.getElementById('duty-grid-loading')?.classList.remove('hidden');
    document.getElementById('duty-person-search-wrap')?.classList.add('hidden');

    try {
        [_currentPersons, _currentMarks] = await Promise.all([
            api.get(`/admin/schedules/${_currentId}/persons`),
            api.get(`/admin/schedules/${_currentId}/marks?year=${_year}&month=${_month}`),
        ]);
        console.log('[duty] Grid loaded — persons:', _currentPersons.length, 'marks:', _currentMarks.length);
    } catch (err) {
        console.error('[duty] _loadGrid error:', err);
        window.showSnackbar?.('Ошибка загрузки данных графика', 'error');
        document.getElementById('duty-grid-loading')?.classList.add('hidden');
        return;
    }

    _renderMonthLabel();
    _renderGrid();
    document.getElementById('duty-grid-loading')?.classList.add('hidden');
}

function _renderMonthLabel() {
    const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const el = document.getElementById('duty-month-label');
    if (el) el.textContent = `${MONTHS[_month - 1]} ${_year}`;
}

function _daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
}

function _renderGrid() {
    const table = document.getElementById('duty-grid-table');
    if (!table) return;

    const days   = _daysInMonth(_year, _month);
    const today  = new Date();
    const todayD = today.getDate();
    const isThisMonth = today.getFullYear() === _year && today.getMonth() + 1 === _month;

    // Set для быстрого поиска O(1)
    const markSet = new Set(_currentMarks.map(m => `${m.person_id}|${m.duty_date}`));

    const DAY_ABBR = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

    // Шапка: номера дней
    const dayHeaders = Array.from({ length: days }, (_, i) => {
        const d         = i + 1;
        const dow       = new Date(_year, _month - 1, d).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isToday   = isThisMonth && d === todayD;
        return `<th class="duty-grid__day-hdr${isWeekend ? ' duty-grid__day-hdr--weekend' : ''}${isToday ? ' duty-grid__day-hdr--today' : ''}"
                    title="${DAY_ABBR[dow]}">${d}</th>`;
    }).join('');

    // Строки с людьми
    const rows = _currentPersons.map(p => {
        const cells = Array.from({ length: days }, (_, i) => {
            const d       = i + 1;
            const dateStr = `${_year}-${String(_month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const on      = markSet.has(`${p.person_id}|${dateStr}`);
            const dow     = new Date(_year, _month - 1, d).getDay();
            const isWeekend = dow === 0 || dow === 6;
            const isToday   = isThisMonth && d === todayD;

            return `<td class="duty-grid__cell${on ? ' duty-grid__cell--on' : ''}${isWeekend ? ' duty-grid__cell--weekend' : ''}${isToday ? ' duty-grid__cell--today' : ''}"
                        data-person-id="${p.person_id}"
                        data-date="${dateStr}"
                        title="${_esc(p.full_name)} — ${dateStr}">
                        ${on ? '<span class="duty-grid__mark">■</span>' : ''}
                    </td>`;
        }).join('');

        const rankBadge = p.rank
            ? `<span class="duty-grid__rank">${_esc(p.rank)}</span>`
            : '';

        return `<tr>
            <td class="duty-grid__name-cell">
                <div class="duty-grid__name-wrap">
                    <button class="duty-grid__remove-person"
                            data-remove-person="${p.person_id}"
                            title="Убрать из графика">✕</button>
                    <div class="duty-grid__name-info">
                        ${rankBadge}
                        <span class="duty-grid__fullname">${_esc(p.full_name)}</span>
                    </div>
                </div>
            </td>
            ${cells}
        </tr>`;
    }).join('');

    const emptyRow = _currentPersons.length === 0
        ? `<tr><td colspan="${days + 1}"
               style="text-align:center;padding:24px;color:var(--md-on-surface-hint);font-size:0.85rem;">
               Нет людей — добавьте через кнопку «+ Добавить человека»
           </td></tr>`
        : '';

    table.innerHTML = `
        <colgroup>
            <col style="min-width:200px;width:200px;">
            ${Array.from({ length: days }, () => '<col style="width:32px;min-width:28px;">').join('')}
        </colgroup>
        <thead>
            <tr>
                <th class="duty-grid__name-hdr">ФИО</th>
                ${dayHeaders}
            </tr>
        </thead>
        <tbody>${rows || emptyRow}</tbody>`;

    // Делегированные события
    table.onclick = async (e) => {
        const cell      = e.target.closest('.duty-grid__cell');
        const removeBtn = e.target.closest('.duty-grid__remove-person');

        if (removeBtn) {
            await _removePersonFromSchedule(parseInt(removeBtn.dataset.removePerson));
            return;
        }
        if (cell) {
            await _toggleMark(parseInt(cell.dataset.personId), cell.dataset.date, cell);
        }
    };
}

async function _toggleMark(personId, dateStr, cellEl) {
    try {
        const res = await api.post(`/admin/schedules/${_currentId}/marks`, {
            person_id: personId,
            duty_date: dateStr,
        });
        console.log('[duty] toggleMark result:', res);

        const isOn = res.action === 'added';

        // Обновляем UI без перезагрузки
        cellEl.classList.toggle('duty-grid__cell--on', isOn);
        cellEl.innerHTML = isOn ? '<span class="duty-grid__mark">■</span>' : '';

        if (isOn) {
            _currentMarks.push({ person_id: personId, duty_date: dateStr });
            if (res.filled_events_count > 0) {
                window.showSnackbar?.(
                    `Наряд выставлен. Заполнено автоматически: ${res.filled_events_count} ${
                        res.filled_events_count === 1 ? 'список' :
                        res.filled_events_count < 5  ? 'списка' : 'списков'
                    }`,
                    'success'
                );
            }
        } else {
            _currentMarks = _currentMarks.filter(
                m => !(m.person_id === personId && m.duty_date === dateStr)
            );
        }
    } catch (err) {
        console.error('[duty] toggleMark error:', err);
        window.showSnackbar?.(`Ошибка: ${err?.message || 'сервер'}`, 'error');
    }
}

async function _removePersonFromSchedule(personId) {
    const p = _currentPersons.find(x => x.person_id === personId);
    if (!confirm(`Убрать «${p?.full_name}» из графика?`)) return;
    try {
        await api.delete(`/admin/schedules/${_currentId}/persons/${personId}`);
        await _loadGrid();
    } catch (err) {
        console.error('[duty] removePersonFromSchedule error:', err);
        window.showSnackbar?.('Ошибка удаления из графика', 'error');
    }
}

function _shiftMonth(delta) {
    _month += delta;
    if (_month > 12) { _month = 1;  _year++; }
    if (_month < 1)  { _month = 12; _year--; }
    _loadGrid();
}

function _showGridEmpty() {
    document.getElementById('duty-grid-empty')?.classList.remove('hidden');
    document.getElementById('duty-grid-container')?.classList.add('hidden');
}

// ─── Person search ────────────────────────────────────────────────────────────

function _onPersonSearch(query) {
    clearTimeout(_searchTimeout);
    const results = document.getElementById('duty-person-results');
    if (!results) return;

    if (query.trim().length < 2) {
        results.innerHTML = '';
        return;
    }

    _searchTimeout = setTimeout(async () => {
        try {
            const persons = await api.get(`/persons/search?q=${encodeURIComponent(query)}&limit=10`);
            if (persons.length === 0) {
                results.innerHTML = '<div style="padding:8px 12px;color:var(--md-on-surface-hint);font-size:0.8rem;">Не найдено</div>';
                return;
            }
            results.innerHTML = persons.map(p => `
                <div class="duty-person-result" data-person-id="${p.id}">
                    <span class="duty-person-result__name">${_esc(p.full_name)}</span>
                    ${p.rank ? `<span class="duty-person-result__rank">${_esc(p.rank)}</span>` : ''}
                </div>
            `).join('');

            results.onclick = async (e) => {
                const row = e.target.closest('.duty-person-result');
                if (!row) return;
                const pid = parseInt(row.dataset.personId);
                await _addPersonToSchedule(pid);
                document.getElementById('duty-person-search-input').value = '';
                results.innerHTML = '';
                document.getElementById('duty-person-search-wrap')?.classList.add('hidden');
            };
        } catch (err) {
            console.error('[duty] person search error:', err);
        }
    }, 250);
}

async function _addPersonToSchedule(personId) {
    try {
        await api.post(`/admin/schedules/${_currentId}/persons`, { person_id: personId });
        await _loadGrid();
        window.showSnackbar?.('Человек добавлен в график', 'success');
    } catch (err) {
        console.error('[duty] addPersonToSchedule error:', err);
        if (err?.status === 409) {
            window.showSnackbar?.('Этот человек уже в графике', 'error');
        } else {
            window.showSnackbar?.(`Ошибка: ${err?.message || err?.status}`, 'error');
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(v) {
    if (v == null) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}