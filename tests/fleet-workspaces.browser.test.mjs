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
]);

test('mobile: separate driver, signed mechanic and reserve entrypoints', { skip: !playwright, timeout: 35000 }, async () => {
  const { devices, webkit } = await import(pathToFileURL(playwright).href);
  const server = createServer((req, res) => {
    const result = routeMap.get(new URL(req.url, 'http://local').pathname);
    if (!result) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' }).end(readFileSync(result));
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
        const result = req.action === 'get_session'
          ? { status:'ok', profile, directory:{ users:[], vehicles:[], trip_prices:[], quarry_plans:[] } }
          : { status:'ok', repairs:[], dashboard:{} };
        return route.fulfill({json:result, headers:cors});
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => checks.push(e.message));
      return { page, context, actions };
    }
    const main = await newPage('driver');
    await main.page.goto(origin + '/');
    assert.equal(await main.page.locator('#open-mechanic').isVisible(), false);
    await main.page.locator('#open-tonars').tap();
    assert.deepEqual(await main.page.locator('#bottom-nav button').evaluateAll(
      (buttons) => buttons.map((button) => button.dataset.screen)), ['s-home','s-tonary','s-dt','s-expense']);
    await main.page.locator('#btn-tonary').tap();
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
    assert.equal(await main.page.locator('#ton-truck-chips .on').count(), 0);
    assert.equal(await main.page.locator('#s-tonary').isVisible(), true);
    for (const id of ['s-director', 's-dlinn', 's-mixer', 's-mechanic-dash'])
      assert.equal(await main.page.locator('#' + id).isVisible(), false);
    assert.equal(main.actions.length, 0);
    await main.page.locator('#ton-truck-chips').getByRole('button', { name: '803', exact: true }).tap();
    const saved = main.page.waitForResponse((r) =>
      r.request().method() === 'POST' && r.request().postDataJSON().action === 'tonar_trip');
    await main.page.locator('#ton-new button[onclick="submitTonarTrip(this)"]').tap();
    assert.equal((await saved).ok(), true);
    assert.deepEqual(main.actions.map((v) => [v.action, v.data.truck]), [['tonar_trip', '803']]);

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
