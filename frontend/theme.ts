import { useColorScheme } from 'react-native';

// Colours of the app, one set for light mode and one for dark mode
const light = {
  bg: '#f3f5f8',
  card: '#ffffff',
  text: '#14181d',
  muted: '#5c6773',
  border: '#dfe4ea',
  primary: '#2b5c8a',
  onPrimary: '#ffffff',
  imageBg: '#e9edf2',
  ok: '#1d7a4b',
  okBg: '#e3f4ea',
  warn: '#9a4f12',
  warnBg: '#fcefe2',
  error: '#b3261e',
  errorBg: '#fdecea',
  info: '#2b5c8a',
  infoBg: '#e6eef7',
};

export type Palette = typeof light;

const dark: Palette = {
  bg: '#0f1216',
  card: '#191e24',
  text: '#eef1f4',
  muted: '#9aa5b1',
  border: '#2a323b',
  primary: '#6ea8dc',
  onPrimary: '#0f1216',
  imageBg: '#11161b',
  ok: '#5cc08b',
  okBg: '#173326',
  warn: '#e8a36a',
  warnBg: '#3a2615',
  error: '#f2867e',
  errorBg: '#3b1b19',
  info: '#8dbbe6',
  infoBg: '#1b2b3b',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
