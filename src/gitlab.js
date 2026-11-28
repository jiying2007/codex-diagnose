'use strict';

function apiError(message,status=0,body=''){const e=new Error(message);e.code=status?'EGITLABHTTP':'EGITLAB';e.status=status;e.responseBody=String(body||'').slice(0,2000);return e;}
function normalizeBaseUrl(value){let url;try{url=new URL(String(value||'').trim());}catch{throw apiError('GitLab base URL is invalid');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw apiError('GitLab base URL must be http(s) without credentials/query/fragment');return url.toString().replace(/\/$/,'');}
function projectPath(value){return encodeURIComponent(String(value));}
function artifactPath(value){return String(value).split('/').map(encodeURIComponent).join('/');}
function sizeError(maxBytes,status=0){return Object.assign(apiError(`GitLab response exceeds ${maxBytes} bytes`,status),{code:'EGITLABSIZE',maxBytes});}
function redirectError(message){return Object.assign(apiError(message),{code:'EGITLABREDIRECT'});}
function normalizeArtifactRedirectOrigin(value){
  const raw=String(value??'').trim();
  let url;try{url=new URL(raw);}catch{throw redirectError('Artifact redirect origin is invalid');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.hostname.includes('*')||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/[\\\s\u0000-\u001f\u007f]/.test(raw))throw redirectError('Artifact redirect allowlist entries must be exact HTTP(S) origins without path, query, fragment, credentials or wildcard');
  return url.origin;
}
async function fetchGitLab(url,options,{allowExternalRedirect=false,artifactRedirectOrigins=[]}={}){
  let current=new URL(url),headers={...options.headers};
  const initialOrigin=current.origin,approved=new Set(artifactRedirectOrigins);
  for(let redirects=0;redirects<=5;redirects++){
    const response=await fetch(current,{...options,headers,redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))return response;
    await response.body?.cancel?.();
    if(redirects===5)throw redirectError('GitLab response exceeded the redirect limit');
    if(options.method!=='GET')throw redirectError('GitLab writes must not be redirected');
    const location=response.headers?.get?.('location');
    if(!location)throw redirectError('GitLab redirect has no Location');
    let next;try{next=new URL(location,current);}catch{throw redirectError('GitLab redirect URL is invalid');}
    if(!['http:','https:'].includes(next.protocol)||next.username||next.password||next.hash)throw redirectError('GitLab redirect URL is unsafe');
    if(current.protocol==='https:'&&next.protocol!=='https:')throw redirectError('GitLab redirect must not downgrade HTTPS');
    if(next.origin!==current.origin){
      if(!allowExternalRedirect)throw redirectError('GitLab API redirect must remain on the configured origin');
      if(next.origin!==initialOrigin&&!approved.has(next.origin))throw redirectError('Artifact redirect destination is not an explicitly approved origin');
      // Signed artifact/CDN URLs are fetched anonymously. A later redirect back
      // to GitLab must not reintroduce a credential dropped at this boundary.
      headers={'User-Agent':headers['User-Agent']};
    }
    current=next;
  }
  throw redirectError('GitLab redirect did not terminate');
}
function requireByteLimit(maxBytes){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw Object.assign(apiError('GitLab response byte limit must be a non-negative safe integer'),{code:'EGITLABLIMIT'});
}
async function readBoundedResponse(response,maxBytes){
  requireByteLimit(maxBytes);
  const declared=Number(response.headers?.get?.('content-length')||0);
  if(declared>maxBytes){
    try{await response.body?.cancel?.();}catch{}
    throw sizeError(maxBytes,response.status);
  }
  // Native Fetch returns a ReadableStream or null. Never buffer an unknown
  // transport with arrayBuffer(): the byte cap must apply before allocation.
  if(response.body===null)return Buffer.alloc(0);
  if(typeof response.body?.getReader!=='function')throw Object.assign(apiError('GitLab response body is not a readable stream',response.status),{code:'EGITLABBODY'});
  const reader=response.body.getReader(),chunks=[];
  let total=0,completed=false;
  try{
    while(true){
      const{done,value}=await reader.read();
      if(done){completed=true;break;}
      if(value.byteLength>maxBytes-total)throw sizeError(maxBytes,response.status);
      const chunk=Buffer.from(value);
      total+=chunk.length;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks,total);
  }finally{
    if(!completed){try{await reader.cancel();}catch{}}
    try{reader.releaseLock();}catch{}
  }
}
class GitLabDiagnoseClient{
  constructor({baseUrl,token,timeoutMs=30000,maxPages=20,maxTraceBytes=8*1024*1024,maxArtifactBytes=4*1024*1024,artifactRedirectOrigins=[]}={}){this.baseUrl=normalizeBaseUrl(baseUrl);this.apiUrl=`${this.baseUrl}/api/v4`;this.token=String(token||'').trim();if(!this.token)throw apiError('GitLab token is required');this.timeoutMs=timeoutMs;this.maxPages=maxPages;this.maxTraceBytes=maxTraceBytes;this.maxArtifactBytes=maxArtifactBytes;if(!Array.isArray(artifactRedirectOrigins)||artifactRedirectOrigins.length>8)throw redirectError('At most eight exact artifact redirect origins may be configured');this.artifactRedirectOrigins=Object.freeze([...new Set(artifactRedirectOrigins.map(normalizeArtifactRedirectOrigin))]);}
  async request(method,pathname,{query,body,expected=[200],accept='json',maxBytes=4*1024*1024,allowExternalRedirect=false}={}){requireByteLimit(maxBytes);const url=new URL(this.apiUrl+pathname);for(const[k,v]of Object.entries(query||{}))if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v));let response;try{response=await fetchGitLab(url,{method,headers:{'PRIVATE-TOKEN':this.token,'User-Agent':'codex-diagnose-safe/1.0.0',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(this.timeoutMs)},{allowExternalRedirect,artifactRedirectOrigins:this.artifactRedirectOrigins});}catch(cause){if(cause?.code==='EGITLABREDIRECT')throw cause;const e=apiError(`GitLab ${method} ${pathname} network failure`);e.code='EGITLABNETWORK';e.cause=cause;throw e;}const buffer=await readBoundedResponse(response,maxBytes),text=buffer.toString('utf8');if(!expected.includes(response.status))throw apiError(`GitLab ${method} ${pathname} failed with ${response.status}`,response.status,text);if(accept==='text')return{text,status:response.status,headers:response.headers};if(!text)return{data:null,status:response.status,headers:response.headers};try{return{data:JSON.parse(text),status:response.status,headers:response.headers};}catch(cause){const e=apiError(`GitLab ${method} ${pathname} returned invalid JSON`,response.status,text);e.code='EGITLABJSON';e.cause=cause;throw e;}}
  async paginated(pathname,query={}){
    const fail=message=>Object.assign(apiError(message),{code:'EGITLABPAGINATION'});
    const limit=this.maxPages,perPage=100,items=[];
    if(!Number.isSafeInteger(limit)||limit<1)throw fail('GitLab pagination page limit is invalid');
    for(let page=1;page<=limit;page++){
      const r=await this.request('GET',pathname,{query:{...query,per_page:perPage,page},maxBytes:8*1024*1024});
      if(!Array.isArray(r.data)||r.data.length>perPage)throw fail('GitLab paginated response is not a bounded array');
      const observed=r.headers.get('x-page');
      if(observed!==null&&String(observed).trim()!==String(page))throw fail('GitLab pagination response does not identify the requested page');
      items.push(...r.data);
      const next=r.headers.get('x-next-page');
      // A full page without pagination metadata is not proof of exhaustion.
      if(next===null)return{items,complete:r.data.length<perPage};
      const cursor=String(next).trim();
      if(!cursor)return{items,complete:true};
      // Offset pagination must be contiguous. Never silently ignore a jump,
      // loop, or malformed cursor when callers rely on complete enumeration.
      if(cursor!==String(page+1))throw fail('GitLab pagination cursor is not the next contiguous page');
    }
    return{items,complete:false};
  }
  async getProject(project){return(await this.request('GET',`/projects/${projectPath(project)}`)).data;}
  async getPipeline(project,pipelineId){return(await this.request('GET',`/projects/${projectPath(project)}/pipelines/${pipelineId}`)).data;}
  async getJob(project,jobId){return(await this.request('GET',`/projects/${projectPath(project)}/jobs/${jobId}`)).data;}
  async listPipelineJobs(project,pipelineId){return this.paginated(`/projects/${projectPath(project)}/pipelines/${pipelineId}/jobs`,{include_retried:false});}
  async getTrace(project,jobId){return(await this.request('GET',`/projects/${projectPath(project)}/jobs/${jobId}/trace`,{accept:'text',maxBytes:this.maxTraceBytes})).text;}
  async getArtifactText(project,jobId,filePath,maxBytes=this.maxArtifactBytes){const r=await this.request('GET',`/projects/${projectPath(project)}/jobs/${jobId}/artifacts/${artifactPath(filePath)}`,{accept:'text',expected:[200,404],maxBytes,allowExternalRedirect:true});return r.status===404?null:r.text;}
  async changedPaths(project,sha){if(!sha)return[];const result=await this.paginated(`/projects/${projectPath(project)}/repository/commits/${encodeURIComponent(sha)}/diff`);if(!result.complete)throw Object.assign(apiError('Commit changed-path enumeration is incomplete'),{code:'EGITLABPAGINATION'});return [...new Set(result.items.flatMap(item=>[item.new_path,item.old_path]).filter(Boolean).map(String))];}
  async mergeRequestsForCommit(project,sha){if(!sha)return[];const result=await this.paginated(`/projects/${projectPath(project)}/repository/commits/${encodeURIComponent(sha)}/merge_requests`);if(!result.complete)throw apiError('Could not exhaustively resolve merge requests for the failed commit');return result.items;}
  async getCommit(project,sha){return(await this.request('GET',`/projects/${projectPath(project)}/repository/commits/${encodeURIComponent(sha)}`)).data;}
  async getMergeRequest(project,iid){return(await this.request('GET',`/projects/${projectPath(project)}/merge_requests/${iid}`)).data;}
  async listMergeRequestNotes(project,iid){return this.paginated(`/projects/${projectPath(project)}/merge_requests/${iid}/notes`,{sort:'asc'});}
  async upsertDiagnosisNote(project,iid,markdown,{beforeWrite,identityDigest}={}){const marker='<!-- codex-diagnose-safe:summary -->',me=(await this.request('GET','/user',{maxBytes:8192})).data,actorId=Number(me?.id);if(!Number.isSafeInteger(actorId)||actorId<=0)throw apiError('Authenticated GitLab actor identity is unavailable; refusing publication');const notes=await this.listMergeRequestNotes(project,iid);if(!notes.complete)throw apiError('Could not exhaustively scan MR notes before publication');if(identityDigest!==undefined&&!/^[0-9a-f]{64}$/.test(identityDigest))throw apiError('Diagnosis publication identity must be a SHA-256 digest');const identityMarker=identityDigest?`<!-- codex-diagnose-safe:identity:${identityDigest} -->`:'',body=`${String(markdown).trim()}\n\n${marker}${identityMarker?'\n'+identityMarker:''}`,owned=notes.items.filter(item=>typeof item.body==='string'&&item.body.includes(marker)&&Number(item.author?.id)===actorId);if(owned.length>1)throw apiError('Multiple bot-owned diagnosis notes require reconciliation before publication');const existing=owned[0];if(beforeWrite)await beforeWrite();if(existing&&(existing.body===body||(identityMarker&&existing.body.includes(identityMarker))))return existing;if(existing)return(await this.request('PUT',`/projects/${projectPath(project)}/merge_requests/${iid}/notes/${existing.id}`,{body:{body}})).data;return(await this.request('POST',`/projects/${projectPath(project)}/merge_requests/${iid}/notes`,{body:{body},expected:[201]})).data;}
}
module.exports={GitLabDiagnoseClient,normalizeBaseUrl,normalizeArtifactRedirectOrigin,projectPath,artifactPath,readBoundedResponse};
