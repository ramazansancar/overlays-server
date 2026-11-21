/**
 * The status page in a real browser, against a real server and the fake DDPAI camera.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeDdpai, type FakeDdpai } from '../scripts/lib/fake-ddpai.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { silentLogger } from '../src/lib/log.ts';

const HOSTILE = '<img src=x onerror="window.__xss=1">';

async function startStack(options: { token?: string; baseInfo?: Record<string, unknown>; port?: number; stateFile?: string; unreachable?: boolean } = {}) {
  const fake = options.unreachable ? undefined : await startFakeDdpai({ gpsIntervalMs: 200, gsensorIntervalMs: 50, ...(options.baseInfo && { baseInfo: options.baseInfo }) });
  const server = await startServer({
    config: parseConfig({
      port: options.port ?? 0,
      logLevel: 'silent',
      rememberLastPosition: Boolean(options.stateFile),
      ...(options.stateFile && { stateFile: options.stateFile }),
      ...(options.token && { token: options.token }),
      sources: [
        {
          id: 'cam',
          driver: 'ddpai',
          options: fake
            ? { host: '127.0.0.1', telemetryPort: fake.telemetryPort, httpPort: fake.httpPort }
            : { host: '127.0.0.1', telemetryPort: 9, deviceInfo: false },
        },
      ],
    }),
    log: silentLogger,
  });
  return { fake, server };
}

async function stop(stack: { fake?: FakeDdpai; server: RunningServer }) {
  await stack.server.close();
  await stack.fake?.close();
}

const card = (page: Page) => page.locator('#sources .card').first();

test.describe('status page', () => {
  let stack: Awaited<ReturnType<typeof startStack>>;
  test.beforeAll(async () => {
    stack = await startStack({ baseInfo: { model: `DDPAI ${HOSTILE}`, adas_type: HOSTILE } });
  });
  test.afterAll(() => stop(stack));

  test('shows live data from the camera', async ({ page }) => {
    await page.goto(stack.server.url + '/');
    await expect(page.locator('#conn')).toHaveText('live');
    await expect(card(page)).toContainText('DDPAI dashcam');
    await expect(card(page).locator('.badge', { hasText: 'online' })).toBeVisible();
    await expect(card(page).locator('.badge', { hasText: 'fix' })).toBeVisible();
    await expect(card(page)).toContainText('Memory card');
    await expect(card(page)).toContainText('rtsp://127.0.0.1:554/liveRTSP/av5');
    await expect(card(page)).toContainText(/\d+ km\/h/);
    await expect(card(page)).toContainText('Acceleration (g)');
    await expect(page.locator('footer a')).toHaveAttribute('href', 'https://github.com/ramazansancar/overlays-server');
  });

  test('device strings are shown as text, never run as HTML', async ({ page }) => {
    await page.goto(stack.server.url + '/');
    await expect(card(page)).toContainText(HOSTILE);
    await card(page).locator('summary').click();
    await expect(card(page).locator('details')).toContainText(HOSTILE);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (globalThis as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(await card(page).locator('img').count()).toBe(0);
  });

  test('position hidden by default; shown with map links on request', async ({ page }) => {
    await page.goto(stack.server.url + '/');
    const position = card(page).locator('dt', { hasText: 'Position' }).locator('xpath=following-sibling::dd[1]');
    await expect(position).toHaveText('•••');
    await expect(card(page).getByRole('link', { name: 'Google Maps' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show location' }).click();
    await expect(position).toContainText(/39\.9\d+, 32\.8\d+/);
    for (const [name, pattern] of [
      ['Google Maps', /^https:\/\/www\.google\.com\/maps\?q=39\.9\d+,32\.8\d+$/],
      ['Yandex', /^https:\/\/yandex\.com\/maps\/\?pt=32\.8\d+,39\.9\d+&z=16&l=map$/],
      ['OpenStreetMap', /^https:\/\/www\.openstreetmap\.org\/\?mlat=39\.9\d+&mlon=32\.8\d+#map=16\/39\.9\d+\/32\.8\d+$/],
    ] as const) {
      const link = card(page).getByRole('link', { name });
      await expect(link).toHaveAttribute('href', pattern);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    await page.getByRole('button', { name: 'Hide location' }).click();
    await expect(position).toHaveText('•••');
  });

  test('"other device info" stays open while the page keeps updating', async ({ page }) => {
    await page.goto(stack.server.url + '/');
    const details = card(page).locator('details');
    await expect(details.locator('summary')).toHaveCSS('cursor', 'pointer');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await page.waitForTimeout(2500); // several re-renders
    await expect(details).toHaveAttribute('open', '');
    await expect(details).toContainText('sdcapacity');
  });

  test('downloads a dated diagnostics file, positions only when ticked', async ({ page }) => {
    await page.goto(stack.server.url + '/');
    const link = page.getByRole('link', { name: 'Download diagnostics (.json)' });
    for (const withPositions of [false, true]) {
      if (withPositions) await page.getByLabel(/Include my position/).check();
      const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
      expect(download.suggestedFilename()).toMatch(/^overlays-server-diagnostics-\d{8}-\d{6}\.json$/);
      const file = await download.path();
      const data = JSON.parse(fs.readFileSync(file!, 'utf8'));
      expect(data.positionsIncluded).toBe(withPositions);
      expect(JSON.stringify(data)).not.toContain('do-not-leak');
    }
  });

  test('Turkish browsers get the Turkish page', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'tr-TR' });
    const page = await context.newPage();
    await page.goto(stack.server.url + '/');
    await expect(page.locator('#conn')).toHaveText('canlı');
    await expect(page.getByRole('button', { name: 'Konumu göster' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tanı verisini indir (.json)' })).toBeVisible();
    await context.close();
  });
});

test('reconnects by itself when the server restarts', async ({ page }) => {
  const first = await startStack();
  const port = first.server.port;
  await page.goto(first.server.url + '/');
  await expect(page.locator('#conn')).toHaveText('live');
  await stop(first);
  await expect(page.locator('#conn')).toHaveText(/no connection/);
  const second = await startStack({ port });
  try {
    await expect(page.locator('#conn')).toHaveText('live', { timeout: 15_000 });
    await expect(card(page).locator('.badge', { hasText: 'fix' })).toBeVisible();
  } finally {
    await stop(second);
  }
});

test('with a token: works with ?token=, stays offline without it', async ({ page }) => {
  const stack = await startStack({ token: 'tok123' });
  try {
    await page.goto(stack.server.url + '/?token=tok123');
    await expect(page.locator('#conn')).toHaveText('live');
    await expect(page.getByRole('link', { name: 'Download diagnostics (.json)' })).toHaveAttribute('href', /token=tok123/);
    await page.goto(stack.server.url + '/');
    await page.waitForTimeout(1500);
    await expect(page.locator('#conn')).not.toHaveText('live');
  } finally {
    await stop(stack);
  }
});

test('shows the last known position when the camera is gone (tunnel, restart)', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-pw-'));
  const stateFile = path.join(dir, 'last.json');
  fs.writeFileSync(stateFile, JSON.stringify({ format: 1, positions: { cam: { fix: { lat: 41.0082, lon: 28.9784, timestamp: Date.now() - 60_000 }, savedAt: Date.now() - 60_000 } } }));
  const stack = await startStack({ stateFile, unreachable: true });
  try {
    await page.goto(stack.server.url + '/');
    await expect(card(page)).toContainText('last known position (no GPS)');
    await page.getByRole('button', { name: 'Show location' }).click();
    await expect(card(page)).toContainText('41.00820, 28.97840');
  } finally {
    await stop(stack);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
