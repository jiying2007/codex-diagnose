'use strict';

function apiError(message,status=0,body=''){const e=new Error(message);e.code=status?'EGITLABHTTP':'EGITLAB';e.status=status;e.responseBody=String(body||'').slice(0,2000);return e;}
function normalizeBaseUrl(value){let url;try{url=new URL(String(value||'').trim());}catch{throw apiError('GitLab base URL is invalid');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw apiError('GitLab base URL must be http(s) without credentials/query/fragment');return url.toString().replace(/\/$/,'');}
function projectPath(value){return encodeURIComponent(String(value));}
function artifactPath(value){return String(value).split('/').map(encodeURIComponent).join('/');}
function sizeError(maxBytes,status=0){return Object.assign(apiError(`GitLab response exceeds ${maxBytes} bytes`,status),{code:'EGITLABSIZE',maxBytes});}
function redirectError(message){return Object.assign(apiError(message),{code:'EGITLABREDIRECT'});}
async function fetchGitLab(url,options,{allowExternalRedirect=false}={}){
  let current=new URL(url),headers={...options.headers};
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
      // Signed artifact/CDN URLs are fetched anonymously. A later redirect back
      // to GitLab must not reintroduce a credential dropped at this boundary.
      headers={'User-Agent':headers['User-Agent']};
    }
    current=next;
  }
  throw redirectError('GitLab redirect did not terminate');
}
async function readBoundedResponse(response,maxBytes){const length=Number(response.headers?.get?.('content-length')||0);if(Number.isFinite(length)&&length>maxBytes)throw sizeError(maxBytes,response.status);if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const{done,value}=await reader.read();if(done)break;const chunk=Buffer.from(value);total+=chunk.length;if(total>maxBytes){try{await reader.cancel();}catch{}throw sizeError(maxBytes,response.status);}chunks.push(chunk);}}finally{try{reader.releaseLock();}catch{}}return Buffer.concat(chunks,total);}const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>maxBytes)throw sizeError(maxBytes,response.status);return buffer;}
class GitLabDiagnoseClient{
  constructor({baseUrl,token,timeoutMs=30000,maxPages=20,maxTraceBytes=8*1024*1024,maxArtifactBytes=4*1024*1024}={}){this.baseUrl=normalizeBaseUrl(baseUrl);this.apiUrl=`${this.baseUrl}/api/v4`;this.token=String(token||'').trim();if(!this.token)throw apiError('GitLab token is required');this.timeoutMs=timeoutMs;this.maxPages=maxPages;this.maxTraceBytes=maxTraceBytes;this.maxArtifactBytes=maxArtifactBytes;}
  async request(method,pathname,{query,body,expected=[200],accept='json',maxBytes=4*1024*1024,allowExternalRedirect=false}={}){const url=new URL(this.apiUrl+pathname);for(const[k,v]of Object.entries(query||{}))if(v!==undefined&&v!==null&&v!=='')url.searchParams.set(k,String(v));let response;try{response=await fetchGitLab(url,{method,headers:{'PRIVATE-TOKEN':this.token,'User-Agent':'codex-diagnose-safe/1.0.0',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(this.timeoutMs)},{allowExternalRedirect});}catch(cause){if(cause?.code==='EGITLABREDIRECT')throw cause;const e=apiError(`GitLab ${method} ${pathname} network failure`);e.code='EGITLABNETWORK';e.cause=cause;throw e;}const buffer=await readBoundedResponse(response,maxBytes),text=buffer.toString('utf8');if(!expected.includes(response.status))throw apiError(`GitLab ${method} ${pathname} failed with ${response.status}`,response.status,text);if(accept==='text')return{text,status:response.status,headers:response.headers};if(!text)return{data:null,status:response.status,headers:response.headers};try{return{data:JSON.parse(text),status:response.status,headers:response.headers};}catch(cause){const e=apiError(`GitLab ${method} ${pathname} returned invalid JSON`,response.status,text);e.code='EGITLABJSON';e.cause=cause;throw e;}}
  async paginated(pathname,query={}){const items=[];for(let page=1;page<=this.maxPages;page++){const r=await this.request('GET',pathname,{query:{...query,per_page:100,page},maxBytes:8*1024*1024});if(!Array.isArray(r.data))throw apiError('GitLab paginated response is not an array');items.push(...r.data);const next=String(r.headers.get('x-next-page')||'').trim();if(!next)return{items,complete:true};const n=Number(next);if(!Number.isInteger(n)||n<=page)throw apiError('GitLab pagination cursor is invalid');}return{items,complete:false};}
  async getPipeline(project,pipelineId){return(await this.request('GET',`/projects/${projectPath(project)}/pipelines/${pipelineId}`)).data;}
  async getJob(project,jobId){return(await this.request('GET',`/projects/${projectPath(project)}/jobs/${jobId}`)).data;}
  async listPipelineJobs(project,pipelineId){return this.paginated(`/projects/${projectPath(project)}/pipelines/${pipelineId}/jobs`,{include_retried:false});}
  async getTrace(project,jobId){return(await this.request('GET',`/projects/${projectPath(project)}/jobs/${jobId}/trace`,{accept:'text',maxBytes:this.maxTraceBytes})).text;}
  async getArtifactText(project,jobId,filePath,maxBytes=this.maxArtifactBytes){const r=await this.request('GET',`/projects/${projectPath(project)}/jobs/${jobId}/artifacts/${artifactPath(filePath)}`,{accept:'text',expected:[200,404],maxBytes,allowExternalRedirect:true});return r.status===404?null:r.text;}
  async changedPaths(project,sha){if(!sha)return[];const result=await this.paginated(`/projects/${projectPath(project)}/repository/commits/${encodeURIComponent(sha)}/diff`);return [...new Set(result.items.flatMap(item=>[item.new_path,item.old_path]).filter(Boolean).map(String))].slice(0,200);}
  async mergeRequestsForCommit(project,sha){if(!sha)return[];const r=await this.request('GET',`/projects/${projectPath(project)}/repository/commits/${encodeURIComponent(sha)}/merge_requests`,{expected:[200,404]});return r.status===404||!Array.isArray(r.data)?[]:r.data;}
  async listMergeRequestNotes(project,iid){return this.paginated(`/projects/${projectPath(project)}/merge_requests/${iid}/notes`,{sort:'asc'});}
  async upsertDiagnosisNote(project,iid,markdown){const marker='<!-- codex-diagnose-safe:summary -->',notes=await this.listMergeRequestNotes(project,iid);if(!notes.complete)throw apiError('Could not exhaustively scan MR notes before publication');const body=`${String(markdown).trim()}\n\n${marker}`,existing=notes.items.find(item=>typeof item.body==='string'&&item.body.includes(marker));if(existing)return(await this.request('PUT',`/projects/${projectPath(project)}/merge_requests/${iid}/notes/${existing.id}`,{body:{body}})).data;return(await this.request('POST',`/projects/${projectPath(project)}/merge_requests/${iid}/notes`,{body:{body},expected:[201]})).data;}
}
module.exports={GitLabDiagnoseClient,normalizeBaseUrl,projectPath,artifactPath,readBoundedResponse};
