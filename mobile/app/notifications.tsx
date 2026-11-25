import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "../src/auth";
import { type Notification, post } from "../src/api";
import { colors } from "../src/config";
import { useCached } from "../src/useCached";
import { Card, Empty, formatDate, P, Screen } from "../src/ui";

export default function Notifications() {
  const { ready, member } = useAuth();
  const { data, loading, refresh } = useCached<Notification[]>("/notifications", "notifications");
  const hasUnread = !!data?.some((n) => !n.read);
  useEffect(() => {
    if (hasUnread) post("/notifications/read").catch(() => {});
  }, [hasUnread]);

  if (ready && !member) return <Redirect href="/login" />;
  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      {data && data.length === 0 ? <Empty text="لا توجد إشعارات" /> : null}
      {(data ?? []).map((n) => (
        <Card key={n.id} style={!n.read ? { borderColor: colors.blue, backgroundColor: "#f3f8ff" } : undefined}>
          <P bold>{n.title}</P>
          <P>{n.body}</P>
          <P muted style={{ fontSize: 12 }}>{formatDate(n.created_at)}</P>
        </Card>
      ))}
    </Screen>
  );
}
