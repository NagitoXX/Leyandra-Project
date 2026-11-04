import type { ImagePickerAsset } from 'expo-image-picker';

// "auto": only noisy photos are denoised, "always": every photo goes through the U-Net
export type DenoiseMode = 'auto' | 'always';

// What the backend sends back for one image
export type CaptionResult = {
  is_photo: boolean;
  photo_probability: number;
  noise_level: number | null;    // estimated noise sigma of the photo
  denoised: boolean;
  caption: string | null;
  alternatives: string[];        // other captions, next best first
  denoised_image: string | null; // denoised photo, JPEG in base64
};

export type Status = 'waiting' | 'processing' | 'done' | 'error';

// One chosen image and where it is in the processing
export type Item = {
  id: string;
  asset: ImagePickerAsset;
  name: string;
  status: Status;
  result?: CaptionResult;
  error?: string;
};
