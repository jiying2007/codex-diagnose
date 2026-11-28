'use strict';

const {secureReadText}=require('./codex-safe-core/secure-local-file');
const crypto=require('node:crypto');
const {buildDiagnosisEvidence,buildDiagnosisInputManifest,classifyFailureDeterministically,normalizeDiagnosisResult,createDiagnosisReceipt,formatDiagnosisMarkdown}=require('./codex-safe-core/diagnosis-platform');
const {GitLabDiagnoseClient}=require('./gitlab');
const {runCodexDiagnosis,buildDiagnosisPrompt}=require('./codex');
const {cleanText,sanitizeDiagnosticValue,prepareDiagnosticInput}=require('./diagnostic-input');
const {resolvePublicationTarget,assertPublicationCurrent}=require('./publication');
const {rankFailedJobEvidence,formatRankedFailureBlocks}=require('./failure-causality');

const MAX_LOCAL_LOG_BYTES=32*1024*1024;
const MAX_FAILED_JOBS=12;
function digest(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function appError(code,message){return Object.assign(new Error(message),{code});}
function readLocalLog(file){return secureReadText(file,{maxBytes:MAX_LOCAL_LOG_BYTES,requireOwner:false,rejectGroupOtherWrite:false});}
function deterministicDiagnosis(prior,evidence){const classification=prior.classification||'unknown',actions={source:['Inspect the first compiler/linker error and the affected source change; reproduce with the same build configuration.'],test:['Inspect the first failing assertion and its fixture/input; compare it with the changed behavior.'],dependency:['Verify the lockfile/registry/artifact version that the failed job resolved and restore a reproducible dependency set.'],infra:['Verify runner/network/storage availability and retry only after the infrastructure condition is cleared.'],flaky:['Re-run the isolated failing test under the same revision and collect repeated evidence before changing product code.'],unknown:['Inspect the earliest error in the compact evidence and collect the missing build/test context before changing code.']}[classification];return normalizeDiagnosisResult({classification,rootCause:`Deterministic-only mode classified the supplied failure evidence as ${classification}; model root-cause synthesis was intentionally disabled.`,confidence:prior.confidence,primaryEvidence:(evidence.log.text.match(/^\d+: .*$/gm)||[]).slice(0,5),relatedFailures:[],affectedFiles:[],recommendedActions:actions,retryRecommended:classification==='infra'||classification==='flaky'},evidence);}
// Only authoritative native API metadata can select the automatic zero-model
// runner path. A string in a job trace is never sufficient.
function nativeRunnerFailureJobs(jobs,pipelineId,commitSha,expectedJobId=0){
 if(!Array.isArray(jobs)||!jobs.length||!Number.isSafeInteger(Number(pipelineId))||Number(pipelineId)<=0||!/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(String(commitSha||'')))return [];
 const ids=[];
 for(const job of jobs){
  const id=Number(job?.id),commit=String(job?.commit?.id||''),pipelineCommit=String(job?.pipeline?.sha||'');
  if(!Number.isSafeInteger(id)||id<=0||ids.includes(id)||(expectedJobId&&id!==Number(expectedJobId))||job.status!=='failed'||job.failure_reason!=='runner_system_failure'||Number(job.pipeline?.id)!==Number(pipelineId)||(!commit&&!pipelineCommit)||(commit&&commit!==commitSha)||(pipelineCommit&&pipelineCommit!==commitSha))return [];
  ids.push(id);
 }
 return ids;
}
function nativeRunnerTraceEligible(trace){
 // Check each original trace before adding the controller's native failure
 // marker. Aggregate classifier scores and compacted log winners can hide
 // a concurrent compiler/test/dependency failure.
 const text=String(trace||'');
 const scores=classifyFailureDeterministically(text).scores||{};
 if(['source','test','dependency','flaky'].some(key=>Number(scores[key]||0)>0))return false;
 // Common C/C++ compiler diagnostics not covered by the coarse classifier.
 if(/(?:^|\n)[^\r\n]{1,1024}:\d+(?::\d+)?:\s*(?:fatal\s+)?error\s*:/i.test(text))return false;
 return true;
}
function nativeRunnerDiagnosis(jobIds,evidence){
 return normalizeDiagnosisResult({classification:'infra',rootCause:'GitLab reports runner_system_failure for every selected failed job. The underlying runner/host failure is not established; no model root-cause synthesis was performed.',confidence:0.8,primaryEvidence:jobIds.map(id=>'GitLab API job '+id+': failure_reason=runner_system_failure'),relatedFailures:[],affectedFiles:[],recommendedActions:['Inspect runner and executor health for the exact failed job IDs.','Retry only after the reported infrastructure condition is cleared.'],retryRecommended:true},evidence);
}
async function collectArtifacts(client,project,jobs,specs){const texts=[],meta=[];for(const job of jobs){for(const spec of specs||[]){let text;try{text=await client.getArtifactText(project,job.id,spec.path);}catch(error){if(error.status===404)continue;throw error;}if(text===null)continue;const bounded=cleanText(text,256*1024),name=cleanText(`job-${job.id}/${spec.path}`,256),sha=digest(bounded);texts.push(Object.freeze({kind:spec.kind,name,text:bounded,digest:sha}));meta.push(Object.freeze({kind:spec.kind,name,digest:sha}));}}return Object.freeze({texts:Object.freeze(texts),meta:Object.freeze(meta)});}
async function collectGitLab(options,client){const project=options.project;if(options.jobId){const job=await client.getJob(project,options.jobId);if(String(job.status)!=='failed')throw appError('EJOBSTATE',`Job ${job.id} is ${job.status}; only failed jobs are diagnosed`);const trace=await client.getTrace(project,job.id),pipelineId=Number(job.pipeline?.id||0)||null,commitSha=String(job.commit?.id||job.pipeline?.sha||''),artifacts=await collectArtifacts(client,project,[job],options.artifacts),changedPaths=await client.changedPaths(project,commitSha);return{log:`===== FAILED JOB ${job.id} ${job.name||''} stage=${job.stage||''} =====\n${trace}`,job:{projectId:Number(project)||null,pipelineId,jobId:Number(job.id),commitSha,jobName:String(job.name||`job ${job.id}`)},artifactTexts:artifacts.texts,artifactMeta:artifacts.meta,changedPaths,mrIid:options.mrIid||0,nativeRunnerJobs:nativeRunnerTraceEligible(trace)?nativeRunnerFailureJobs([job],pipelineId,commitSha,options.jobId):[]};}
  const pipeline=await client.getPipeline(project,options.pipelineId),jobsResult=await client.listPipelineJobs(project,options.pipelineId);if(!jobsResult.complete)throw appError('EGITLABPAGINATION','Failed-job enumeration exceeded the configured GitLab page limit');const failed=jobsResult.items.filter(job=>String(job.status)==='failed').sort((a,b)=>Number(a.id)-Number(b.id));if(!failed.length)throw appError('EPIPELINESTATE',`Pipeline ${options.pipelineId} has no failed jobs`);if(failed.length>MAX_FAILED_JOBS)throw appError('EJOBLIMIT',`Pipeline has ${failed.length} failed jobs; maximum bounded diagnosis set is ${MAX_FAILED_JOBS}`);const entries=[];for(const job of failed){const trace=await client.getTrace(project,job.id);entries.push({job,trace});}const ranked=rankFailedJobEvidence(entries),rankedJobs=ranked.map(item=>item.job),commitSha=String(pipeline.sha||failed[0]?.commit?.id||''),artifacts=await collectArtifacts(client,project,rankedJobs,options.artifacts),changedPaths=await client.changedPaths(project,commitSha);return{log:formatRankedFailureBlocks(ranked),job:{projectId:Number(project)||null,pipelineId:Number(pipeline.id||options.pipelineId),jobId:null,commitSha,jobName:`pipeline ${pipeline.id||options.pipelineId}: ${failed.length} failed job(s)`},artifactTexts:artifacts.texts,artifactMeta:artifacts.meta,changedPaths,mrIid:options.mrIid||0,nativeRunnerJobs:Number(pipeline.id)===Number(options.pipelineId)&&entries.every(item=>nativeRunnerTraceEligible(item.trace))?nativeRunnerFailureJobs(failed,pipeline.id,commitSha):[],failedJobs:ranked.map(item=>({id:item.job.id,name:item.job.name,stage:item.job.stage,status:item.job.status,causalRank:item.causalRank,stageRank:item.stageRank,classification:item.classification,confidence:item.confidence,cascade:item.cascade,duplicateOf:item.duplicateOf,signature:item.signature}))};}
async function resolvePublishMr(client,project,commitSha,explicit){const target=await resolvePublicationTarget(client,project,{commitSha},explicit);return target.iid;}
async function runDiagnosis(options,{client=null,runCodexFn=runCodexDiagnosis}={}){
  let source;
  if(options.logFile){const log=readLocalLog(options.logFile);source={log,job:{projectId:null,pipelineId:null,jobId:null,commitSha:`local:${digest(log).slice(0,24)}`,jobName:'local log'},artifactTexts:[],artifactMeta:[],changedPaths:[],mrIid:0};}
  else{const token=String(process.env[options.gitlabTokenEnv]||'').trim();if(!token)throw appError('EGITLABTOKEN',`GitLab token environment variable ${options.gitlabTokenEnv} is missing`);client=client||new GitLabDiagnoseClient({baseUrl:options.gitlabUrl,token,artifactRedirectOrigins:options.artifactRedirectOrigins});source=await collectGitLab(options,client);}
  source={...source,job:sanitizeDiagnosticValue(source.job),failedJobs:sanitizeDiagnosticValue(source.failedJobs||[])};
  const nativeJobs=source.nativeRunnerJobs||[];
  if(nativeJobs.length)source.log=nativeJobs.map(id=>'GITLAB API JOB '+id+' failure_reason=runner_system_failure').join('\n')+'\n'+source.log;
  const evidence=buildDiagnosisEvidence({log:source.log,job:source.job,artifacts:source.artifactMeta}),prior=classifyFailureDeterministically(evidence.log.text);
  const automaticRunner=Boolean(nativeJobs.length&&!options.deterministicOnly&&!(options.artifacts||[]).length&&!String(options.model||'').trim()&&(!options.modelSelectionStrategy||options.modelSelectionStrategy==='auto')&&!(options.modelCandidates||[]).length&&['infra','unknown'].includes(prior.classification));
  const deterministic=Boolean(options.deterministicOnly||automaticRunner);
  const prepared=prepareDiagnosticInput({evidence,deterministic:prior,changedPaths:source.changedPaths,artifactTexts:source.artifactTexts}),deliveredPrompt=deterministic?undefined:buildDiagnosisPrompt(prepared);
  const publicationTarget=options.publish?await resolvePublicationTarget(client,options.project,evidence.subject,source.mrIid):null;
  let diagnosis,model='',codexVersion='',usage={},durationMs=0,requestEstimate=null,modelEvidence=null,modelRoutingManaged=false,modelRegistryRevision='';
  if(deterministic){diagnosis=automaticRunner?nativeRunnerDiagnosis(nativeJobs,evidence):deterministicDiagnosis(prior,evidence);model='deterministic';}
  else{const result=await runCodexFn({...prepared,options});diagnosis=result.diagnosis;model=result.model;codexVersion=result.codexVersion;usage=result.usage;durationMs=result.durationMs;requestEstimate=result.requestEstimate;modelEvidence=result.modelEvidence||null;modelRoutingManaged=Boolean(result.modelRoutingManaged);modelRegistryRevision=result.modelRegistryRevision||'';}
  diagnosis=normalizeDiagnosisResult(sanitizeDiagnosticValue(diagnosis),evidence);
  model=cleanText(model,256);codexVersion=cleanText(codexVersion,256);usage=sanitizeDiagnosticValue(usage);requestEstimate=sanitizeDiagnosticValue(requestEstimate);modelEvidence=sanitizeDiagnosticValue(modelEvidence);modelRegistryRevision=cleanText(modelRegistryRevision,256);
  const inputManifest=buildDiagnosisInputManifest({...prepared,model,deliveredPrompt});
  const receipt=createDiagnosisReceipt({evidence,inputManifest,diagnosis,model,codexVersion}),markdown=formatDiagnosisMarkdown(diagnosis,evidence,receipt.createdAt);
  let publishedMr=0;if(publicationTarget){publishedMr=publicationTarget.iid;await client.upsertDiagnosisNote(options.project,publishedMr,markdown,{beforeWrite:()=>assertPublicationCurrent(client,publicationTarget),identityDigest:digest(JSON.stringify({subject:receipt.subject,inputManifestDigest:inputManifest.digest,diagnosis}))});}
  return Object.freeze({schemaVersion:2,diagnosis,receipt,evidence:{version:evidence.version,digest:evidence.digest,inputManifestDigest:inputManifest.digest,subject:evidence.subject,log:{digest:evidence.log.digest,originalLines:evidence.log.originalLines,includedLines:evidence.log.includedLines,bytes:evidence.log.bytes,truncated:evidence.log.truncated},artifacts:evidence.artifacts,changedPaths:Object.freeze(prepared.changedPaths),failedJobs:Object.freeze(source.failedJobs||[])},execution:{mode:deterministic?'deterministic':'codex',model,codexVersion,usage,durationMs,requestEstimate,modelRoutingContractVersion:deterministic?null:1,modelRoutingManaged,modelRegistryRevision,modelEvidence,inputManifest:{version:inputManifest.version,digest:inputManifest.digest,promptContractVersion:inputManifest.promptContractVersion,promptBound:inputManifest.promptBound,deliveredPromptDigest:inputManifest.deliveredPromptDigest,coverageGaps:prepared.coverageGaps}},publication:{mrIid:publishedMr||null},markdown});
}
module.exports={MAX_LOCAL_LOG_BYTES,MAX_FAILED_JOBS,readLocalLog,deterministicDiagnosis,collectArtifacts,collectGitLab,resolvePublishMr,runDiagnosis};
