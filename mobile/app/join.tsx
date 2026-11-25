// Deep link: hightech://join?code=XXXX (or hightech-wholesale://join?code=XXXX)
import { useLocalSearchParams } from "expo-router";
import { ReferralRedirect } from "../src/referral";

export default function Join() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <ReferralRedirect code={code} />;
}
