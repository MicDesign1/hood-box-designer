# Dieline Studio

A browser-based tool for generating production-ready FEFCO/ECMA dielines (SVG + DXF) for corrugated boxes. Upload a product photo, configure box dimensions and style, and export print-ready dieline files.

This monorepo is the foundation for a professional packaging dieline application.

## Project Structure

```
dieline-studio/
├── frontend/   # Next.js 15 web application
├── backend/    # FastAPI + Python dieline generation API
└── docs/       # Project documentation
```

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.11+
- **[uv](https://docs.astral.sh/uv/)** — Python package manager

## Development

Run both dev servers in separate terminals from the project root.

### Frontend (Next.js)

```bash
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Backend (FastAPI)

```bash
cd backend && uv run uvicorn main:app --reload
```

API: [http://localhost:8000](http://localhost:8000)  
Interactive docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## What's Next

- FEFCO/ECMA box template library
- Photo-to-dimension inference
- SVG and DXF export pipeline
- Interactive dieline editor in the browser