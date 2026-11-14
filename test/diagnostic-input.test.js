'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runDiagnosis } = require('../src/diagnose');
const { buildDiagnosisPrompt } = require('../src/codex');
const { prepareDiagnosticInput, sanitizeDiagnosticValue, MAX_TOTAL_ARTIFACT_BYTES } = require('../src/diagnostic-input');
const { compactText } = require('../src/notify');

test('all outbound and persisted diagnostic text uses the shared scrubber', async () => {
  const before = process.env.TEST_DIAG_INPUT_TOKEN;
  process.env.TEST_DIAG_INPUT_TOKEN = 'synthetic';
  const secret = 'private-canary-do-not-expose';
  const labeled = `Authorization: Bearer ${secret}`;
  let prompt = '';
  const client = {
    getPipeline: async () => ({ id: 9, sha: 'a'.repeat(40) }),
    listPipelineJobs: async () => ({ complete: true, items: [{ id: 1, name: labeled, stage: `token=${secret}`, status: 'failed' }] }),
    getTrace: async () => `main.c:2: error: failed\n${labeled}`,
    getArtifactText: async () => JSON.stringify({ message: labeled, token: secret }),
    changedPaths: async () => [`src/token=${secret}`, 'src/中文.c']
  };
  try {
    const result = await runDiagnosis({ gitlabUrl: 'https://gitlab.example', gitlabTokenEnv: 'TEST_DIAG_INPUT_TOKEN', project: '7', pipelineId: 9, artifacts: [{ kind: 'sarif', path: 'report.sarif' }], publish: false }, { client, runCodexFn: async input => {
      prompt = buildDiagnosisPrompt(input);
      assert.equal(JSON.stringify(input).includes(secret), false);
      return { model: 'fixture', modelEvidence: { provider: `https://user:${secret}@provider.test`, token: secret }, diagnosis: { classification: 'source', confidence: .9, rootCause: `failure ${labeled}`, primaryEvidence: [labeled], relatedFailures: [], affectedFiles: [], recommendedActions: ['inspect first error'], retryRecommended: false }, usage: {} };
    } });
    assert.equal(prompt.includes(secret), false);
    assert.match(prompt, /main.c:2: error: failed/);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(compactText(result.diagnosis, result.evidence, result.receipt).includes(secret), false);
    assert.equal(result.execution.inputManifest.promptBound, true);
    assert.equal(result.execution.inputManifest.deliveredPromptDigest, crypto.createHash('sha256').update(prompt).digest('hex'));
  } finally {
    if (before === undefined) delete process.env.TEST_DIAG_INPUT_TOKEN; else process.env.TEST_DIAG_INPUT_TOKEN = before;
  }
});

test('sanitization preserves ordinary log content and is idempotent beside an already-redacted token', () => {
  const value = { text: '1: main.c:2: error: undefined symbol\n2: token=[REDACTED]', token: 'sensitive', detail: { text: 'prefix\nAuthorization: Bearer sensitive\nsuffix' } };
  const clean = sanitizeDiagnosticValue(value);
  assert.match(clean.text, /undefined symbol/);
  assert.match(clean.detail.text, /prefix\nAuthorization: \[REDACTED\]\nsuffix/);
  assert.equal(clean.token, '[REDACTED]');
  assert.deepEqual(sanitizeDiagnosticValue(clean), clean);
});

test('UTF-8 artifacts share a byte budget, retain exact paths and report omissions', () => {
  const input = prepareDiagnosticInput({ evidence: { subject: {}, log: { text: 'failure' } }, artifactTexts: Array.from({ length: 14 }, (_, i) => ({ kind: 'junit', name: `${i}.xml`, text: '中文'.repeat(20000) })), changedPaths: ['x\\y.c', 'x/y.c'] });
  const bytes = input.artifactTexts.reduce((total, item) => total + Buffer.byteLength(item.text), 0);
  assert.ok(bytes <= MAX_TOTAL_ARTIFACT_BYTES);
  assert.ok(input.artifactTexts.every(item => !item.text.includes('\ufffd')));
  assert.deepEqual(input.changedPaths, ['x\\y.c', 'x/y.c']);
  assert.ok(input.coverageGaps.includes('artifact_count_limit'));
  assert.match(buildDiagnosisPrompt(input), /Input coverage gaps:/);
});

test('oversized path identities are omitted whole and partial enumeration fails before inference', async () => {
  const input = prepareDiagnosticInput({ evidence: {}, changedPaths: ['x'.repeat(2049), 'src/complete.js'] });
  assert.deepEqual(input.changedPaths, ['src/complete.js']);
  assert.ok(input.coverageGaps.includes('changed_path_size_limit'));
  const { GitLabDiagnoseClient } = require('../src/gitlab');
  const client = new GitLabDiagnoseClient({ baseUrl: 'https://gitlab.example', token: 'synthetic' });
  client.paginated = async () => ({ complete: false, items: [{ new_path: 'first.js' }] });
  await assert.rejects(client.changedPaths(7, 'a'.repeat(40)), { code: 'EGITLABPAGINATION' });
});
