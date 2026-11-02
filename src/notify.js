'use strict';

const { formatDisplayTime } = require('./codex-safe-core/display-time');

const HOSTS=Object.freeze({feishu:new Set(['open.feishu.cn']),wecom:new Set(['qyapi.weixin.qq.com'])});
const MAX_NOTIFY_RESPONSE_BYTES=64*1024;
function resolveWebhook(provider,envName,env=process.env){if(!HOSTS[provider])throw Object.assign(new Error('Unsupported notification provider'),{code:'ENOTIFYCONFIG'});const raw=String(env?.[envName]||'').trim();if(!raw)throw Object.assign(new Error(`Notification webhook environment variable ${envName} is missing`),{code:'ENOTIFYCONFIG'});let url;try{url=new URL(raw);}catch{throw Object.assign(new Error('Notification webhook is not a URL'),{code:'ENOTIFYCONFIG'});}if(url.protocol!=='https:'||url.username||url.password||!HOSTS[provider].has(url.hostname))throw Object.assign(new Error('Notification webhook host/protocol is not allowed'),{code:'ENOTIFYCONFIG'});return url.toString();}
function compactText(diagnosis,evidence,receipt={}){const job=evidence?.subject?.jobName||`job ${evidence?.subject?.jobId||''}`,time=typeof receipt?.createdAt==='string'?formatDisplayTime(receipt.createdAt):'';return [`Codex Diagnose Safe: ${diagnosis.classification}`,time?`Diagnosis time: ${time}`:'',job,diagnosis.rootCause,`Confidence: ${Math.round(diagnosis.confidence*100)}%`,`Retry: ${diagnosis.retryRecommended?'yes':'no'}`].filter(Boolean).join('\n').slice(0,3500);}
function notifySizeError(){return Object.assign(new Error(`Notification response exceeds ${MAX_NOTIFY_RESPONSE_BYTES} bytes`),{code:'ENOTIFYPROTOCOL'});}
async function readNotifyResponse(response){const declared=Number(response.headers?.get?.('content-length')||0);if(Number.isFinite(declared)&&declared>MAX_NOTIFY_RESPONSE_BYTES)throw notifySizeError();if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const{done,value}=await reader.read();if(done)break;const chunk=Buffer.from(value);total+=chunk.length;if(total>MAX_NOTIFY_RESPONSE_BYTES){try{await reader.cancel();}catch{}throw notifySizeError();}chunks.push(chunk);}}finally{try{reader.releaseLock();}catch{}}return Buffer.concat(chunks,total).toString('utf8');}const text=await response.text();if(Buffer.byteLength(text,'utf8')>MAX_NOTIFY_RESPONSE_BYTES)throw notifySizeError();return text;}
function requireNotificationAcknowledgment(provider, text) {
  let body;
  try { body = JSON.parse(text); }
  catch { throw Object.assign(new Error('Notification provider returned invalid JSON'), { code: 'ENOTIFYPROTOCOL' }); }
  const expected = provider === 'feishu' ? ['code', 'StatusCode'] : ['errcode'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || !expected.some(key => Object.hasOwn(body, key))) {
    throw Object.assign(new Error('Notification provider acknowledgment is missing'), { code: 'ENOTIFYPROTOCOL' });
  }
  const codes = ['code', 'StatusCode', 'errcode'].filter(key => Object.hasOwn(body, key)).map(key => body[key]);
  if (!codes.every(Number.isSafeInteger)) {
    throw Object.assign(new Error('Notification provider acknowledgment is malformed'), { code: 'ENOTIFYPROTOCOL' });
  }
  const rejected = codes.find(code => code !== 0);
  if (rejected !== undefined) {
    throw Object.assign(new Error(`Notification provider rejected the request (${rejected})`), { code: 'ENOTIFYREMOTE', providerCode: rejected });
  }
}
async function notifyDiagnosis({provider,webhookEnv,diagnosis,evidence,receipt,env=process.env,timeoutMs=10000}={}) {
  const url = resolveWebhook(provider, webhookEnv, env), text = compactText(diagnosis, evidence, receipt);
  const body = provider === 'feishu' ? { msg_type: 'text', content: { text } } : { msgtype: 'markdown', markdown: { content: text } };
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  } catch (cause) {
    throw Object.assign(new Error('Notification request failed'), { code: 'ENOTIFYNETWORK', cause });
  }
  const result = await readNotifyResponse(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Notification failed with HTTP ${response.status}`), { code: 'ENOTIFYHTTP', status: response.status, responseBody: result.slice(0, 2000) });
  }
  requireNotificationAcknowledgment(provider, result);
  return Object.freeze({ provider, status: response.status });
}
module.exports={resolveWebhook,compactText,notifyDiagnosis,readNotifyResponse,MAX_NOTIFY_RESPONSE_BYTES};
