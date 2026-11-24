import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const playwright = process.env.PULSAR_PLAYWRIGHT_MODULE;
const routeMap = new Map([
  ['/', new URL('../index.html', import.meta.url)],
  ['/index.html', new URL('../index.html', import.meta.url)],
  ['/mechanic.html', new URL('../mechanic.html', import.meta.url)],
  ['/tonar-cabinet.js', new URL('../tonar-cabinet.js', import.meta.url)],
]);

test('mobile: separate driver, signed mechanic and reserve entrypoints', { skip: !playwright, timeout: 35000 }, async () => {
  const { devices, webkit } = await import(pathToFileURL(playwright).href);
  const server = createServer((req, res) => {
    const result = routeMap.get(new URL(req.url, 'http://local').pathname);
    if (!result) { res.writeHead(404).end(); return; }
    const type = result.pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': type + '; charset=UTF-8' }).end(readFileSync(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const checks = [];
  try {
    browser = await webkit.launch({headless:true});
    async function newPage(role, authorized = true) {
      const context = await browser.newContext(devices['iPhone 15']);
      const actions = [];
      const reports = [];
      let fuel = 0;
      const expenses = [{description:'Антифриз', place:'Магазин', date:'2026-11-23', amount:700},
        {description:'Фильтр', place:'Запчасти', date:'2026-11-21', amount:600}];
      await context.addInitScript((authorized) => {
        window.Telegram = { WebApp: {
          initData: authorized ? 'fixture_signature_only' : '',
          initDataUnsafe: { user: { id: 43 } },
          ready(){}, expand(){}, onEvent(){},
        } };
      }, authorized);
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.hostname === 'telegram.org' && url.pathname.endsWith('.js'))
          return route.fulfill({contentType:'text/javascript', body:''});
        if (url.pathname !== '/api') return route.abort();
        const cors = {'access-control-allow-origin':'*', 'access-control-allow-headers':'content-type,x-api-key'};
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({status:204, headers:{...cors,'access-control-allow-methods':'POST,OPTIONS'}});
        const req = route.request().postDataJSON();
        actions.push(req);
        const profile = { id:'fixture', name:'Сотрудник', role, active:true, default_truck:'', vehicle_type:'tonar' };
        if (req.action === 'tonar_cabinet_trip') {
          reports.push({...req.data, id:'TNR-1001', date:'2026-11-24', time:'10:15',
            tonnes:40, quarry:'Тестовый карьер', object:'Тестовый объект', material:'Щебень', version:'v1'});
        }
        if (req.action === 'update_tonar_trip') {
          assert.equal(req.data.trip_id, 'TNR-1001');
          reports[0] = {...reports[0], ...req.data.patch, tonnes:Number(req.data.patch.unload_tonnage), version:'v2'};
        }
        if (req.action === 'tonar_cabinet_fuel') fuel += req.data.liters;
        if (req.action === 'update_tonar_fuel') {
          assert.equal(req.data.fuel_id, 'FUL-fixture');
          fuel = Number(req.data.litres);
        }
        if (req.action === 'tonar_cabinet_expense') {
          expenses.unshift({description:req.data.description, date:'2026-11-24', amount:Number(req.data.amount)});
        }
        const tonnes = reports.reduce((sum, trip) => sum + trip.tonnes, 0);
        const result = req.action === 'get_tonar_cabinet' ? {status:'ok', dashboard: {
          profile:{name:role === 'second-driver' ? 'Второй сотрудник' : 'Сотрудник', truck:'803'},
          trucks:['803','143','709','729'], date:'2026-11-24',
          today:{trips:reports.length, tonnes, litres:fuel},
          month:{trips:reports.length + 2, tonnes:tonnes + 80, litres:fuel + 1200},
          trips:reports, last_trip:reports.at(-1)
        }} : req.action === 'get_tonar_vehicle_history' ? {status:'ok', history: {
          fuel: {station:req.data.truck === '803' ? 'АЗС первого' : 'АЗС второго', date:'2026-11-24', litres:fuel || 20, amount:1000,
            ...(fuel ? {edit:{id:'FUL-fixture',version:'f1',price_per_liter:70}} : {})},
          expenses:req.data.truck === '803' ? expenses.slice(0,2) : [{description:'Расход 143', date:'2026-11-20', amount:500}]
        }} : req.action === 'get_session'
          ? { status:'ok', profile, directory:{ users:[], vehicles:[], trip_prices:[], quarry_plans:[] } }
          : { status:'ok', id:'TNR-1001', repairs:[], dashboard:{} };
        return route.fulfill({json:result, headers:cors});
      });
      const page = await context.newPage();
      page.setDefaultTimeout(6500);
      page.on('pageerror', (e) => checks.push(e.message));
      return { page, context, actions };
    }
    const main = await newPage('driver');
    await main.page.goto(origin + '/');
    await main.page.locator('#tonar-today').getByText('0 л', {exact:true}).waitFor();
    assert.equal(await main.page.locator('#open-mechanic').isVisible(), false);
    assert.equal(await main.page.locator('#s-login').isVisible(), false);
    assert.equal(await main.page.locator('#legacy-driver-cabinet').isVisible(), false);
    assert.deepEqual(await main.page.locator('#bottom-nav button').evaluateAll(
      (buttons) => buttons.map((button) => button.dataset.screen)), ['s-driver-dash','s-tonary','s-dt','s-expense']);
    await main.page.locator('#bottom-nav [data-screen="s-tonary"]').tap();
    await main.page.locator('#ton-menu button[onclick="showSub(\'ton-new\')"]').tap();
    assert.deepEqual(await main.page.locator('#ton-truck-chips button').allTextContents(), ['803', '143']);
    await main.page.evaluate(() => {
      APP_SESSION = { profile: { default_truck:'709' } };
      DIRECTORY = { users:[], vehicles:[
        { active:true, type:'tonar', truck:'803' }, { active:true, type:'tonar', truck:'709' },
        { active:true, type:'tonar', truck:'143' },
      ] };
      refreshDirectoryChips();
      applyVoiceTripToForm('709');
      go('s-dlinn');
      loginAs('director');
    });
    assert.deepEqual(await main.page.locator('#ton-truck-chips button').allTextContents(), ['803', '143']);
    assert.equal(await main.page.locator('#ton-truck-chips .on').textContent(), '803');
    assert.equal(await main.page.locator('#s-tonary').isVisible(), true);
    for (const id of ['s-director', 's-dlinn', 's-mixer', 's-mechanic-dash'])
      assert.equal(await main.page.locator('#' + id).isVisible(), false);
    await main.page.locator('#ton-truck-chips').getByRole('button', { name: '803', exact: true }).tap();
    const saved = main.page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.request().postDataJSON().action === 'tonar_cabinet_trip');
    await main.page.locator('#ton-new button[onclick="submitTonarTrip(this)"]').tap();
    assert.equal((await saved).ok(), true);
    assert.deepEqual(main.actions.filter((v) => v.action.startsWith('tonar_cabinet_'))
      .map((v) => [v.action, v.data.truck]), [['tonar_cabinet_trip', '803']]);
    await main.page.locator('#tonar-last-trip').getByText('Тестовый карьер → Тестовый объект').waitFor();
    await main.page.locator('#tonar-last-trip').getByRole('button', {name:'Исправить'}).tap();
    await main.page.locator('#ton-edit input[name="unload_tonnage"]').fill('41.5');
    await main.page.getByRole('button', {name:'Сохранить исправление'}).tap();
    await main.page.locator('#tonar-last-trip').getByText('41,5 т', {exact:true}).waitFor();
    assert.equal(main.actions.filter((v) => v.action === 'tonar_cabinet_trip').length, 1);
    assert.deepEqual(main.actions.find((v) => v.action === 'update_tonar_trip').data.patch, {unload_tonnage:'41.5'});

    await main.page.locator('#bottom-nav [data-screen="s-dt"]').tap();
    await main.page.getByRole('button', {name:/Новая заправка/}).tap();
    await main.page.locator('#tonar-dt-form-recent').getByText('АЗС первого').waitFor();
    assert.deepEqual(await main.page.locator('#dt-new [data-tonar-truck] button').allTextContents(), ['803','143']);
    await main.page.locator('#dt-new [data-tonar-truck] button').getByText('143').tap();
    await main.page.locator('#tonar-dt-form-recent').getByText('АЗС второго').waitFor();
    await main.page.locator('#dt-new input[type=number]').first().fill('300');
    await main.page.locator('#dt-new .submit').tap();
    await main.page.locator('#tonar-dt-recent').getByText(/300 л/).waitFor();
    await main.page.locator('#bottom-nav [data-screen="s-driver-dash"]').tap();
    await main.page.locator('#tonar-today').getByText('300 л', {exact:true}).waitFor();
    assert.match(await main.page.locator('#tonar-month').textContent(), /1\s500 л/);
    assert.match(await main.page.locator('#tonar-today').textContent(), /41,5 т/);
    await main.page.locator('#bottom-nav [data-screen="s-dt"]').tap();
    await main.page.locator('#tonar-fuel-edit-open').tap();
    await main.page.locator('#tonar-fuel-edit input[name="litres"]').fill('250');
    await main.page.locator('#tonar-fuel-edit .submit').tap();
    await main.page.locator('#tonar-dt-recent').getByText(/250 л/).waitFor();
    await main.page.locator('#bottom-nav [data-screen="s-driver-dash"]').tap();
    await main.page.locator('#tonar-today').getByText('250 л', {exact:true}).waitFor();
    assert.match(await main.page.locator('#tonar-month').textContent(), /1\s450 л/);

    await main.page.locator('#bottom-nav [data-screen="s-expense"]').tap();
    await main.page.getByRole('button', {name:/Новый расход/}).tap();
    await main.page.locator('#tonar-exp-form-recent').getByText('Антифриз').waitFor();
    await main.page.locator('#exp-new [data-tonar-truck] button').getByText('143').tap();
    await main.page.locator('#tonar-exp-form-recent').getByText('Расход 143').waitFor();
    assert.equal(await main.page.locator('#tonar-exp-form-recent').getByText('Антифриз').isVisible(), false);
    await main.page.locator('#exp-new [data-tonar-truck] button').getByText('803').tap();
    await main.page.getByPlaceholder('Например: тормозные колодки').fill('Новый фильтр');
    await main.page.getByPlaceholder('Например: 4800').fill('550');
    await main.page.locator('#exp-new .submit').tap();
    await main.page.locator('#tonar-exp-recent').getByText('Новый фильтр').waitFor();
    assert.deepEqual(await main.page.locator('#tonar-exp-recent .row-title').allTextContents(), ['Новый фильтр','Антифриз']);
    const otherDriver = await newPage('second-driver');
    await otherDriver.page.goto(origin + '/');
    await otherDriver.page.locator('#tonar-live-cabinet').getByText('Второй сотрудник').waitFor();
    await otherDriver.page.locator('#tonar-today').getByText('0 л', {exact:true}).waitFor();
    assert.equal(await otherDriver.page.getByText('Тестовый объект', {exact:false}).isVisible(), false);

    const mechanic = await newPage('mechanic');
    await mechanic.page.goto(origin + '/mechanic.html#tgWebAppData=fixture');
    await mechanic.page.locator('#s-mechanic-dash.active').waitFor();
    assert.deepEqual(await mechanic.page.locator('#bottom-nav button').evaluateAll(
      (buttons) => buttons.map((button) => button.dataset.screen)), ['s-service','s-parts','s-mechanic-dash']);
    await mechanic.page.locator('#bottom-nav [data-screen="s-service"]').tap();
    assert.equal(await mechanic.page.locator('#s-service').isVisible(), true);
    assert.ok(mechanic.actions.some((v) => v.action === 'get_mechanic_dashboard'));
    assert.ok(mechanic.actions.every((v) => v.data.init_data === 'fixture_signature_only'));
    const outsider = await newPage('driver');
    await outsider.page.goto(origin + '/mechanic.html');
    await outsider.page.getByText('Кабинет доступен только назначенному слесарю.').waitFor();
    assert.equal(await outsider.page.locator('#s-mechanic-dash').isVisible(), false);
    assert.deepEqual(outsider.actions.map((v) => v.action), ['get_session']);
    const unsigned = await newPage('mechanic', false);
    await unsigned.page.goto(origin + '/mechanic.html');
    await unsigned.page.getByText('Откройте этот кабинет через Telegram.').waitFor();
    assert.deepEqual(unsigned.actions, []);
    const reserve = await newPage('driver');
    await reserve.page.goto(origin + '/?app=mixer-reserve');
    await reserve.page.locator('#open-tonars').tap();
    assert.equal(await reserve.page.locator('#s-mixer').isVisible(), true);
    assert.equal(await reserve.page.locator('#s-tonary').isVisible(), false);
    assert.deepEqual(checks, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
