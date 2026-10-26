'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { notifyDiagnosis } = require('../src/notify');

async function server(handler, t) {
  const value = http.createServer(handler);
  await new Promise((resolve, reject) => {
    value.once('error', reject);
    value.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => { value.closeAllConnections(); value.close(resolve); }));
  return `http://127.0.0.1:${value.address().port}`;
}

const diagnosis = { classification: 'source', rootCause: 'synthetic-private-diagnosis', confidence: 0.9, retryRecommended: false };
const evidence = { subject: { jobName: 'synthetic-build' } };

test('notification writes never follow same-origin or cross-origin HTTP redirects', { timeout: 10000 }, async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const reached = [];
  const target = await server((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { reached.push({ method: req.method, body }); res.end('{}'); });
  }, t);
  let status = 307, location = `${target}/sink`, accepted = 0;
  const origin = await server((req, res) => {
    if (req.url === '/moved') { reached.push({ method: req.method, sameOrigin: true }); res.end('{}'); return; }
    accepted++;
    req.resume();
    res.writeHead(status, { location });
    res.end();
  }, t);
  for (const [provider, host] of [['feishu', 'open.feishu.cn'], ['wecom', 'qyapi.weixin.qq.com']]) {
    // Keep production provider validation; map only the initial transport to a
    // local HTTP fixture. Native fetch performs any subsequent redirect itself.
    global.fetch = (url, options) => {
      assert.equal(new URL(String(url)).hostname, host);
      return originalFetch(`${origin}/initial`, options);
    };
    for (status of [307, 308, 301, 302, 303]) {
      for (location of [`${target}/sink`, '/moved']) {
        let failure;
        try { await notifyDiagnosis({ provider, webhookEnv: 'HOOK', env: { HOOK: `https://${host}/synthetic-hook` }, diagnosis, evidence }); }
        catch (error) { failure = error; }
        assert.deepEqual(reached, [], 'notification content must not reach a redirect destination');
        assert.equal(failure?.code, 'ENOTIFYHTTP');
        assert.equal(failure?.status, status);
      }
    }
  }
  assert.equal(accepted, 20);
});

test('a direct provider response still accepts the intended notification body', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const received = [];
  const origin = await server((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { received.push({ method: req.method, body: JSON.parse(body) }); res.end(JSON.stringify({ code: 0 })); });
  }, t);
  global.fetch = (url, options) => {
    assert.equal(new URL(String(url)).hostname, 'open.feishu.cn');
    return originalFetch(origin, options);
  };
  const result = await notifyDiagnosis({ provider: 'feishu', webhookEnv: 'HOOK', env: { HOOK: 'https://open.feishu.cn/synthetic-hook' }, diagnosis, evidence });
  assert.deepEqual(result, { provider: 'feishu', status: 200 });
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.ok(received[0].body.content.text.includes(diagnosis.rootCause));
});

test('HTTP success requires an explicit and consistent provider acknowledgment', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let reply = '{}';
  const origin = await server((req, res) => { req.resume(); res.setHeader('content-type', 'application/json'); res.end(reply); }, t);
  const cases = [
    ['feishu', { code: 0 }, null],
    ['feishu', { StatusCode: 0 }, null],
    ['feishu', { code: 0, StatusCode: 0 }, null],
    ['wecom', { errcode: 0 }, null],
    ['feishu', { code: 9499, msg: 'synthetic-credential-should-not-appear' }, 'ENOTIFYREMOTE'],
    ['wecom', { errcode: 45009 }, 'ENOTIFYREMOTE'],
    ['feishu', { code: 0, StatusCode: 19021 }, 'ENOTIFYREMOTE'],
    ['wecom', { errcode: 0, code: 9 }, 'ENOTIFYREMOTE'],
    ['feishu', {}, 'ENOTIFYPROTOCOL'],
    ['wecom', { code: 0 }, 'ENOTIFYPROTOCOL'],
    ['feishu', { code: null }, 'ENOTIFYPROTOCOL'],
    ['feishu', { code: '0' }, 'ENOTIFYPROTOCOL'],
    ['wecom', { errcode: false }, 'ENOTIFYPROTOCOL'],
    ['feishu', [], 'ENOTIFYPROTOCOL'],
    ['wecom', 'not-json', 'ENOTIFYPROTOCOL']
  ];
  for (const [provider, body, errorCode] of cases) {
    const host = provider === 'feishu' ? 'open.feishu.cn' : 'qyapi.weixin.qq.com';
    global.fetch = (url, options) => { assert.equal(new URL(String(url)).hostname, host); return originalFetch(origin, options); };
    reply = typeof body === 'string' ? body : JSON.stringify(body);
    const send = () => notifyDiagnosis({ provider, webhookEnv: 'HOOK', env: { HOOK: `https://${host}/synthetic-hook` }, diagnosis, evidence });
    if (errorCode) {
      await assert.rejects(send, error => error.code === errorCode && !error.message.includes('synthetic-credential-should-not-appear'));
    } else {
      assert.deepEqual(await send(), { provider, status: 200 });
    }
  }
});
