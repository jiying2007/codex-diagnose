#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {parseArgs,usage}=require('./args');
const {runDiagnosis}=require('./diagnose');
const {notifyDiagnosis}=require('./notify');
const {version}=require('../package.json');
function writePrivate(file,text){const dir=path.dirname(file);if(!fs.existsSync(dir))throw Object.assign(new Error(`Output directory does not exist: ${dir}`),{code:'EOUTPUTPATH'});const temp=`${file}.tmp-${process.pid}`;fs.writeFileSync(temp,text,{encoding:'utf8',mode:0o600});fs.renameSync(temp,file);}
async function main(argv=process.argv.slice(2)){const options=parseArgs(argv);if(options.help){process.stdout.write(`${usage()}\n`);return 0;}if(options.version){process.stdout.write(`${version}\n`);return 0;}const result=await runDiagnosis(options);if(options.outputFile)writePrivate(options.outputFile,`${JSON.stringify(result,null,2)}\n`);else process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(options.markdownFile)writePrivate(options.markdownFile,`${result.markdown}\n`);if(options.notifyProvider)await notifyDiagnosis({provider:options.notifyProvider,webhookEnv:options.notifyWebhookEnv,diagnosis:result.diagnosis,evidence:result.evidence});return result.diagnosis.classification==='unknown'?2:0;}
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(error=>{const code=String(error?.code||'EDIAGNOSE'),message=String(error?.message||error);process.stderr.write(`codex-diagnose: ${code}: ${message}\n`);process.exitCode=1;});
module.exports={main,writePrivate};
