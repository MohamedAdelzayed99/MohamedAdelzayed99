// Share link https://DOMAIN/r/CODE opened in the app
import { useLocalSearchParams } from "expo-router";
import { ReferralRedirect } from "../../src/referral";

export default function ShareLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <ReferralRedirect code={code} />;
}
