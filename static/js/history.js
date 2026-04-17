// static/js/history.js
//
// Вкладка «История» — все рабочие списки по датам.
// Шаблоны сюда НЕ попадают (они остаются в редакторе).
// Выводит список, позволяет просмотреть в режиме "только чтение" и
// экспортировать в .docx. Удалять позволяет только админу.

import { api } from './api.js';
import { formatRole } from './ui.js';

let _allEvents    = [];
let _filtered     = [];
let _searchQuery  = '';
let _periodFilter = 'past'; // по умолчанию — прошедшие
let _inited       = false;

const WEEKDAYS_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function _esc(v) {
    if (v == null) return '';
    return String(v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
}

function _weekdayOf(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return WEEKDAYS_FULL[d.getDay()];
}

function _todayIso() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function _daysBetween(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((a - b) / 86400000);
}

// ─── Init / Load ──────────────────────────────────────────────────────────────

export async function loadHistory() {
    _bindEventsOnce();

    const tbody = document.getElementById('history-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--md-on-surface-hint);">Загрузка…</td></tr>`;

    try {
        // Берём все события через админский эндпоинт
        const events = await api.get('/admin/events');
        // Фильтруем только рабочие списки (не шаблоны, с датой)
        _allEvents = events.filter(e => !e.is_template && e.date);
        _renderStats();
        _applyFilters();
    } catch (err) {
        console.error('[history] load:', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--md-error, #E24B4A);">Ошибка загрузки истории</td></tr>`;
        window.showSnackbar?.('Не удалось загрузить историю', 'error');
    }
}

function _bindEventsOnce() {
    if (_inited) return;
    _inited = true;

    const search = document.getElementById('history-search-input');
    if (search) {
        let t = null;
        search.addEventListener('input', (e) => {
            clearTimeout(t);
            t = setTimeout(() => {
                _searchQuery = (e.target.value || '').trim().toLowerCase();
                _applyFilters();
            }, 200);
        });
    }

    const period = document.getElementById('history-filter-period');
    if (period) {
        period.addEventListener('change', (e) => {
            _periodFilter = e.target.value;
            _applyFilters();
        });
    }

    document.getElementById('history-refresh-btn')?.addEventListener('click', () => loadHistory());

    // Делегирование кликов по таблице
    document.getElementById('history-tbody')?.addEventListener('click', async (e) => {
        const viewBtn   = e.target.closest('.history-view-btn');
        const exportBtn = e.target.closest('.history-export-btn');
        const delBtn    = e.target.closest('.history-del-btn');

        if (viewBtn)   _openReadonly(parseInt(viewBtn.dataset.eventId, 10));
        if (exportBtn) _exportEvent(parseInt(exportBtn.dataset.eventId, 10));
        if (delBtn)    _deleteEvent(parseInt(delBtn.dataset.eventId, 10));
    });
}

// ─── Filters / stats ──────────────────────────────────────────────────────────

function _applyFilters() {
    const today = _todayIso();

    _filtered = _allEvents.filter(ev => {
        // Фильтр по поиску
        if (_searchQuery && !ev.title.toLowerCase().includes(_searchQuery)) return false;

        // Фильтр по периоду
        if (_periodFilter === 'all')      return true;
        if (_periodFilter === 'upcoming') return ev.date >= today && ev.date !== today;
        if (_periodFilter === 'past')     return ev.date < today;
        if (_periodFilter === 'today')    return ev.date === today;

        const diff = _daysBetween(today, ev.date);
        if (_periodFilter === 'week')  return diff >= 0 && diff <= 7;
        if (_periodFilter === 'month') return diff >= 0 && diff <= 30;
        return true;
    });

    // Сортировка: свежие даты первыми (desc по дате, затем по id desc)
    _filtered.sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        return b.id - a.id;
    });

    _renderTable();
}

function _renderStats() {
    const today = _todayIso();
    const total    = _allEvents.length;
    const past     = _allEvents.filter(e => e.date <  today).length;
    const upcoming = _allEvents.filter(e => e.date >  today).length;
    const todayN   = _allEvents.filter(e => e.date === today).length;

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('history-stat-total',    total);
    setText('history-stat-past',     past);
    setText('history-stat-upcoming', upcoming);
    setText('history-stat-today',    todayN);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function _renderTable() {
    const tbody = document.getElementById('history-tbody');
    const empty = document.getElementById('history-empty');
    if (!tbody) return;

    if (_filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--md-on-surface-hint);">Нет списков по выбранным фильтрам</td></tr>`;
        empty?.classList.toggle('hidden', _allEvents.length > 0);
        return;
    }
    empty?.classList.add('hidden');

    const today = _todayIso();

    const STATUS_LABEL = { draft: 'Черновик', active: 'Активен', closed: 'Закрыт' };

    tbody.innerHTML = _filtered.map(ev => {
        const isPast   = ev.date <  today;
        const isToday  = ev.date === today;
        const isFuture = ev.date >  today;

        const dateBadge = isToday
            ? `<span style="font-size:0.7rem; padding:2px 7px; border-radius:10px; background:var(--md-warning-light, #FCECD3); color:var(--md-warning, #BA7517); border:1px solid #f0d9b8; white-space:nowrap; margin-left:6px;">Сегодня</span>`
            : '';

        const statusStyle = ev.status === 'active'
            ? 'background:var(--md-primary-light); color:var(--md-primary-dark); border:1px solid #c5ddd8;'
            : ev.status === 'closed'
                ? 'background:#eee; color:#666; border:1px solid #ddd;'
                : 'background:var(--md-surface-variant); color:var(--md-on-surface-variant); border:1px solid var(--md-outline-variant);';

        const rowStyle = isPast ? 'opacity:0.72;' : (isFuture ? 'background:rgba(0,0,0,0.015);' : '');

        return `
            <tr data-event-id="${ev.id}" style="${rowStyle}">
                <td style="color:var(--md-on-surface-hint); font-family:var(--md-font-mono); font-size:0.72rem;">${ev.id}</td>
                <td style="font-weight:500;">${_esc(ev.title)}</td>
                <td style="white-space:nowrap;">${_fmtDate(ev.date)}${dateBadge}</td>
                <td style="color:var(--md-on-surface-variant);">${_weekdayOf(ev.date)}</td>
                <td>
                    <span style="font-size:0.7rem; padding:2px 8px; border-radius:10px; ${statusStyle} white-space:nowrap;">
                        ${STATUS_LABEL[ev.status] || ev.status}
                    </span>
                </td>
                <td id="hist-fill-${ev.id}" style="font-size:0.78rem; color:var(--md-on-surface-variant);">—</td>
                <td>
                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                        <button class="btn btn-outlined btn-xs history-view-btn" data-event-id="${ev.id}" type="button" title="Открыть для просмотра">👁 Просмотр</button>
                        <button class="btn btn-outlined btn-xs history-export-btn" data-event-id="${ev.id}" type="button" title="Скачать .docx">⬇ .docx</button>
                        <button class="btn btn-danger btn-xs history-del-btn" data-event-id="${ev.id}" type="button" title="Удалить список">✕</button>
                    </div>
                </td>
            </tr>`;
    }).join('');

    // Асинхронно подтягиваем заполнение каждой строки (не блокируем рендер)
    _filtered.forEach(ev => _loadFillStatus(ev.id));
}

async function _loadFillStatus(eventId) {
    try {
        const data = await api.get(`/admin/events/${eventId}/full`);
        let total = 0, filled = 0;
        (data.groups || []).forEach(g => {
            (g.slots || []).forEach(s => {
                total++;
                if (s.full_name && s.full_name.trim()) filled++;
            });
        });
        const cell = document.getElementById(`hist-fill-${eventId}`);
        if (!cell) return;
        if (total === 0) {
            cell.textContent = '—';
            return;
        }
        const pct = Math.round((filled / total) * 100);
        const color = pct >= 90 ? 'var(--md-success, #1D9E75)' : (pct >= 60 ? 'var(--md-warning, #BA7517)' : 'var(--md-error, #E24B4A)');
        cell.innerHTML = `<span style="color:${color}; font-weight:500;">${filled}/${total}</span> <span style="color:var(--md-on-surface-hint);">(${pct}%)</span>`;
    } catch {
        /* игнорируем — в худшем случае останется — */
    }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function _openReadonly(eventId) {
    return openEventReadonly(eventId);
}

/**
 * Публичная функция — открывает список в режиме просмотра (модалка с таблицей).
 * Используется:
 *   - кнопкой «👁 Просмотр» во вкладке История (через _openReadonly)
 *   - кликом по карточке списка в дашборде
 */
export async function openEventReadonly(eventId) {
    try {
        const data = await api.get(`/admin/events/${eventId}/full`);
        _showReadonlyModal(data);
    } catch (err) {
        console.error('[history] open readonly:', err);
        window.showSnackbar?.('Не удалось открыть список', 'error');
    }
}

function _showReadonlyModal(data) {
    document.getElementById('history-readonly-modal')?.remove();

    const ev = data.event;
    const modal = document.createElement('div');
    modal.id = 'history-readonly-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px;';

    const cols = (data.columns || []).filter(c => c.visible !== false).sort((a, b) => a.order - b.order);

    const slotRow = (slot, idx) => {
        const cells = cols.map(c => {
            let val = '';
            if (c.type === 'select_position') {
                val = slot.position_name || '—';
            } else if (c.type === 'select_dept') {
                val = slot.department ? formatRole(slot.department) : '—';
            } else if (c.key in slot) {
                val = slot[c.key] ?? '';
            } else if (slot.extra_data && slot.extra_data[c.key] != null) {
                val = slot.extra_data[c.key];
            }
            return `<td style="padding:4px 8px; border-bottom:1px solid var(--md-outline-variant); font-size:0.82rem;">${_esc(val || '—')}</td>`;
        }).join('');
        return `<tr><td style="padding:4px 8px; text-align:center; color:var(--md-on-surface-hint); font-size:0.75rem;">${idx}</td>${cells}</tr>`;
    };

    let globalIdx = 1;
    const groupsHtml = (data.groups || []).map(g => {
        const rows = (g.slots || []).map(s => slotRow(s, globalIdx++)).join('');
        return `
            <tr class="group-header"><td colspan="${cols.length + 1}" style="background:var(--md-surface-variant); padding:6px 10px; font-weight:600; font-size:0.85rem;">${_esc(g.name)}</td></tr>
            ${rows}`;
    }).join('');

    modal.innerHTML = `
        <div style="background:var(--md-surface); border-radius:var(--md-radius-lg, 12px); box-shadow:0 10px 40px rgba(0,0,0,0.25); max-width:1100px; width:100%; max-height:90vh; display:flex; flex-direction:column; overflow:hidden;">
            <div style="padding:16px 20px; border-bottom:1px solid var(--md-outline-variant); display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
                <div>
                    <div style="font-weight:600; font-size:1rem;">${_esc(ev.title)}</div>
                    <div style="font-size:0.78rem; color:var(--md-on-surface-hint); margin-top:2px;">
                        ${_fmtDate(ev.date)} · ${_weekdayOf(ev.date)} · ${ev.status}
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-text btn-sm" id="history-modal-close" type="button">Закрыть</button>
                </div>
            </div>

            <!-- Блок: Дежурный + Скачать .docx (как в редакторе шаблонов) -->
            <div style="padding:12px 20px; background:var(--md-surface-variant); border-bottom:1px solid var(--md-outline-variant); display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap;">
                <div style="flex:1 1 auto; min-width:260px;">
                    <div style="font-size:0.72rem; font-weight:600; color:var(--md-on-surface-variant); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.3px;">
                        Дежурный (подпись в документе)
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <div class="field" style="min-width:130px; flex:0 0 150px;">
                            <label class="field-label" for="history-duty-rank" style="font-size:0.7rem;">Звание</label>
                            <input type="text" id="history-duty-rank" placeholder="подполковник" autocomplete="off"
                                   style="padding:5px 8px; font-size:0.82rem; border:1px solid var(--md-outline); border-radius:var(--md-radius-sm); background:var(--md-surface); color:var(--md-on-surface); width:100%; outline:none;">
                        </div>
                        <div class="field" style="flex:1; min-width:180px;">
                            <label class="field-label" for="history-duty-name" style="font-size:0.7rem;">ФИО</label>
                            <input type="text" id="history-duty-name" placeholder="А.П. Ярощук" autocomplete="off"
                                   style="padding:5px 8px; font-size:0.82rem; border:1px solid var(--md-outline); border-radius:var(--md-radius-sm); background:var(--md-surface); color:var(--md-on-surface); width:100%; outline:none;">
                        </div>
                        <button id="history-duty-save" class="btn btn-outlined btn-sm" type="button"
                                style="flex-shrink:0; align-self:flex-end;">
                            Сохранить
                        </button>
                    </div>
                </div>
                <button class="btn btn-filled btn-sm history-export-btn" data-event-id="${ev.id}" type="button"
                        style="flex-shrink:0; align-self:flex-end;">
                    ⬇ Скачать .docx
                </button>
            </div>

            <div style="overflow:auto; flex:1;">
                <table style="width:100%; border-collapse:collapse;">
                    <thead style="position:sticky; top:0; background:var(--md-surface); z-index:1;">
                        <tr>
                            <th style="padding:6px 8px; text-align:center; border-bottom:2px solid var(--md-outline); font-size:0.75rem;">№</th>
                            ${cols.map(c => `<th style="padding:6px 8px; text-align:left; border-bottom:2px solid var(--md-outline); font-size:0.75rem;">${_esc(c.label)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>${groupsHtml}</tbody>
                </table>
            </div>
        </div>`;

    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('history-modal-close')?.addEventListener('click', () => modal.remove());

    // Загружаем текущего дежурного из /settings
    _loadDutyIntoModal();

    // Кнопка «Сохранить» — сохраняет дежурного в настройках
    document.getElementById('history-duty-save')?.addEventListener('click', _saveDutyFromModal);

    // Кнопка «⬇ Скачать .docx» — перед скачиванием сохраняет дежурного (если поля изменены),
    // затем скачивает документ. Бэкенд подставит актуальные значения в .docx.
    modal.querySelector('.history-export-btn')?.addEventListener('click', async () => {
        await _saveDutyFromModal({ silent: true });
        _exportEvent(ev.id);
    });
}

// ─── Блок «Дежурный» в модалке ────────────────────────────────────────────────

async function _loadDutyIntoModal() {
    try {
        const s = await api.get('/settings');
        const rankEl = document.getElementById('history-duty-rank');
        const nameEl = document.getElementById('history-duty-name');
        if (rankEl) rankEl.value = s.duty_rank || '';
        if (nameEl) nameEl.value = s.duty_name || '';
    } catch (err) {
        console.error('[history] load duty settings:', err);
    }
}

async function _saveDutyFromModal(opts = {}) {
    const silent = opts && opts.silent === true;
    const rank = document.getElementById('history-duty-rank')?.value?.trim() ?? '';
    const name = document.getElementById('history-duty-name')?.value?.trim() ?? '';
    try {
        await api.patch('/settings', { duty_rank: rank, duty_name: name });
        if (!silent) {
            const label = `${rank} ${name}`.trim();
            window.showSnackbar?.(label ? `Дежурный сохранён: ${label}` : 'Дежурный очищен', 'success');
        }
    } catch (err) {
        console.error('[history] save duty:', err);
        if (!silent) window.showSnackbar?.('Ошибка сохранения дежурного', 'error');
    }
}

async function _exportEvent(eventId) {
    try {
        const blob = await api.download(`/export/events/${eventId}/export-word`);
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: `Список_${eventId}.docx` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('[history] export:', err);
        window.showSnackbar?.('Ошибка выгрузки', 'error');
    }
}

async function _deleteEvent(eventId) {
    const ev = _allEvents.find(e => e.id === eventId);
    const label = ev ? `«${ev.title}» за ${_fmtDate(ev.date)}` : `#${eventId}`;
    if (!confirm(`Удалить список ${label}?\n\nВсе заполненные данные будут безвозвратно удалены.`)) return;
    try {
        await api.delete(`/admin/events/${eventId}`);
        window.showSnackbar?.('Список удалён', 'success');
        await loadHistory();
    } catch (err) {
        console.error('[history] delete:', err);
        window.showSnackbar?.('Ошибка удаления', 'error');
    }
}
