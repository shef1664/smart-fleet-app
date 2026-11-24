/* Tonar-only workspace. The old mechanic/mixer entrypoints keep their own UI. */
var tonarLive = {
  dashboard: null, dashboardSeq: 0, trucksKey: null, initialized: false,
  historySeq: {}, submissionIds: {}, lastFuel: null
};

function tonarRequest(action, data) {
  var auth = buildAuthData();
  if (!auth.init_data) return Promise.reject(new Error('Откройте кабинет из Telegram.'));
  var payload = Object.assign({}, data || {}, auth);
  var signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(60000) : undefined;
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ action: action, data: payload }),
    signal: signal
  }).then(async function(response) {
    var result = await response.json();
    if (!response.ok || result.status !== 'ok') throw new Error(result.message || 'Не удалось выполнить запрос.');
    return result;
  }).catch(function(error) {
    if (error.name === 'TimeoutError' || error instanceof TypeError || error instanceof SyntaxError) {
      throw new Error('Нет подтверждения от сервера. Проверьте связь и повторите с этой же формы.');
    }
    throw error;
  });
}

function tonarSubmit(action, data) {
  var nonce = tonarLive.submissionIds[action];
  if (!nonce) {
    var u = crypto.getRandomValues(new Uint8Array(16));
    u[6] = (u[6] & 15) | 64;
    u[8] = (u[8] & 63) | 128;
    var hex = Array.from(u, function (v) { return v.toString(16).padStart(2, '0'); }).join('');
    nonce = [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
    tonarLive.submissionIds[action] = nonce;
  }
  return tonarRequest(action, Object.assign({}, data, {submission_id: nonce})).then(function(result) {
    delete tonarLive.submissionIds[action];
    return result;
  });
}

function tonarLocalDay() {
  var ru = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Novokuznetsk', day: '2-digit', month: '2-digit', year: 'numeric' });
  var parts = ru.split('.').map(Number);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

function tonarFmt(number) {
  return Number(number || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function tonarDate(iso) {
  var parts = String(iso || '').split('-');
  return parts.length === 3 ? parts.reverse().join('.') : iso || '';
}

function tonarTripCard(trip) {
  return '<div class="list-row"><div class="row-info"><div class="row-title">'
    + esc(trip.quarry || '—') + ' → ' + esc(trip.object || trip.client || '—') + '</div>'
    + '<div class="row-sub">' + esc([tonarDate(trip.date), trip.time, trip.material, trip.fraction, trip.truck].filter(Boolean).join(' · '))
    + '</div></div><div class="row-right"><div class="row-val">' + esc(tonarFmt(trip.tonnes)) + ' т</div>'
    + '<button type="button" class="chip" data-tonar-edit="' + esc(trip.id) + '">Исправить</button></div></div>';
}

function tonarEmpty(message) {
  return '<div class="row-sub" style="padding:12px 14px;">' + esc(message) + '</div>';
}

function tonarSetHTML(id, markup) {
  var element = document.getElementById(id);
  if (element) element.innerHTML = markup;
}

function tonarMetrics(data) {
  return '<div class="card"><div class="list-row">'
    + '<div class="row-info"><div class="row-title">' + esc(tonarFmt(data.trips)) + '</div><div class="row-sub">Рейсов</div></div>'
    + '<div class="row-info"><div class="row-title">' + esc(tonarFmt(data.tonnes)) + ' т</div><div class="row-sub">Выгружено</div></div>'
    + '<div class="row-info"><div class="row-title">' + esc(tonarFmt(data.litres)) + ' л</div><div class="row-sub">Заправлено</div></div>'
    + '</div></div>';
}

function tonarRenderDashboard(data, error) {
  var root = document.getElementById('tonar-live-cabinet');
  var name = data && data.profile && data.profile.name;
  root.innerHTML = '<div class="topbar"><div><div class="page-title">Кабинет водителя</div>'
    + (name ? '<div class="page-sub">' + esc(name) + '</div>' : '')
    + '</div><button type="button" class="chip" id="tonar-refresh">Обновить</button></div>'
    + '<div id="tonar-cabinet-status" role="status">' + (error ? tonarEmpty(error) : '') + '</div>'
    + (data ? '<div class="sec-lbl">Сегодня · ' + esc(tonarDate(data.date)) + '</div>'
      + '<div id="tonar-today">' + tonarMetrics(data.today) + '</div>'
      + '<div class="sec-lbl">Рейсы за сегодня</div><div class="card" id="tonar-today-trips">'
      + (data.trips.length ? data.trips.map(tonarTripCard).join('') : tonarEmpty('Сегодня рейсов нет')) + '</div>'
      + '<div class="sec-lbl">С начала месяца</div><div id="tonar-month">'
      + tonarMetrics(data.month) + '</div>'
      : (!error ? tonarEmpty('Загружаем ваши отчёты…') : ''));
}

function tonarInit() {
  if (tonarLive.initialized) return;
  tonarLive.initialized = true;
  document.getElementById('legacy-driver-cabinet').style.display = 'none';
  document.getElementById('tonar-live-cabinet').style.display = 'block';
  document.title = 'Кабинет водителя · Тонары';
  var oldTrip = document.querySelector('#ton-menu .repeat-card');
  if (oldTrip) oldTrip.remove();
  document.getElementById('ton-menu').insertAdjacentHTML('beforeend',
    '<div class="sec-lbl">Последний отправленный рейс</div><div class="card" id="tonar-last-trip"></div>');
  document.getElementById('s-dt').insertAdjacentHTML('beforeend', '<div class="sub-screen" id="tonar-fuel-edit"></div>');
  ['dt', 'exp'].forEach(function(kind) {
    var menu = document.getElementById(kind + '-menu');
    menu.querySelectorAll('.sec-lbl, .card').forEach(function(el){ el.remove(); });
    var heading = kind === 'dt' ? 'Последняя заправка' : 'Последние два расхода и запчасти';
    var html = '<div class="sec-lbl">' + heading + '</div><div class="card" id="tonar-' + kind;
    menu.insertAdjacentHTML('beforeend', html + '-recent"></div>');
    var form = document.getElementById(kind + '-new');
    var car = form.querySelector('.form-block .chips');
    car.dataset.tonarTruck = kind;
    form.querySelector('.submit').insertAdjacentHTML('beforebegin', html + '-form-recent"></div>');
  });
  tonarRenderDashboard(null);
  tonarDriverFields(null);
  document.addEventListener('click', function(event) {
    var edit = event.target.closest('[data-tonar-edit]');
    if (edit) tonarOpenEdit(edit.dataset.tonarEdit);
    if (event.target.closest('#tonar-fuel-edit-open')) tonarOpenFuelEdit();
    if (event.target.closest('#tonar-refresh')) tonarRefresh();
    var chip = event.target.closest('[data-tonar-truck] .chip');
    if (chip) tonarLoadHistory(chip.parentElement.dataset.tonarTruck, chip.textContent.trim());
  });
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && currentRole === 'driver') tonarRefresh();
  });
}

function tonarDriverFields(dashboard) {
  var trucks = (dashboard && dashboard.trucks || []).filter(function(truck) {
    return !/(^|[^0-9])(709|729)([^0-9]|$)/.test(truck);
  });
  var profile = dashboard && dashboard.profile || {};
  var key = JSON.stringify([profile.name, profile.truck, trucks]);
  if (tonarLive.trucksKey === key) return;
  tonarLive.trucksKey = key;
  ['ton', 'dt', 'exp'].forEach(function(kind) {
    var selector = '#' + kind + '-new';
    var defaultTruck = trucks.includes(profile.truck) ? profile.truck : (trucks.length === 1 ? trucks[0] : '');
    var selected = document.querySelector(selector + ' .form-block .chip.on');
    if (kind === 'ton') selected = document.querySelector('#ton-truck-chips .chip.on');
    var car = selected && selected.textContent.trim();
    var truckField = Array.from(document.querySelectorAll(selector + ' .form-block')).find(function(block) {
      var label = block.querySelector('.form-lbl');
      return label && label.textContent === 'Автомобиль';
    });
    var chips = truckField && truckField.querySelector('.chips');
    if (chips) {
      var chosen = trucks.includes(car) ? car : defaultTruck;
      chips.innerHTML = trucks.map(function(truck) {
        return '<button type="button" class="chip' + (truck === chosen ? ' on' : '')
          + '" onclick="sel(this)">' + esc(truck) + '</button>';
      }).join('');
    }
    var driverField = Array.from(document.querySelectorAll(selector + ' .form-block')).find(function(block) {
      var label = block.querySelector('.form-lbl');
      return label && label.textContent === 'Водитель';
    });
    if (driverField) {
      var driverChips = driverField.querySelector('.chips');
      driverChips.innerHTML = profile.name ? '<span class="chip on">' + esc(profile.name) + '</span>' : '';
      driverField.querySelectorAll('.other-input').forEach(function(el){ el.remove(); });
    }
  });
}

function tonarRefresh() {
  var seq = ++tonarLive.dashboardSeq;
  return tonarRequest('get_tonar_cabinet').then(function(result) {
    if (seq !== tonarLive.dashboardSeq || currentRole !== 'driver') return;
    var data = result.dashboard;
    tonarLive.dashboard = data;
    tonarRenderDashboard(data);
    tonarDriverFields(data);
    tonarSetHTML('tonar-last-trip', data.last_trip ? tonarTripCard(data.last_trip) : tonarEmpty('Отчётов пока нет'));
    if (document.querySelector('#s-dt.active')) tonarCurrentHistory('dt');
    if (document.querySelector('#s-expense.active')) tonarCurrentHistory('exp');
  }).catch(function(error) {
    if (seq !== tonarLive.dashboardSeq || currentRole !== 'driver') return;
    tonarRenderDashboard(tonarLive.dashboard, (tonarLive.dashboard ? 'Данные не обновились. ' : '') + error.message);
    if (!tonarLive.dashboard) tonarSetHTML('tonar-last-trip', tonarEmpty(error.message));
  });
}

function tonarScreenOpened(screen) {
  tonarInit();
  if (screen === 's-driver-dash' || (screen === 's-tonary' && !tonarLive.dashboard)) tonarRefresh();
  if (screen === 's-dt') tonarCurrentHistory('dt');
  if (screen === 's-expense') tonarCurrentHistory('exp');
}

function tonarFormOpened(form) {
  var key = {'ton-new': 'ton', 'dt-new': 'dt', 'exp-new': 'exp'}[form];
  if (key) {
    var todayChip = document.querySelector('#' + form + ' [onclick*="' + key + '-date"][onclick*="today"].on');
    if (todayChip) setDate(key + '-date', 'today', todayChip);
  }
  if (form === 'dt-new') tonarCurrentHistory('dt');
  if (form === 'exp-new') tonarCurrentHistory('exp');
}

function tonarCurrentHistory(kind) {
  var selected = document.querySelector('[data-tonar-truck="' + kind + '"] .on');
  tonarLoadHistory(kind, selected ? selected.textContent.trim() : '');
}

function tonarLoadHistory(kind, truck) {
  var seq = (tonarLive.historySeq[kind] || 0) + 1;
  tonarLive.historySeq[kind] = seq;
  if (kind === 'dt') tonarLive.lastFuel = null;
  var ids = ['tonar-' + kind + '-recent', 'tonar-' + kind + '-form-recent'];
  function display(html) {
    if (tonarLive.historySeq[kind] === seq) ids.forEach(function(id) { tonarSetHTML(id, html); });
  }
  if (!truck) {
    display(tonarEmpty('Выберите автомобиль в форме.'));
    return;
  }
  display(tonarEmpty('Машина ' + truck + ' · загружаем…'));
  tonarRequest('get_tonar_vehicle_history', { truck: truck }).then(function(result) {
    var history = result.history;
    var html = kind === 'dt'
      ? (history.fuel ? tonarHistoryRow(history.fuel.station, history.fuel, tonarFmt(history.fuel.litres) + ' л') : '')
      : history.expenses.map(function(row) { return tonarHistoryRow(row.description || row.category, row, row.place); }).join('');
    display(tonarEmpty('Машина ' + truck) + (html || tonarEmpty('Записей пока нет')));
    if (kind === 'dt' && tonarLive.historySeq[kind] === seq && history.fuel && history.fuel.edit) {
      tonarLive.lastFuel = { ...history.fuel, truck: truck };
      document.getElementById(ids[0]).insertAdjacentHTML('beforeend',
        '<div style="padding:10px 14px"><button type="button" class="chip" id="tonar-fuel-edit-open">Исправить заправку</button></div>');
    }
  }).catch(function(error) { display(tonarEmpty(error.message)); });
}

function tonarHistoryRow(title, row, extra) {
  return '<div class="list-row"><div class="row-info"><div class="row-title">' + esc(title || '—')
    + '</div><div class="row-sub">' + esc([tonarDate(row.date), extra].filter(Boolean).join(' · '))
    + '</div></div><div class="row-right"><div class="row-val">' + esc(tonarFmt(row.amount)) + ' ₽</div></div></div>';
}

function tonarAfterSave(kind, truck) {
  tonarRefresh();
  if (kind) tonarLoadHistory(kind, truck);
}

function tonarOpenFuelEdit() {
  var data = tonarLive.lastFuel;
  if (!data) return;
  var panel = document.getElementById('tonar-fuel-edit');
  panel.innerHTML = '<button type="button" class="back-btn" id="tonar-fuel-edit-close">‹ Топливо</button>'
    + '<div class="page-title">Исправить заправку</div>'
    + '<div class="page-sub">Машина ' + esc(data.truck) + '</div><form id="tonar-fuel-edit-form">'
    + [['date','Дата','date',data.date], ['station','АЗС','text',data.station],
       ['litres','Литры','decimal',data.litres], ['price_per_liter','Цена за литр','decimal',data.edit.price_per_liter || '']]
      .map(function(field) {
        return '<label class="form-block" style="display:block"><span class="form-lbl">' + field[1] + '</span>'
          + '<input class="inp" name="' + field[0] + '" type="' + (field[2] === 'decimal' ? 'text' : field[2])
          + '" value="' + esc(field[3]) + '"' + (field[2] === 'decimal' ? ' inputmode="decimal"' : '') + '></label>';
      }).join('')
    + '<button type="submit" class="submit">Сохранить исправление</button><p role="status"></p></form>';
  document.getElementById('dt-menu').style.display = 'none';
  panel.classList.add('active');
  var close = function(){ hideSub('dt-menu', 'tonar-fuel-edit'); };
  document.getElementById('tonar-fuel-edit-close').onclick = close;
  var form = document.getElementById('tonar-fuel-edit-form');
  form.onsubmit = async function(event) {
    event.preventDefault();
    var button = form.querySelector('button[type=submit]');
    if (button.disabled) return;
    button.disabled = true;
    var status = form.querySelector('[role=status]');
    status.textContent = 'Сохраняем…';
    try {
      var payload = Object.fromEntries(new FormData(form));
      await tonarRequest('update_tonar_fuel', { ...payload, fuel_id: data.edit.id, version: data.edit.version });
      close();
      showNotification('Заправка исправлена');
      tonarAfterSave('dt', data.truck);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function tonarOpenEdit(id) {
  var data = tonarLive.dashboard;
  if (!data) return;
  var trip = data.trips.concat(data.last_trip || []).find(function(item) { return item.id === id; });
  if (!trip) return;
  go('s-tonary');
  hideSub('ton-menu', 'ton-new');
  var panel = document.getElementById('ton-edit');
  var fields = [['date', 'Дата', 'date'], ['truck', 'Автомобиль', 'select'], ['quarry', 'Карьер'],
    ['object', 'Объект / адрес'], ['material', 'Материал'], ['fraction', 'Фракция'],
    ['client', 'Заказчик'], ['load_tonnage', 'Тоннаж загрузки (т)', 'decimal'],
    ['unload_tonnage', 'Тоннаж выгрузки (т)', 'decimal']];
  panel.innerHTML = '<button type="button" class="back-btn" id="tonar-edit-close">‹ Тонары</button>'
    + '<div class="page-title">Исправить отчёт</div><div class="page-sub">Рейс ' + esc(trip.id) + '</div>'
    + '<form id="tonar-edit-form">' + fields.map(function(field) {
      var key = field[0], label = field[1], type = field[2];
      return '<label class="form-block" style="display:block"><span class="form-lbl">' + esc(label) + '</span>'
        + (type === 'select' ? '<select class="inp" name="' + key + '">' + Array.from(new Set([trip.truck].concat(data.trucks))).map(function(car) {
          return '<option' + (trip.truck === car ? ' selected' : '') + '>' + esc(car) + '</option>';
        }).join('') + '</select>' : '<input class="inp" type="' + (type === 'date' ? 'date' : 'text')
          + '" name="' + key + '" value="' + esc(trip[key] || '') + '"' + (type === 'decimal' ? ' inputmode="decimal"' : '') + '>')
        + '</label>';
    }).join('') + '<button type="submit" class="submit">Сохранить исправление</button><p role="status" id="tonar-edit-status"></p></form>';
  document.getElementById('ton-menu').style.display = 'none';
  panel.classList.add('active');
  document.getElementById('tonar-edit-close').onclick = function() { hideSub('ton-menu', 'ton-edit'); };
  var form = document.getElementById('tonar-edit-form');
  form.onsubmit = async function(event) {
    event.preventDefault();
    var button = form.querySelector('button[type=submit]');
    if (button.disabled) return;
    var patch = {};
    new FormData(form).forEach(function(value, key) {
      var clean = value.trim();
      if (clean !== String(trip[key] || '')) patch[key] = clean;
    });
    if (!Object.keys(patch).length) {
      hideSub('ton-menu', 'ton-edit');
      return;
    }
    button.disabled = true;
    var status = document.getElementById('tonar-edit-status');
    status.textContent = 'Сохраняем…';
    try {
      await tonarRequest('update_tonar_trip', { trip_id: trip.id, version: trip.version, patch: patch });
      hideSub('ton-menu', 'ton-edit');
      showNotification('Исправление сохранено');
      tonarAfterSave();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
