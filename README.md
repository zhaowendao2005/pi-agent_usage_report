# usage-report

Pi extension package scaffold (Hello World). Placeholder for future usage/cost
reporting tools.

## Install

Local directory:

```bash
pi install ./path/to/usage_report        # add to user settings
pi install -l ./path/to/usage_report     # add to project settings (.pi/settings.json)
```

Try without installing (temporary, current run only):

```bash
pi -e ./path/to/usage_report
```

## What's inside

| File                 | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `extensions/index.ts` | Extension entry point — greets on load, registers a `greet` tool and `/hello` command |

`package.json` declares the `pi` manifest (`keywords: ["pi-package"]`,
`pi.extensions: ["./extensions"]`). Core pi packages are declared as
`peerDependencies` (bundled by pi) and as `devDependencies` for local
type-checking. See https://pi.dev/docs/latest/packages.

## Test locally

```bash
pi -e ./extensions/index.ts
```

Type-check:

```bash
npm install    # installs devDependencies for type resolution
npx tsc --noEmit
```

## Layout (future)

- `extensions/` — tools, commands, event hooks
- `skills/` — optional SKILL.md folders
- `prompts/` — optional prompt templates
- `themes/` — optional themes

## Docs

- Extensions: https://pi.dev/docs/latest/extensions
- Packages: https://pi.dev/docs/latest/packages
