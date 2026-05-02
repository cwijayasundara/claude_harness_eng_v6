'use strict';

class JiraTracker {
  constructor(config) {
    this.config = config;
  }

  async listCandidates() {
    throw new Error('Jira adapter is not implemented yet. Linear is the first supported provider.');
  }

  async moveIssue() {
    throw new Error('Jira adapter is not implemented yet. Linear is the first supported provider.');
  }

  async addComment() {
    throw new Error('Jira adapter is not implemented yet. Linear is the first supported provider.');
  }
}

module.exports = { JiraTracker };
