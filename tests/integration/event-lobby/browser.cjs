#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const PROJECT = 'demo-geoguess-admission';
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9009');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
const tools = createRequire('/workspace/.geoguess-emulator-tools/package.json');
const { initializeTestEnvironment } = tools('@firebase/rules-unit-testing');
const { set, get, ref } = tools('firebase/database');
const { chromium } = require('/workspace/.geoguess-tools/node_modules/playwright');
const BASE = 'http://127.0.0.1:8087';

test('routed lobby restores browser identity and keeps two guests when a page leaves', { timeout: 90000 }, async () => {
    let env, browser;
    try {
        env = await initializeTestEnvironment({ projectId: PROJECT, database: {
            host: '127.0.0.1', port: 9009,
            rules: fs.readFileSync(path.join(__dirname, '../event-admission/rules.json'), 'utf8'),
        } });
        await env.clearDatabase();
        await env.withSecurityRulesDisabled(async context => {
            await set(ref(context.database(), 'events/browser_smoke'), {
                hostUid: 'organizer', public: { title: 'Local lobby smoke', phase: 'lobby' },
            });
        });
        browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
        async function context() {
            const result = await browser.newContext({ viewport: { width: 390, height: 844 } });
            // Fail closed if a build accidentally targets a real provider.
            await result.route('**/*', route => {
                const url = new URL(route.request().url());
                return url.hostname === '127.0.0.1' && ['8087', '9009', '9099'].includes(url.port)
                    ? route.continue() : route.abort();
            });
            await result.addInitScript(() => {
                const Native = window.WebSocket;
                window.WebSocket = class extends Native {
                    constructor(url, ...args) {
                        const endpoint = new URL(url, window.location.href);
                        if (endpoint.hostname !== '127.0.0.1' || !['8087', '9009', '9099'].includes(endpoint.port)) {
                            throw new Error('Nonlocal test WebSocket rejected');
                        }
                        super(url, ...args);
                    }
                };
            });
            return result;
        }
        const audience = await context();
        let audienceSignups = 0;
        audience.on('request', request => { if (request.url().includes('accounts:signUp')) audienceSignups++; });
        const presentation = await audience.newPage();
        await presentation.goto(`${BASE}/event/browser_smoke/present?adminToken=do-not-copy`, { waitUntil: 'domcontentloaded' });
        await presentation.getByRole('heading', { name: 'Local lobby smoke', exact: true }).waitFor({ timeout: 30000 });
        assert.equal(audienceSignups, 0, 'A presenter must not create an anonymous guest');
        const publicUrl = await presentation.locator('.event-presentation__join-url').textContent();
        assert.equal(publicUrl, `${BASE}/event/browser_smoke/join`);
        assert.equal(await presentation.locator('form').count(), 0);
        const a = await context();
        const b = await context();
        const pageA = await a.newPage();
        const pageB = await b.newPage();
        for (const [page, name] of [[pageA, 'Alex'], [pageB, 'Taylor']]) {
            await page.goto(`${BASE}/event/browser_smoke/join`, { waitUntil: 'domcontentloaded' });
            await page.getByLabel('Nickname', { exact: true }).waitFor({ timeout: 30000 });
            await page.waitForFunction(() => !document.querySelector('input[name="nickname"]').disabled, { timeout: 30000 });
            await page.getByLabel('Nickname', { exact: true }).fill(name);
            await page.getByLabel('Nickname', { exact: true }).press('Enter');
            await page.getByRole('status').filter({ hasText: 'You’re in the lobby' }).waitFor({ timeout: 30000 });
        }
        await presentation.waitForFunction(() => document.querySelectorAll('.event-presentation__guests li').length === 2);
        assert.deepEqual((await presentation.locator('.event-presentation__guests li').allTextContents()).map(x => x.trim()).sort(), ['Alex', 'Taylor']);
        let before;
        await env.withSecurityRulesDisabled(async c => { before = (await get(ref(c.database(), 'events/browser_smoke/public/participants'))).val(); });
        await pageA.reload({ waitUntil: 'domcontentloaded' });
        await pageA.getByRole('status').filter({ hasText: 'You’re in the lobby' }).waitFor({ timeout: 30000 });
        let restored;
        await env.withSecurityRulesDisabled(async c => { restored = (await get(ref(c.database(), 'events/browser_smoke/public/participants'))).val(); });
        assert.deepEqual(restored, before, 'Browser reload must reuse identity and membership');
        await a.close();
        await new Promise(resolve => setTimeout(resolve, 200));
        let after;
        await env.withSecurityRulesDisabled(async c => { after = (await get(ref(c.database(), 'events/browser_smoke/public/participants'))).val(); });
        assert.deepEqual(after, before, 'Guest departure must not delete any membership');
        assert.equal(audienceSignups, 0);
        assert.equal(await pageB.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally {
        if (browser) await browser.close();
        if (env) await env.cleanup();
    }
});
