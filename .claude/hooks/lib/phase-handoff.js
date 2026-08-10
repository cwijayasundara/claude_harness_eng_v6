'use strict';

// The between-phase handoff: what the human should do once a planning phase is
// approved, printed at the moment approval lands.
//
// Why this exists. A metered run of the front half (/scaffold -> /brd -> /spec
// -> /design) billed $118.60, of which only $12.00 was generated output. The
// other $106 was context: 148M cache-read tokens, re-carried turn after turn.
// One session ran 337 turns at a 242K average context because /brd's artifacts
// were still resident while /spec worked, and /spec's while /design worked.
//
// Every planning phase reads its inputs from disk, so clearing between phases
// loses nothing — and the approval receipt written alongside this block is what
// lets the fresh session prove the gate was passed. Prose in a skill file was
// not enough: the instruction has to arrive at the moment approval lands, which
// is inside `plan-approval.js record --verdict approved`.

// Each phase's successor, and where that successor gets its inputs. `reads`
// names the digest path rather than the raw artifacts on purpose — pointing a
// fresh session at brd-requirements.json (33 KB) reintroduces the cost the
// clear just removed.
const NEXT_PHASE = Object.freeze({
  brd: { next: '/spec', reads: 'specs/brd/ via `phase-digest.js --phase spec`' },
  spec: { next: '/design', reads: 'specs/stories/ via `phase-digest.js --phase design`' },
  design: { next: '/test', reads: 'specs/design/ via `phase-digest.js --phase test`' },
  test: { next: '/auto', reads: 'specs/test_artefacts/ and the four approval receipts' },
});

// The inverse of NEXT_PHASE: what each phase must be clear OF before it starts.
// The entry phase is absent on purpose — it has nothing upstream to be clear of.
const PREV_PHASE = Object.freeze({
  spec: 'brd',
  design: 'spec',
  test: 'design',
});

/**
 * Whether `phase` is starting inside the conversation that approved its
 * predecessor — the case the printed handoff asks the operator to avoid, and
 * which a live run ignored, carrying /brd's context through /spec at a 273K
 * average turn against ~110K for a fresh session.
 *
 * Every uncertain case passes. A control that blocks on missing evidence
 * (no receipt, no session id, a receipt predating stamping) reports a context
 * problem for something else's failure, and teaches operators to bypass it.
 *
 * @param {object} args
 * @param {string} args.phase phase about to start
 * @param {object|null} args.receipt the predecessor's approval receipt
 * @param {string|null} args.sessionId the live session id
 * @param {boolean} [args.inSession] caller orchestrates all phases in one session
 * @returns {{blocked: boolean, message: string}}
 */
// Is the conversation that produced `record` the one running now?
//
// Shared by both checkpoints. Every uncertain case answers false — no record, no
// session id, a record predating stamping. A control that fires on missing
// evidence reports a context problem for another control's failure.
//
// Two exemptions ride on the record itself rather than on a flag the caller must
// remember at a second call site: `in_session` (a conductor that owns every
// phase and cannot clear between them, i.e. /build) and `waived_by` (a headless
// lane with no human to run /clear).
function isResident(record, sessionId) {
  if (!record || !record.session_id || !sessionId) return false;
  if (record.in_session === true || record.waived_by) return false;
  return record.session_id === sessionId;
}

function staleContext({ phase, receipt, sessionId, inSession }) {
  const upstream = PREV_PHASE[phase];
  const pass = { blocked: false, message: '' };
  if (!upstream || inSession) return pass;
  if (!isResident(receipt, sessionId)) return pass;
  return {
    blocked: true,
    message: [
      '',
      `  /${phase} is starting in the same session that approved /${upstream}.`,
      '',
      `  Run /clear, then /${phase} again.`,
      '',
      `  Every input /${phase} needs is on disk — ${upstream === 'brd' ? 'specs/brd/' : `specs/${upstream === 'spec' ? 'stories' : 'design'}/`}`,
      `  and the ${upstream} approval receipt — so clearing loses no state. It stops`,
      `  /${upstream}'s conversation being re-billed on every turn of this phase,`,
      '  which is where most front-half spend goes when phases share a session.',
      '',
      '  Conducting the whole pipeline from one session on purpose (/build)?',
      '  Pass --in-session.',
      '',
    ].join('\n'),
  };
}

// The second checkpoint, inside a shaping phase.
//
// The phase boundary is not the only place the state becomes durable. Once a
// decisions file passes its gate, everything after it — dispatching the
// renderer, the grounding gates, the phase evaluation — runs off that file and
// needs none of the shaping dialogue that produced it. On the audited run that
// was 40 of /spec's 47 turns, at a 284K average context against ~110K for a
// fresh session: the single most expensive stretch of the front half.
//
// Defined only for phases that can re-enter after the clear. A block on a phase
// with no `--render-only` would strand it rather than save anything.
// `evidence` is what was actually measured for THAT phase. /spec's number is a
// real metered run; /design has not been metered, so it says so rather than
// borrowing /spec's figure and presenting it as its own.
const RENDER_PHASES = Object.freeze({
  spec: {
    decisions: 'specs/decisions/spec-decisions.json',
    verdict: 'specs/reviews/spec-decisions-verdict.json',
    evidence: [
      '  not this conversation, so clearing loses no state. On a metered run this',
      '  stretch was 40 of 47 turns at a 284K average context — the most expensive',
      '  part of the front half, and all of it re-reading a dialogue already',
      '  recorded in the decisions file.',
    ],
  },
  design: {
    decisions: 'specs/decisions/design-decisions.json',
    verdict: 'specs/reviews/design-decisions-verdict.json',
    evidence: [
      '  not this conversation, so clearing loses no state. The equivalent stretch',
      '  in /spec was 40 of 47 turns at a 284K average context; /design has the',
      '  same shape and the largest shaping dialogue of any planning phase',
      '  (Step 0 brainstorm, Step 0.5 clarify, Step 0.7 modularity).',
    ],
  },
});

const RENDER_RULE = '─'.repeat(58);

function renderHandoffBlock(phase) {
  const hop = RENDER_PHASES[phase];
  if (!hop) return '';
  return [
    '',
    `  ${RENDER_RULE}`,
    '  CHECKPOINT — decisions gated and written to disk.',
    '',
    `  Run /clear, then /${phase} --render-only.`,
    '',
    `  Everything left in this phase reads ${hop.decisions},`,
    ...hop.evidence,
    `  ${RENDER_RULE}`,
    '',
  ].join('\n');
}

/**
 * Whether the render stretch is starting in the session that shaped the
 * decisions. Same rules as staleContext — see isResident.
 *
 * @param {object} args
 * @param {string} args.phase spec | design
 * @param {object|null} args.verdict the phase's decisions verdict
 * @param {string|null} args.sessionId the live session id
 * @param {boolean} [args.inSession]
 * @returns {{blocked: boolean, message: string}}
 */
function staleRenderContext({ phase, verdict, sessionId, inSession }) {
  const hop = RENDER_PHASES[phase];
  if (!hop || inSession || !isResident(verdict, sessionId)) return { blocked: false, message: '' };
  return {
    blocked: true,
    message: [
      '',
      `  This is the session that shaped ${hop.decisions}.`,
      '',
      `  Run /clear, then /${phase} --render-only.`,
      '',
      '  The renderer and the gates after it read the decisions file, not this',
      '  conversation. Continuing here re-bills the whole shaping dialogue on',
      '  every remaining turn of the phase.',
      '',
      '  Conducting the whole pipeline from one session on purpose (/build)?',
      '  Pass --in-session.',
      '',
    ].join('\n'),
  };
}

/**
 * The handoff block for an approved phase.
 * @param {string} phase one of brd | spec | design | test
 * @returns {string} block to print, or '' when the phase has no successor
 */
function handoffBlock(phase) {
  const hop = NEXT_PHASE[phase];
  if (!hop) return '';
  const rule = '─'.repeat(58);
  return [
    '',
    `  ${rule}`,
    `  HANDOFF — ${phase} approved, receipt written.`,
    '',
    `  Run /clear before ${hop.next}.`,
    '',
    `  ${hop.next} re-reads what it needs from`,
    `    ${hop.reads}`,
    `  so clearing loses no state. It only stops this phase's context`,
    `  being re-billed on every turn of the next one — which is where`,
    `  ~90% of front-half spend goes when phases share a session.`,
    `  ${rule}`,
    '',
  ].join('\n');
}

/**
 * The handoff to print for a recorded round, or '' when none applies.
 *
 * Suppressed for `--in-session` callers: `/build` conducts every phase from one
 * session and cannot clear itself mid-run, so it absorbs the handoff. Standalone
 * `/brd -> /spec -> /design -> /test` is the cheaper interactive route precisely
 * because each hop can start fresh.
 *
 * @param {string} phase
 * @param {string} verdict changes-requested | approved
 * @param {boolean} inSession caller orchestrates all phases in one session
 * @returns {string}
 */
function handoffOn(phase, verdict, inSession) {
  if (verdict !== 'approved' || inSession) return '';
  return handoffBlock(phase);
}

module.exports = {
  NEXT_PHASE, PREV_PHASE, RENDER_PHASES, handoffBlock, handoffOn,
  staleContext, staleRenderContext, renderHandoffBlock,
};
