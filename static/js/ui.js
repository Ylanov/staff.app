// static/js/ui.js
import { api } from './api.js';

// ─── View switching ───────────────────────────────────────────────────────────

export function showView(viewId) {
    // Скрываем все view
    document.querySelectorAll(
        '#login-view, #admin-view, #department-view'
    ).forEach(el => el.classList.add('hidden'));

    // Показываем нужный
    document.getElementById(viewId)?.classList.remove('hidden');

    // Navbar: скрыт только на логин-экране
    const navbar = document.getElementById('navbar');
    const userChip = document.getElementById('user-chip');
    if (viewId === 'login-view') {
        navbar?.classList.add('hidden');
    } else {
        navbar?.classList.remove('hidden');
        userChip && (userChip.style.display = 'flex');
    }
}

// ─── Error / notification ─────────────────────────────────────────────────────

export function showError(message) {
    if (typeof window.showSnackbar === 'function') {
        window.showSnackbar(message, 'error');
    } else {
        alert(message);
    }
}

export function showSuccess(message) {
    if (typeof window.showSnackbar === 'function') {
        window.showSnackbar(message, 'success');
    }
}

// ─── Role formatter ───────────────────────────────────────────────────────────

export function formatRole(role) {
    if (!role) return '';
    if (role === 'admin') return 'Администратор';
    if (role.startsWith('upr_')) return role.replace('upr_', '') + ' Управление';
    return role;
}

// ─── User display ─────────────────────────────────────────────────────────────

export function setUserDisplay(username) {
    const displayEl = document.getElementById('user-display');
    const avatarEl  = document.getElementById('user-avatar');

    const formatted = formatRole(username);
    if (displayEl) displayEl.textContent = formatted;

    // Инициал для аватара — первая буква имени (или первая цифра для upr_N)
    if (avatarEl) {
        const initial = username === 'admin'
            ? 'А'
            : (username.replace('upr_', '') || username)[0].toUpperCase();
        avatarEl.textContent = initial;
    }
}

// ─── Admin tabs ───────────────────────────────────────────────────────────────

export function switchAdminTab(tab) {
    const tabEditor  = document.getElementById('tab-editor');
    const tabUsers   = document.getElementById('tab-users');
    const tabPersons = document.getElementById('tab-persons');
    const tabBtns    = document.querySelectorAll('.tab-btn');

    // Скрываем всё
    tabEditor?.classList.add('hidden');
    tabUsers?.classList.add('hidden');
    tabPersons?.classList.add('hidden');
    tabBtns.forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });

    if (tab === 'editor') {
        tabEditor?.classList.remove('hidden');
        tabBtns[0]?.classList.add('active');
        tabBtns[0]?.setAttribute('aria-selected', 'true');
    } else if (tab === 'users') {
        tabUsers?.classList.remove('hidden');
        tabBtns[1]?.classList.add('active');
        tabBtns[1]?.setAttribute('aria-selected', 'true');
    } else if (tab === 'persons') {
        tabPersons?.classList.remove('hidden');
        tabBtns[2]?.classList.add('active');
        tabBtns[2]?.setAttribute('aria-selected', 'true');
        // Загружаем базу людей при первом открытии вкладки
        loadPersons();
    }
}

// ─── Events dropdowns ─────────────────────────────────────────────────────────

// Кэш всех событий — обновляется при каждом loadEventsDropdowns()
// Используется scheduleGrid в admin.js чтобы показывать уже созданные списки
let _cachedEvents = [];

export function getCachedEvents() {
    return _cachedEvents;
}

export async function loadEventsDropdowns() {
    try {
        const events = await api.get('/slots/events');
        _cachedEvents = events;

        // 🔥 Разделяем списки и шаблоны
        const templates = events.filter(e => e.is_template);
        const regular = events.filter(e => !e.is_template);

        // Формируем красивые группы для обычных меню
        let generalOptions = '<option value="" disabled selected>— Выберите список —</option>';

        if (regular.length > 0) {
            generalOptions += '<optgroup label="Рабочие списки">';
            generalOptions += regular
                .map(e => `<option value="${e.id}">${e.title}</option>`)
                .join('');
            generalOptions += '</optgroup>';
        }

        if (templates.length > 0) {
            generalOptions += '<optgroup label="Шаблоны (для редактирования)">';
            generalOptions += templates
                .map(e => `<option value="${e.id}">[Шаблон] ${e.title}</option>`)
                .join('');
            generalOptions += '</optgroup>';
        }

        // ✅ ИСПРАВЛЕНО: нормальный массив
        [
            'dept-event-id',
            'group-event-id',
            'export-event-id',
            'editor-event-id',
            'position-event-id',
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = generalOptions;
        });

        // Карточки для department view
        renderDeptEventCards(regular);

        // 🔥 Только шаблоны (для генерации)
        const templateSelect = document.getElementById('template-select-id');
        if (templateSelect) {
            let tplOptions = '<option value="" disabled selected>— Выберите шаблон —</option>';

            if (templates.length === 0) {
                tplOptions += '<option disabled>Нет сохраненных шаблонов</option>';
            } else {
                tplOptions += templates
                    .map(e => `<option value="${e.id}">${e.title}</option>`)
                    .join('');
            }

            templateSelect.innerHTML = tplOptions;
        }

    } catch (error) {
        console.error('loadEventsDropdowns:', error);

        // 💡 небольшой UX бонус
        if (typeof window.showSnackbar === 'function') {
            window.showSnackbar('Ошибка загрузки списков', 'error');
        }
    }
}

// ─── Department: карточки списков ────────────────────────────

const WEEKDAY_NAMES_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WEEKDAY_FULL_RU  = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function getDayLabel(isoDate) {
    if (!isoDate) return null;
    const today    = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const d        = new Date(isoDate + 'T00:00:00');

    if (d.getTime() === today.getTime())    return { text: 'Сегодня',  accent: true };
    if (d.getTime() === tomorrow.getTime()) return { text: 'Завтра',   accent: false };

    // Если в пределах текущей недели — показываем день недели
    const diff = Math.round((d - today) / 86400000);
    if (diff > 1 && diff <= 6) return { text: WEEKDAY_FULL_RU[d.getDay()], accent: false };
    if (diff < 0 && diff >= -2) return { text: 'Прошедший', accent: false, muted: true };

    return null;
}

function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    const dd  = String(d.getDate()).padStart(2, '0');
    const mm  = String(d.getMonth() + 1).padStart(2, '0');
    const wd  = WEEKDAY_NAMES_RU[d.getDay()];
    return `${wd}, ${dd}.${mm}`;
}

export function renderDeptEventCards(events) {
    const grid = document.getElementById('dept-event-cards');
    if (!grid) return;

    if (!events || events.length === 0) {
        grid.innerHTML = `
            <div class="dept-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
                <p>Нет активных списков</p>
                <span>Администратор ещё не выпустил списки для заполнения</span>
            </div>`;
        return;
    }

    grid.innerHTML = events.map((event, i) => {
        const dayLabel   = getDayLabel(event.date);
        const dateStr    = formatDisplayDate(event.date);

        const labelHtml = dayLabel
            ? `<span class="dept-event-card__day-label${dayLabel.accent ? ' dept-event-card__day-label--today' : dayLabel.muted ? ' dept-event-card__day-label--muted' : ''}">${dayLabel.text}</span>`
            : '';

        const dateHtml = dateStr
            ? `<span class="dept-event-card__date">${dateStr}</span>`
            : '';

        return `
        <button class="dept-event-card${dayLabel?.accent ? ' dept-event-card--today' : ''}" data-event-id="${event.id}" data-event-title="${event.title}" type="button">
            <div class="dept-event-card__num">${i + 1}</div>
            <div class="dept-event-card__body">
                <div class="dept-event-card__top">
                    ${labelHtml}
                    ${dateHtml}
                </div>
                <span class="dept-event-card__title">${event.title}</span>
                <div class="dept-event-card__progress-wrap">
                    <div class="dept-event-card__progress-bar">
                        <div class="dept-event-card__progress-fill" id="progress-fill-${event.id}" style="width:0%"></div>
                    </div>
                    <span class="dept-event-card__progress-label" id="progress-label-${event.id}">—</span>
                </div>
            </div>
            <svg class="dept-event-card__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18l6-6-6-6"/>
            </svg>
        </button>`
    }).join('');
}

// Обновляет прогресс-бар карточки после загрузки слотов
export function updateDeptCardProgress(eventId, slots) {
    const fill  = document.getElementById(`progress-fill-${eventId}`);
    const label = document.getElementById(`progress-label-${eventId}`);
    if (!fill || !label) return;

    const total   = slots.length;
    const filled  = slots.filter(s => s.full_name && s.full_name.trim() !== '').length;
    const percent = total > 0 ? Math.round((filled / total) * 100) : 0;

    fill.style.width = `${percent}%`;
    fill.className   = 'dept-event-card__progress-fill' + (percent === 100 ? ' done' : percent > 0 ? ' partial' : '');
    label.textContent = total > 0 ? `${filled} из ${total}` : 'Пусто';
}

// ─── База людей (admin: вкладка «База людей») ─────────────────────────────────

let _personsData   = [];   // кэш загруженных записей
let _editingId     = null; // id записи в режиме редактирования
let _searchTimeout = null;

export async function loadPersons(searchQuery = '') {
    const tbody   = document.getElementById('persons-tbody');
    const empty   = document.getElementById('persons-empty');
    if (!tbody) return;

    try {
        const params  = searchQuery ? `?q=${encodeURIComponent(searchQuery)}&limit=500` : '?limit=500';
        _personsData  = await api.get(`/persons${params}`);
        renderPersonsTable(_personsData);
        empty?.classList.toggle('hidden', _personsData.length > 0);
    } catch (err) {
        console.error('loadPersons:', err);
        if (typeof window.showSnackbar === 'function') {
            window.showSnackbar('Ошибка загрузки базы людей', 'error');
        }
    }
}

function esc(v) {
    if (v == null) return '';
    return String(v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPersonsTable(persons) {
    const tbody = document.getElementById('persons-tbody');
    if (!tbody) return;

    if (persons.length === 0) {
        tbody.innerHTML = '';
        return;
    }

    tbody.innerHTML = persons.map(p => `
        <tr data-person-id="${p.id}" id="person-row-${p.id}">
            <td style="color:var(--md-on-surface-hint); font-family:var(--md-font-mono); font-size:0.72rem;">${p.id}</td>
            <td class="person-cell-name">${esc(p.full_name)}</td>
            <td class="person-cell-rank">${esc(p.rank || '—')}</td>
            <td class="person-cell-doc">${esc(p.doc_number || '—')}</td>
            <td>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-outlined btn-xs person-edit-btn" data-person-id="${p.id}" type="button">✎</button>
                    <button class="btn-tiny-danger person-del-btn" data-person-id="${p.id}" type="button">✕</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Inline редактирование строки
function startEditRow(personId) {
    const person = _personsData.find(p => p.id === personId);
    if (!person) return;

    // Если редактировали другую строку — восстанавливаем её
    if (_editingId && _editingId !== personId) cancelEditRow();

    _editingId = personId;
    const row  = document.getElementById(`person-row-${personId}`);
    if (!row) return;

    row.innerHTML = `
        <td style="color:var(--md-on-surface-hint); font-family:var(--md-font-mono); font-size:0.72rem;">${person.id}</td>
        <td><input class="person-inline-input" id="edit-name-${personId}"  value="${esc(person.full_name)}"  placeholder="ФИО"></td>
        <td><input class="person-inline-input" id="edit-rank-${personId}"  value="${esc(person.rank || '')}"  placeholder="Звание"></td>
        <td><input class="person-inline-input" id="edit-doc-${personId}"   value="${esc(person.doc_number || '')}" placeholder="№ документа"></td>
        <td>
            <div style="display:flex;gap:4px;">
                <button class="btn btn-filled btn-xs person-save-edit-btn" data-person-id="${personId}" type="button">✓</button>
                <button class="btn btn-outlined btn-xs person-cancel-edit-btn" data-person-id="${personId}" type="button">✕</button>
            </div>
        </td>
    `;
    document.getElementById(`edit-name-${personId}`)?.focus();
}

function cancelEditRow() {
    if (!_editingId) return;
    const person = _personsData.find(p => p.id === _editingId);
    if (person) {
        const row = document.getElementById(`person-row-${_editingId}`);
        if (row) {
            row.innerHTML = `
                <td style="color:var(--md-on-surface-hint); font-family:var(--md-font-mono); font-size:0.72rem;">${person.id}</td>
                <td class="person-cell-name">${esc(person.full_name)}</td>
                <td class="person-cell-rank">${esc(person.rank || '—')}</td>
                <td class="person-cell-doc">${esc(person.doc_number || '—')}</td>
                <td>
                    <div style="display:flex;gap:4px;">
                        <button class="btn btn-outlined btn-xs person-edit-btn" data-person-id="${person.id}" type="button">✎</button>
                        <button class="btn-tiny-danger person-del-btn" data-person-id="${person.id}" type="button">✕</button>
                    </div>
                </td>
            `;
        }
    }
    _editingId = null;
}

async function saveEditRow(personId) {
    const name = document.getElementById(`edit-name-${personId}`)?.value?.trim();
    const rank = document.getElementById(`edit-rank-${personId}`)?.value?.trim();
    const doc  = document.getElementById(`edit-doc-${personId}`)?.value?.trim();

    if (!name) {
        window.showSnackbar?.('ФИО не может быть пустым', 'error');
        return;
    }

    try {
        const updated = await api.put(`/persons/${personId}`, {
            full_name:  name,
            rank:       rank || null,
            doc_number: doc  || null,
        });
        // Обновляем кэш
        const idx = _personsData.findIndex(p => p.id === personId);
        if (idx !== -1) _personsData[idx] = updated;
        _editingId = null;
        renderPersonsTable(_personsData);
        window.showSnackbar?.('Сохранено', 'success');
    } catch (err) {
        window.showSnackbar?.('Ошибка сохранения', 'error');
    }
}

async function deletePerson(personId) {
    if (!confirm('Удалить из базы? Это не затронет уже заполненные списки.')) return;
    try {
        await api.delete(`/persons/${personId}`);
        _personsData = _personsData.filter(p => p.id !== personId);
        renderPersonsTable(_personsData);
        document.getElementById('persons-empty')?.classList.toggle('hidden', _personsData.length > 0);
        window.showSnackbar?.('Удалено', 'success');
    } catch (err) {
        window.showSnackbar?.('Ошибка удаления', 'error');
    }
}

// Инициализация обработчиков вкладки «База людей»
export function initPersonsTab() {
    // Поиск с дебаунсом
    document.getElementById('persons-search')?.addEventListener('input', (e) => {
        clearTimeout(_searchTimeout);
        _searchTimeout = setTimeout(() => loadPersons(e.target.value.trim()), 300);
    });

    // --- ЛОГИКА ИМПОРТА EXCEL ---
    const importBtn = document.getElementById('persons-import-btn');
    const importInput = document.getElementById('persons-import-input');

    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => {
            importInput.click();
        });

        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
                window.showSnackbar?.('Пожалуйста, выберите файл .xlsx', 'error');
                importInput.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            const originalText = importBtn.innerHTML;
            importBtn.innerHTML = '⏳ Загрузка...';
            importBtn.disabled = true;

            try {
                const res = await api.upload('/persons/import', formData);
                await loadPersons(document.getElementById('persons-search')?.value?.trim() || '');
                window.showSnackbar?.(`Готово! Добавлено: ${res.added}, Обновлено: ${res.updated}`, 'success', 6000);
            } catch (err) {
                console.error('Import error:', err);
                window.showSnackbar?.(err.message || 'Ошибка при импорте файла', 'error');
            } finally {
                importBtn.innerHTML = originalText;
                importBtn.disabled = false;
                importInput.value = '';
            }
        });
    }

    // Показать/скрыть форму добавления
    document.getElementById('persons-add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('persons-add-form');
        form?.classList.toggle('hidden');
        if (!form?.classList.contains('hidden')) {
            document.getElementById('person-fullname')?.focus();
        }
    });

    document.getElementById('persons-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('persons-add-form')?.classList.add('hidden');
        clearAddForm();
    });

    // Сохранить новую запись
    document.getElementById('persons-save-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('person-fullname')?.value?.trim();
        const rank = document.getElementById('person-rank')?.value?.trim();
        const doc  = document.getElementById('person-doc')?.value?.trim();

        if (!name) {
            window.showSnackbar?.('Введите ФИО', 'error');
            return;
        }

        try {
            await api.post('/persons', { full_name: name, rank: rank || null, doc_number: doc || null });
            clearAddForm();
            document.getElementById('persons-add-form')?.classList.add('hidden');
            await loadPersons(document.getElementById('persons-search')?.value?.trim() || '');
            window.showSnackbar?.('Добавлено в базу', 'success');
        } catch (err) {
            const msg = err.status === 409 ? 'Человек с таким ФИО уже есть' : 'Ошибка добавления';
            window.showSnackbar?.(msg, 'error');
        }
    });

    // Делегирование — таблица (редактирование / удаление)
    document.getElementById('persons-tbody')?.addEventListener('click', (e) => {
        const editBtn   = e.target.closest('.person-edit-btn');
        const delBtn    = e.target.closest('.person-del-btn');
        const saveEdit  = e.target.closest('.person-save-edit-btn');
        const cancelEdit = e.target.closest('.person-cancel-edit-btn');

        if (editBtn)    startEditRow(parseInt(editBtn.dataset.personId));
        if (delBtn)     deletePerson(parseInt(delBtn.dataset.personId));
        if (saveEdit)   saveEditRow(parseInt(saveEdit.dataset.personId));
        if (cancelEdit) cancelEditRow();
    });
}

function clearAddForm() {
    ['person-fullname', 'person-rank', 'person-doc'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

// ─── Автодополнение ФИО ───────────────────────────────────────────────────────

let _acTimeout  = null;
let _acActive   = false;

export function initAutocomplete() {
    // Единый обработчик для полей ввода имени
    const handleInput = (e) => {
        const input = e.target;
        // Ищем только поля с id начинающимся на "name-"
        if (!input.id?.startsWith('name-')) return;
        const slotId = input.id.replace('name-', '');
        triggerAutocomplete(input, slotId);
    };

    // Привязываем и к таблице управлений, и к главной таблице админа!
    document.getElementById('slots-tbody')?.addEventListener('input', handleInput);
    document.getElementById('master-tbody')?.addEventListener('input', handleInput);

    // Закрываем дропдаун при клике вне
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.ac-dropdown')) {
            closeAllDropdowns();
        }
    });
}

function triggerAutocomplete(input, slotId) {
    clearTimeout(_acTimeout);
    const query = input.value.trim();

    if (query.length < 2) {
        closeAllDropdowns();
        return;
    }

    _acTimeout = setTimeout(async () => {
        try {
            const results = await api.get(`/persons/search?q=${encodeURIComponent(query)}&limit=8`);
            if (results.length === 0) { closeAllDropdowns(); return; }
            showDropdown(input, slotId, results);
        } catch {
            // Тихо игнорируем — автодополнение не критично
        }
    }, 250);
}

function showDropdown(input, slotId, persons) {
    closeAllDropdowns();

    const dropdown = document.createElement('div');
    dropdown.className = 'ac-dropdown';
    dropdown.setAttribute('role', 'listbox');

    persons.forEach(person => {
        const item = document.createElement('div');
        item.className = 'ac-item';
        item.setAttribute('role', 'option');
        item.innerHTML = `
            <span class="ac-item__name">${esc(person.full_name)}</span>
            ${person.rank       ? `<span class="ac-item__tag">${esc(person.rank)}</span>` : ''}
            ${person.doc_number ? `<span class="ac-item__tag ac-item__tag--doc">${esc(person.doc_number)}</span>` : ''}
        `;

        item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // не снимаем фокус с input

            // Заполняем поля слота данными из базы
            const nameEl = document.getElementById(`name-${slotId}`);
            const rankEl = document.getElementById(`rank-${slotId}`);
            const docEl  = document.getElementById(`doc-${slotId}`);

            if (nameEl) nameEl.value = person.full_name;
            if (rankEl && person.rank)       rankEl.value = person.rank;
            if (docEl  && person.doc_number) docEl.value  = person.doc_number;

            closeAllDropdowns();

            // Даём пользователю понять что данные подставились
            [nameEl, rankEl, docEl].forEach(el => {
                if (!el || !el.value) return;
                el.classList.add('ac-filled');
                setTimeout(() => el.classList.remove('ac-filled'), 600);
            });
        });

        dropdown.appendChild(item);
    });

    // Позиционируем под полем ввода
    const rect = input.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top      = `${rect.bottom + 2}px`;
    dropdown.style.left     = `${rect.left}px`;
    dropdown.style.width    = `${Math.max(rect.width, 240)}px`;
    dropdown.style.zIndex   = '9000';

    document.body.appendChild(dropdown);
}

function closeAllDropdowns() {
    document.querySelectorAll('.ac-dropdown').forEach(d => d.remove());
}