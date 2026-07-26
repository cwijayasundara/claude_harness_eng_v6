'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const {
  SUBJECTS, certify, verifyCertification,
} = require('../.claude/scripts/security-certification');

const REPO = path.resolve(__dirname, '..');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-certification-'));
  for (const rel of SUBJECTS) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), target);
  }
  for (const rel of [
    '.claude/config/security-certification-profiles.json',
    '.claude/templates/unattended-policy.template.json',
  ]) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), target);
  }
  fs.copyFileSync(
    path.join(root, '.claude', 'templates', 'unattended-policy.template.json'),
    path.join(root, '.claude', 'unattended-policy.json'),
  );
  return root;
}

test('unattended-core attack corpus passes and produces a current integrity-bound artifact', () => {
  const root = fixture();
  const now = new Date('2026-07-26T12:00:00Z');
  const output = certify(root, 'unattended-core', now);
  assert.strictEqual(output.result.pass, true);
  assert.ok(output.result.cases.length >= 12);
  assert.strictEqual(verifyCertification(root, 'unattended-core', new Date('2026-07-26T12:10:00Z')).pass, true);
});

test('certification fails after result corruption, policy drift, subject drift, or expiry', () => {
  const variants = [
    (root) => {
      const file = path.join(root, '.claude', 'certification', 'security-boundary.json');
      const result = JSON.parse(fs.readFileSync(file, 'utf8'));
      result.cases[0].actual = 'allowed';
      fs.writeFileSync(file, JSON.stringify(result));
    },
    (root) => {
      const file = path.join(root, '.claude', 'unattended-policy.json');
      const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
      policy.network.allowed_domains.push('changed.example');
      fs.writeFileSync(file, JSON.stringify(policy));
    },
    (root) => fs.appendFileSync(path.join(root, SUBJECTS[0]), '\n// drift\n'),
  ];
  for (const mutate of variants) {
    const root = fixture();
    certify(root, 'unattended-core', new Date('2026-07-26T12:00:00Z'));
    mutate(root);
    assert.strictEqual(
      verifyCertification(root, 'unattended-core', new Date('2026-07-26T12:10:00Z')).pass,
      false,
    );
  }
  const root = fixture();
  certify(root, 'unattended-core', new Date('2026-07-26T12:00:00Z'));
  assert.ok(verifyCertification(root, 'unattended-core', new Date('2026-07-28T12:00:00Z')).failures.includes('certification-expired'));
});

test('certification fails closed on malformed result fields', () => {
  const root = fixture();
  certify(root, 'unattended-core', new Date('2026-07-26T12:00:00Z'));
  const file = path.join(root, '.claude', 'certification', 'security-boundary.json');
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete result.cases;
  delete result.subjects;
  result.expires_at = 'not-a-date';
  fs.writeFileSync(file, JSON.stringify(result));
  const verification = verifyCertification(root, 'unattended-core', new Date('2026-07-26T12:10:00Z'));
  assert.strictEqual(verification.pass, false);
  assert.ok(verification.failures.includes('attack-case-failed'));
  assert.ok(verification.failures.includes('certification-expired'));
});
