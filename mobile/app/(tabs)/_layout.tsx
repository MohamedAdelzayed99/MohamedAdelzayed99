import { useCallback, useState } from "react";
import { type ColorValue, Pressable, Text, View } from "react-native";
import { Redirect, router, useFocusEffect } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { get, type Notification } from "../../src/api";
import { useAuth } from "../../src/auth";
import { useCart } from "../../src/cart";
import { colors, t } from "../../src/config";
import { Loading } from "../../src/ui";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, lineHeight: 24, color }}>{glyph}</Text>;

function Bell() {
  const [unread, setUnread] = useState(0);
  useFocusEffect(
    useCallback(() => {
      get<Notification[]>("/notifications").then((n) => setUnread(n.filter((x) => !x.read).length)).catch(() => {});
    }, []),
  );
  return (
    <Pressable accessibilityLabel="الإشعارات" onPress={() => router.push("/notifications")} style={{ paddingHorizontal: 16 }} testID="bell">
      <Text style={{ fontSize: 22 }}>🔔</Text>
      {unread > 0 ? (
        <View style={{ position: "absolute", top: -4, end: 8, backgroundColor: colors.red, borderRadius: 10, minWidth: 18, paddingHorizontal: 4, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function TabsLayout() {
  const { ready, member } = useAuth();
  const { count } = useCart();
  const insets = useSafeAreaInsets();
  if (!ready) return <Loading />;
  if (!member) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => <Bell />,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontWeight: "600", fontSize: 12 },
        tabBarStyle: { minHeight: 64 + insets.bottom, paddingBottom: 6 + insets.bottom, paddingTop: 4 },
        tabBarIconStyle: { height: 26 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "المنتجات", headerTitle: t.appName, tabBarIcon: icon("🛍️") }} />
      <Tabs.Screen name="cart" options={{ title: "السلة", tabBarIcon: icon("🛒"), tabBarBadge: count > 0 ? count : undefined }} />
      <Tabs.Screen name="orders" options={{ title: t.ordersTab, tabBarIcon: icon("📦") }} />
      <Tabs.Screen name="wallet" options={{ title: t.walletTab, tabBarIcon: icon("💰") }} />
      <Tabs.Screen name="network" options={{ title: "شبكتي", tabBarIcon: icon("👥") }} />
    </Tabs>
  );
}
