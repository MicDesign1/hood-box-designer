from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.dieline import router as dieline_router

app = FastAPI(title="Dieline Studio API")

app.add_middleware(
    CORSMiddleware,
    # Demo API: allow any origin so the Cloudflare site (and its
    # preview-deployment URLs) can call it. No cookies/auth are used,
    # so credentials are off — required when allowing all origins.
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dieline_router)


@app.get("/")
def read_root():
    return {"message": "Dieline Studio backend is running"}
