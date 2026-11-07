import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function submitMixerTrip(btn){');
const end = html.indexOf('// ═══════════════════ СЛЕСАРЬ', start);
assert.ok(start > 0 && end > start);
const source = html.slice(start, end);

function submit({ factoryVolume = '5.5', topup = 'Да', clientGrade = 'М300' } = {}) {
  const fields = { 'mix-plant-grade': 'М250', 'mix-plant-volume': factoryVolume, 'mix-topup': topup };
  const values = Array(20).fill('');
  values[8] = '6';
  values[13] = '6500';
  values[14] = '1000';
  const blocks = values.map((value, index) => ({
    value: index === 5 ? clientGrade : value,
    offsetParent: index === 7 ? null : {},
    querySelector: () => ({ value }),
  }));
  let sent = null;
  let notice = null;
  const context = {
    document: { getElementById: (id) => ({ value: fields[id] ?? '', checked: false }) },
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

test('mixer form keeps legacy block positions and has no preselected customer grade', () => {
  const form = html.slice(
    html.indexOf('<div class="sub-screen" id="mix-new">'),
    html.indexOf('<!-- ═══════════════════════════════ ДЛИННОМЕРЫ'),
  );
  const factory = form.match(/<div id="mix-factory-facts">([\s\S]*?)<div class="form-block">/);
  assert.ok(factory);
  assert.ok(!factory[1].includes('class="form-block"'));
  assert.ok(!form.match(/class="chip on" onclick="sel\(this\)">М300<\/button>/));
});

test('sends separate factory/customer facts while billing only customer volume', () => {
  const { sent } = submit();
  assert.equal(sent.action, 'mixer_trip');
  assert.equal(sent.data.plant_loaded_grade, 'М250');
  assert.equal(sent.data.plant_loaded_volume_m3, '5.5');
  assert.equal(sent.data.client_delivered_grade, 'М300');
  assert.equal(sent.data.client_delivered_volume_m3, '6');
  assert.equal(sent.data.topup_declared, 'Да');
  assert.equal(sent.data.volume, '6');
  assert.equal(sent.data.concrete_cost, 39000);
});

test('missing factory or top-up facts cannot be submitted', () => {
  for (const input of [{ factoryVolume: '' }, { topup: '' }, { clientGrade: '' }]) {
    const { sent, notice, button } = submit(input);
    assert.equal(sent, null);
    assert.match(notice, /Укажите марку и объём/);
    assert.equal(button.disabled, false);
  }
});
