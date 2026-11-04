"""Small API for the Leyenda demo: upload an image, get back its caption."""
import io
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps

from pipeline import Pipeline

MAX_BYTES = 10 * 1024 * 1024   # 10 MB max per image
models = {}


@asynccontextmanager
async def lifespan(app):
    # The three models are loaded once, when the server starts (it takes a few seconds)
    models["pipeline"] = Pipeline()
    yield
    models.clear()


app = FastAPI(title="Leyenda demo", lifespan=lifespan)

# Open to every origin: the app runs on another port in the browser, or on a phone
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/caption")
def caption(file: UploadFile = File(...), denoise: Literal["auto", "always"] = "auto"):
    # One image per request: the app sends the images one after the other, so each result arrives as soon as it is ready.
    # Normal (not async) function: FastAPI runs it in a thread, so the server keeps answering during the computation.
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The image is too big (10 MB max).")

    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image).convert("RGB")   # phone photos: apply the rotation saved in the file
    except Exception:
        raise HTTPException(status_code=400, detail="This file is not an image (JPG or PNG expected).")

    return models["pipeline"].process(image, denoise=denoise)
