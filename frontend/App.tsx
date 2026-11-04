import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { getCaption, isNetworkError } from './api';
import { Button } from './components/Button';
import { ImageCard } from './components/ImageCard';
import { API_URL } from './config';
import { usePalette, type Palette } from './theme';
import type { DenoiseMode, Item } from './types';

const MAX_IMAGES = 10;      // images at a time
const MAX_WIDTH = 1000;     // width of the page on a large screen

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.9,
  // iPhone: ask for a JPEG instead of a HEIC photo, which the backend cannot read
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [items, setItems] = useState<Item[]>([]);
  const [denoise, setDenoise] = useState<DenoiseMode>('auto');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState<string | null>(null);

  // Two columns of cards on a large screen, one on a phone
  const contentWidth = Math.min(width - 32, MAX_WIDTH);
  const columns = contentWidth >= 760 ? 2 : 1;
  const cardWidth = columns === 2 ? (contentWidth - 16) / 2 : contentWidth;

  const update = (id: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  // Gallery (several images, or the file explorer in a browser) or camera (one photo, on a phone)
  async function addImages(fromCamera: boolean) {
    setNotice(null);
    const room = MAX_IMAGES - items.length;
    if (room <= 0) {
      setNotice(`${MAX_IMAGES} images at a time at most. Remove some before adding new ones.`);
      return;
    }
    if (fromCamera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setNotice('Camera access was refused.');
        return;
      }
    }
    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync({ ...PICKER_OPTIONS, allowsMultipleSelection: true, selectionLimit: room });
    if (picked.canceled) return;

    if (picked.assets.length > room) {
      setNotice(`Only the first ${room} images were added (${MAX_IMAGES} at a time at most).`);
    }
    const stamp = Date.now();
    setItems((prev) => [
      ...prev,
      ...picked.assets.slice(0, room).map((asset, i) => ({
        id: `${stamp}-${i}`,
        asset,
        name: asset.fileName ?? `image-${prev.length + i + 1}.jpg`,
        status: 'waiting' as const,
      })),
    ]);
  }

  // Sends the images one after the other: each card is filled as soon as its result arrives
  async function processItems(queue: Item[]) {
    if (queue.length === 0) return;
    setBusy(true);
    setNotice(null);
    setProgress({ done: 0, total: queue.length });
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      update(item.id, { status: 'processing', error: undefined });
      try {
        const result = await getCaption(item.asset, item.name, denoise);
        update(item.id, { status: 'done', result });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Something went wrong.';
        update(item.id, { status: 'error', error: message });
        if (isNetworkError(e)) {
          // Server unreachable: the next images would fail the same way
          setNotice(message);
          queue.slice(i + 1).forEach((rest) => update(rest.id, { status: 'waiting' }));
          break;
        }
      }
      setProgress({ done: i + 1, total: queue.length });
    }
    setBusy(false);
  }

  const toProcess = items.filter((it) => it.status === 'waiting' || it.status === 'error');
  const done = items.filter((it) => it.status === 'done');
  const photos = done.filter((it) => it.result?.is_photo).length;
  const setAside = done.length - photos;
  const errors = items.filter((it) => it.status === 'error').length;

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg }]}>
      <StatusBar style="auto" />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 48 }]}
      >
        <View style={[styles.column, { width: contentWidth }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.logo, { backgroundColor: palette.primary }]}>
              <Ionicons name="sparkles-outline" size={22} color={palette.onPrimary} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: palette.text }]}>Leyenda</Text>
              <Text style={[styles.subtitle, { color: palette.muted }]}>
                Photo or not, denoising and caption, for up to {MAX_IMAGES} images at a time.
              </Text>
            </View>
          </View>

          {/* Empty state: big zone to choose the images */}
          {items.length === 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => addImages(false)}
              style={({ pressed }) => [
                styles.dropZone,
                { borderColor: palette.primary, backgroundColor: palette.card, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="images-outline" size={44} color={palette.primary} />
              <Text style={[styles.dropTitle, { color: palette.text }]}>Choose images</Text>
              <Text style={{ color: palette.muted, textAlign: 'center' }}>
                JPG or PNG, up to {MAX_IMAGES} at a time. Photos get a caption, the other images are set aside.
              </Text>
              {Platform.OS !== 'web' && (
                <Button icon="camera-outline" label="Take a photo" variant="outline" palette={palette} onPress={() => addImages(true)} />
              )}
            </Pressable>
          ) : (
            <View style={[styles.panel, { backgroundColor: palette.card, borderColor: palette.border }]}>
              {/* Add / clear */}
              <View style={styles.row}>
                <Button icon="images-outline" label="Add images" variant="outline" palette={palette}
                  onPress={() => addImages(false)} disabled={busy || items.length >= MAX_IMAGES} />
                {Platform.OS !== 'web' && (
                  <Button icon="camera-outline" label="Take a photo" variant="outline" palette={palette}
                    onPress={() => addImages(true)} disabled={busy || items.length >= MAX_IMAGES} />
                )}
                <Button icon="trash-outline" label="Clear all" variant="ghost" palette={palette}
                  onPress={() => setItems([])} disabled={busy} />
              </View>

              {/* Denoising mode */}
              <View style={styles.denoiseRow}>
                <Text style={[styles.small, { color: palette.muted }]}>Denoising</Text>
                <Segmented
                  value={denoise}
                  options={[{ value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }]}
                  onChange={setDenoise}
                  palette={palette}
                  disabled={busy}
                />
              </View>
              <Text style={[styles.small, { color: palette.muted }]}>
                {denoise === 'auto'
                  ? 'Auto: only noisy photos go through the U-Net. On a clean photo it removes details and the caption gets worse.'
                  : 'Always: every photo goes through the U-Net before the caption, even a clean one.'}
              </Text>

              {/* Main button and progress */}
              <Button
                icon="sparkles-outline"
                label={busy
                  ? `Processing ${Math.min(progress.done + 1, progress.total)} / ${progress.total}…`
                  : toProcess.length > 0
                    ? `Caption ${toProcess.length} image${toProcess.length > 1 ? 's' : ''}`
                    : 'All images are done'}
                palette={palette}
                onPress={() => processItems(toProcess)}
                disabled={busy || toProcess.length === 0}
              />
              {busy && (
                <View style={[styles.progressTrack, { backgroundColor: palette.imageBg }]}>
                  <View
                    style={[
                      styles.progressBar,
                      {
                        backgroundColor: palette.primary,
                        width: `${(100 * progress.done) / Math.max(1, progress.total)}%` as `${number}%`,
                      },
                    ]}
                  />
                </View>
              )}

              {/* Summary */}
              {done.length + errors > 0 && !busy && (
                <Text style={{ color: palette.text }}>
                  {photos} photo{photos === 1 ? '' : 's'} captioned · {setAside} set aside
                  {errors > 0 ? ` · ${errors} error${errors > 1 ? 's' : ''}` : ''}
                </Text>
              )}
            </View>
          )}

          {notice && (
            <View style={[styles.notice, { backgroundColor: palette.errorBg }]}>
              <Ionicons name="alert-circle-outline" size={18} color={palette.error} />
              <Text style={[styles.flex, { color: palette.error }]}>{notice}</Text>
            </View>
          )}

          {/* Cards */}
          <View style={styles.grid}>
            {items.map((item) => (
              <ImageCard
                key={item.id}
                item={item}
                width={cardWidth}
                palette={palette}
                busy={busy}
                onRemove={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                onRetry={() => processItems([item])}
              />
            ))}
          </View>

          <Text style={[styles.footer, { color: palette.muted }]}>Server: {API_URL}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

type SegmentedProps<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  palette: Palette;
  disabled?: boolean;
};

// Small two-choice switch
function Segmented<T extends string>({ value, options, onChange, palette, disabled }: SegmentedProps<T>) {
  return (
    <View style={[styles.segment, { borderColor: palette.border, opacity: disabled ? 0.5 : 1 }]}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => onChange(o.value)}
          style={[styles.segmentItem, value === o.value && { backgroundColor: palette.primary }]}
        >
          <Text style={[styles.segmentText, { color: value === o.value ? palette.onPrimary : palette.text }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 16 },
  column: { gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 21 },
  flex: { flex: 1 },
  dropZone: { borderWidth: 2, borderStyle: 'dashed', borderRadius: 16, padding: 32, alignItems: 'center', gap: 10 },
  dropTitle: { fontSize: 20, fontWeight: '700' },
  panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  denoiseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  small: { fontSize: 13, lineHeight: 18 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBar: { height: 6, borderRadius: 3 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  footer: { fontSize: 12, textAlign: 'center' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segmentItem: { paddingVertical: 7, paddingHorizontal: 14 },
  segmentText: { fontSize: 14, fontWeight: '600' },
});
