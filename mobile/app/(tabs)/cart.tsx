import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { type AppConfig, type Order, post, type Wallet } from "../../src/api";
import { useAuth } from "../../src/auth";
import { minQty, useCart } from "../../src/cart";
import { colors, IS_RETAIL, PAYMENT_LABELS, t } from "../../src/config";
import { cache } from "../../src/storage";
import { useCached } from "../../src/useCached";
import { Banner, Between, Button, Card, Chip, Empty, Field, H, money, P, Row, Screen, Stepper } from "../../src/ui";

export default function Cart() {
  const { member } = useAuth();
  const cart = useCart();
  const config = useCached<AppConfig>("/config", "config");
  const wallet = useCached<Wallet>(IS_RETAIL ? null : "/wallet", "wallet");
  const [address, setAddress] = useState(member?.shopAddress ?? "");
  const [governorate, setGovernorate] = useState("");
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState("cod");
  const [useDiscount, setUseDiscount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cart.lines.length === 0) {
    return (
      <Screen>
        <Empty text="السلة فارغة" />
        <Button title="تصفح المنتجات" onPress={() => router.navigate("/")} />
      </Screen>
    );
  }

  const shipping = config.data?.shippingFee ?? 0;
  const discountBalance = Math.max(0, wallet.data?.available ?? 0);
  const discount = !IS_RETAIL && useDiscount ? Math.min(discountBalance, cart.subtotal) : 0;
  const total = cart.subtotal - discount + shipping;
  const blocked = member?.status !== "active";
  const methods = config.data?.paymentMethods ?? ["cod"];

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await post<Order>("/orders", {
        items: cart.lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        address,
        governorate,
        notes,
        paymentMethod: payment,
        useDiscount: !IS_RETAIL && useDiscount,
      });
      cart.clear();
      await cache.set("orders", null);
      router.push({ pathname: "/orders/[id]", params: { id: String(order.id), placed: "1" } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {blocked ? <Banner tone="warn">لا يمكن الطلب قبل تفعيل الحساب من الإدارة.</Banner> : null}
      {cart.lines.map((l) => (
        <Card key={l.product.id}>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 2 }}>
              <P bold>{l.product.name}</P>
              <P muted>{`${money(l.product.price)} × ${l.qty} = ${money(l.product.price * l.qty)}`}</P>
              {!IS_RETAIL ? <P muted style={{ fontSize: 13 }}>{`أقل كمية: ${minQty(l.product)}`}</P> : null}
            </View>
            <Pressable onPress={() => cart.remove(l.product.id)} accessibilityLabel="حذف">
              <Text style={{ color: colors.red, fontWeight: "700" }}>حذف</Text>
            </Pressable>
          </Row>
          <Stepper value={l.qty} min={minQty(l.product)} onChange={(n) => cart.setQty(l.product.id, n)} />
        </Card>
      ))}

      <Card>
        <H>التوصيل</H>
        <Field label="العنوان بالتفصيل" value={address} onChangeText={setAddress} multiline testID="address" />
        <Field label="المحافظة" value={governorate} onChangeText={setGovernorate} />
        <Field label="ملاحظات (اختياري)" value={notes} onChangeText={setNotes} />
      </Card>

      <Card>
        <H>طريقة الدفع</H>
        <Row style={{ flexWrap: "wrap" }}>
          {methods.map((m) => <Chip key={m} label={PAYMENT_LABELS[m] ?? m} active={payment === m} onPress={() => setPayment(m)} />)}
        </Row>
      </Card>

      {!IS_RETAIL ? (
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <P bold>استخدم رصيد الخصم</P>
              <P muted>{`المتاح: ${money(discountBalance)}`}</P>
            </View>
            <Switch value={useDiscount} onValueChange={setUseDiscount} disabled={discountBalance <= 0} />
          </Row>
        </Card>
      ) : null}

      <Card>
        <Between label="المنتجات" value={money(cart.subtotal)} />
        {discount > 0 ? <Between label="خصم من الرصيد" value={`− ${money(discount)}`} /> : null}
        <Between label="الشحن" value={shipping ? money(shipping) : "مجانًا"} />
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Between label="الإجمالي" value={money(total)} bold />
      </Card>

      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button
        title={`تأكيد ال${t.order}`}
        onPress={place}
        loading={busy}
        disabled={blocked || address.trim().length < 5}
        testID="place-order"
      />
    </Screen>
  );
}
