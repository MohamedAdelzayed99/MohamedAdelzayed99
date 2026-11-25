import { useState } from "react";
import { Linking, Platform, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Network } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, IS_RETAIL, t } from "../../src/config";
import { useCached } from "../../src/useCached";
import { Banner, Button, Card, Empty, formatDate, H, money, P, Row, Screen } from "../../src/ui";

export default function NetworkScreen() {
  const { member, signOut } = useAuth();
  const { data: net, loading, refresh, stale, error } = useCached<Network>("/network", "network");
  const [copied, setCopied] = useState(false);
  if (!member) return null;

  const message = IS_RETAIL
    ? `حمّل تطبيق High Tech وسجّل من لينكي: ${member.shareLink}\nأو اكتب كود الدعوة: ${member.referralCode}`
    : `سجّل محلك في High Tech جملة من لينكي: ${member.shareLink}\nكود الدعوة: ${member.referralCode}`;

  const share = async () => {
    if (Platform.OS === "web" && !(navigator as any).share) return copy();
    try { await Share.share({ message }); } catch { /* user cancelled */ }
  };
  const whatsapp = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
  const facebook = () => Linking.openURL(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(member.shareLink)}`);
  const copy = async () => {
    await Clipboard.setStringAsync(member.shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      <View style={{ backgroundColor: colors.navy, borderRadius: 16, padding: 16, gap: 8 }}>
        <Text style={{ color: "#c7d6f5" }}>لينكك الخاص</Text>
        <Text selectable style={{ color: "#fff", fontWeight: "700", fontSize: 15 }} testID="share-link">{member.shareLink}</Text>
        <Text style={{ color: "#c7d6f5" }}>
          كود الدعوة: <Text style={{ color: "#fff", fontWeight: "800", letterSpacing: 2 }}>{member.referralCode}</Text>
        </Text>
        <Button title="شارك لينكي" onPress={share} testID="share" />
        <Row>
          <Button title="واتساب" variant="secondary" onPress={whatsapp} style={{ flex: 1, backgroundColor: "#25d366" }} />
          <Button title="فيسبوك" variant="secondary" onPress={facebook} style={{ flex: 1, backgroundColor: "#1877f2" }} />
          <Button title={copied ? "تم النسخ ✓" : "نسخ"} variant="secondary" onPress={copy} style={{ flex: 1, backgroundColor: colors.navy2 }} />
        </Row>
      </View>
      <P muted>
        {IS_RETAIL
          ? "أي شخص يسجّل من لينكك يصبح تحتك، وتكسب من كل عملية شراء تتم تحتك مهما تفرعت الشبكة."
          : "أي محل يسجّل من لينكك يصبح تحتك، وتكسب خصمًا من كل فاتورة لمحل جاء عن طريقك."}
      </P>

      {stale ? <Banner>تعرض آخر نسخة محفوظة — {error}</Banner> : null}
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <H>شبكتي</H>
          <P bold testID="network-total">{`${net?.totalMembers ?? 0} ${t.networkMembers}`}</P>
        </Row>
        {net && net.levels.length === 0 ? <Empty text="لم يسجّل أحد من لينكك بعد" /> : null}
        {(net?.levels ?? []).map((l) => (
          <View key={l.level} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, gap: 4 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <P bold>{`المستوى ${l.level}`}</P>
              <P>{`${l.count} ${t.networkMembers}`}</P>
            </Row>
            <Row style={{ justifyContent: "space-between" }}>
              <P muted style={{ fontSize: 13 }}>{`أرباح متاحة: ${money(l.earnedAvailable)}`}</P>
              <P muted style={{ fontSize: 13 }}>{`معلّقة: ${money(l.earnedPending)}`}</P>
            </Row>
            {l.members?.map((m) => (
              <Row key={m.id} style={{ justifyContent: "space-between", paddingStart: 8 }}>
                <P>{`• ${m.name}`}</P>
                <P muted style={{ fontSize: 12 }}>{formatDate(m.joinedAt)}</P>
              </Row>
            ))}
          </View>
        ))}
      </Card>

      <Card>
        <H>حسابي</H>
        <P>{member.shopName ?? member.name}</P>
        <P muted>{member.phone}</P>
        <Button title="تسجيل الخروج" variant="ghost" onPress={signOut} />
      </Card>
    </Screen>
  );
}
