import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function submitMixerTrip(btn){');
const end = html.indexOf('// ═══════════════════ СЛЕСАРЬ', start);
assert.ok(start > 0 && end > start);
const source = html.slice(start, end);

function submit({
  factoryGrade = 'М250', factoryVolume = '5.5', difference = false,
  clientGrade = 'М300', clientVolume = '6', client = 'Ч/Л (частник)',
  concretePrice = '6500', delivery = '1000', distanceKm = '12.5',
} = {}) {
  const fields = {
    'mix-plant-grade': { value: factoryGrade },
    'mix-plant-volume': { value: factoryVolume },
    'mix-difference': { checked: difference },
    'mix-volume': { value: clientVolume },
    'mix-concrete-price': { value: concretePrice },
    'mix-delivery-cost': { value: delivery },
    'mix-route-km': { value: distanceKm },
    'mix-paid': { checked: false },
    'mix-cash-received': { value: '' },
  };
  const values = Array(21).fill('');
  values[4] = client;
  values[5] = 'Бетон';
  values[6] = clientGrade;
  values[7] = clientVolume;
  values[8] = 'Нет';
  values[14] = concretePrice;
  values[15] = delivery;
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
  const run = vm.runInContext(`${source}\nsubmitMixerTrip`, context);
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
  const { sent } = submit({ client: 'Заводская заявка', factoryGrade: '', factoryVolume: '', clientGrade: '', clientVolume: '', concretePrice: '' });
  assert.equal(sent.data.client, 'Заводская заявка');
  assert.equal(sent.data.grade, '');
  assert.equal(sent.data.volume, '');
  assert.equal(sent.data.concrete_cost, 0);
  assert.equal(sent.data.delivery_cost, '1000');
  assert.equal(sent.data.distance_km, '12.5');
  assert.equal(sent.data.transport_only, 'Да');
  assert.equal(sent.data.plant_loaded_grade, undefined);
  for (const input of [{ delivery: '' }, { distanceKm: '' }]) {
    const bad = submit({ client: 'Заводская заявка', ...input });
    assert.equal(bad.sent, null);
    assert.equal(bad.button.disabled, false);
  }
});

test('ordinary trip still requires plant grade and volume', () => {
  for (const input of [{ factoryGrade: '' }, { factoryVolume: '' }, { distanceKm: '' }]) {
    const { sent, button } = submit(input);
    assert.equal(sent, null);
    assert.equal(button.disabled, false);
  }
});
