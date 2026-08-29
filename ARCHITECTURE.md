# Architecture

Codex Diagnose Safe is a thin product layer over the exact-pinned Codex Safe Core. Product code owns local/GitLab evidence acquisition and optional publication; Core owns process/Codex safety, failure-log compaction, deterministic classification, diagnosis schema/normalization and Diagnosis Receipt validation.

```text
Local log ──────────────┐
                       │
GitLab failed job(s) ──┼─> product acquisition/bounds
                       │          │
optional text artifact ┘          v
                           Safe Core failure evidence
                           - secret/ANSI cleanup
                           - error-window compaction
                           - deterministic prior
                           - evidence digest
                                   │
                    deterministic-only OR one Safe Codex call
                                   │
                                   v
                           structured diagnosis
                                   │
                           Diagnosis Receipt v1
                                   │
                      ┌────────────┴────────────┐
                      v                         v
                  JSON/Markdown          explicit side effects
                                        - MR note upsert
                                        - Feishu/WeCom
```

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
