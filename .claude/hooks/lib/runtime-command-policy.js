'use strict';

const NETWORK_TOOLS = /\b(curl|wget|nc|ncat|socat|ssh|scp|rsync)\b/i;
const OPAQUE_EXECUTION = [
  { id: 'shell-c', re: /(?:^|[;&|]\s*)(?:ba|z|da)?sh\s+-c\b/i },
  { id: 'interpreter-eval', re: /\b(?:node|python\d*|ruby|perl)\s+(?:-[ce]|--eval)\b/i },
  { id: 'eval', re: /(?:^|[;&|]\s*)eval\b/i },
  { id: 'decode-to-shell', re: /\b(?:base64|xxd)\b[^|]*\|\s*(?:ba|z|da)?sh\b/i },
  { id: 'command-substitution-shell', re: /\$\([^)]*(?:ba|z|da)?sh\b/i },
];
const PACKAGE_INSTALL = /\b(?:npm\s+(?:install|i)|pnpm\s+(?:add|install)|yarn\s+add|pip\d*\s+install|uv\s+add|cargo\s+add)\b/i;

function commandStarts(command, entry) {
  const escaped = String(entry).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[;&|]\\s*)${escaped}(?:\\s|$)`).test(command);
}

function urlHosts(command) {
  const hosts = [];
  const re = /https?:\/\/([A-Za-z0-9.-]+)/g;
  let match;
  while ((match = re.exec(command))) hosts.push(match[1].toLowerCase());
  return hosts;
}

function domainAllowed(host, allowed) {
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function classifyCommand(policy, command) {
  const broker = (policy.broker_only_commands || []).find((entry) => commandStarts(command, entry));
  if (broker) return { allowed: false, finding: 'broker-only-command', detail: broker };
  const opaque = OPAQUE_EXECUTION.find((entry) => entry.re.test(command));
  if (opaque) return { allowed: false, finding: 'opaque-execution', detail: opaque.id };
  if (PACKAGE_INSTALL.test(command) && policy.allow_package_install !== true) {
    return { allowed: false, finding: 'dependency-install-not-authorized' };
  }
  if (NETWORK_TOOLS.test(command)) {
    const hosts = urlHosts(command);
    const allowed = policy.network && Array.isArray(policy.network.allowed_domains)
      ? policy.network.allowed_domains.map((item) => item.toLowerCase()) : [];
    if (!hosts.length || hosts.some((host) => !domainAllowed(host, allowed))) {
      return { allowed: false, finding: 'egress-not-authorized', detail: hosts };
    }
  }
  return { allowed: true, finding: null };
}

module.exports = {
  NETWORK_TOOLS, OPAQUE_EXECUTION, PACKAGE_INSTALL,
  classifyCommand, commandStarts, domainAllowed, urlHosts,
};
