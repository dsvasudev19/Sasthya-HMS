import type { ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native'

export const colors = {
  brand900: '#0f4a35',
  brand800: '#125c42',
  brand700: '#137550',
  brand500: '#26b172',
  brand300: '#84dfaa',
  brand200: '#b6ecc9',
  brand100: '#daf6e4',
  brand50: '#f0fbf4',
  lime: '#e9fccb',
  mint: '#a6ebcc',
  ink: '#0d1b14',
  muted: '#6f7f77',
  line: '#e3ece7',
  surface: '#f6faf7',
  white: '#ffffff',
  red: '#dc2626',
  redSoft: '#fee2e2',
  amberSoft: '#fef3c7',
  amber: '#b45309',
  skySoft: '#e0f2fe',
  sky: '#0369a1',
}

export const radius = { card: 24, pill: 999, field: 14 }

export function Screen({ children, scroll = true, bg = colors.surface }: { children: ReactNode; scroll?: boolean; bg?: string }) {
  const body = <View style={{ padding: 20, gap: 16 }}>{children}</View>
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>{body}</ScrollView> : body}
    </View>
  )
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, letterSpacing: -0.5 }}>{children}</Text>
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[{ fontSize: 13, color: colors.muted }, style as object]}>{children}</Text>
}

export function Button({ title, onPress, variant = 'primary', disabled, loading }: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; loading?: boolean
}) {
  const bg = variant === 'primary' ? colors.brand800 : variant === 'danger' ? colors.redSoft : colors.white
  const fg = variant === 'primary' ? colors.white : variant === 'danger' ? colors.red : colors.ink
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderWidth: variant === 'ghost' ? 1 : 0, borderColor: colors.line }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  )
}

export function Card({ children, highlight, style }: { children: ReactNode; highlight?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: colors.white, borderRadius: radius.card, padding: 18, borderWidth: highlight ? 3 : 1, borderColor: highlight ? colors.brand300 : colors.line, gap: 6 }, style]}>
      {children}
    </View>
  )
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: selected ? colors.brand800 : colors.white, borderColor: selected ? colors.brand800 : colors.line }]}>
      <Text style={{ color: selected ? colors.white : colors.ink, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

const BADGES: Record<string, { bg: string; fg: string; label: string }> = {
  COMPLETED: { bg: colors.brand100, fg: colors.brand700, label: 'Completed' },
  IN_PROGRESS: { bg: colors.brand800, fg: colors.white, label: 'In consultation' },
  CHECKED_IN: { bg: colors.amberSoft, fg: colors.amber, label: 'Waiting' },
  SCHEDULED: { bg: colors.skySoft, fg: colors.sky, label: 'Scheduled' },
  CANCELLED: { bg: colors.redSoft, fg: colors.red, label: 'Cancelled' },
  NO_SHOW: { bg: '#e7e5e4', fg: '#57534e', label: 'No show' },
}

export function StatusBadge({ status }: { status: string }) {
  const b = BADGES[status] ?? { bg: '#e7e5e4', fg: '#57534e', label: status }
  return (
    <View style={{ backgroundColor: b.bg, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: b.fg, fontSize: 12, fontWeight: '700' }}>{b.label}</Text>
    </View>
  )
}

export function TextField({ label, error, ...p }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...p} style={[styles.field, p.style]} />
      {error ? <Text style={{ color: colors.red, fontSize: 12 }}>{error}</Text> : null}
    </View>
  )
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, style]}>{children}</View>
}

export function ErrorText({ children }: { children?: string | null }) {
  return children ? <Text style={{ color: colors.red, fontSize: 13 }}>{children}</Text> : null
}

const styles = StyleSheet.create({
  button: { borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  chip: { borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1 },
  field: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.ink },
})
