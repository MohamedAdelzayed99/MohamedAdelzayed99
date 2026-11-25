import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { get, type Member, post } from "../src/api";
import { useAuth } from "../src/auth";
import { colors, IS_RETAIL, t } from "../src/config";
import { Banner, Button, Card, Field, H, P, Screen } from "../src/ui";

/** Convert Arabic-Indic digits so people can type numbers on an Arabic keyboard. */
const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export default function Login() {
  const { ready, member, pendingCode, signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [referral, setReferral] = useState(pendingCode ?? "");
  const [inviter, setInviter] = useState<string | null>(null);
  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [commercialReg, setCommercialReg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (pendingCode) setReferral(pendingCode); }, [pendingCode]);

  // Show who invited you, as a confirmation the code is right.
  useEffect(() => {
    const c = referral.trim().toUpperCase();
    setInviter(null);
    if (c.length < 4) return;
    const h = setTimeout(() => {
      get<{ name: string }>(`/referral/${encodeURIComponent(c)}`).then((r) => setInviter(r.name)).catch(() => setInviter(""));
    }, 400);
    return () => clearTimeout(h);
  }, [referral]);

  if (ready && member) return <Redirect href="/" />;

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ phone: string; isNewUser: boolean; devCode?: string }>("/auth/request-otp", { phone: latinDigits(phone) });
      setIsNew(r.isNewUser);
      setDevCode(r.devCode ?? null);
      setStep("code");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string; member: Member }>("/auth/verify", {
        phone: latinDigits(phone),
        code: latinDigits(code),
        ...(isNew
          ? {
              name,
              referralCode: referral.trim() || undefined,
              ...(IS_RETAIL ? {} : { shopName, shopAddress, commercialReg: commercialReg || undefined }),
            }
          : {}),
      });
      await signIn(r.token, r.member);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ backgroundColor: colors.navy, paddingTop: insets.top + 32, paddingBottom: 32, paddingHorizontal: 20, gap: 6 }}>
        <Text style={{ color: "#8fb3ff", letterSpacing: 4, fontWeight: "700", fontSize: 12 }}>HIGH TECH</Text>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>{t.appName}</Text>
        <Text style={{ color: "#c7d6f5", fontSize: 15 }}>
          {IS_RETAIL ? "اشترِ، وشارك لينكك، واكسب من كل بيعة تحتك" : "اطلب بالجملة، وادعُ المحلات، واكسب خصمًا من كل فاتورة"}
        </Text>
      </View>
      <Screen>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {step === "phone" ? (
          <Card>
            <H>تسجيل الدخول</H>
            <Field
              label="رقم الموبايل"
              placeholder="01xxxxxxxxx"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
              testID="phone"
            />
            <Button title="إرسال كود التأكيد" onPress={requestCode} loading={busy} disabled={phone.length < 10} testID="send-code" />
          </Card>
        ) : (
          <Card>
            <H>{isNew ? "حساب جديد" : "أدخل الكود"}</H>
            <P muted>أرسلنا كود التأكيد إلى {phone}</P>
            {devCode ? <Banner tone="warn">{`كود التجربة: ${devCode}`}</Banner> : null}
            <Field label="كود التأكيد" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} testID="otp" />
            {isNew ? (
              <>
                <Field label="الاسم" value={name} onChangeText={setName} testID="name" />
                {!IS_RETAIL ? (
                  <>
                    <Field label="اسم المحل" value={shopName} onChangeText={setShopName} testID="shop-name" />
                    <Field label="عنوان المحل" value={shopAddress} onChangeText={setShopAddress} testID="shop-address" />
                    <Field label="السجل التجاري (اختياري)" value={commercialReg} onChangeText={setCommercialReg} />
                  </>
                ) : null}
                <Field
                  label="كود الدعوة (من اللينك اللي وصلك)"
                  autoCapitalize="characters"
                  value={referral}
                  onChangeText={setReferral}
                  testID="referral"
                />
                {inviter ? <P style={{ color: colors.green }}>{`دعاك: ${inviter}`}</P> : null}
                {inviter === "" ? <P style={{ color: colors.red }}>كود الدعوة غير صحيح</P> : null}
              </>
            ) : null}
            <Button
              title={isNew ? "إنشاء الحساب" : "دخول"}
              onPress={verify}
              loading={busy}
              disabled={code.length < 6 || (isNew && (!name.trim() || (!IS_RETAIL && (!shopName.trim() || !shopAddress.trim()))))}
              testID="verify"
            />
            <Button title="تغيير الرقم" variant="ghost" onPress={() => { setStep("phone"); setCode(""); }} />
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
