import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "./auth";
import { Loading } from "./ui";

/** Store the referral code from a deep link / share link, then go to sign-up (or home if signed in). */
export function ReferralRedirect({ code }: { code: string | string[] | undefined }) {
  const { ready, member, setPendingCode } = useAuth();
  const c = (Array.isArray(code) ? code[0] : code)?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  useEffect(() => {
    if (c && ready && !member) setPendingCode(c);
  }, [c, ready, member, setPendingCode]);
  if (!ready) return <Loading />;
  return <Redirect href={member ? "/" : "/login"} />;
}
