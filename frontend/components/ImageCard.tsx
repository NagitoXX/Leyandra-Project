import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { Button } from './Button';
import type { Palette } from '../theme';
import type { Item } from '../types';

const MAX_IMAGE_HEIGHT = 360;
const NOISE_THRESHOLD = 0.04; // same value as the backend, only used for the text under the photo

type Props = {
  item: Item;
  width: number;
  palette: Palette;
  busy: boolean;          // true while images are being processed: no remove / retry
  onRemove: () => void;
  onRetry: () => void;
};

const percent = (p: number) => `${Math.round(p * 100)} %`;

// One image: the picture, its status, and the result once the backend has answered
export function ImageCard({ item, width, palette, busy, onRemove, onRetry }: Props) {
  const [view, setView] = useState<'original' | 'denoised'>('denoised');
  const [copied, setCopied] = useState(false);
  const r = item.result;

  // Picture shown: the denoised photo if there is one and it is selected, otherwise the original
  const showDenoised = !!r?.denoised_image && view === 'denoised';
  const uri = showDenoised ? `data:image/jpeg;base64,${r!.denoised_image}` : item.asset.uri;
  const ratio = item.asset.width && item.asset.height ? item.asset.width / item.asset.height : 4 / 3;
  const imageHeight = Math.min(MAX_IMAGE_HEIGHT, width / ratio);

  async function copyCaption() {
    if (!r?.caption) return;
    await Clipboard.setStringAsync(r.caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Small label on the picture
  let chip = { text: 'Waiting', color: palette.muted, bg: palette.card };
  if (item.status === 'processing') chip = { text: 'Processing…', color: palette.info, bg: palette.infoBg };
  if (item.status === 'error') chip = { text: 'Error', color: palette.error, bg: palette.errorBg };
  if (item.status === 'done' && r?.is_photo) chip = { text: `Photo · ${percent(r.photo_probability)}`, color: palette.ok, bg: palette.okBg };
  if (item.status === 'done' && r && !r.is_photo) chip = { text: 'Not a photo', color: palette.warn, bg: palette.warnBg };

  return (
    <View style={[styles.card, { width, backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.imageBox, { height: imageHeight, backgroundColor: palette.imageBg }]}>
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />

        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.color }]}>{chip.text}</Text>
        </View>

        {!busy && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
            onPress={onRemove}
            style={[styles.remove, { backgroundColor: palette.card }]}
          >
            <Ionicons name="close" size={18} color={palette.text} />
          </Pressable>
        )}

        {item.status === 'processing' && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={[styles.name, { color: palette.muted }]} numberOfLines={1}>
          {item.name}
        </Text>

        {item.status === 'waiting' && (
          <Text style={{ color: palette.muted }}>Ready to be processed.</Text>
        )}

        {item.status === 'processing' && (
          <Text style={{ color: palette.muted }}>Photo check, noise, caption…</Text>
        )}

        {item.status === 'error' && (
          <View style={styles.rowBetween}>
            <Text style={[styles.flex, { color: palette.error }]}>{item.error}</Text>
            {!busy && <Button icon="refresh" label="Retry" variant="outline" palette={palette} onPress={onRetry} />}
          </View>
        )}

        {/* Not a photo: set aside */}
        {item.status === 'done' && r && !r.is_photo && (
          <Text style={{ color: palette.text }}>
            Set aside, no caption. Probability of being a photo: {percent(r.photo_probability)}.
          </Text>
        )}

        {/* Photo: caption, other suggestions, noise, original / denoised */}
        {item.status === 'done' && r?.is_photo && (
          <>
            <Text style={[styles.caption, { color: palette.text }]}>{r.caption || '(no caption)'}</Text>

            {r.alternatives.length > 0 && (
              <View style={styles.alternatives}>
                <Text style={[styles.small, { color: palette.muted }]}>Other suggestions</Text>
                {r.alternatives.map((a) => (
                  <Text key={a} style={{ color: palette.muted }}>
                    • {a}
                  </Text>
                ))}
              </View>
            )}

            <Text style={[styles.small, { color: palette.muted }]}>{noiseText(r.noise_level, r.denoised)}</Text>

            <View style={styles.rowBetween}>
              {r.denoised_image ? (
                <View style={[styles.segment, { borderColor: palette.border }]}>
                  {(['original', 'denoised'] as const).map((v) => (
                    <Pressable
                      key={v}
                      accessibilityRole="button"
                      onPress={() => setView(v)}
                      style={[styles.segmentItem, view === v && { backgroundColor: palette.primary }]}
                    >
                      <Text style={[styles.segmentText, { color: view === v ? palette.onPrimary : palette.text }]}>
                        {v === 'original' ? 'Original' : 'Denoised'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View />
              )}
              <View style={styles.actions}>
                <Button
                  icon={copied ? 'checkmark' : 'copy-outline'}
                  label={copied ? 'Copied' : 'Copy'}
                  variant="ghost"
                  palette={palette}
                  onPress={copyCaption}
                />
                {!busy && (
                  <Button icon="refresh" variant="ghost" palette={palette} onPress={onRetry} accessibilityLabel="Run again" />
                )}
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

// Explains why the photo was denoised or not
function noiseText(sigma: number | null, denoised: boolean): string {
  if (sigma === null) return '';
  const s = `σ = ${sigma.toFixed(3)}`;
  if (!denoised) return `Clean photo (${s}): captioned as it is, not denoised.`;
  if (sigma > NOISE_THRESHOLD) return `Noisy photo (${s}): denoised by the U-Net before the caption.`;
  return `Denoised on request (${s}), the photo was already clean.`;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  imageBox: { width: '100%', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' },
  chip: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '700' },
  remove: { position: 'absolute', top: 8, right: 8, borderRadius: 999, padding: 6 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  body: { padding: 16, gap: 10 },
  name: { fontSize: 13 },
  caption: { fontSize: 22, fontWeight: '600', lineHeight: 30 },
  alternatives: { gap: 2 },
  small: { fontSize: 13 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segmentItem: { paddingVertical: 7, paddingHorizontal: 12 },
  segmentText: { fontSize: 14, fontWeight: '600' },
});
