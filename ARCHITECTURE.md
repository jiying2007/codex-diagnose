# Architecture

Codex Diagnose Safe is a thin product layer over the exact-pinned Codex Safe Core. Product code owns local/GitLab evidence acquisition and optional publication; Core owns process/Codex safety, failure-log compaction, deterministic classification, diagnosis schema/normalization and Diagnosis Receipt validation.

Acquisition reads bounded local files or GitLab responses. One shared scrubber handles log text, artifacts, filenames, job metadata and model output. The product then prepares an explicit UTF-8 byte-limited input, records omissions, and either classifies it deterministically or sends one read-only Codex request.

The Diagnosis Input Manifest binds the exact prepared path/artifact representation. Model mode additionally hashes the exact delivered prompt; deterministic mode records `promptBound: false` and does not claim a model execution. Diagnosis Receipt v2 binds that input identity to the normalized result. JSON/Markdown are returned locally; optional MR publication and notifications use the same sanitized result.

## Pipeline aggregation

Pipeline mode enumerates jobs through GitLab API pagination and requires a complete bounded job set. Only `failed` jobs enter diagnosis. A pipeline with more than 12 failed jobs is rejected rather than silently sampled. Selected traces are combined before Core compaction, so downstream cascade failures share one evidence digest and one model request.

## Evidence identity

Diagnosis Evidence binds:

- project ID where numeric;
- pipeline ID;
- job ID for single-job mode, or aggregate job identity for pipeline mode;
- exact commit SHA;
- redacted source-log digest and compact-log metadata;
- optional artifact kind/name/content digest.

Raw logs and artifact bodies are not embedded in the returned Receipt or result JSON.

## Deterministic vs model responsibilities

Deterministic code owns acquisition bounds, secret redaction, log selection, failure classification prior, structured-output validation, receipt fingerprints, publication target resolution and webhook host validation.

Codex is used only for root-cause synthesis over supplied bounded evidence. Model text cannot cause GitLab retries, execute a command or authorize a side effect.

## GitLab compatibility

The initial product uses GitLab REST API v4 endpoints available across the declared Self-Managed compatibility floor for pipelines, jobs, traces, artifacts, commit diffs and MR notes. GitLab-specific API behavior stays product-owned and is not moved into Safe Core.

## Family ownership

Safe Core owns generic diagnosis primitives. Codex Diagnose Safe owns `diagnose-domain` and `ci-failure-evidence-acquisition`. Review Service remains the owner of durable GitLab MR review operations and Analyzer Adapter Hub. No duplicate Review Service, notification outbox or database is introduced here.

## Deterministic causal ranking

Multi-job pipeline diagnosis ranks evidence using only provider-proven metadata and normalized error signatures. Duplicate signatures may be marked as cascade evidence; no unproven dependency edge is invented. The ranking remains read-only and feeds the existing single bounded Codex diagnosis.

## Publication freshness and idempotency

Publication resolves the full commit-to-MR association before model execution. An automatic selection requires one open MR; `--mr` selects explicitly but does not waive association or current-head checks. Complete diff refs, source/target projects and branches are bound to the initial snapshot. A merged-results commit additionally needs the current `head_pipeline` identity and commit-parent evidence containing the current source head.

Immediately after exhaustive owned-note discovery and before a write, the product re-fetches the MR and rejects state/head/branch/project drift. Only the authenticated actor's unique summary can be updated. The stable subject/input/diagnosis identity makes equivalent output a no-op even when its display timestamp changes. GitLab's note write has no conditional-head argument; the final read narrows the remote read/write interval and does not claim server-atomic publication.
