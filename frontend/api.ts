import { Platform } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';

import { API_URL } from './config';
import type { CaptionResult, DenoiseMode } from './types';

// The models run on the CPU of the PC: one image takes a few seconds, the first one a bit more
const TIMEOUT_MS = 60_000;

// True when the server could not be reached at all (then there is no point trying the next images)
export function isNetworkError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { network?: boolean }).network === true;
}

export async function getCaption(asset: ImagePickerAsset, name: string, denoise: DenoiseMode): Promise<CaptionResult> {
  const type = asset.mimeType ?? 'image/jpeg';
  const form = new FormData();

  if (Platform.OS === 'web') {
    // In the browser the file is a real Blob (read from its uri if the picker did not give it)
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    form.append('file', blob, name);
  } else {
    // On a phone, React Native sends the file from its uri
    form.append('file', { uri: asset.uri, name, type } as unknown as Blob);
  }

  // The request is cancelled if the server takes too long
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/caption?denoise=${denoise}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error('The server took too long to answer. Try again.');
    }
    throw Object.assign(new Error(`Cannot reach the server at ${API_URL}. Is the backend running?`), { network: true });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The backend explains the problem in "detail" (not an image, too big...)
    let message = `Server error (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') message = body.detail;
    } catch {
      // no JSON in the answer, we keep the generic message
    }
    throw new Error(message);
  }
  return (await response.json()) as CaptionResult;
}
