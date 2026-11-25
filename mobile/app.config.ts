import type { ExpoConfig } from "expo/config";

// One codebase, two store apps:  EXPO_PUBLIC_APP_VARIANT=retail (default) | wholesale
// (APP_VARIANT is accepted too, e.g. from EAS build profiles.)
const variant = (process.env.EXPO_PUBLIC_APP_VARIANT ?? process.env.APP_VARIANT) === "wholesale" ? "wholesale" : "retail";
// The app code reads the variant from this inlined env var (works on native and web).
process.env.EXPO_PUBLIC_APP_VARIANT = variant;
const retail = variant === "retail";

const config: ExpoConfig = {
  name: retail ? "High Tech" : "High Tech جملة",
  slug: retail ? "hightech-retail" : "hightech-wholesale",
  scheme: retail ? "hightech" : "hightech-wholesale",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  // Placeholder: replace with the High Tech logo (plan section 8).
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: retail ? "com.hightech.retail" : "com.hightech.wholesale",
    supportsTablet: false,
  },
  android: {
    package: retail ? "com.hightech.retail" : "com.hightech.wholesale",
    adaptiveIcon: { foregroundImage: "./assets/icon.png", backgroundColor: "#0b2447" },
    // Open share links (https://DOMAIN/r/CODE or /w/CODE) straight in the app.
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: process.env.LINK_HOST ?? "hightech.example", pathPrefix: retail ? "/r/" : "/w/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: { bundler: "metro", output: "single" },
  locales: { ar: "./assets/locale-ar.json" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { color: "#2f80ed" }],
  ],
  extra: {
    variant,
    supportsRTL: true,
    forcesRTL: true,
  },
};

export default config;
