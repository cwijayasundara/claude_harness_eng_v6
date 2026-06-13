'use strict';

// Flattens `claude -p --output-format stream-json` output into the plain
// text of all assistant turns, so behavioral assertions can see intermediate
// messages (micro-contracts, clarifying questions, escalations) — not just
// the final response that plain -p prints.

function extractTranscript(streamJsonStdout) {
  const texts = [];
  for (const line of streamJsonStdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (_) {
      continue;
    }
    if (event.type !== 'assistant' || !event.message) continue;
    for (const block of event.message.content || []) {
      if (block.type === 'text' && block.text) texts.push(block.text);
    }
  }
  return texts.join('\n');
}

module.exports = { extractTranscript };
