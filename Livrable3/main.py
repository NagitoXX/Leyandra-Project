from pathlib import Path

import numpy as np
import tensorflow as tf
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

MODEL_PATH = Path(__file__).resolve().parent.parent / "modele_photo_improved.keras"
IMAGE_SIZE = (180, 180)
CLASS_NAMES = ["not a photo", "photo"]

print(f"Cargando modelo desde {MODEL_PATH}...")
# compile=False: solo inferencia; evita deserializar la loss del entrenamiento
model = tf.keras.models.load_model(MODEL_PATH, compile=False)
print("Modelo cargado.")


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": True}


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

    try:
        img = tf.image.decode_image(image_bytes, channels=3)
        img.set_shape([None, None, 3])
        img = tf.image.resize(img, IMAGE_SIZE)  # mismas dimensiones del entrenamiento
        batch = tf.expand_dims(img, 0)          # el modelo ya incluye su Rescaling(1./255)

        logits = model.predict(batch, verbose=0)
        probs = tf.nn.softmax(logits[0]).numpy()
        index = int(np.argmax(probs))
        label = CLASS_NAMES[index]
        confidence = float(probs[index])
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="The file could not be decoded as an image",
        )

    # Mantenemos "caption" para no romper el frontend actual.
    return {
        "caption": f"{label} ({confidence:.1%})",
        "label": label,
        "confidence": confidence,
    }