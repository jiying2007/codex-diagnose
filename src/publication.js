'use strict';

const fail = (code, message) => Object.assign(new Error(message), { code });
const SHA = /^[0-9a-f]{40}$/i;

function publicationSnapshot(mr, { project, expectedProjectId, iid, commitSha, pipelineId, mergeParents = [] }) {
  if (!mr || Number(mr.iid) !== Number(iid) || mr.state !== 'opened') throw fail('EMRSTATE', 'Diagnosis publication requires the selected open merge request.');
  const projectId = Number(mr.project_id || mr.target_project_id);
  const wantedProject = expectedProjectId || (/^\d+$/.test(String(project)) ? Number(project) : 0);
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(wantedProject) || wantedProject <= 0 || projectId !== wantedProject) throw fail('EMRPROJECT', 'Merge request project identity does not match the diagnosis.');
  const head = String(mr.diff_refs?.head_sha || mr.sha || '');
  if (!SHA.test(head) || !SHA.test(String(commitSha))) throw fail('EMREVIDENCE', 'Merge request head or failed commit evidence is unavailable.');
  const baseSha = String(mr.diff_refs?.base_sha || ''), startSha = String(mr.diff_refs?.start_sha || '');
  const sourceProjectId = Number(mr.source_project_id), targetProjectId = Number(mr.target_project_id);
  if (![baseSha, startSha].every(value => SHA.test(value)) || ![sourceProjectId, targetProjectId].every(value => Number.isSafeInteger(value) && value > 0) || !mr.source_branch || !mr.target_branch) throw fail('EMREVIDENCE', 'Complete merge request diff and source/target identity is required for publication.');
  if (targetProjectId !== projectId) throw fail('EMRPROJECT', 'Merge request target project identity is inconsistent.');
  const direct = head === commitSha;
  // Merged-results pipelines have a synthetic SHA. Accept only the MR's current
  // authoritative head_pipeline, never an arbitrary historical pipeline member.
  const currentMergedPipeline = Number(pipelineId) > 0 && Number(mr.head_pipeline?.id) === Number(pipelineId) && mr.head_pipeline?.sha === commitSha;
  if (!direct && !currentMergedPipeline) throw fail('EMRSTALE', 'The failed commit is no longer the current merge request subject.');
  if (!direct && (mergeParents.length < 2 || !mergeParents.every(value => SHA.test(value)) || !mergeParents.includes(head))) throw fail('EMREVIDENCE', 'Synthetic pipeline commit must contain the current source head as a merge parent.');
  return Object.freeze({ projectId, iid: Number(iid), headSha: head, baseSha, startSha, sourceProjectId, targetProjectId, sourceBranch: String(mr.source_branch), targetBranch: String(mr.target_branch), pipelineId: direct ? null : Number(pipelineId), pipelineSha: direct ? null : commitSha });
}

async function resolvePublicationTarget(client, project, subject, explicit = 0) {
  const expectedProjectId = /^\d+$/.test(String(project)) ? Number(project) : Number((await client.getProject(project))?.id);
  if (!Number.isSafeInteger(expectedProjectId) || expectedProjectId <= 0) throw fail('EMRPROJECT', 'Diagnosis project identity is unavailable.');
  const matches = await client.mergeRequestsForCommit(project, subject.commitSha);
  const open = [...new Map(matches.filter(mr => mr?.state === 'opened' && Number(mr.project_id) === expectedProjectId && (mr.target_project_id === undefined || Number(mr.target_project_id) === expectedProjectId) && Number.isSafeInteger(Number(mr.iid)) && Number(mr.iid) > 0).map(mr => [`${expectedProjectId}:${Number(mr.iid)}`, mr])).values()];
  let iid = Number(explicit) || 0;
  if (!iid) {
    if (open.length > 1) throw fail('EMRAMBIGUOUS', 'Multiple open merge requests contain this commit; select --mr explicitly.');
    iid = Number(open[0]?.iid) || 0;
  }
  if (!iid) throw fail('EMRNOTFOUND', 'No unique open merge request is associated with the failed commit.');
  const options = { project, expectedProjectId, iid, commitSha: subject.commitSha, pipelineId: subject.pipelineId };
  const mr = await client.getMergeRequest(project, iid);
  if (String(mr?.diff_refs?.head_sha || mr?.sha || '') !== subject.commitSha && Number(mr?.head_pipeline?.id) === Number(subject.pipelineId) && mr?.head_pipeline?.sha === subject.commitSha) {
    const commit = await client.getCommit(project, subject.commitSha);
    if (commit?.id !== subject.commitSha || !Array.isArray(commit.parent_ids)) throw fail('EMREVIDENCE', 'Synthetic pipeline commit ancestry is unavailable.');
    options.mergeParents = Object.freeze([...commit.parent_ids]);
  }
  const snapshot = publicationSnapshot(mr, options);
  // An explicit MR may use a merged-results SHA absent from commit/MR lookup;
  // publicationSnapshot then requires current head_pipeline identity instead.
  if (!open.some(mr => Number(mr.iid) === iid) && !snapshot.pipelineId) throw fail('EMRASSOCIATION', 'The selected merge request is not associated with the failed commit.');
  return Object.freeze({ ...options, snapshot });
}

async function assertPublicationCurrent(client, target) {
  const current = publicationSnapshot(await client.getMergeRequest(target.project, target.iid), target);
  if (JSON.stringify(current) !== JSON.stringify(target.snapshot)) throw fail('EMRSTALE', 'Merge request identity changed during diagnosis; refusing stale publication.');
  return current;
}

module.exports = { publicationSnapshot, resolvePublicationTarget, assertPublicationCurrent };
