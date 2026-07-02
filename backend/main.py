from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.dieline import router as dieline_router

app = FastAPI(title="Dieline Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dieline_router)


@app.get("/")
def read_root():
    return {"message": "Dieline Studio backend is running"}