import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { VARIANT } from "./config";

const key = (k: string) => `hightech.${VARIANT}.${k}`;

/** Session token: SecureStore on devices, localStorage on web. */
export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key("token")) ?? null;
    return SecureStore.getItemAsync(key("token").replace(/[^\w.-]/g, "_"));
  },
  async set(token: string | null): Promise<void> {
    if (Platform.OS === "web") {
      if (token) globalThis.localStorage?.setItem(key("token"), token);
      else globalThis.localStorage?.removeItem(key("token"));
      return;
    }
    const k = key("token").replace(/[^\w.-]/g, "_");
    if (token) await SecureStore.setItemAsync(k, token);
    else await SecureStore.deleteItemAsync(k);
  },
};

/** Offline cache (plan section 6): the phone keeps a copy, the server stays the source of truth. */
export const cache = {
  async get<T>(k: string): Promise<T | undefined> {
    try {
      const v = await AsyncStorage.getItem(key(k));
      return v ? (JSON.parse(v) as T) : undefined;
    } catch {
      return undefined;
    }
  },
  async set(k: string, v: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key(k), JSON.stringify(v));
    } catch {
      /* cache is best-effort */
    }
  },
  async clearUserData(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(key("")) && !k.endsWith("products") && !k.endsWith("categories")));
  },
};
