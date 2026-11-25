// Share link https://DOMAIN/w/CODE opened in the app
import { useLocalSearchParams } from "expo-router";
import { ReferralRedirect } from "../../src/referral";

export default function ShareLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <ReferralRedirect code={code} />;
}
