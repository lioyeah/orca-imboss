# Contributing to imboss

Thanks for your interest in improving imboss! This document explains how to
contribute and, importantly, how to accept the project's
[Contributor License Agreement](CLA.md) (CLA).

By contributing, you agree to abide by the project's licensing terms. Please read
[CLA.md](CLA.md) before opening a pull request.

## Contributor License Agreement

imboss is dual-licensed under GPL-3.0 and a commercial license. To keep that model
possible, Orca Studio must be able to distribute every contribution under **both**
licenses. We therefore ask every contributor to accept the CLA in
[CLA.md](CLA.md).

### Individual contributors

Add the following statement to your **first pull request** (in the PR description
or as a comment). It is required — pull requests without it cannot be merged:

> I have read the CLA at CLA.md and I hereby sign it.

Your pull request and the statement together constitute your acceptance of
**Part A — Individual Contributor License Agreement**. You only need to do this
once; it covers your future contributions unless the CLA changes.

### Contributing on behalf of a company or other entity

If you contribute as part of your job, or the contribution is owned by a company
or other legal entity, that entity must accept **Part B — Entity Contributor
License Agreement**. An authorized representative should sign Part B of
[CLA.md](CLA.md) and email a scanned copy (or an email confirming acceptance) to
[kefroth@outlook.com](mailto:kefroth@outlook.com) **before** the entity's first
contribution is merged.

If you are unsure which applies to you, contact us first.

## Reporting issues

Bug reports and feature requests are welcome via GitHub issues. Please include:

- What you expected to happen and what actually happened.
- Steps to reproduce, and the imboss version (see **Settings → About**).
- Your operating system and version.

Do not include secrets, API keys, tokens, or other credentials in an issue.

## Development

### Prerequisites

- Node.js 24+
- [pnpm](https://pnpm.io/) 11

### Setup

```bash
pnpm install
pnpm dev        # run the app in development
```

### Checks before opening a pull request

```bash
pnpm typecheck  # type-check the main and renderer processes
pnpm test       # run the Node test runner (src/**/*.test.ts)
pnpm build      # type-check + production build
pnpm format     # format with Prettier
```

Please make sure `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

### Code style

- Formatting is handled by [Prettier](https://prettier.io/) — run `pnpm format`.
- Follow the existing conventions in the surrounding code.
- Keep changes focused; unrelated refactors make review harder.

## Pull requests

1. Fork the repository and create a topic branch.
2. Make your change, keeping commits reasonably scoped.
3. Run `pnpm typecheck` and `pnpm build`.
4. Open a pull request describing the change and include the CLA acceptance
   statement (see above) if it is your first contribution.

## Questions

For licensing questions, commercial-license enquiries, or anything you are unsure
about, contact [kefroth@outlook.com](mailto:kefroth@outlook.com).
