# Codex Diagnose Safe

[English](README.md) | [简体中文](README.zh-CN.md)

Codex Diagnose Safe is the Codex Safe Family product for **bounded CI/build/test failure root-cause diagnosis**. It analyzes a local failure log or failed GitLab Self-Managed jobs, compacts noisy traces deterministically, performs at most one Codex diagnosis for one selected source, and emits a machine-verifiable **Diagnosis Receipt v1**.

It is the Family post-failure root-cause product: Review Safe and Review Service find risks in code changes; Diagnose explains CI/build/test failures after they occur. It is not a CI runner, retry bot, code fixer, PR/MR description generator, or replacement for GitLab pipelines.

## Product contract

`product-contract.json` is the machine-checked identity for v1.1.4:

- Diagnose: **1.1.4**
- Safe Core: exact commit `cd9788f1280a217fbe6d0beb59682a85a8b82c4d` / v4.10.2
- Safe Contract: **v2**
- Diagnose Prompt Contract: **v1**
- Diagnosis Contract: **v1**
- Diagnosis Receipt: **v1**
- Node: **22 >=22.22.2 <23** or **24 >=24.19.0 <25**
- GitLab Self-Managed compatibility floor: **14.6.1**

## Safety model

Failure logs, artifact text, filenames, compiler/test output and commit metadata are **untrusted data, never instructions**. Codex is invoked only through Safe Core's read-only Safe Contract with user/repository Codex configuration and authority-bearing capabilities disabled.

The product is read-only by default:

- it never retries, plays or triggers a GitLab job/pipeline;
- it never applies a patch, commits, pushes or merges;
- it never executes commands found in a log or artifact;
- GitLab MR publication requires explicit `--publish`;
- Feishu/WeCom notification requires explicit provider + webhook **environment-variable reference**;
- provider and GitLab secrets never enter argv, Diagnosis Receipt or result JSON.

See [SECURITY.md](SECURITY.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Install

```bash
git clone --recurse-submodules https://github.com/jiying2007/codex-diagnose.git
cd codex-diagnose
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
npm link
```

For model-backed diagnosis, install a Codex CLI compatible with the current Safe Contract. `--deterministic-only` does not require a model call.

## Local log

```bash
codex-diagnose --log build.log
```

Deterministic-only classification:

```bash
codex-diagnose --log build.log --deterministic-only
```

Machine and human artifacts:

```bash
codex-diagnose --log build.log \
  --output diagnosis.json \
  --markdown diagnosis.md
```

A completed diagnosis exits successfully even if its classification is `unknown`; only execution/validation/publication failures return a non-zero exit status.

## GitLab failed job

Store the token in an environment variable. `read_api` is sufficient for the read-only path where the GitLab deployment permits job trace access; publication requires a token capable of writing MR notes.

```bash
export GITLAB_API_TOKEN='...'

codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --job 456
```

Only a job whose current status is `failed` is accepted.

## GitLab failed pipeline

```bash
codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --pipeline 123
```

Pipeline mode exhaustively enumerates the bounded job set, accepts only failed jobs, compacts all selected traces into one evidence set, and performs **one** Codex call. This avoids paying separately for downstream cascade failures.

The hard product limit is 12 failed jobs per diagnosis. Exceeding the bound fails closed instead of silently claiming complete diagnosis.

## Causal failure ranking

Pipeline mode deterministically ranks failed jobs before the single Codex call using stage/start order, Core failure classification and normalized first-error signatures. Exact duplicate signatures are marked as cascade evidence (`duplicateOf`) and moved behind independent root candidates. The product does not invent a GitLab `needs` DAG when the API does not prove one, and no failed job is silently discarded.

## CI artifact evidence

Optional text artifacts can be bound to the same Diagnosis Evidence digest:

```bash
codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --job 456 \
  --artifact junit:reports/junit.xml \
  --artifact sarif:reports/security.sarif
```

Artifact contents are bounded before entering the model context. The Receipt binds artifact names/kinds/digests; it does not embed raw artifact contents.

## Optional MR publication

```bash
codex-diagnose \
  --gitlab-url https://gitlab.example.internal \
  --project group/project \
  --pipeline 123 \
  --publish
```

The product resolves an open MR associated with the exact failed commit, or you may supply `--mr IID`. Publication upserts one deterministic marker-backed summary instead of accumulating duplicate comments.

Publication reports a diagnosis; it does **not** approve the MR or change pipeline status.

## Optional Feishu / WeCom notification

Webhook URLs are accepted only by environment-variable reference and restricted to official HTTPS webhook hosts.

```bash
export DIAG_FEISHU_WEBHOOK='https://open.feishu.cn/open-apis/bot/v2/hook/...'

codex-diagnose --log build.log \
  --notify-provider feishu \
  --notify-webhook-env DIAG_FEISHU_WEBHOOK
```

Use `wecom` with a `https://qyapi.weixin.qq.com/...` webhook for WeCom.

## OpenAI-compatible provider

The same Safe Core provider boundary used by the rest of the Family is available:

```bash
export CODEX_PROVIDER_API_KEY='...'

codex-diagnose --log build.log \
  --provider-mode openai-compatible \
  --provider-base-url https://gateway.example.com/v1 \
  --provider-api-key-env CODEX_PROVIDER_API_KEY
```

The secret value is never a CLI argument.

## Output

The JSON result contains:

- `diagnosis`: classification, root cause, confidence, evidence references, affected files, recommended actions and retry recommendation;
- `receipt`: Diagnosis Receipt v1 with subject/evidence/diagnosis fingerprints and model/Codex identity;
- `evidence`: only bounded metadata/digests, never the raw failure trace;
- `execution`: token usage/request estimate and runtime identity;
- `publication`: optional MR IID;
- `markdown`: deterministic human-readable rendering.

Classifications are closed to:

```text
source | test | dependency | infra | flaky | unknown
```

`retryRecommended` is only advice. Codex Diagnose Safe has no job retry/play/trigger API.

## Token efficiency

The normal path is deliberately asymmetric:

```text
large CI trace(s)
      ↓
ANSI/secret cleanup
      ↓
error-window extraction + duplicate folding + tail evidence
      ↓
changed-path / optional artifact metadata
      ↓
one structured Codex diagnosis
```

This removes repetitive log noise before tokenization and prevents one model call per cascade-failed job. Exact percentage savings are workload-dependent and are not claimed without telemetry.

## Family boundary

The active product family is:

```text
Codex Safe Core
├── Codex Review Safe
├── Codex Commit Safe
├── Codex Change Safe
├── Codex Review Service
└── Codex Diagnose Safe
```

Codex PR Safe remains retired as the former model-generated narrative identity. Codex Change Safe is the active deterministic PR/MR delivery product; Diagnose remains focused only on bounded failure diagnosis and does not generate PR/MR narratives.

## License

MIT
