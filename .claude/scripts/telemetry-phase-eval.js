#!/usr/bin/env node
'use strict';

function processPhaseEval(record, counters, gauges, { labelPairs, setGauge, addCounter }) {
  if (record.kind !== 'phase_eval') return;
  const evalLabels = labelPairs([
    ['phase', record.phase],
    ['criterion', 'weighted_avg'],
    ['user', record.user],
    ['group', record.group_id],
    ['iteration', record.iteration],
    ['verdict', record.verdict],
  ]);
  setGauge(gauges, 'harness_phase_eval_score', evalLabels, record.weighted_average || 0);

  for (const [criterion, score] of Object.entries(record.scores || {})) {
    const criterionLabels = labelPairs([
      ['phase', record.phase],
      ['criterion', criterion],
      ['user', record.user],
      ['group', record.group_id],
      ['iteration', record.iteration],
      ['verdict', record.verdict],
    ]);
    setGauge(gauges, 'harness_phase_eval_score', criterionLabels, score);
  }

  addCounter(counters, 'harness_phase_eval_iterations_total', labelPairs([
    ['phase', record.phase],
    ['user', record.user],
    ['group', record.group_id],
    ['verdict', record.verdict],
  ]));
}

module.exports = { processPhaseEval };
