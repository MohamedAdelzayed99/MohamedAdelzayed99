import { Pressable } from "react-native";
import { router } from "expo-router";
import type { Order } from "../../src/api";
import { t } from "../../src/config";
import { useCached } from "../../src/useCached";
import { Badge, Banner, Card, Empty, formatDate, money, P, Row, Screen } from "../../src/ui";

export default function Orders() {
  const { data, loading, refresh, stale, error } = useCached<Order[]>("/orders", "orders");
  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      {stale && data ? <Banner>تعرض آخر نسخة محفوظة — {error}</Banner> : null}
      {data && data.length === 0 ? <Empty text={`لا توجد ${t.ordersTab === "فواتيري" ? "فواتير" : "طلبات"} بعد`} /> : null}
      {(data ?? []).map((o) => (
        <Pressable key={o.id} onPress={() => router.push({ pathname: "/orders/[id]", params: { id: String(o.id) } })} testID={`order-${o.id}`}>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <P bold>{`${t.order} رقم ${o.id}`}</P>
              <Badge status={o.status} label={o.statusLabel} />
            </Row>
            <P muted>{`${formatDate(o.createdAt)} · ${o.items.reduce((s, i) => s + i.qty, 0)} قطعة`}</P>
            <P bold>{money(o.total)}</P>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
