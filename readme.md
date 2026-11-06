# Project Leyenda: automatic captioning of archive photos

A school project (CESI, Data Science) for **TouNum**, a company that digitizes paper archives. Their scans mix photos with text pages, drawings, paintings and diagrams, and the photos are often noisy. The goal: **find the photos, clean them, and write a caption for each one**, automatically.

```
 scanned image ──► 1. Is it a photo? ──► 2. Remove the noise ──► 3. Write a caption ──► "a group of people standing in the snow"
                     (CNN classifier)      (U-Net denoiser)        (CNN encoder + RNN decoder)
```

Each step is a deliverable with its own notebook. The notebooks are saved **with their outputs**, so you can read the results and figures directly on GitHub without running anything.

---

## Results at a glance

| Step | Notebook | Best model | Result |
|---|---|---|---|
| 1. Photo or not? | [`Livrable1_Classification_Photo.ipynb`](Livrable1_Classification_Photo.ipynb) | CNN with dropout, data augmentation and early stopping | **92.0 %** accuracy on test images |
| 2. Denoising | [`Livrable2_Denoising_final.ipynb`](Livrable2_Denoising_final.ipynb) | U-Net with skip connections | **29.9 dB** PSNR (SSIM 0.847), better than our auto-encoder on every test photo |
| 3. Captioning | [`Livrable3_Captioning.ipynb`](Livrable3_Captioning.ipynb) | InceptionV3 features + attention + GRU, trained on all of MS COCO | test loss per word **2.80** (first version: 4.93) |

Some captions written by the final model:

| Photo | Caption |
|---|---|
| COCO test photo of a kitchen | "a kitchen with a sink and a refrigerator" |
| COCO test photo of a bathroom | "a bathroom with a sink and a mirror" |
| Web photo: a river in a meadow | "a group of horses grazing on a grassy hill" (right scene, invented horses) |
| Web photo: a dog | "a teddy bear sitting on a bed" (wrong) |

The model does well on photos that look like COCO, but it often **invents details** on other photos. See [Limits](#limits).

---

## How it works

### 1. Is it a photo?

A convolutional neural network sorts the images into **photo** and **not a photo**. It was trained on about 41,500 images (photos, paintings, diagrams, drawings, text), resized to 180×180.

A first model reached 99 % on its training images but only 91 % on new ones, which is a clear sign of overfitting. Adding **dropout**, **data augmentation** (random flips, rotations, zooms) and **early stopping** brought the test accuracy to 92 %, with almost no gap between training and test.

### 2. Removing the noise

The photos have no clean version, so we add Gaussian noise to them ourselves and train a network to remove it: noisy photo in, clean photo out. We compared several models on the same 23 test photos:

| Model | PSNR |
|---|---|
| Auto-encoder, trained on whole photos shrunk to 128×128 | below a simple Gaussian blur |
| Same auto-encoder, trained on patches at the real resolution | 28.1 dB |
| **U-Net** (skip connections let the fine details bypass the bottleneck) | **29.9 dB** |

One finding changed the pipeline: denoising a photo that is **already clean makes it worse**, and most real photos are only slightly noisy. So the final pipeline first **estimates the noise level** and only denoises photos above a threshold.

### 3. Writing a caption

This is the classic "Show, Attend and Tell" approach:

1. **Encoder:** InceptionV3, pre-trained on ImageNet, turns each photo into an 8×8 grid of features. They are computed once and stored on disk.
2. **Attention:** at each word, the model chooses which part of the photo to look at.
3. **Decoder:** a GRU writes the caption word by word. Its word vectors start from **GloVe** (pre-trained on billions of words).

Training uses all of **MS COCO 2014**: 74,145 training photos with about 5 captions each, a validation set with early stopping, and dropout. Captions are written with **beam search**, which keeps the 3 best sentences at each step.

### The full pipeline

Section 7 of the Livrable 3 notebook puts everything together. It takes a folder of images, sets aside the non-photos, denoises the noisy photos and captions the rest. On 17 images from the web, the classifier got 16 right, and the captions find the main subject most of the time.

---

## Repository contents

| File / folder | What it is |
|---|---|
| `Livrable1_Classification_Photo.ipynb` | Step 1 notebook |
| `Livrable2_Denoising_final.ipynb` | Step 2 notebook |
| `Livrable3_Captioning.ipynb` | Step 3 notebook, and the full pipeline (Section 7) |
| `captioning_train.py` | Captioning model and training script (written by the Livrable 3 notebook) |
| `modele_photo_improved.keras` | Final photo classifier |
| `denoiser_rgb_v3.keras` | Final denoiser (U-Net) |
| `modele_captioning/` | Final captioning model: weights, vocabulary and sizes |
| `Livrable2_Denoising.ipynb` | Earlier version of the step 2 notebook (auto-encoder only, before the U-Net) |
| `modele_photo.keras`, `denoiser_rgb.keras`, `denoiser_rgb_v2.keras` | Earlier models, kept for comparison |

The model files are stored with **Git LFS**. The datasets are not included: the step 1 and step 2 images were provided by the school, and MS COCO is too large for GitHub.

---

## Running it yourself

1. **Clone with Git LFS**, otherwise the model files are only small pointer files:
   ```bash
   git lfs install
   git clone https://github.com/NagitoXX/Leyandra-Project.git
   ```
2. **Install Python 3.12** and the libraries:
   ```bash
   pip install tensorflow numpy pandas scipy scikit-learn matplotlib pillow tqdm jupyter
   ```
3. **Set the data paths** at the top of each notebook (they currently point to our own folders).
4. **For step 3**, download the MS COCO 2014 caption annotations. The notebook downloads the missing images and the GloVe vectors itself.

A GPU is strongly recommended for step 3: on our laptop (RTX 4060), downloading the COCO images and extracting their features took about 2 hours, and the training about 5 hours 30 minutes (25 epochs).

To only **use** the trained models, you don't need to train anything: Section 7 of the Livrable 3 notebook reloads the saved models and runs the full pipeline on your own folder of images.

---

## Limits

- **Invented details.** COCO is full of people doing sports and animals in fields, so the captioning model tends to add a frisbee or a baseball bat as soon as it sees a person, or horses on grass.
- **Small details are lost.** The model only sees each photo as an 8×8 grid of InceptionV3 features.
- **Synthetic noise.** The denoiser was trained on Gaussian noise that we added ourselves, which is not exactly the noise of a real scan.



---

## Team

Fernanda Gentil, Haytam El hilali, Felipe Lobos. CESI, Data Science block.
