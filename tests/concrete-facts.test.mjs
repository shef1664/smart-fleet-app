import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function submitMixerTrip(btn){');
const end = html.indexOf('// ═══════════════════ СЛЕСАРЬ', start);
assert.ok(start > 0 && end > start);
const source = html.slice(start, end);
const helperStart = html.indexOf('function normalizeMixerGrade(value){');
const helperEnd = html.indexOf('function setMixerVolumePart(', helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart);
const helpers = html.slice(helperStart, helperEnd);

function submit({
  factoryGrade = 'М250', factoryVolume = '5.5', difference = false,
  clientGrade = 'М300', clientVolume = '6', client = 'Ч/Л (частник)',
  concretePrice = '6500', delivery = '1000', distanceKm = '12.5',
  paymentType = 'Нал', cashReceived = '', paid = false,
  tnNumber = 'TN-1', arriveTime = '12:40', departTime = '13:10', address = 'Тестовый объект',
} = {}) {
  const fields = {
    'mix-plant-grade': { value: factoryGrade },
    'mix-plant-volume': { value: factoryVolume },
    'mix-difference': { checked: difference },
    'mix-volume': { value: clientVolume },
    'mix-concrete-price': { value: concretePrice },
    'mix-delivery-cost': { value: delivery },
    'mix-route-km': { value: distanceKm },
    'mix-paid': { checked: paid },
    'mix-cash-received': { value: cashReceived },
  };
  const values = Array(21).fill('');
  values[4] = client;
  values[5] = 'Бетон';
  values[6] = clientGrade;
  values[7] = clientVolume;
  values[8] = 'Нет';
  values[10] = address;
  values[12] = arriveTime;
  values[13] = departTime;
  values[14] = concretePrice;
  values[15] = delivery;
  values[16] = paymentType;
  values[18] = tnNumber;
  const blocks = values.map((value, index) => ({
    value,
    offsetParent: index === 9 ? null : {},
    querySelector: () => ({ value }),
  }));
  let sent = null;
  let notice = null;
  const context = {
    document: { getElementById: (id) => fields[id] || { value: '', checked: false } },
    getFieldValue: (block) => block.value,
    dateState: { 'mix-date': '08.11.2026' },
    getPhotoArray: () => [],
    sendToAPI: (action, data) => { sent = { action, data }; },
    showNotification: (message) => { notice = message; },
  };
  vm.createContext(context);
  const run = vm.runInContext(`${helpers}\n${source}\nsubmitMixerTrip`, context);
  const button = { textContent: 'Сохранить', disabled: false, closest: () => ({ querySelectorAll: () => blocks }) };
  run(button);
  return { sent, notice, button };
}

test('customer is selected immediately after plant; extra concrete fields start hidden', () => {
  const form = html.slice(html.indexOf('<div class="sub-screen" id="mix-new">'), html.indexOf('<!-- ═══════════════════════════════ ДЛИННОМЕРЫ'));
  assert.ok(form.indexOf('Завод загрузки') < form.indexOf('Заказчик'));
  assert.ok(form.indexOf('Заказчик') < form.indexOf('Марка на заводе'));
  assert.match(form, /id="mix-difference"[^>]*type="checkbox"/);
  assert.match(form, /id="mix-client-facts"[^>]*display:none/);
  assert.match(form, /id="mix-route-km"/);
  assert.match(form, /id="mix-distance-block"/);
});

test('delivery quote uses 35 rub/km plus 650 rub per cubic metre, minimum six', () => {
  const begin = html.indexOf('function calculateMixerDelivery(km, volume){');
  const finish = html.indexOf('var mixDeliveryManualOverride = false;', begin);
  assert.ok(begin > 0 && finish > begin);
  const calculate = vm.runInNewContext(`${html.slice(begin, finish)}\ncalculateMixerDelivery`);
  assert.equal(calculate(10, 1).amount, 6000);
  assert.equal(calculate(10, 6).amount, 6000);
  assert.equal(calculate(10, 7).amount, 7000);
  assert.equal(calculate(10, '').amount, 6000);
  assert.equal(calculate('', 6), null);
});

test('ordinary trip without difference copies plant facts to client and bills client volume', () => {
  const { sent } = submit();
  assert.equal(sent.action, 'mixer_trip');
  assert.equal(sent.data.grade, 'М250');
  assert.equal(sent.data.volume, '5.5');
  assert.equal(sent.data.plant_loaded_grade, 'М250');
  assert.equal(sent.data.client_delivered_grade, 'М250');
  assert.equal(sent.data.client_delivered_volume_m3, '5.5');
  assert.equal(sent.data.topup_declared, 'Нет');
  assert.equal(sent.data.transport_only, 'Нет');
  assert.equal(sent.data.distance_km, '12.5');
  assert.equal(sent.data.concrete_cost, 35750);
});

test('checked difference requires customer facts and bills delivered volume once', () => {
  const { sent } = submit({ difference: true });
  assert.equal(sent.data.grade, 'М300');
  assert.equal(sent.data.volume, '6');
  assert.equal(sent.data.topup_declared, 'Да');
  assert.equal(sent.data.concrete_cost, 39000);
  for (const input of [{ clientGrade: '' }, { clientVolume: '' }, { clientGrade: 'М250', clientVolume: '5.5' }]) {
    const bad = submit({ difference: true, ...input });
    assert.equal(bad.sent, null);
    assert.equal(bad.button.disabled, false);
  }
});

test('factory request needs only delivery price and plant-to-site kilometres', () => {
  const { sent } = submit({ client: 'Заводская заявка', factoryGrade: '', factoryVolume: '', clientGrade: '', clientVolume: '', concretePrice: '', cashReceived: '50000', paid: true });
  assert.equal(sent.data.client, 'Заводская заявка');
  assert.equal(sent.data.grade, '');
  assert.equal(sent.data.volume, '');
  assert.equal(sent.data.concrete_cost, 0);
  assert.equal(sent.data.delivery_cost, '1000');
  assert.equal(sent.data.distance_km, '12.5');
  assert.equal(sent.data.transport_only, 'Да');
  assert.equal(sent.data.plant_loaded_grade, undefined);
  assert.equal(sent.data.payment_type, '');
  assert.equal(sent.data.cash_received, '');
  assert.equal(sent.data.paid, '');
  for (const input of [{ delivery: '' }, { distanceKm: '' }, { tnNumber: '' }, { arriveTime: '' }, { departTime: '' }, { address: '' }]) {
    const bad = submit({ client: 'Заводская заявка', ...input });
    assert.equal(bad.sent, null);
    assert.equal(bad.button.disabled, false);
  }
});

test('factory mode hides every payment control but keeps trip and document fields', () => {
  const form = html.slice(html.indexOf('<div class="sub-screen" id="mix-new">'), html.indexOf('<!-- ═══════════════════════════════ ДЛИННОМЕРЫ'));
  assert.match(form, /id="mix-payment-type-block"/);
  assert.match(form, /id="dengi-block"/);
  assert.match(form, /id="mix-paid-block"/);
  assert.match(form, /№ ТН/);
  assert.match(form, /Время прибытия/);
  assert.match(form, /Время убытия/);
});

test('ordinary trip still requires plant grade and volume', () => {
  for (const input of [{ factoryGrade: '' }, { factoryVolume: '' }, { distanceKm: '' }]) {
    const { sent, button } = submit(input);
    assert.equal(sent, null);
    assert.equal(button.disabled, false);
  }
});

test('plant grade is chosen with buttons without opening a keyboard', () => {
  const form = html.slice(html.indexOf('<div class="sub-screen" id="mix-new">'), html.indexOf('<!-- ═══════════════════════════════ ДЛИННОМЕРЫ'));
  assert.match(form, /id="mix-plant-grade-chips"[\s\S]*?>М200<\/button>/);
  assert.match(form, /id="mix-plant-grade"[^>]*readonly/);
  assert.match(form, /id="mix-plant-grade-manual"/);
});

test('manual grade accepts a number without requiring the driver to type M', () => {
  const { sent } = submit({ factoryGrade: '250' });
  assert.equal(sent.data.plant_loaded_grade, 'М250');
  assert.equal(sent.data.grade, 'М250');
});

test('plant and customer volumes have button pickers with optional manual entry', () => {
  const form = html.slice(html.indexOf('<div class="sub-screen" id="mix-new">'), html.indexOf('<!-- ═══════════════════════════════ ДЛИННОМЕРЫ'));
  for (const field of ['mix-plant-volume', 'mix-volume']) {
    assert.match(form, new RegExp(`id="${field}-picker"`));
    assert.match(form, new RegExp(`id="${field}"[^>]*inputmode="decimal"[^>]*autocomplete="off"`));
    assert.match(form, new RegExp(`id="${field}-manual"`));
  }
  assert.match(form, /setMixerVolumePart\('mix-plant-volume', 'whole', 6/);
  assert.match(form, /setMixerVolumePart\('mix-plant-volume', 'tenth', 7/);
});

test('phone-like or malformed volume cannot be sent as a mixer trip', () => {
  for (const factoryVolume of ['9236218521', '5abc', '0', '-1']) {
    const { sent, button } = submit({ factoryVolume });
    assert.equal(sent, null, `factory volume ${factoryVolume}`);
    assert.equal(button.disabled, false);
  }
  for (const clientVolume of ['9236218521', '5abc', '0', '-1']) {
    const { sent, button } = submit({ difference: true, clientVolume });
    assert.equal(sent, null, `customer volume ${clientVolume}`);
    assert.equal(button.disabled, false);
  }
});

test('Telegram keyboard resize does not force-scroll and dismiss focused numeric input', () => {
  const begin = html.indexOf('function initKeyboardInset(){');
  const end = html.indexOf('/* ── Pulsar v3 UI init', begin);
  assert.ok(begin > 0 && end > begin);
  assert.doesNotMatch(html.slice(begin, end), /scrollIntoView|viewportChanged/);
});
