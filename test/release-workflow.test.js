'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release verification is bounded, retrying, and fail-closed', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /verified=false/);
  assert.match(workflow, /for attempt in \{1\.\.12\}; do/);
  assert.match(workflow, /if gh release verify \"\$RELEASE_TAG\"; then/);
  assert.match(workflow, /sleep 5/);
  assert.match(workflow, /test \"\$verified\" = true/);
  assert.match(workflow, /gh release verify-asset \"\$RELEASE_TAG\" \"\$tgz\"/);
});
