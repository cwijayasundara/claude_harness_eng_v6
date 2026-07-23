'use strict';

// Sprint-contract pre-commit gate. PLANNING pack: a sprint contract only exists in a
// project running the /brd -> /spec -> /design -> /auto pipeline. Split out of
// gates-quality (kernel) so the kernel commit gate does not require contract-schema.

const fs = require('fs');
const path = require('path');
const { validate: validateSchema } = require('./contract-schema');
const { failBlock, noteSkip, requireScript } = require('./pre-commit-util');

function validateContractShape(projectDir, group) {
  const schemaPath = path.join(projectDir, '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json');
  if (!fs.existsSync(schemaPath)) return;
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(path.join(projectDir, 'sprint-contracts', `${group}.json`), 'utf8'));
  } catch (_) {
    failBlock({
      id: 'sprint-contract',
      title: `sprint-contracts/${group}.json is not valid JSON`,
      fix: `re-negotiate the contract (node .claude/scripts/validate-contract.js sprint-contracts/${group}.json to check).`,
      minTier: 'minimal',
    });
  }
  const errors = validateSchema(JSON.parse(fs.readFileSync(schemaPath, 'utf8')), contract);
  if (errors.length > 0) {
    failBlock({
      id: 'sprint-contract',
      title: `sprint-contracts/${group}.json fails schema validation`,
      detail: `${errors.map((e) => `  - ${e}`).join('\n')}\n`,
      fix: `correct the contract (node .claude/scripts/validate-contract.js sprint-contracts/${group}.json).`,
      minTier: 'minimal',
    });
  }
}

function checkSecurityVerdict(projectDir, group) {
  let verdict = null;
  try {
    verdict = JSON.parse(fs.readFileSync(path.join(projectDir, 'specs', 'reviews', 'security-verdict.json'), 'utf8'));
  } catch (_) {
    /* missing or unparseable = not PASS */
  }
  const passed = verdict && (verdict.pass === true || verdict.verdict === 'PASS');
  if (!passed) {
    failBlock({
      id: 'sprint-contract',
      title: `security gate for group ${group} not satisfied — specs/reviews/security-verdict.json is missing or not PASS`,
      fix: 'run /evaluate (its security layer writes the verdict), address findings, then retry the commit.',
      minTier: 'minimal',
    });
  }
}

function checkVerificationMatrix(projectDir, group) {
  if (!fs.existsSync(path.join(projectDir, 'specs', 'test_artefacts', 'verification-matrix.json'))) return;
  let runGate;
  try {
    ({ runGate } = requireScript('verification-matrix-gate'));
  } catch (_) {
    noteSkip('verification-matrix', 'gate script missing or unloadable from .claude/scripts');
    return;
  }
  let verdict;
  try {
    verdict = runGate({ root: projectDir, phase: 'executed', group });
  } catch (err) {
    failBlock({
      id: 'verification-matrix-gate',
      title: `verification-matrix gate could not run: ${err.message}`,
      fix: 'repair specs/test_artefacts/verification-matrix.json, then retry the commit.',
      minTier: 'minimal',
    });
  }
  if (verdict.rows_checked === 0) {
    noteSkip('verification-matrix', `no matrix rows in scope for group ${group}`);
    return;
  }
  if (!verdict.pass) {
    const lines = verdict.failures
      .slice(0, 10)
      .map((f) => `  - ${f.code}${f.matrix_id ? ` (${f.matrix_id})` : ''}${f.layer ? ` [${f.layer}]` : ''}`);
    const more = verdict.failures.length > 10 ? `  … ${verdict.failures.length - 10} more\n` : '';
    failBlock({
      id: 'verification-matrix-gate',
      title: `verification matrix (executed phase) not satisfied for group ${group} — ${verdict.failures.length} failure(s)`,
      detail: `${lines.join('\n')}\n${more}`,
      fix: 'run /evaluate to (re)generate runtime evidence and update the matrix, then retry the commit. Check: node .claude/scripts/verification-matrix-gate.js --phase executed --group "' + group + '"',
      minTier: 'minimal',
    });
  }
}

function checkSprintContract(ctx) {
  const { projectDir } = ctx;
  let progress;
  try {
    progress = fs.readFileSync(path.join(projectDir, 'claude-progress.txt'), 'utf8');
  } catch (_) {
    return;
  }
  const groupMatch = progress.match(/^current_group:\s*(.+)$/m);
  if (!groupMatch || !groupMatch[1].trim()) return;
  const group = groupMatch[1].trim();
  if (!fs.existsSync(path.join(projectDir, 'sprint-contracts', `${group}.json`))) return;

  validateContractShape(projectDir, group);

  let report = '';
  try {
    report = fs.readFileSync(path.join(projectDir, 'specs', 'reviews', 'evaluator-report.md'), 'utf8');
  } catch (_) {
    /* missing report = not PASS */
  }
  if (!/^VERDICT:\s*PASS\s*$/m.test(report)) {
    failBlock({
      id: 'sprint-contract',
      title: `Sprint contract for group ${group} not satisfied. Run /evaluate first.`,
      fix: 'Run /evaluate to verify the sprint contract, then retry the commit.',
      minTier: 'minimal',
    });
  }
  checkSecurityVerdict(projectDir, group);
  checkVerificationMatrix(projectDir, group);
}


module.exports = { checkSprintContract };
