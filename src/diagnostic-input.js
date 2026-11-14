'use strict';

const crypto = require('node:crypto');
const { redactDiagnosticText, boundUtf8Text } = require('./codex-safe-core/diagnosis-platform');

const MAX_ARTIFACT_BYTES = 48 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 64 * 1024;
const MAX_PATH_BYTES = 16 * 1024;
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanText = (value, bytes) => boundUtf8Text(redactDiagnosticText(value), bytes);

function sanitizeDiagnosticValue(value) {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    // Probe only the field label: JSON-escaping user text can turn newlines into
    // literal backslashes and make an already-scrubbed value match differently.
    const cleaned = sanitizeDiagnosticValue(item);
    const labeled = `${key}: "diagnostic-field-probe"`;
    const secretField = typeof item === 'string' && redactDiagnosticText(labeled) !== labeled;
    return [redactDiagnosticText(key), secretField ? '[REDACTED]' : cleaned];
  }));
  return value;
}

function prepareDiagnosticInput({ evidence, deterministic, changedPaths = [], artifactTexts = [], coverageGaps: existingGaps = [] } = {}) {
  const coverageGaps = existingGaps.map(value => cleanText(value, 128));
  let remaining = MAX_TOTAL_ARTIFACT_BYTES;
  const artifacts = [];
  if (artifactTexts.length > 12) coverageGaps.push('artifact_count_limit');
  for (const item of artifactTexts.slice(0, 12)) {
    const original = redactDiagnosticText(item.text || '');
    const text = boundUtf8Text(original, Math.min(MAX_ARTIFACT_BYTES, remaining));
    if (Buffer.byteLength(original) > Buffer.byteLength(text)) coverageGaps.push(`artifact_truncated:${artifacts.length}`);
    if (!text && original) continue;
    remaining -= Buffer.byteLength(text);
    artifacts.push(Object.freeze({ kind: cleanText(item.kind, 64), name: cleanText(item.name, 256), text, digest: digest(text) }));
  }
  let pathBytes = 0;
  const paths = [];
  for (const value of changedPaths.slice(0, 200)) {
    const path = redactDiagnosticText(value);
    const bytes = Buffer.byteLength(path);
    if (bytes > 2048) { coverageGaps.push('changed_path_size_limit'); continue; }
    if (pathBytes + bytes > MAX_PATH_BYTES) { coverageGaps.push('changed_paths_byte_limit'); break; }
    pathBytes += bytes;
    paths.push(path);
  }
  if (changedPaths.length > 200) coverageGaps.push('changed_paths_count_limit');
  return Object.freeze({ evidence: sanitizeDiagnosticValue(evidence), deterministic: sanitizeDiagnosticValue(deterministic), changedPaths: Object.freeze(paths), artifactTexts: Object.freeze(artifacts), coverageGaps: Object.freeze([...new Set(coverageGaps)]) });
}

module.exports = { MAX_ARTIFACT_BYTES, MAX_TOTAL_ARTIFACT_BYTES, MAX_PATH_BYTES, cleanText, digest, sanitizeDiagnosticValue, prepareDiagnosticInput };
