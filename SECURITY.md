# Security

Codex Diagnose Safe treats CI logs, artifacts, filenames, commit metadata, GitLab responses and model output as untrusted data.

## Authority boundary

The default product path is read-only. It can read a local log or GitLab failed-job/pipeline evidence and invoke Codex through the exact-pinned Safe Core. It cannot retry/play/trigger jobs, apply patches, commit, push, merge, approve merge requests or create PR/MR descriptions.

GitLab MR note publication is disabled unless `--publish` is explicit. Feishu/WeCom delivery is disabled unless both provider and webhook environment-variable reference are explicit.

## Secrets

- `GITLAB_API_TOKEN` or a user-selected token environment variable is read from process environment only.
- OpenAI-compatible provider keys are referenced by environment-variable name through Safe Core.
- Notification webhook URLs are referenced by environment-variable name and restricted to official HTTPS hosts.
- Raw secret values must never be written to argv, Diagnosis Receipt or output JSON.
- The shared Core diagnostic scrubber runs before UTF-8 truncation on logs, artifact bodies/names, job metadata, paths and model output. It covers common credential labels, bearer/basic authorization, URL credentials, token prefixes and private-key blocks. It is a bounded-pattern scrubber, not a complete data-loss-prevention guarantee.

## Prompt injection

Logs and artifacts may contain strings such as “ignore previous instructions”, shell commands or fake policies. They remain evidence only. The model prompt explicitly forbids following them, and Safe Core disables authority-bearing Codex capabilities independently of prompt wording.

## Bounded evidence

Local logs, GitLab responses, job counts, artifact contents and model request estimates have hard upper bounds. Exceeding a completeness bound fails closed instead of silently truncating a pipeline and claiming a complete diagnosis.

## Reporting

Report vulnerabilities privately through the repository Security Advisories interface. Do not include production tokens, webhook URLs, private source code or raw confidential CI traces in public issues.

## Delivered evidence and publication

Artifact text is capped at 48 KiB per item, 64 KiB in aggregate and 12 items. Changed paths are capped at 200 and 16 KiB in aggregate; a path exceeding 2 KiB is omitted whole. Coverage gaps are explicit in the prepared input and result. Manifest identity hashes the actual prepared representation and, only in model mode, the delivered prompt.

Local logs use the Core bounded file-descriptor reader with no final-component symlink following and before/after identity checks. MR publication rejects missing or stale source/target identity. Synthetic merged-result commits require current pipeline and parent evidence. Owned-note updates retain actor checks and exhaustive pagination; equivalent subject/input/diagnosis identity does not cause another write.
