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

module.exports = { NEXT_PHASE, handoffBlock, handoffOn };
