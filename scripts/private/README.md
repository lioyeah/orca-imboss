# The private layer

This fork (`lioyeah/orca-imboss`) follows upstream (`sethyuan/orca-imboss`) while
keeping its own changes. Three branches, three rules:

| branch            | what it is                | rule                                                        |
| ----------------- | ------------------------- | ----------------------------------------------------------- |
| `main`            | mirror of `upstream/main` | never commit here; `git merge --ff-only upstream/main` only |
| `mine`            | this fork's own changes   | rebase onto `main` whenever upstream moves                  |
| `feat/*`, `fix/*` | one topic per branch      | cut from `main`, PR only — never carry private changes      |

Keeping the private layer out of PR branches is the whole point: PRs stay small
and self-contained, and only `mine` needs conflict resolution when upstream
advances.

## Scripts

`scripts/private/sync-upstream.sh` — fetch upstream, fast-forward `main`, push
the mirror, rebase the private layer, rebuild the AppImage.

```sh
scripts/private/sync-upstream.sh              # sync + rebuild
scripts/private/sync-upstream.sh --no-build   # sync only
scripts/private/sync-upstream.sh --no-push    # do not push main to origin
```

`scripts/private/run-compare.sh` — build upstream and this fork from source and
run both side by side, each with its own data directory.

```sh
scripts/private/run-compare.sh                    # build both, run both
scripts/private/run-compare.sh --no-build         # run what is already built
scripts/private/run-compare.sh --no-run           # build only
scripts/private/run-compare.sh --stop             # stop both
IMBOSS_UPSTREAM_APPIMAGE=~/Applications/orca-imboss-1.7.0.AppImage \
  scripts/private/run-compare.sh                  # compare against the shipped build
```

The "mine" side is whatever branch is checked out, so the same script also
compares a PR branch against upstream.

## Why each build gets its own data directory

`getDataRoot()` (`src/main/data-dir.ts`) is hardcoded to `~/.imboss` and has no
environment override, so `HOME` is the only way to isolate a build.
`migrate()` (`src/main/db/migrations.ts`) only ever moves `user_version`
forward, so a private branch that adds a migration leaves behind a database
that upstream's build cannot open — the app then fails with
`no such column: c.muted` and similar. Give every build its own `HOME` and the
problem cannot happen.

Running both at once works because the single-instance lock
(`app.requestSingleInstanceLock()` in `src/main/index.ts`) is keyed on the
Electron userData directory, which follows `HOME`.

## The updater is off in this build

`UPDATER_ENABLED = false` in `src/main/updater.ts`. `electron-builder.yml`
publishes to `sethyuan/orca-imboss`, so a private build's "check for updates"
would offer the upstream release, and installing it would silently replace the
running app with a build that lacks the private changes. The check now reports
"此版本不支持自动更新。"; set the constant to `true` to restore upstream
behaviour.

## The private UI/UX layer

Aesthetic changes live in `src/renderer/private/`, imported once from
`src/renderer/main.tsx`. Upstream never touches that directory, so restyling
never creates a rebase conflict.

- `src/renderer/private/theme.css` — token overrides. Every component is driven
  by the custom properties in `src/renderer/styles/tokens.css`, so one line here
  restyles the whole app and cannot fight an upstream CSS rule. It loads after
  `tokens.css`, and the file says which block to edit for light, dark, and
  forced-dark.
- `src/renderer/private/overrides.css` — the few things a token cannot reach
  (a rule that paints with a hardcoded value, a missing hairline, a focus ring).
- `src/renderer/private/*` — private components and their own `index.css`,
  mounted from `index.ts`.

Two things to know before editing it:

1. **The import must stay last in `src/renderer/main.tsx`.** Vite injects
   stylesheets in module-execution order, and a rule with equal specificity that
   is injected later wins — so `import "./private";` goes after every other
   import, or upstream rules silently override the private ones. (There are no
   dynamic imports in the renderer, so the static order is reliable.)
2. **The accent is not a stylesheet token.** `src/renderer/theme.ts` writes
   `--imb-accent` and its derived siblings INLINE on `documentElement` from the
   theme colour the user picks in Settings › Theme, and an inline style beats
   every stylesheet. The app's default lives in two upstream files that must be
   kept in sync with each other and with the fallbacks in `theme.css`:
   `src/renderer/theme.ts` (`THEME_COLORS[0]`, the first swatch, also the
   default) and `src/main/theme.ts` (`DEFAULT_COLOR`). Do not reach for
   `!important` here — that would freeze the accent picker.

Rules that keep it cheap:

1. Prefer a token over a selector, and this directory over an upstream file.
2. New behaviour gets its own file plus a one-line mount, never a rewrite of an
   upstream component.
3. Keep the layer as a handful of small, named commits, so a change upstream
   later adopts on its own can be dropped with `git rebase -i`.
4. Never reformat an upstream file — a whole-file prettier pass turns a
   one-line conflict into a full-file one.

To check the layer is loaded, read `--imb-private-layer` off `:root`: it is `1`
in this build.

## Keeping the private layer cheap

Conflicts only happen where private changes touch files upstream also edits —
`chat-module/index.tsx`, `builtin-tools.ts`, `zhCN.json` and friends. Prefer new
files over edits to those, and keep the layer small; then `sync-upstream.sh`
usually rebases without stopping.

These scripts are committed on `mine` only. Copy them into `~/.local/bin` if you
want them available while another branch is checked out.
