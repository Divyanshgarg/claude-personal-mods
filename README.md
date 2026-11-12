# claude-personal-mods

Personal Claude Code mods.

- **session-ledger**: a side pane that logs every tool call of the session with its time, target, duration and pass/fail. Open it with `/ledger`.
- **env-status**: a status line showing the session's working directory, whether the FM share is mounted, and the git branch. Re-check with `/env`.

- **worklog**: keeps one dated entry per session in the project's `WORKLOG.md`: what was asked, which files changed, commands run and where it stands. Browse it in a side pane with `/worklog`, which also writes the entry on demand. Note: it creates `WORKLOG.md` in every project it runs in.

- **evidence-band**: a band above the prompt showing whether the session's edits are backed by a passing check (tests, build, lint, type-check), plus uncommitted and unpushed counts. Print the verdict with `/evidence`.

- **agent-board**: a side pane listing every subagent the session dispatched, with its brief, status, tool calls, token spend and one-line result. It opens when the first agent starts, or with `/board`.

## Install

This repository is private: the machine needs a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

From a shell:

```
claude plugin install session-ledger --marketplace Divyanshgarg/claude-personal-mods
claude plugin install env-status --marketplace Divyanshgarg/claude-personal-mods
claude plugin install worklog --marketplace Divyanshgarg/claude-personal-mods
claude plugin install evidence-band --marketplace Divyanshgarg/claude-personal-mods
claude plugin install agent-board --marketplace Divyanshgarg/claude-personal-mods
```

At the prompt of a terminal session:

```
/plugin install session-ledger --marketplace Divyanshgarg/claude-personal-mods
/plugin install env-status --marketplace Divyanshgarg/claude-personal-mods
/plugin install worklog --marketplace Divyanshgarg/claude-personal-mods
/plugin install evidence-band --marketplace Divyanshgarg/claude-personal-mods
/plugin install agent-board --marketplace Divyanshgarg/claude-personal-mods
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `Divyanshgarg/claude-personal-mods`, then Add plugin.

## Update

```
claude plugin marketplace update personal-mods
claude plugin update session-ledger@personal-mods
claude plugin update env-status@personal-mods
claude plugin update worklog@personal-mods
claude plugin update evidence-band@personal-mods
claude plugin update agent-board@personal-mods
```
