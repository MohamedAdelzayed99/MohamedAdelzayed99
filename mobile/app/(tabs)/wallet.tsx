import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { post, type Wallet } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, IS_RETAIL, STATUS_AR, t, WITHDRAW_LABELS } from "../../src/config";
import { useCached } from "../../src/useCached";
import { Badge, Banner, Button, Card, Chip, Empty, Field, formatDate, H, Loading, money, P, Row, Screen } from "../../src/ui";

function Stat({ label, value, color, testID }: { label: string; value: number; color: string; testID?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
      <Text style={{ color: colors.muted, fontWeight: "600" }}>{label}</Text>
      <Text testID={testID} style={{ color, fontSize: 22, fontWeight: "800" }}>{money(value)}</Text>
    </View>
  );
}

export default function WalletScreen() {
  const { member, refresh: refreshMe } = useAuth();
  const { data: w, loading, refresh, stale, error } = useCached<Wallet>("/wallet", "wallet");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(member?.payoutMethod ?? "vodafone_cash");
  const [account, setAccount] = useState(member?.payoutAccount ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => { if (member?.payoutAccount) setAccount(member.payoutAccount); }, [member?.payoutAccount]);

  if (!w) return <Loading />;
  const openRequest = w.withdrawals.some((x) => x.status === "requested");

  const withdraw = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const pounds = Number(amount.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
      await post("/wallet/withdrawals", { amount: Math.round(pounds * 100), method, account });
      setAmount("");
      setMsg({ tone: "info", text: "تم إرسال طلب السحب، وسيتم مراجعته." });
      refresh();
      refreshMe().catch(() => {});
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      {stale ? <Banner>تعرض آخر نسخة محفوظة — {error}</Banner> : null}
      <Row style={{ alignItems: "stretch" }}>
        <Stat label={t.balanceLabel} value={w.available} color={colors.green} testID="available" />
        <Stat label="رصيد معلّق" value={w.pending} color={colors.orange} testID="pending" />
      </Row>
      <P muted>
        {IS_RETAIL
          ? "الرصيد المعلّق يصبح متاحًا بعد تسليم الطلب وانتهاء مدة الإرجاع. لو المنتج رجع، تُلغى العمولة تلقائيًا."
          : "رصيد الخصم يُستخدم في فواتيرك القادمة: فعّل «استخدم رصيد الخصم» في السلة. الرصيد المعلّق يصبح متاحًا بعد انتهاء مدة الإرجاع."}
      </P>

      {w.canWithdraw ? (
        <Card>
          <H>طلب سحب</H>
          {openRequest ? (
            <Banner tone="warn">لديك طلب سحب قيد المراجعة.</Banner>
          ) : (
            <>
              <P muted>{`الحد الأدنى للسحب ${money(w.minWithdrawal)}`}</P>
              <Field label="المبلغ (جنيه)" keyboardType="numeric" value={amount} onChangeText={setAmount} testID="withdraw-amount" />
              <Row style={{ flexWrap: "wrap" }}>
                {w.withdrawalMethods.map((m) => <Chip key={m} label={WITHDRAW_LABELS[m] ?? m} active={method === m} onPress={() => setMethod(m)} />)}
              </Row>
              <Field
                label={method === "bank_transfer" ? "رقم الحساب / IBAN" : method === "instapay" ? "عنوان إنستاباي أو رقم الموبايل" : "رقم المحفظة"}
                value={account}
                onChangeText={setAccount}
              />
              <Button title="اطلب السحب" onPress={withdraw} loading={busy} disabled={!amount || !account} />
            </>
          )}
          {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
        </Card>
      ) : null}

      {w.withdrawals.length ? (
        <Card>
          <H>طلبات السحب</H>
          {w.withdrawals.map((x) => (
            <Row key={x.id} style={{ justifyContent: "space-between" }}>
              <View>
                <P bold>{money(x.amount)}</P>
                <P muted style={{ fontSize: 13 }}>{`${WITHDRAW_LABELS[x.method] ?? x.method} · ${formatDate(x.created_at)}`}</P>
                {x.note ? <P muted style={{ fontSize: 13 }}>{x.note}</P> : null}
              </View>
              <Badge status={x.status} />
            </Row>
          ))}
        </Card>
      ) : null}

      <Card>
        <H>{IS_RETAIL ? "الأرباح" : "الخصومات المكتسبة"}</H>
        {w.earnings.length === 0 ? <Empty text={`لا توجد ${IS_RETAIL ? "أرباح" : "خصومات"} بعد — شارك لينكك من «شبكتي»`} /> : null}
        {w.earnings.map((e) => (
          <Row key={e.id} style={{ justifyContent: "space-between" }}>
            <View>
              <P bold>{money(e.amount)}</P>
              <P muted style={{ fontSize: 13 }}>
                {`المستوى ${e.level} · ${formatDate(e.created_at)}${e.status === "pending" ? ` · متاح من ${formatDate(e.release_at)}` : ""}`}
              </P>
            </View>
            <Badge status={e.status} label={e.status === "cancelled" ? "ملغي (مرتجع)" : STATUS_AR[e.status]} />
          </Row>
        ))}
      </Card>
    </Screen>
  );
}
