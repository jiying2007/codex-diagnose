'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePublicationTarget, assertPublicationCurrent } = require('../src/publication');
const { GitLabDiagnoseClient } = require('../src/gitlab');
const sha = 'a'.repeat(40), next = 'b'.repeat(40);
const subject = { commitSha: sha, pipelineId: 9 };
const mr = extra => ({ iid: 44, project_id: 7, state: 'opened', sha, source_project_id: 7, target_project_id: 7, source_branch: 'fix', target_branch: 'main', diff_refs: { head_sha: sha, base_sha: 'c'.repeat(40), start_sha: 'd'.repeat(40) }, ...extra });

test('automatic publication requires one open association and explicit selection is checked', async () => {
  const client = { mergeRequestsForCommit: async () => [mr(), mr({ iid: 45 })], getMergeRequest: async (_p, iid) => mr({ iid }) };
  await assert.rejects(resolvePublicationTarget(client, '7', subject), { code: 'EMRAMBIGUOUS' });
  assert.equal((await resolvePublicationTarget(client, '7', subject, 44)).iid, 44);
  await assert.rejects(resolvePublicationTarget(client, '7', subject, 46), { code: 'EMRASSOCIATION' });
});

test('head, branch, project and state drift are rejected before publication', async () => {
  let current = mr();
  const client = { mergeRequestsForCommit: async () => [mr()], getMergeRequest: async () => current };
  const target = await resolvePublicationTarget(client, '7', subject);
  await assertPublicationCurrent(client, target);
  for (const changed of [mr({ diff_refs: { head_sha: next } }), mr({ source_branch: 'different' }), mr({ project_id: 8 }), mr({ state: 'merged' })]) {
    current = changed;
    await assert.rejects(assertPublicationCurrent(client, target), error => /^EMR/.test(error.code));
  }
});

test('a synthetic merge commit requires the current MR pipeline and binds its source head', async () => {
  let current = mr({ sha: next, diff_refs: { head_sha: next, base_sha: 'c'.repeat(40), start_sha: 'd'.repeat(40) }, head_pipeline: { id: 9, sha } });
  const client = { mergeRequestsForCommit: async () => [], getMergeRequest: async () => current, getCommit: async () => ({ id: sha, parent_ids: [next, 'd'.repeat(40)] }) };
  const target = await resolvePublicationTarget(client, '7', subject, 44);
  assert.equal(target.snapshot.headSha, next);
  await assertPublicationCurrent(client, target);
  current = { ...current, head_pipeline: { id: 10, sha } };
  await assert.rejects(assertPublicationCurrent(client, target), { code: 'EMRSTALE' });
});

test('failed diff identity cannot use an unrelated historical MR pipeline', async () => {
  const client = { mergeRequestsForCommit: async () => [mr()], getMergeRequest: async () => mr({ diff_refs: { head_sha: next, base_sha: 'c'.repeat(40), start_sha: 'd'.repeat(40) }, head_pipeline: { id: 8, sha } }) };
  await assert.rejects(resolvePublicationTarget(client, '7', subject), { code: 'EMRSTALE' });
});

test('last subject check runs after note discovery and immediately before a write', async () => {
  const client = new GitLabDiagnoseClient({ baseUrl: 'https://gitlab.example', token: 'synthetic' });
  const calls = [];
  client.request = async (method, route) => { calls.push(`${method} ${route}`); return { data: { id: 22 } }; };
  client.listMergeRequestNotes = async () => { calls.push('notes'); return { complete: true, items: [] }; };
  await assert.rejects(client.upsertDiagnosisNote(7, 44, 'diagnosis', { beforeWrite: async () => { calls.push('recheck'); throw Object.assign(new Error('advanced'), { code: 'EMRSTALE' }); } }), { code: 'EMRSTALE' });
  assert.deepEqual(calls, ['GET /user', 'notes', 'recheck']);
});

test('identical owned note is a no-op after current-subject validation', async () => {
  const client = new GitLabDiagnoseClient({ baseUrl: 'https://gitlab.example', token: 'synthetic' });
  let writes = 0, checked = false;
  client.request = async method => { if (method !== 'GET') writes++; return { data: { id: 22 } }; };
  client.listMergeRequestNotes = async () => ({ complete: true, items: [{ id: 11, author: { id: 22 }, body: 'diagnosis\n\n<!-- codex-diagnose-safe:summary -->' }] });
  const result = await client.upsertDiagnosisNote(7, 44, 'diagnosis', { beforeWrite: async () => { checked = true; } });
  assert.equal(result.id, 11);
  assert.equal(checked, true);
  assert.equal(writes, 0);
});

test('equivalent subject and diagnosis identity avoids a write despite display-time changes', async () => {
  const client = new GitLabDiagnoseClient({ baseUrl: 'https://gitlab.example', token: 'synthetic' });
  const identityDigest = 'e'.repeat(64);
  let writes = 0, checked = 0;
  client.request = async method => { if (method !== 'GET') writes++; return { data: { id: 22 } }; };
  client.listMergeRequestNotes = async () => ({ complete: true, items: [{ id: 11, author: { id: 22 }, body: `old display time\n<!-- codex-diagnose-safe:summary -->\n<!-- codex-diagnose-safe:identity:${identityDigest} -->` }] });
  await client.upsertDiagnosisNote(7, 44, 'new display time', { identityDigest, beforeWrite: async () => { checked++; } });
  assert.equal(writes, 0);
  assert.equal(checked, 1);
  await client.upsertDiagnosisNote(7, 44, 'changed actual diagnosis', { identityDigest: 'f'.repeat(64), beforeWrite: async () => { checked++; } });
  assert.equal(writes, 1);
});

test('publication rejects incomplete diff identity and unrelated synthetic ancestry', async () => {
  let current = mr({ diff_refs: null });
  const client = { mergeRequestsForCommit: async () => [mr()], getMergeRequest: async () => current, getCommit: async () => ({ id: sha, parent_ids: ['c'.repeat(40), 'd'.repeat(40)] }) };
  await assert.rejects(resolvePublicationTarget(client, '7', subject), { code: 'EMREVIDENCE' });
  current = mr({ diff_refs: { head_sha: next, base_sha: 'c'.repeat(40), start_sha: 'd'.repeat(40) }, head_pipeline: { id: 9, sha } });
  await assert.rejects(resolvePublicationTarget(client, '7', subject), { code: 'EMREVIDENCE' });
});

test('MR association binds project and IID together, including path-form project selection', async () => {
  const foreign = mr({ project_id: 8, target_project_id: 8 });
  const client = { getProject: async () => ({ id: 7 }), mergeRequestsForCommit: async () => [foreign], getMergeRequest: async () => mr() };
  for (const project of ['7', 'group/project']) {
    await assert.rejects(resolvePublicationTarget(client, project, subject), { code: 'EMRNOTFOUND' });
    await assert.rejects(resolvePublicationTarget(client, project, subject, 44), { code: 'EMRASSOCIATION' });
  }
  client.mergeRequestsForCommit = async () => [foreign, mr()];
  const target = await resolvePublicationTarget(client, 'group/project', subject);
  assert.equal(target.snapshot.projectId, 7);
  assert.equal(target.snapshot.iid, 44);
});
