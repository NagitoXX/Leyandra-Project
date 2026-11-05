"""
The three steps of the Leyenda pipeline, applied to one uploaded image:
photo or not (Deliverable 1) -> denoising (Deliverable 2) -> caption (Deliverable 3).
Same steps as section 7 of Livrable3_Captioning.ipynb, with three changes for better captions:
- the photo is only denoised if it is really noisy (Deliverable 2 showed the U-Net makes almost clean photos worse);
- beam search keeps 5 sentences instead of 3, never writes <unk> and never repeats a word twice in a row;
- the 3 best different captions are returned.
"""
import base64
import io
import json
import sys
import threading
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image

# Project root: the folder that holds backend/, the models and captioning_train.py
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import captioning_train as ct  # noqa: E402  (it only defines the model classes, importing it trains nothing)

CLASSIFIER_PATH = ROOT / "modele_photo_improved.keras"   # Deliverable 1
DENOISER_PATH = ROOT / "denoiser_rgb_v3.keras"           # Deliverable 2 (U-Net)
CAPTIONING_DIR = ROOT / "modele_captioning"              # Deliverable 3

CLASSIFIER_SIZE = 180      # the classifier was trained on 180x180 images
PHOTO_THRESHOLD = 0.5      # above this probability, the image is a photo
MAX_SIDE = 640             # photos are reduced to 640 px max, the size of the Deliverable 2 photos
NOISE_THRESHOLD = 0.04     # below this noise level, denoising makes the photo worse (Deliverable 2, section 5)
BEAM_WIDTH = 5             # number of sentences kept at each step of the beam search
N_CAPTIONS = 3             # main caption + 2 alternatives


def estimate_noise_sigma(channel):
    # Immerkaer estimator, same as Deliverable 2: a 3x3 filter keeps only the high frequencies,
    # and their mean is turned into the standard deviation of the noise (pixels in [0, 1])
    h, w = channel.shape
    x = np.pad(channel.astype(np.float64), 1, mode="reflect")
    kernel = [[1, -2, 1], [-2, 4, -2], [1, -2, 1]]
    filtered = sum(kernel[i][j] * x[i:i + h, j:j + w] for i in range(3) for j in range(3))
    return float(np.sqrt(np.pi / 2) * np.abs(filtered).sum() / (6 * max(1, (w - 2) * (h - 2))))


def repeats_pair(tokens):
    # True if the last two words already appear together earlier in the sentence
    if len(tokens) < 3:
        return False
    last = (tokens[-2], tokens[-1])
    return any((tokens[i], tokens[i + 1]) == last for i in range(len(tokens) - 2))


def to_base64_jpeg(image):
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=95)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class Pipeline:
    def __init__(self):
        # Deliverables 1 and 2: compile=False because we only predict (it also avoids a Keras version error)
        self.classifier = tf.keras.models.load_model(str(CLASSIFIER_PATH), compile=False)
        self.denoiser = tf.keras.models.load_model(str(DENOISER_PATH), compile=False)

        # Deliverable 3: InceptionV3 without its classification layers gives 8x8x2048 features
        image_model = tf.keras.applications.InceptionV3(include_top=False, weights="imagenet")
        self.features_model = tf.keras.Model(image_model.input, image_model.layers[-1].output)

        # Vocabulary and sizes saved with the captioning model
        cfg = json.loads((CAPTIONING_DIR / "config.json").read_text())
        self.tokenizer = tf.keras.preprocessing.text.tokenizer_from_json(
            (CAPTIONING_DIR / "tokenizer.json").read_text(encoding="utf-8"))
        self.max_length = cfg["max_length"]
        self.start_id = self.tokenizer.word_index["<start>"]
        self.end_id = self.tokenizer.word_index["<end>"]
        self.unk_id = self.tokenizer.word_index.get("<unk>", 1)

        # Encoder and decoder rebuilt with the same classes as the training, then the saved weights are loaded.
        # The GloVe matrix was only the starting point of the training, so zeros are enough here.
        self.encoder = ct.CNN_Encoder(cfg["embedding_dim"])
        self.decoder = ct.RNN_Decoder_v2(cfg["glove_dim"], cfg["units"], cfg["vocab_size"],
                                         np.zeros((cfg["vocab_size"], cfg["glove_dim"]), "float32"))
        ct.build(self.encoder, self.decoder)
        self.encoder.load_weights(str(CAPTIONING_DIR / "encoder.weights.h5"))
        self.decoder.load_weights(str(CAPTIONING_DIR / "decoder.weights.h5"))

        # One image at a time goes through the models
        self.lock = threading.Lock()

    def photo_probability(self, image):
        # Step 1: 180x180 image (same resize as load_img in the notebook), probability of the class "photo"
        small = image.resize((CLASSIFIER_SIZE, CLASSIFIER_SIZE), Image.NEAREST)
        x = np.asarray(small, dtype=np.float32)[None]
        probs = tf.nn.softmax(self.classifier(x, training=False)[0]).numpy()
        return float(probs[1])

    def denoise(self, x):
        # Step 2: pixels in [0, 1], padded to a multiple of 4 (two poolings in the U-Net), denoised, cropped back
        h, w = x.shape[:2]
        padded = np.pad(x, ((0, (-h) % 4), (0, (-w) % 4), (0, 0)), mode="reflect")
        clean = self.denoiser(padded[None], training=False).numpy()[0, :h, :w]
        return np.clip(clean, 0.0, 1.0)

    def encode_image(self, image):
        # Image -> 299x299, pixels in [-1, 1] -> InceptionV3 -> 64 regions x 2048 -> encoder
        x = tf.image.resize(np.asarray(image, dtype=np.float32), (299, 299))
        x = tf.keras.applications.inception_v3.preprocess_input(x)[None]
        features = self.features_model(x, training=False)
        features = tf.reshape(features, (1, -1, features.shape[3]))
        return self.encoder(features)

    def beam_search(self, features):
        # A candidate sentence: (word indexes, sum of log-probabilities).
        # All the sentences of a step go through the decoder together, in one batch.
        score = lambda c: c[1] / len(c[0])        # divided by the length, so short sentences are not favoured
        beams = [([self.start_id], 0.0)]
        hidden = self.decoder.reset_state(batch_size=1)
        finished = []
        for _ in range(self.max_length):
            n = len(beams)
            dec_input = tf.constant([[tokens[-1]] for tokens, _ in beams], dtype=tf.int32)
            predictions, new_hidden, _ = self.decoder(dec_input, tf.repeat(features, n, axis=0), hidden)
            log_probs = tf.nn.log_softmax(predictions).numpy()

            candidates = []
            for b, (tokens, total) in enumerate(beams):
                added = 0
                for w in np.argsort(log_probs[b])[::-1]:      # most likely words first
                    w = int(w)
                    # no <pad>, no <unk>, no word twice in a row, no repeated pair of words
                    if w in (0, self.unk_id) or w == tokens[-1] or repeats_pair(tokens + [w]):
                        continue
                    candidates.append((tokens + [w], total + float(log_probs[b, w]), b))
                    added += 1
                    if added == BEAM_WIDTH:
                        break

            # The sentences that reached <end> are finished, the 5 best others continue
            candidates.sort(key=score, reverse=True)
            beams, parents = [], []
            for tokens, total, b in candidates:
                if tokens[-1] == self.end_id:
                    finished.append((tokens, total))
                else:
                    beams.append((tokens, total))
                    parents.append(b)
                if len(beams) == BEAM_WIDTH:
                    break
            if not beams:                    # every sentence has reached <end>
                break
            hidden = tf.gather(new_hidden, parents)   # each sentence keeps the GRU state of its parent

        # The best different sentences, best first
        ranked = sorted(finished if finished else beams, key=score, reverse=True)
        captions = []
        for tokens, _ in ranked:
            words = [self.tokenizer.index_word.get(t, "<unk>") for t in tokens[1:]]
            text = " ".join(w for w in words if w not in ("<start>", "<end>"))
            if text and text not in captions:
                captions.append(text)
            if len(captions) == N_CAPTIONS:
                break
        return captions

    def process(self, image, denoise="auto"):
        # The whole pipeline on one RGB image. denoise="auto": only noisy photos, "always": every photo
        with self.lock:
            p_photo = self.photo_probability(image)
            if p_photo <= PHOTO_THRESHOLD:
                # Not a photo: set aside, no denoising and no caption
                return {"is_photo": False, "photo_probability": p_photo, "noise_level": None, "denoised": False,
                        "caption": None, "alternatives": [], "denoised_image": None}

            photo = image.copy()
            photo.thumbnail((MAX_SIDE, MAX_SIDE))
            x = np.asarray(photo, dtype=np.float32) / 255.0
            sigma = float(np.mean([estimate_noise_sigma(x[..., c]) for c in range(3)]))

            denoised = denoise == "always" or sigma > NOISE_THRESHOLD
            if denoised:
                photo = Image.fromarray((self.denoise(x) * 255).round().astype(np.uint8))

            # Step 3: caption of the photo actually kept (denoised or not)
            captions = self.beam_search(self.encode_image(photo))

        return {"is_photo": True, "photo_probability": p_photo, "noise_level": sigma, "denoised": denoised,
                "caption": captions[0] if captions else "", "alternatives": captions[1:],
                "denoised_image": to_base64_jpeg(photo) if denoised else None}
