'use strict';

const path=require('node:path');
const PROVIDERS=new Set(['openai','openai-compatible']);
const CREDENTIAL_SOURCES=new Set(['auto','env','auth-json']);
const NOTIFY_PROVIDERS=new Set(['feishu','wecom']);
function error(message){const e=new Error(message);e.code='EARGS';return e;}
function integer(value,name,min,max){if(!/^\d+$/.test(String(value||'')))throw error(`${name} must be an integer`);const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw error(`${name} must be between ${min} and ${max}`);return n;}
function cleanString(value,name,max=2048){const text=String(value||'').trim();if(!text||text.length>max||/[\r\n\0]/.test(text))throw error(`${name} is invalid`);return text;}
function envName(value,name){const text=cleanString(value,name,128);if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text))throw error(`${name} must be an environment variable name`);return text;}
function artifactSpec(value){const raw=cleanString(value,'--artifact',1024),i=raw.indexOf(':');if(i<=0)throw error('--artifact must be kind:repository/path');const kind=raw.slice(0,i).toLowerCase(),file=raw.slice(i+1).replace(/\\/g,'/').replace(/^\.\//,'');if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(kind)||!file||file.startsWith('/')||file.split('/').includes('..'))throw error('--artifact is invalid');return Object.freeze({kind,path:file});}
function usage(){return `Codex Diagnose Safe 1.3.1\n\nUsage:\n  codex-diagnose --log build.log [options]\n  codex-diagnose --gitlab-url https://gitlab.example --project group/project --pipeline 123 [options]\n  codex-diagnose --gitlab-url https://gitlab.example --project 7 --job 456 [options]\n\nOptions:\n  --deterministic-only         Skip Codex and emit deterministic classification only\n  --artifact kind:path         Add a text CI artifact from the selected GitLab job(s)\n  --output FILE                Write machine JSON result\n  --markdown FILE              Write deterministic Markdown summary\n  --publish                    Upsert the diagnosis on the related/provided MR\n  --mr IID                     Explicit merge request IID for --publish\n  --notify-provider feishu|wecom\n  --notify-webhook-env ENV     Webhook URL environment variable (never pass secret URLs directly)\n  --codex PATH                 Codex executable (default: codex)\n  --model NAME                 Explicit Codex model\n  --max-estimated-tokens N     Preflight request ceiling (default: 50000)\n  --provider-mode openai|openai-compatible\n  --provider-base-url URL      Required only for openai-compatible\n  --provider-api-key-env ENV   Credential env reference only\n  --provider-credential-source auto|env|auth-json\n  --provider-allow-insecure-http  Explicitly allow trusted non-loopback HTTP relay\n  --gitlab-token-env ENV       GitLab token env reference (default: GITLAB_API_TOKEN)\n  --help\n  --version`;
}
function parseArgs(argv=process.argv.slice(2)){
  const out={help:false,version:false,logFile:'',gitlabUrl:'',project:'',pipelineId:0,jobId:0,mrIid:0,gitlabTokenEnv:'GITLAB_API_TOKEN',codexPath:'codex',model:'',outputFile:'',markdownFile:'',deterministicOnly:false,maxEstimatedTokens:50000,providerMode:'openai',providerBaseUrl:'',providerApiKeyEnv:'OPENAI_API_KEY',providerCredentialSource:'auto',providerAllowInsecureHttp:false,artifacts:[],publish:false,notifyProvider:'',notifyWebhookEnv:''};
  const take=(i,name)=>{if(i+1>=argv.length)throw error(`${name} requires a value`);return argv[i+1];};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--help'||a==='-h')out.help=true;
    else if(a==='--version'||a==='-v')out.version=true;
    else if(a==='--deterministic-only')out.deterministicOnly=true;
    else if(a==='--publish')out.publish=true;
    else if(a==='--log'){out.logFile=cleanString(take(i,a),a);i++;}
    else if(a==='--gitlab-url'){out.gitlabUrl=cleanString(take(i,a),a);i++;}
    else if(a==='--project'){out.project=cleanString(take(i,a),a);i++;}
    else if(a==='--pipeline'){out.pipelineId=integer(take(i,a),a,1,Number.MAX_SAFE_INTEGER);i++;}
    else if(a==='--job'){out.jobId=integer(take(i,a),a,1,Number.MAX_SAFE_INTEGER);i++;}
    else if(a==='--mr'){out.mrIid=integer(take(i,a),a,1,Number.MAX_SAFE_INTEGER);i++;}
    else if(a==='--gitlab-token-env'){out.gitlabTokenEnv=envName(take(i,a),a);i++;}
    else if(a==='--codex'){out.codexPath=cleanString(take(i,a),a,1024);i++;}
    else if(a==='--model'){out.model=cleanString(take(i,a),a,128);i++;}
    else if(a==='--output'){out.outputFile=cleanString(take(i,a),a);i++;}
    else if(a==='--markdown'){out.markdownFile=cleanString(take(i,a),a);i++;}
    else if(a==='--max-estimated-tokens'){out.maxEstimatedTokens=integer(take(i,a),a,1024,1000000);i++;}
    else if(a==='--provider-mode'){out.providerMode=cleanString(take(i,a),a,64);if(!PROVIDERS.has(out.providerMode))throw error('--provider-mode is unsupported');i++;}
    else if(a==='--provider-base-url'){out.providerBaseUrl=cleanString(take(i,a),a);i++;}
    else if(a==='--provider-api-key-env'){out.providerApiKeyEnv=envName(take(i,a),a);i++;}
    else if(a==='--provider-credential-source'){out.providerCredentialSource=cleanString(take(i,a),a,32);if(!CREDENTIAL_SOURCES.has(out.providerCredentialSource))throw error('--provider-credential-source is unsupported');i++;}
    else if(a==='--provider-allow-insecure-http')out.providerAllowInsecureHttp=true;
    else if(a==='--artifact'){out.artifacts.push(artifactSpec(take(i,a)));i++;}
    else if(a==='--notify-provider'){out.notifyProvider=cleanString(take(i,a),a,32);if(!NOTIFY_PROVIDERS.has(out.notifyProvider))throw error('--notify-provider is unsupported');i++;}
    else if(a==='--notify-webhook-env'){out.notifyWebhookEnv=envName(take(i,a),a);i++;}
    else throw error(`Unknown argument: ${a}`);
  }
  if(out.help||out.version)return Object.freeze(out);
  const local=Boolean(out.logFile),remote=Boolean(out.gitlabUrl||out.project||out.pipelineId||out.jobId);
  if(local===remote)throw error('Select exactly one source: --log or GitLab --pipeline/--job');
  if(remote){if(!out.gitlabUrl||!out.project)throw error('GitLab mode requires --gitlab-url and --project');if(Boolean(out.pipelineId)===Boolean(out.jobId))throw error('GitLab mode requires exactly one of --pipeline or --job');}
  if(local&&(out.publish||out.mrIid||out.artifacts.length))throw error('--publish/--mr/--artifact require GitLab mode');
  if(out.publish&&!remote)throw error('--publish requires GitLab mode');
  if(Boolean(out.notifyProvider)!==Boolean(out.notifyWebhookEnv))throw error('--notify-provider and --notify-webhook-env must be used together');
  if(out.providerMode==='openai-compatible'){if(!out.providerBaseUrl)throw error('--provider-base-url is required for openai-compatible');if(out.providerApiKeyEnv==='OPENAI_API_KEY')out.providerApiKeyEnv='CODEX_PROVIDER_API_KEY';}
  else {if(out.providerBaseUrl)throw error('--provider-base-url is only valid for openai-compatible');if(out.providerCredentialSource!=='auto'||out.providerAllowInsecureHttp)throw error('--provider-credential-source/--provider-allow-insecure-http require openai-compatible');}
  for(const key of ['outputFile','markdownFile'])if(out[key])out[key]=path.resolve(out[key]);
  return Object.freeze({...out,artifacts:Object.freeze(out.artifacts)});
}
module.exports={parseArgs,usage,artifactSpec};
