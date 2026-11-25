import type { ReactNode } from "react";
import {
  ActivityIndicator, Pressable, type PressableProps, RefreshControl, ScrollView, type StyleProp, StyleSheet, Text,
  TextInput, type TextInputProps, type TextStyle, View, type ViewStyle,
} from "react-native";
import { formatEGP } from "@hightech/commission";
import { colors, STATUS_AR, STATUS_COLORS } from "./config";

export const money = formatEGP;

export function Screen({ children, refreshing, onRefresh, style }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[{ padding: 16, gap: 12, paddingBottom: 40 }, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h, style]}>{children}</Text>;
}

export function P({ children, muted, style, bold, testID }: { children: ReactNode; muted?: boolean; bold?: boolean; style?: StyleProp<TextStyle>; testID?: string }) {
  return <Text testID={testID} style={[s.p, muted && { color: colors.muted }, bold && { fontWeight: "700" }, style]}>{children}</Text>;
}

export function Button({ title, onPress, variant = "primary", loading, disabled, style, ...rest }: {
  title: string; variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean; style?: StyleProp<ViewStyle>;
} & Omit<PressableProps, "style" | "children">) {
  const bg = { primary: colors.blue, secondary: colors.navy, ghost: "transparent", danger: colors.red }[variant];
  const fg = variant === "ghost" ? colors.blue : "#fff";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "ghost" && { borderWidth: 1, borderColor: colors.blue }, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: { label?: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} style={[s.input, style]} {...props} />
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: colors.navy, borderColor: colors.navy }]}>
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ status, label }: { status: string; label?: string }) {
  const c = STATUS_COLORS[status] ?? colors.muted;
  return (
    <View style={[s.badge, { backgroundColor: c + "22" }]}>
      <Text style={{ color: c, fontWeight: "700", fontSize: 12 }}>{label ?? STATUS_AR[status] ?? status}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, style]}>{children}</View>;
}

export function Between({ label, value, bold }: { label: string; value: ReactNode; bold?: boolean }) {
  return (
    <Row style={{ justifyContent: "space-between" }}>
      <P muted={!bold} bold={bold}>{label}</P>
      <P bold={bold}>{value}</P>
    </Row>
  );
}

export function Banner({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "error" }) {
  const map = { info: ["#e8f0fe", colors.blue], warn: [colors.amberBg, colors.orange], error: ["#fde8e8", colors.red] } as const;
  const [bg, border] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderStartWidth: 4, borderColor: border, padding: 12, borderRadius: 10 }}>
      {typeof children === "string" ? <P>{children}</P> : children}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <P muted style={{ textAlign: "center", paddingVertical: 32 }}>{text}</P>;
}

export function Stepper({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <Row style={{ gap: 0 }}>
      <Pressable accessibilityLabel="زيادة" onPress={() => onChange(value + 1)} style={s.step}><Text style={s.stepText}>+</Text></Pressable>
      <Text style={{ minWidth: 36, textAlign: "center", fontWeight: "700", color: colors.text }}>{value}</Text>
      <Pressable accessibilityLabel="نقص" onPress={() => onChange(Math.max(min, value - 1))} style={[s.step, value <= min && { opacity: 0.4 }]}>
        <Text style={s.stepText}>−</Text>
      </Pressable>
    </Row>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} color={colors.blue} />;
}

export function formatDate(sqlTime: string | null | undefined) {
  if (!sqlTime) return "";
  const d = new Date(sqlTime.replace(" ", "T") + "Z");
  return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" });
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border },
  h: { fontSize: 18, fontWeight: "800", color: colors.text },
  p: { fontSize: 15, color: colors.text, lineHeight: 22 },
  btn: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 16, fontWeight: "700" },
  label: { fontSize: 14, color: colors.muted, fontWeight: "600" },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, backgroundColor: "#fff", color: colors.text, textAlign: "right",
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: "flex-start" },
  step: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  stepText: { fontSize: 20, fontWeight: "700", color: colors.navy },
});
