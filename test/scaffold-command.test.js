const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const scaffold = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'),
  'utf8'
);
const dashboard = fs.readFileSync(
  path.join(__dirname, '..', 'telemetry', 'grafana', 'dashboards', 'harness-overview.json'),
  'utf8'
);
const dashboardJson = JSON.parse(dashboard);
const installFrameworkPacks = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'install-framework-packs', 'SKILL.md'),
  'utf8'
);

test('/scaffold validates every telemetry asset before copying it to target repos', () => {
  const requiredChecks = [
    'test -f "$PLUGIN_SOURCE/skills/code-map/scripts/import_understand_graph.js"',
    'test -f "$PLUGIN_SOURCE/scripts/telemetry-memory.js"',
    'test -f "$PLUGIN_SOURCE/scripts/replay-telemetry.js"',
    'test -f "$HARNESS_ROOT/telemetry_docker_compose.yml"',
    'test -f "$HARNESS_ROOT/telemetry/otel-collector-config.yml"',
    'test -f "$HARNESS_ROOT/telemetry/prometheus.yml"',
    'test -f "$HARNESS_ROOT/telemetry/grafana/dashboards/harness-overview.json"',
    'test -f "$HARNESS_ROOT/telemetry/grafana/provisioning/dashboards/dashboards.yml"',
    'test -f "$HARNESS_ROOT/telemetry/grafana/provisioning/datasources/prometheus.yml"',
  ];

  for (const check of requiredChecks) {
    assert.match(scaffold, new RegExp(check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('/scaffold copies telemetry, docs, and git hook assets into target repos', () => {
  const requiredCopies = [
    'cp "$HARNESS_ROOT/telemetry_docker_compose.yml" ./telemetry_docker_compose.yml',
    'cp "$HARNESS_ROOT/telemetry/otel-collector-config.yml" ./telemetry/',
    'cp "$HARNESS_ROOT/telemetry/prometheus.yml" ./telemetry/',
    'cp -r "$HARNESS_ROOT/telemetry/grafana" ./telemetry/',
    'cp "$HARNESS_ROOT/README.md" ./SCAFFOLD_README.md',
    'cp -r $PLUGIN_SOURCE/scripts/ .claude/scripts/',
    'cp $PLUGIN_SOURCE/git-hooks/prepare-commit-msg .git/hooks/prepare-commit-msg',
  ];

  for (const copy of requiredCopies) {
    assert.match(scaffold, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('/scaffold does not vendor redundant Karpathy guidelines as a separate skill', () => {
  const skillPath = path.join(__dirname, '..', '.claude', 'skills', 'karpathy-guidelines', 'SKILL.md');

  assert.equal(fs.existsSync(skillPath), false);
  assert.doesNotMatch(scaffold, /karpathy-guidelines/);
  assert.match(scaffold, /test "\$SKILL_COUNT" = "28"/);
  assert.match(scaffold, /28 skills\s+→ \.claude\/skills\//);
});

test('/scaffold does not attempt auto-mode-blocked framework pack installs', () => {
  assert.match(scaffold, /Do not run `npx skills add` from `\/scaffold`/);
  assert.match(scaffold, /PENDING MANUAL INSTALL/);
  assert.doesNotMatch(scaffold, /Bash\(npx/);
  assert.doesNotMatch(scaffold, /install them via the open agent skills CLI/);
});

test('/install-framework-packs verifies and prints manual commands instead of running npx', () => {
  assert.match(installFrameworkPacks, /does not attempt to run `npx skills add`/);
  assert.match(installFrameworkPacks, /PENDING MANUAL INSTALL/);
  assert.match(installFrameworkPacks, /Open a normal terminal \(NOT Claude Code\)/);
  assert.doesNotMatch(installFrameworkPacks, /Capture the full stdout\+stderr/);
});

test('Grafana dashboard queries current Claude Code OTEL metric names', () => {
  assert.match(dashboard, /claude_code_cost_usage_USD_total/);
  assert.match(dashboard, /claude_code_token_usage_tokens_total/);
  assert.match(dashboard, /claude_code_active_time_seconds_total/);
  assert.match(dashboard, /claude_code_code_edit_tool_decision_total/);
  assert.match(dashboard, /max_over_time\(claude_code_cost_usage_USD_total\[\$__range\]\)/);
  assert.match(dashboard, /max_over_time\(claude_code_token_usage_tokens_total\[\$__range\]\)/);
  assert.match(dashboard, /max_over_time\(claude_code_active_time_seconds_total\[\$__range\]\)/);
  assert.doesNotMatch(dashboard, /claude_code_active_time_total_seconds_total/);
});

test('Grafana dashboard panels use range-safe categorical queries', () => {
  const panelsByTitle = Object.fromEntries(dashboardJson.panels.map((panel) => [panel.title, panel]));

  assert.equal(panelsByTitle['Team Activity — Turns by User'].type, 'barchart');
  assert.match(panelsByTitle['Team Activity — Turns by User'].targets[0].expr, /harness_conversation_turns_total/);
  assert.match(panelsByTitle['Team Activity — Turns by User'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Lane Usage'].type, 'piechart');
  assert.match(panelsByTitle['Lane Usage'].targets[0].expr, /harness_conversation_turns_total/);
  assert.match(panelsByTitle['Lane Usage'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Quality — Success vs Failure'].type, 'piechart');
  assert.match(panelsByTitle['Quality — Success vs Failure'].targets[0].expr, /harness_agent_runs_total/);
  assert.match(panelsByTitle['Quality — Success vs Failure'].targets[0].expr, /harness_tool_events_total/);
  assert.match(panelsByTitle['Quality — Success vs Failure'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Agent / Tool Workload — Runs by Type'].type, 'barchart');
  assert.match(panelsByTitle['Agent / Tool Workload — Runs by Type'].targets[0].expr, /harness_agent_runs_total/);
  assert.match(panelsByTitle['Agent / Tool Workload — Runs by Type'].targets[0].expr, /harness_tool_events_total/);
  assert.match(panelsByTitle['Agent / Tool Workload — Runs by Type'].targets[0].expr, /label_replace/);
  assert.match(panelsByTitle['Agent / Tool Workload — Runs by Type'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Effort per Group — Total Activity'].type, 'bargauge');
  assert.match(panelsByTitle['Effort per Group — Total Activity'].targets[0].expr, /harness_conversation_turns_total/);
  assert.match(panelsByTitle['Effort per Group — Total Activity'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Effort per Story — Total Activity'].type, 'bargauge');
  assert.match(panelsByTitle['Effort per Story — Total Activity'].targets[0].expr, /harness_conversation_turns_total/);
  assert.match(panelsByTitle['Effort per Story — Total Activity'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Success Rate per Agent / Tool'].type, 'bargauge');
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /clamp_min/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /harness_agent_runs_total/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /harness_tool_events_total/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /label_replace/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /job="claude_harness_memory"/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /agent!="unknown"/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /or on\(agent\)/);
  assert.match(panelsByTitle['Success Rate per Agent / Tool'].targets[0].expr, /kind=~"subagent\|subagent_stop"/);

  assert.equal(panelsByTitle['Execution Mode Distribution'].type, 'piechart');
  assert.match(panelsByTitle['Execution Mode Distribution'].targets[0].expr, /harness_conversation_turns_total/);
  assert.match(panelsByTitle['Execution Mode Distribution'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Conversation Turns — by User & Lane'].type, 'bargauge');
  assert.match(panelsByTitle['Conversation Turns — by User & Lane'].targets[0].expr, /max_over_time\(harness_conversation_turns_total/);
  assert.match(panelsByTitle['Conversation Turns — by User & Lane'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Developer Output'].type, 'bargauge');
  for (const target of panelsByTitle['Developer Output'].targets) {
    assert.match(target.expr, /or vector\(0\)/);
  }

  assert.equal(panelsByTitle['Native Tokens — by Type'].type, 'bargauge');
  assert.match(panelsByTitle['Native Tokens — by Type'].targets[0].expr, /claude_code_token_usage_tokens_total/);
  assert.equal(panelsByTitle['Native Cost — by Model'].type, 'bargauge');
  assert.match(panelsByTitle['Native Cost — by Model'].targets[0].expr, /claude_code_cost_usage_USD_total/);
  assert.equal(panelsByTitle['Native Edit Decisions'].type, 'bargauge');
  assert.match(panelsByTitle['Native Edit Decisions'].targets[0].expr, /claude_code_code_edit_tool_decision_total/);
  assert.match(panelsByTitle['Native Edit Decisions'].targets[0].expr, /or vector\(0\)/);

  assert.equal(panelsByTitle['Command Invocations — by Command'].type, 'bargauge');
  assert.match(panelsByTitle['Command Invocations — by Command'].targets[0].expr, /harness_command_invocations_total/);
  assert.match(panelsByTitle['Command Invocations — by Command'].targets[0].expr, /job="claude_harness_memory"/);
  assert.equal(panelsByTitle['Tool Activity — by Tool'].type, 'bargauge');
  assert.match(panelsByTitle['Tool Activity — by Tool'].targets[0].expr, /harness_tool_events_total/);
  assert.match(panelsByTitle['Tool Activity — by Tool'].targets[0].expr, /job="claude_harness_memory"/);

  assert.equal(panelsByTitle['Skill Usage — by Skill'].type, 'bargauge');
  assert.match(panelsByTitle['Skill Usage — by Skill'].targets[0].expr, /harness_skill_usage_total/);
  assert.match(panelsByTitle['Skill Usage — by Skill'].targets[0].expr, /harness_skill_info/);
  assert.match(panelsByTitle['Skill Usage — by Skill'].targets[0].expr, /job="claude_harness_memory"/);
  assert.equal(panelsByTitle['Installed Skills — Memory Inventory'].type, 'table');
  assert.match(panelsByTitle['Installed Skills — Memory Inventory'].targets[0].expr, /harness_skill_info/);
  assert.match(panelsByTitle['Installed Skills — Memory Inventory'].targets[0].expr, /job="claude_harness_memory"/);
});

test('Grafana dashboard variables use any memory-backed harness metric', () => {
  const queries = Object.fromEntries(dashboardJson.templating.list.map((item) => [item.name, item.query]));

  assert.equal(queries.user, 'label_values({job="claude_harness_memory",__name__=~"harness_.*"}, user)');
  assert.equal(queries.lane, 'label_values({job="claude_harness_memory",__name__=~"harness_.*"}, lane)');
  assert.equal(queries.group, 'label_values({job="claude_harness_memory",__name__=~"harness_.*"}, group)');
});

test('Grafana dashboards are mounted outside the data volume', () => {
  const compose = fs.readFileSync(path.join(__dirname, '..', 'telemetry_docker_compose.yml'), 'utf8');
  const provisioning = fs.readFileSync(
    path.join(__dirname, '..', 'telemetry', 'grafana', 'provisioning', 'dashboards', 'dashboards.yml'),
    'utf8'
  );

  assert.match(compose, /telemetry\/grafana\/dashboards:\/etc\/grafana\/dashboards:ro/);
  assert.match(provisioning, /path: \/etc\/grafana\/dashboards/);
  assert.doesNotMatch(compose, /\/var\/lib\/grafana\/dashboards/);
  assert.doesNotMatch(provisioning, /\/var\/lib\/grafana\/dashboards/);
});
