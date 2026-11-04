# Leyenda demo – backend

A small FastAPI server that runs the whole Leyenda pipeline on one image:

1. **Deliverable 1** – is it a photo? (`modele_photo_improved.keras`)
2. **Deliverable 2** – denoising of the photo (`denoiser_rgb_v3.keras`, U-Net)
3. **Deliverable 3** – caption of the photo (`modele_captioning/` + `captioning_train.py`, beam search)

If the image is not a photo, it stops after step 1 and returns no caption.

Compared with section 7 of the notebook, three things were changed to get better captions:

- **The photo is only denoised if it is noisy.** Its noise level σ is estimated with the Immerkaer estimator (same as Deliverable 2). Deliverable 2 showed that below σ = 0.04 the U-Net makes the photo worse, and most real photos are around 0.02, so a clean photo is captioned as it is, with all its details. `?denoise=always` forces the denoising.
- **Beam search keeps 5 sentences** instead of 3, all computed in one batch, and it never writes `<unk>` or the same word twice in a row.
- **The 3 best different captions** are returned: the main one and 2 alternatives.

It runs on Windows with Python 3.13, on the CPU. The models are read from the project root (the folder above `backend/`), so nothing has to be copied.

## Start the server

In PowerShell:

```powershell
cd "C:\Projet data\backend"
python -m pip install -r requirements.txt   # only if a package is missing
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Loading the models takes 10 to 30 seconds. The server is ready when uvicorn prints `Application startup complete`.

- Check: open <http://localhost:8000/health>, it answers `{"status": "ok"}`.
- Try it without the app: <http://localhost:8000/docs>, then `POST /caption` → *Try it out* → choose an image.

`--host 0.0.0.0` makes the server reachable from the other devices of the Wi-Fi network, not only from this PC.

## API

| Method | Route | Body | Answer |
|---|---|---|---|
| GET | `/health` | – | `{"status": "ok"}` |
| POST | `/caption?denoise=auto` | multipart form, field `file` (JPG or PNG, 10 MB max) | see below |

The answer:

| Field | Meaning |
|---|---|
| `is_photo` | `true` if the classifier sees a photo |
| `photo_probability` | probability of being a photo (0 to 1) |
| `noise_level` | estimated noise σ of the photo (`null` if not a photo) |
| `denoised` | `true` if the photo went through the U-Net |
| `caption` | the best caption (`null` if not a photo) |
| `alternatives` | up to 2 other captions, next best first |
| `denoised_image` | the denoised photo as a base64 JPEG (`null` if it was not denoised) |

`denoise` is `auto` (only noisy photos, by default) or `always`. The app sends one image per request, one after the other, so each result shows up as soon as it is ready. A file that is not an image gives an error 400, a file over 10 MB an error 413.

## Use it from a phone

The phone and the PC must be on the **same Wi-Fi**.

1. Find the IP address of the PC:

   ```powershell
   ipconfig
   ```

   Look for **IPv4 Address** under the Wi-Fi adapter, for example `192.168.1.20`.

2. Let the phone reach port 8000 through the Windows firewall (PowerShell **as administrator**, private networks only):

   ```powershell
   New-NetFirewallRule -DisplayName "Leyenda demo (port 8000)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
   ```

   The Wi-Fi must be set as a **private** network in Windows (Settings → Network & Internet → Wi-Fi → your network → Private).

3. Check from the phone's browser: `http://192.168.1.20:8000/health` (with your IP).

To remove the rule after the demo:

```powershell
Remove-NetFirewallRule -DisplayName "Leyenda demo (port 8000)"
```
