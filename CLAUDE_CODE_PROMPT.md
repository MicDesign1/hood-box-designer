# Claude Code Prompt — Dieline CLI Extraction (v1)

Paste everything below the line into Claude Code, opened at the root of the repo: `E:\hood-box-designer`. Read the handoff/CLAUDE.md first if present.

> Note: folder names may differ from the docs (README calls the project "dieline-studio"). Trust the actual repo structure on disk — locate the FastAPI backend and frontend directories by inspection, not by assumed names.

---

## Task

Extract the 0201 RSC (Regular Slotted Container) geometry logic from `backend/` into a standalone command-line tool called `dieline`. The CLI must have **zero dependency on FastAPI, uvicorn, or anything in `frontend/`** — it should run as a plain Python tool.

Target interface:

```
dieline generate --style 0201 --l 12 --w 9 --d 4 --flute C --units in --out box.dxf
```

Requirements:

1. **Reuse, don't rewrite.** Find the existing 0201 geometry code in the backend and refactor it into a shared module (e.g. `dieline_core/`) that both the CLI and the existing FastAPI app import. The API must keep working exactly as before.
2. **Both export formats.** `--out box.dxf` and `--out box.svg` both work; format inferred from extension. `--out` defaults to `./dieline-0201-{L}x{W}x{D}.dxf` in the current directory.
3. **Units flag.** `--units in` (default) and `--units mm`.
4. **Flute flag.** `--flute` accepts B, C, E, BC (extend later); it must affect the geometry exactly the way the current backend does — do not invent new allowance math.
5. **Good `--help`.** Every flag documented with one example invocation at the bottom. Assume the reader is an agent that has never seen this tool.
6. **Sane failures.** Invalid style, negative/zero dimensions, or unknown flute → print a one-line human-readable error to stderr and exit with a nonzero code. No stack traces for user errors.
7. **Machine-friendly success output.** On success, print one line to stdout: the absolute path of the file written. Nothing else.
8. **Installable.** Add a console-script entry point so `uv run dieline ...` works from the repo root, and document the one-line install in a new `cli/README.md`.
9. **Starter skill.** Create `skills/dieline/SKILL.md` from the template I'll provide (or a reasonable structure if absent), documenting when and how an agent should use this CLI. Leave clearly marked `TODO(owner)` placeholders for domain conventions — do not invent packaging rules.

## Scope guards — do NOT

- Do not add any other FEFCO styles. 0201 only.
- Do not refactor, restyle, or touch `frontend/`.
- Do not change the API's routes, request/response shapes, or behavior.
- Do not add new geometry logic, allowances, or "improvements" to the dieline math. Byte-for-byte identical output to the current backend is the goal.
- Do not add config files, plugins, logging frameworks, or abstractions for hypothetical future needs.

## Deployment constraint

This repo is live: the frontend deploys to Cloudflare Pages and the backend to Railway, both from `main`. We are working on a branch, but everything you do must merge cleanly without breaking those deploys:

- The backend's start command and entry point must remain valid exactly as Railway invokes it today (check how the app currently starts before moving any files).
- Any new dependencies for the CLI must not conflict with or bloat the backend's deploy (keep the CLI's deps minimal; stdlib + whatever the geometry code already uses).
- Do not rename or move the backend's entry file. Extract shared code *out* into `dieline_core/`, leaving the entry point where deployment expects it.

## Acceptance criteria (verify each before declaring done)

- [ ] `uv run dieline generate --style 0201 --l 12 --w 9 --d 4 --flute C --out /tmp/test.dxf` exits 0 and writes a valid DXF.
- [ ] Same command with `--out /tmp/test.svg` writes a valid SVG that opens in a browser.
- [ ] **Parity check:** generate the same 12×9×4 C-flute box through the existing FastAPI endpoint and through the CLI, and diff the geometry (path/entity coordinates). They must match. Show me the diff result.
- [ ] `uv run dieline generate --style 0999 ...` exits nonzero with a one-line error.
- [ ] `uv run dieline generate --style 0201 --l -5 ...` exits nonzero with a one-line error.
- [ ] The FastAPI app still starts and its 0201 endpoint still returns correct output (it now imports from the shared module).
- [ ] `dieline --help` and `dieline generate --help` are complete enough that someone who has never seen the repo could use the tool.
- [ ] `skills/dieline/SKILL.md` exists with TODO placeholders for owner conventions.

When done, give me: the exact commands to run the parity check myself, and a list of every file you created or modified.
