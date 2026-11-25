import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { patch } from "./api";

/**
 * Register for push notifications and send the Expo push token to the server
 * ("كسبت 50 ج من طلب جديد في شبكتك"). No-op on web and simulators. Never throws.
 */
export async function registerPush(): Promise<void> {
  if (Platform.OS === "web" || !Device.isDevice) return;
  try {
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "default", importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await patch("/me", { pushToken: data });
  } catch (e) {
    console.warn("[push] registration skipped", e);
  }
}
