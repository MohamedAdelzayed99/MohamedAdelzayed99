import { View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../src/auth";
import type { Order } from "../../src/api";
import { colors, PAYMENT_LABELS, STATUS_AR, STATUS_COLORS, t } from "../../src/config";
import { useCached } from "../../src/useCached";
import { Badge, Banner, Between, Card, formatDate, H, Loading, money, P, Row, Screen } from "../../src/ui";

const FLOW = ["placed", "confirmed", "shipped", "delivered"];

export default function OrderDetail() {
  const { id, placed } = useLocalSearchParams<{ id: string; placed?: string }>();
  const { ready, member } = useAuth();
  const { data: o, loading, refresh } = useCached<Order>(`/orders/${id}`, `order-${id}`);
  if (ready && !member) return <Redirect href="/login" />;
  if (!o) return <Loading />;

  const reached = new Map(o.history.map((h) => [h.status, h.at]));
  const steps = o.status === "cancelled" || o.status === "returned" ? [...o.history.map((h) => h.status)] : FLOW;

  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      <Stack.Screen options={{ title: `${t.order} رقم ${o.id}` }} />
      {placed ? <Banner>{`تم استلام ${t.yourOrder} بنجاح، وسنبلغك بكل تحديث في الحالة.`}</Banner> : null}
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <H>{`${t.order} رقم ${o.id}`}</H>
          <Badge status={o.status} label={o.statusLabel} />
        </Row>
        <P muted>{formatDate(o.createdAt)}</P>
      </Card>

      <Card>
        <H>{`حالة ال${t.order}`}</H>
        {steps.map((st, i) => {
          const at = reached.get(st);
          const color = at ? STATUS_COLORS[st] ?? colors.blue : colors.border;
          return (
            <Row key={st + i} style={{ alignItems: "flex-start" }}>
              <View style={{ alignItems: "center", width: 20 }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, marginTop: 4 }} />
                {i < steps.length - 1 ? <View style={{ width: 2, height: 26, backgroundColor: colors.border }} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <P bold={!!at} muted={!at}>{STATUS_AR[st] ?? st}</P>
                {at ? <P muted style={{ fontSize: 13 }}>{formatDate(at)}</P> : null}
              </View>
            </Row>
          );
        })}
      </Card>

      <Card>
        <H>المنتجات</H>
        {o.items.map((i) => <Between key={i.productId} label={`${i.name} × ${i.qty}`} value={money(i.unitPrice * i.qty)} />)}
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Between label="المنتجات" value={money(o.subtotal)} />
        {o.discountUsed ? <Between label="خصم من الرصيد" value={`− ${money(o.discountUsed)}`} /> : null}
        <Between label="الشحن" value={o.shippingFee ? money(o.shippingFee) : "مجانًا"} />
        <Between label="الإجمالي" value={money(o.total)} bold />
      </Card>

      <Card>
        <H>التوصيل والدفع</H>
        <P>{o.address}{o.governorate ? ` — ${o.governorate}` : ""}</P>
        <P muted>{`${PAYMENT_LABELS[o.paymentMethod] ?? o.paymentMethod} · ${o.paymentStatus === "paid" ? "مدفوع" : o.paymentStatus === "refunded" ? "مسترد" : "غير مدفوع"}`}</P>
      </Card>
    </Screen>
  );
}
