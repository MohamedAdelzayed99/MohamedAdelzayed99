import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatEGP } from "@hightech/commission";

export const money = (p: number | null | undefined) => formatEGP(p ?? 0);
export const toPiastres = (egp: string) => Math.round(Number(egp || 0) * 100);
export const toEGP = (p: number | null | undefined) => (p == null ? "" : String(p / 100));
export const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`;
export const date = (s: string | null | undefined) => (s ? s.replace("T", " ").slice(0, 16) : "—");

export const PROGRAM_AR: Record<string, string> = { retail: "قطاعي", wholesale: "جملة" };
export const ORDER_STATUS_AR: Record<string, string> = {
  placed: "تم الطلب", confirmed: "تم التأكيد", shipped: "في الطريق", delivered: "تم التسليم", returned: "مرتجع", cancelled: "ملغي",
};
export const MEMBER_STATUS_AR: Record<string, string> = { active: "نشط", pending_approval: "في انتظار التفعيل", suspended: "موقوف" };
export const WD_STATUS_AR: Record<string, string> = { requested: "قيد المراجعة", approved: "تمت الموافقة", paid: "تم التحويل", rejected: "مرفوض" };
export const EARNING_STATUS_AR: Record<string, string> = { pending: "معلّق", available: "متاح", cancelled: "ملغي" };
export const METHOD_AR: Record<string, string> = {
  vodafone_cash: "فودافون كاش", instapay: "إنستاباي", bank_transfer: "تحويل بنكي", cod: "كاش عند الاستلام", card: "كارت", wallet: "محفظة إلكترونية",
};

const TONE: Record<string, string> = {
  placed: "blue", confirmed: "blue", shipped: "amber", delivered: "green", returned: "red", cancelled: "gray",
  active: "green", pending_approval: "amber", suspended: "red",
  requested: "amber", approved: "blue", paid: "green", rejected: "red",
  pending: "amber", available: "green", unpaid: "amber", refunded: "gray",
  retail: "blue", wholesale: "amber",
};
export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge ${TONE[value] ?? "gray"}`}>{label ?? value}</span>;
}

/** Load data from the API; returns [data, error, reload]. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, string | undefined, () => void, boolean] {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then(
      (d) => { if (live) { setData(d); setError(undefined); setLoading(false); } },
      (e) => { if (live) { setError(e.message); setLoading(false); } },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [data, error, useCallback(() => setTick((t) => t + 1), []), loading];
}

/** Run an action, show its error, and call onDone on success. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async <T,>(fn: () => Promise<T>, onDone?: (r: T) => void) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await fn();
      onDone?.(r);
      return r;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export const ErrorBox = ({ error }: { error?: string }) => (error ? <div className="alert error">{error}</div> : null);
export const Loading = () => <div className="muted pad">جارِ التحميل…</div>;

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <h3>{title}</h3>
          <div className="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="card-head">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export const Empty = ({ text = "لا توجد بيانات" }: { text?: string }) => <div className="muted pad center">{text}</div>;

export const go = (path: string) => (location.hash = "/" + path);
