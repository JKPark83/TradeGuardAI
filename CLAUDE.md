# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This directory is a **workspace container**, not a single codebase. The outer git repo (`b31ec00 first commit`) is mostly empty — the real work lives in independent subprojects, each with its own VCS history, tooling, and (in most cases) its own `CLAUDE.md` and `README.md`. Always `cd` into the relevant subproject before running commands; tooling at the workspace root will not work.

| Subproject | Stack | Per-project docs |
|---|---|---|
| `A2A-MCP-RealEstate/` | Python 3.12 · FastAPI · FastMCP — Korean real-estate recommendation MCP server with web UI | `CLAUDE.md`, `README.md` |
| `mu_action_agent/` | FastAPI + SQLAlchemy 2.0 async (backend) · React 19 + Vite + TanStack Query (frontend) · LangGraph + Anthropic Claude — Korean auction document analysis | `README.md`, `spec.md`, `specs/` |
| `my_tesla_app/` | Flutter · Riverpod · Tesla Fleet API — iOS/Android/Web vehicle remote control (Korean market) | `CLAUDE.md`, `README.md`, `specs/001-tesla-control-app/` |
| `open_source/everything-claude-code/` | Skill/agent/command bundle for Claude Code (extensive `agents/`, `skills/`, `commands/`) | `CLAUDE.md`, `AGENTS.md`, `COMMANDS-QUICK-REF.md` |
| `jkpark83.github.io/` | Static `index.html` + `callback/` (OAuth bounce target for `my_tesla_app` web build) | — |

The two existing subproject `CLAUDE.md` files (`A2A-MCP-RealEstate/CLAUDE.md`, `my_tesla_app/CLAUDE.md`) are authoritative for their projects — read them before working in those trees.

## Per-Project Quick Commands

### `A2A-MCP-RealEstate/` (Python · FastMCP)
```bash
pip install -r requirements.txt
python runner.py                                      # web UI on :8080
python app/mcp/real_estate_recommendation_mcp.py      # standalone MCP server
python app/mcp/location_service.py                    # standalone location MCP
```
Requires `MOLIT_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` in `.env`.

### `mu_action_agent/` (FastAPI + React, two processes)
```bash
# backend (Port 8000) — uses uv, not pip
cd backend && uv sync && uvicorn app.main:app --reload --port 8000

# frontend (Port 5173) — Vite proxies /api → :8000
cd frontend && npm install && npm run dev
```
Requires `ANTHROPIC_API_KEY` in root `.env`. Start backend *before* frontend.

### `my_tesla_app/` (Flutter)
```bash
flutter pub get
bash scripts/codegen.sh                       # drift `*.g.dart` codegen — required
flutter run -d "iPhone 15"                    # or: -d emulator-5554, -d chrome --web-port=5555
flutter analyze && flutter test               # lint + unit/widget tests
```
Requires `TESLA_CLIENT_ID` / `TESLA_CLIENT_SECRET` in `.env` (bundled as Flutter asset). **Never commit** `.env` or `keys/*.pem`.

### `open_source/everything-claude-code/`
A Claude Code extension bundle, not a runnable app. See its own `CLAUDE.md` and `CONTRIBUTING.md`.

## Cross-Cutting Notes

- **Two real-estate projects, different scope.** `A2A-MCP-RealEstate` is an MCP-server-focused recommendation tool (실거래가 + 위치 점수); `mu_action_agent` is an auction-document analysis pipeline (PDF → LangGraph agents → bid recommendation). They are independent.
- **`my_tesla_app` + `jkpark83.github.io` are linked.** The GitHub Pages site hosts the OAuth callback (`https://jkpark83.github.io/callback`) that Tesla's web-build redirect URI bounces through. Mobile builds use `myteslaapp://callback` instead.
- **Secrets live in per-project `.env` files** (`A2A-MCP-RealEstate/.env`, `mu_action_agent/.env`, `my_tesla_app/.env`). The workspace-level `.gitignore` is not authoritative; each subproject manages its own.
- **Korean is the primary product language** across all three product apps — UI strings, sample data, and many docs/specs are Korean-first. Default to Korean for user-facing content unless a string is explicitly i18n-keyed to English.

<!-- SPECKIT START -->
Active feature plan: [specs/001-tradeguard-ai/plan.md](specs/001-tradeguard-ai/plan.md)
- Spec: [specs/001-tradeguard-ai/spec.md](specs/001-tradeguard-ai/spec.md)
- Research: [specs/001-tradeguard-ai/research.md](specs/001-tradeguard-ai/research.md)
- Data model: [specs/001-tradeguard-ai/data-model.md](specs/001-tradeguard-ai/data-model.md)
- API contracts: [specs/001-tradeguard-ai/contracts/](specs/001-tradeguard-ai/contracts/)
- Quickstart: [specs/001-tradeguard-ai/quickstart.md](specs/001-tradeguard-ai/quickstart.md)
<!-- SPECKIT END -->
