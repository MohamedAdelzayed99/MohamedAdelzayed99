import Constants from "expo-constants";

export type Variant = "retail" | "wholesale";

// EXPO_PUBLIC_* is inlined at build time; Constants is a fallback for native builds.
export const VARIANT: Variant =
  (process.env.EXPO_PUBLIC_APP_VARIANT ?? Constants.expoConfig?.extra?.variant) === "wholesale" ? "wholesale" : "retail";
export const IS_RETAIL = VARIANT === "retail";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const API_BASE = `${API_URL}/api/${VARIANT}`;

export const colors = {
  navy: "#0b2447",
  navy2: "#19376d",
  blue: "#2f80ed",
  bg: "#f3f6fb",
  card: "#ffffff",
  text: "#0b2447",
  muted: "#64748b",
  border: "#dbe3ef",
  green: "#16a34a",
  orange: "#f59e0b",
  red: "#dc2626",
  amberBg: "#fff7e6",
};

/** Text that differs between the two apps. */
export const t = {
  appName: IS_RETAIL ? "High Tech" : "High Tech جملة",
  ordersTab: IS_RETAIL ? "طلباتي" : "فواتيري",
  order: IS_RETAIL ? "طلب" : "فاتورة",
  yourOrder: IS_RETAIL ? "طلبك" : "فاتورتك",
  walletTab: IS_RETAIL ? "محفظتي" : "رصيد الخصم",
  balanceLabel: IS_RETAIL ? "رصيد متاح" : "رصيد الخصم المتاح",
  networkMembers: IS_RETAIL ? "شخص" : "محل",
};

export const PAYMENT_LABELS: Record<string, string> = {
  cod: "كاش عند الاستلام",
  card: "كارت",
  wallet: "محفظة إلكترونية",
};

export const WITHDRAW_LABELS: Record<string, string> = {
  vodafone_cash: "فودافون كاش",
  instapay: "إنستاباي",
  bank_transfer: "تحويل بنكي",
};

export const STATUS_COLORS: Record<string, string> = {
  placed: colors.blue,
  confirmed: colors.navy2,
  shipped: colors.orange,
  delivered: colors.green,
  returned: colors.red,
  cancelled: colors.muted,
  pending: colors.orange,
  available: colors.green,
  requested: colors.orange,
  approved: colors.blue,
  paid: colors.green,
  rejected: colors.red,
};

export const STATUS_AR: Record<string, string> = {
  placed: "تم الطلب",
  confirmed: "تم التأكيد",
  shipped: "في الطريق",
  delivered: "تم التسليم",
  returned: "مرتجع",
  cancelled: "ملغي",
  pending: "معلّق",
  available: "متاح",
  requested: "قيد المراجعة",
  approved: "تمت الموافقة",
  paid: "تم التحويل",
  rejected: "مرفوض",
};
