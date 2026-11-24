import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function getFleetWorkspace(');
const end = html.indexOf('var currentRole', start);
const run = (code) => vm.runInNewContext(html.slice(start, end) + '\n' + code, { URLSearchParams });

test('main login no longer advertises a Director or Mechanic role and still has driver reports', () => {
  const login = html.slice(html.indexOf('id="s-login"'), html.indexOf('id="s-accountant"'));
  assert.match(login, /id="open-tonars"/);
  assert.doesNotMatch(login, /loginAs\(['"](?:director|mechanic)['"]\)|id="pin-modal"/);
  assert.match(html, /id="s-dt"/);
  assert.match(html, /id="s-expense"/);
});

test('only Tonar pages on the standard menu, with a separate mechanic and a mixer fallback', () => {
  assert.ok(start >= 0 && end > start);
  assert.equal(run("getFleetWorkspace('')"), 'tonars');
  assert.equal(run("getFleetWorkspace('?app=director')"), 'tonars');
  assert.equal(run("getFleetWorkspace('?app=mechanic')"), 'mechanic');
  assert.equal(run("getFleetWorkspace('?app=mixer-reserve')"), 'mixer-reserve');
  assert.equal(run("canOpenFleetScreen('tonars', 'driver', 's-tonary')"), true);
  assert.equal(run("canOpenFleetScreen('tonars', 'driver', 's-dlinn')"), false);
  assert.equal(run("canOpenFleetScreen('tonars', 'driver', 's-director')"), false);
  assert.equal(run("canOpenFleetScreen('mechanic', 'driver', 's-service')"), false);
  assert.equal(run("canOpenFleetScreen('mechanic', 'mechanic', 's-service')"), true);
  assert.equal(run("canOpenFleetScreen('mechanic', 'mechanic', 's-parts')"), true);
  assert.equal(run("canOpenFleetScreen('mixer-reserve', 'mixer', 's-mixer')"), true);
});

test('709 is gone from new Tonar trips, even when present in the active directory', () => {
  const trucks = html.slice(html.indexOf('id="ton-truck-chips"'), html.indexOf('Введите ФИО водителя'));
  assert.match(trucks, />803<\/button>/);
  assert.match(trucks, />143<\/button>/);
  assert.doesNotMatch(trucks, />709<\/button>/);
  assert.equal(run("isUnavailableTonar('КамАЗ 709')"), true);
  assert.equal(run("isUnavailableTonar('803')"), false);
  assert.equal(run("isUnavailableTonar('143')"), false);
  assert.match(html, /activeVehiclesByType\('tonary'\)\.filter/);
});
