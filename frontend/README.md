# Leyenda demo – frontend

One screen built with **React Native + Expo**: the same code runs in a web browser, on Android and on iOS.

1. Choose **up to 10 images** at once (or take photos on a phone, one at a time).
2. Choose the denoising mode: **Auto** (only noisy photos go through the U-Net, by default) or **Always**.
3. Press **Caption N images**. The images are sent one after the other, so each card is filled as soon as its result is ready, with a progress bar.

Each image gets a card:

- **photo**: the caption in large text, up to 2 other suggestions, the noise level and whether the photo was denoised, an **Original / Denoised** switch when it was, a **Copy** button for the caption;
- **not a photo**: "Not a photo", set aside, with the probability of being a photo;
- **error**: the reason (not an image, too big, server unreachable) and a **Retry** button.

Images can be removed one by one or all together. On a large screen the cards are on two columns, on a phone on one. Light and dark mode follow the system.

Everything is computed by the backend (`../backend`), which must be running first.

## Files

| File | Role |
|---|---|
| `App.tsx` | the screen: image choice, denoising mode, processing loop, summary |
| `components/ImageCard.tsx` | the card of one image and its result |
| `components/Button.tsx` | button with an icon |
| `api.ts` | sends one image to the backend (web and phone build the file differently) |
| `types.ts` | shapes of the data |
| `theme.ts` | colours, light and dark |
| `config.ts` | backend address |

## Install

Node.js 22 or newer is needed (Node 24 works).

```powershell
cd "C:\Projet data\frontend"
npm install
```

## Run

```powershell
npx expo start
```

- **Browser**: press `w`. The app opens at <http://localhost:8081> and talks to the backend at `http://localhost:8000`, nothing to set up.
- **Phone**: install **Expo Go** (Play Store / App Store), then scan the QR code shown in the terminal (with the camera on iPhone, from Expo Go on Android). The phone must be on the same Wi-Fi as the PC, and the backend address must be set (below).

## Backend address

The address is read in `config.ts` from `EXPO_PUBLIC_API_URL`, with `http://localhost:8000` by default.

On a phone, `localhost` means the phone itself, so the app must use the **IP of the PC** instead:

1. Find the IP of the PC with `ipconfig` (IPv4 Address of the Wi-Fi adapter, for example `192.168.1.20`).
2. Copy `.env.example` to `.env` and put this IP in it:

   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.20:8000
   ```

3. Restart Expo with an empty cache so the new value is used:

   ```powershell
   npx expo start -c
   ```

With the IP in `.env`, the browser version also works (on this PC or another computer of the network).

If the phone cannot reach the backend, open `http://<IP>:8000/health` in the phone's browser: if it does not answer, the Windows firewall rule of the backend README is missing.
