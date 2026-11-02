import random
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="API de captions")

# Por ahora permite llamadas desde el frontend durante el desarrollo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CAPTIONS_DEMO = [
    "a dog is running through a grassy field",
    "a person is riding a bicycle on the street",
    "two people are playing in a park",
    "a cat is sitting beside a window",
]


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": False}


@app.post("/caption")
async def caption(image: UploadFile = File(...)):
    if image.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a JPEG or PNG image",
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(status_code=400, detail="The file is empty")

    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The image exceeds 5 MB")

    time.sleep(1)  # Simula el tiempo de respuesta del modelo.
    return {"caption": random.choice(CAPTIONS_DEMO)}