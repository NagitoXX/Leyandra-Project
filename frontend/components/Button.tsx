import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Palette } from '../theme';

type Props = {
  label?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  palette: Palette;
  variant?: 'primary' | 'outline' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

// Button with an optional icon: filled for the main action, outlined or plain for the others
export function Button({ label, icon, onPress, palette, variant = 'primary', disabled, style, accessibilityLabel }: Props) {
  const color = variant === 'primary' ? palette.onPrimary : palette.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && { backgroundColor: palette.primary },
        variant === 'outline' && { borderWidth: 1.5, borderColor: palette.primary },
        !label && styles.iconOnly,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={18} color={color} />}
      {label && <Text style={[styles.label, { color }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  iconOnly: { paddingHorizontal: 10, paddingVertical: 8 },
  label: { fontSize: 15, fontWeight: '600' },
});
