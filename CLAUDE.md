# CLAUDE.md — hood-box-designer

Standing context for every Claude Code session in this repo. Read this before doing anything.

## What this project is

A dieline generator for corrugated packaging ("Dieline Studio" in the docs; the repo folder is `hood-box-designer` — trust the structure on disk, not the doc names). Monorepo:

- `frontend/` — Next.js 15 web app
- `backend/` — FastAPI + Python dieline generation API
- `docs/` — documentation

Long-term direction: evolve from a web app into **agent-native tooling** — the geometry engines exposed as plain CLI tools with SKILL.md files, usable by Claude Code / Cowork / any agent, with the web app as one consumer among several. Prefer the durable layer: CLIs, plain files, written conventions. No MCP servers unless a specific distribution need arises.

## Deployment — the rules that protect production

This repo is LIVE. Frontend deploys to Cloudflare Pages, backend to Railway, **both from `main`**.

- **Never push to `main`. Never merge to `main` without explicitly asking the owner first.** All work happens on feature branches.
- Do not rename, move, or alter the backend's entry file or start command — Railway invokes it as-is. Check how the app starts before relocating any code.
- Shared logic gets extracted OUT into modules (e.g. `dieline_core/`); entry points stay where deployment expects them.
- Keep backend dependencies lean; CLI additions must not bloat or conflict with the deploy.

## Engineering conventions

- **Reuse, don't rewrite.** Geometry math is sacred: never "improve" allowances, scores, or dimensions. Byte-identical output across refactors, verified by parity checks (CLI vs API for the same box).
- One geometry source of truth. The FastAPI app and any CLI import the same shared module.
- CLI behavior: on success print only the absolute output path to stdout; on user error print one human-readable line to stderr and exit nonzero — no stack traces.
- No speculative abstractions, config systems, plugins, or logging frameworks. Build for the task at hand.
- Scope discipline: implement only what was asked. New FEFCO styles, features, or refactors need explicit owner approval.

## Domain notes

- Owner has ~20 years of corrugated packaging expertise (FEFCO/ECMA styles, flutes, board grades). Domain conventions live in `skills/*/SKILL.md` files — that's where his knowledge gets encoded. Never invent packaging rules; leave `TODO(owner)` placeholders and ask.
- Dimensions convention and units matter enormously in this domain. When ambiguous, ask; never silently assume.

## Environment

- Owner's machine is Windows; repo at `E:\hood-box-designer`. Mind path separators and shell quoting.
- Python via `uv`; frontend via npm. Dev servers: `cd frontend && npm run dev` (localhost:3000), `cd backend && uv run uvicorn main:app --reload` (localhost:8000).
- Verify the local frontend points at the local backend (not the live Railway URL) before using localhost tests as evidence.

## Current initiative (v1)

Extract 0201 RSC geometry into a standalone `dieline` CLI + starter skill. Full spec and acceptance criteria: `CLAUDE_CODE_PROMPT.md` at repo root. Skill structure: `SKILL_template.md`.
