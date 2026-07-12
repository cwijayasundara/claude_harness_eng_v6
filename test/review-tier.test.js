'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveReviewTier, DEFAULTS } = require('../.claude/scripts/review-tier');

function withManifest(review, quality, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-tier-'));
  const body = {
    quality: quality || { sensor_tier: 'standard' },
    review: review || {},
  };
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(body));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('defaults to standard below thresholds', () => {
  withManifest({}, { sensor_tier: 'standard' }, (dir) => {
    const r = resolveReviewTier({ projectDir: dir, files: 2, lines: 20 });
    assert.equal(r.mode, 'standard');
  });
});

test('auto adversarial when files >= min', () => {
  withManifest({}, { sensor_tier: 'standard' }, (dir) => {
    const r = resolveReviewTier({
      projectDir: dir,
      files: DEFAULTS.adversarial_min_files,
      lines: 1,
    });
    assert.equal(r.mode, 'adversarial');
    assert.ok(r.reasons.some((x) => /files/.test(x)));
  });
});

test('strict sensor_tier forces adversarial', () => {
  withManifest({}, { sensor_tier: 'strict' }, (dir) => {
    const r = resolveReviewTier({ projectDir: dir, files: 1, lines: 1 });
    assert.equal(r.mode, 'adversarial');
  });
});

test('security boundary forces adversarial', () => {
  withManifest({}, { sensor_tier: 'standard' }, (dir) => {
    const r = resolveReviewTier({
      projectDir: dir,
      files: 1,
      lines: 1,
      securityBoundary: true,
    });
    assert.equal(r.mode, 'adversarial');
  });
});

test('vibe lane stays standard under auto', () => {
  withManifest({ adversarial: 'auto' }, { sensor_tier: 'strict' }, (dir) => {
    const r = resolveReviewTier({
      projectDir: dir,
      files: 100,
      lines: 1000,
      vibeLane: true,
    });
    // strict would force adversarial, but vibe short-circuits only when auto
    // and before strict? Design: vibe always standard unless always.
    // Our resolveReviewTier checks vibe after never/always, before strict.
    assert.equal(r.mode, 'standard');
  });
});

test('review.adversarial=always forces adversarial even on vibe', () => {
  withManifest({ adversarial: 'always' }, { sensor_tier: 'standard' }, (dir) => {
    const r = resolveReviewTier({
      projectDir: dir,
      files: 1,
      lines: 1,
      vibeLane: true,
    });
    assert.equal(r.mode, 'adversarial');
  });
});

test('review.adversarial=never forces standard', () => {
  withManifest({ adversarial: 'never' }, { sensor_tier: 'strict' }, (dir) => {
    const r = resolveReviewTier({
      projectDir: dir,
      files: 100,
      lines: 1000,
      securityBoundary: true,
    });
    assert.equal(r.mode, 'standard');
  });
});
