import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, date, ErrorBox, Field, Loading, METHOD_AR, toEGP, toPiastres, useAction, useApi } from "../ui";

type S = Record<string, string>;
const WITHDRAW_METHODS = ["vodafone_cash", "instapay", "bank_transfer"];
const PAY_METHODS = ["cod", "card", "wallet"];
const parseList = (s: string | undefined) => { try { return JSON.parse(s ?? "[]") as string[]; } catch { return []; } };

const ACTION_AR: Record<string, string> = {
  move_member: "نقل عضو في الشجرة", order_status: "تغيير حالة طلب", order_paid: "تسجيل دفع", save_product: "حفظ منتج",
  member_status: "تغيير حالة حساب", create_member: "إنشاء عضو", set_rates: "تعديل النسب", update_settings: "تعديل الإعدادات",
  withdrawal_approved: "موافقة على سحب", withdrawal_paid: "تحويل سحب", withdrawal_rejected: "رفض سحب",
};

export function Settings() {
  const [settings, error, reload] = useApi(() => api<S>("GET", "/settings"), []);
  const [audit, auditError, reloadAudit] = useApi(() => api<any[]>("GET", "/audit"), []);
  return (
    <div className="page">
      <header className="page-head"><h1>الإعدادات والسجل</h1></header>
      <ErrorBox error={error} />
      {!settings ? <Loading /> : <SettingsForm s={settings} onSaved={() => { reload(); reloadAudit(); }} />}
      <Card title="سجل التعديلات (من غيّر ماذا ومتى)">
        <ErrorBox error={auditError} />
        {!audit ? <Loading /> : (
          <div className="scroll">
            <table className="compact">
              <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="num">{date(a.at)}</td>
                    <td>{a.username ?? "النظام"}</td>
                    <td>{ACTION_AR[a.action] ?? a.action}</td>
                    <td>
                      {a.entity === "member" && a.entity_id ? <a href={`#/members/${a.entity_id}`}>عضو #{a.entity_id}</a>
                        : a.entity === "order" && a.entity_id ? <a href={`#/orders/${a.entity_id}`}>طلب #{a.entity_id}</a>
                        : `${a.entity}${a.entity_id ? " #" + a.entity_id : ""}`}
                    </td>
                    <td className="mono small details" dir="ltr">{a.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SettingsForm({ s, onSaved }: { s: S; onSaved: () => void }) {
  const fromServer = () => ({
    return_window_days: s.return_window_days,
    min_withdrawal: toEGP(Number(s.min_withdrawal)),
    retail_shipping_fee: toEGP(Number(s.retail_shipping_fee)),
    wholesale_shipping_fee: toEGP(Number(s.wholesale_shipping_fee)),
    wholesale_cash_out: s.wholesale_cash_out === "true",
    wholesale_requires_approval: s.wholesale_requires_approval === "true",
    network_names_depth: s.network_names_depth,
    withdrawal_methods: parseList(s.withdrawal_methods),
    payment_methods_retail: parseList(s.payment_methods_retail),
    payment_methods_wholesale: parseList(s.payment_methods_wholesale),
    default_sponsor_retail: s.default_sponsor_retail,
    default_sponsor_wholesale: s.default_sponsor_wholesale,
  });
  const [f, setF] = useState(fromServer);
  useEffect(() => setF(fromServer()), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  const toggleList = (k: "withdrawal_methods" | "payment_methods_retail" | "payment_methods_wholesale", m: string) => {
    setSaved(false);
    setF({ ...f, [k]: f[k].includes(m) ? f[k].filter((x) => x !== m) : [...f[k], m] });
  };
  const save = () =>
    run(
      () =>
        api("PATCH", "/settings", {
          return_window_days: String(Number(f.return_window_days)),
          min_withdrawal: String(toPiastres(f.min_withdrawal)),
          retail_shipping_fee: String(toPiastres(f.retail_shipping_fee)),
          wholesale_shipping_fee: String(toPiastres(f.wholesale_shipping_fee)),
          wholesale_cash_out: String(f.wholesale_cash_out),
          wholesale_requires_approval: String(f.wholesale_requires_approval),
          network_names_depth: String(Number(f.network_names_depth)),
          withdrawal_methods: JSON.stringify(f.withdrawal_methods),
          payment_methods_retail: JSON.stringify(f.payment_methods_retail),
          payment_methods_wholesale: JSON.stringify(f.payment_methods_wholesale),
          default_sponsor_retail: f.default_sponsor_retail.trim(),
          default_sponsor_wholesale: f.default_sponsor_wholesale.trim(),
        }),
      () => { setSaved(true); onSaved(); },
    );

  return (
    <>
      <div className="grid2">
        <Card title="العمولات والسحب">
          <div className="form-grid">
            <Field label="مدة الإرجاع (يوم)" hint="العمولة تبقى «معلّقة» حتى تنتهي"><input type="number" min="0" value={f.return_window_days} onChange={set("return_window_days")} /></Field>
            <Field label="الحد الأدنى للسحب (جنيه)"><input type="number" min="0" value={f.min_withdrawal} onChange={set("min_withdrawal")} /></Field>
          </div>
          <div className="field"><span>طرق السحب المتاحة</span>
            <div className="row wrap">
              {WITHDRAW_METHODS.map((m) => (
                <label key={m} className="check"><input type="checkbox" checked={f.withdrawal_methods.includes(m)} onChange={() => toggleList("withdrawal_methods", m)} /> {METHOD_AR[m]}</label>
              ))}
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={f.wholesale_cash_out} onChange={(e) => { setSaved(false); setF({ ...f, wholesale_cash_out: e.target.checked }); }} /> السماح للمحلات بسحب رصيد الخصم نقدًا (وإلا يُستخدم في الفواتير فقط)</label>
        </Card>
        <Card title="التسجيل والشبكة">
          <label className="check"><input type="checkbox" checked={f.wholesale_requires_approval} onChange={(e) => { setSaved(false); setF({ ...f, wholesale_requires_approval: e.target.checked }); }} /> المحلات الجديدة تحتاج موافقتك قبل الطلب</label>
          <div className="form-grid">
            <Field label="أسماء الشبكة الظاهرة للعضو حتى المستوى" hint="1 = أسماء المستوى الأول فقط، والباقي أعداد"><input type="number" min="0" value={f.network_names_depth} onChange={set("network_names_depth")} /></Field>
            <span />
            <Field label="من يسجّل بدون لينك (قطاعي) يكون تحت عضو رقم" hint="فارغ = يبدأ شجرة مستقلة"><input type="number" value={f.default_sponsor_retail} onChange={set("default_sponsor_retail")} /></Field>
            <Field label="من يسجّل بدون لينك (جملة) يكون تحت عضو رقم" hint="فارغ = يبدأ شجرة مستقلة"><input type="number" value={f.default_sponsor_wholesale} onChange={set("default_sponsor_wholesale")} /></Field>
          </div>
        </Card>
        <Card title="الشحن والدفع">
          <div className="form-grid">
            <Field label="مصاريف شحن القطاعي (جنيه)"><input type="number" min="0" value={f.retail_shipping_fee} onChange={set("retail_shipping_fee")} /></Field>
            <Field label="مصاريف شحن الجملة (جنيه)"><input type="number" min="0" value={f.wholesale_shipping_fee} onChange={set("wholesale_shipping_fee")} /></Field>
          </div>
          {(["payment_methods_retail", "payment_methods_wholesale"] as const).map((k) => (
            <div className="field" key={k}><span>طرق الدفع — {k.endsWith("retail") ? "القطاعي" : "الجملة"}</span>
              <div className="row wrap">
                {PAY_METHODS.map((m) => (
                  <label key={m} className="check"><input type="checkbox" checked={f[k].includes(m)} onChange={() => toggleList(k, m)} /> {METHOD_AR[m]}</label>
                ))}
              </div>
            </div>
          ))}
          <p className="muted small">الكارت والمحافظ تحتاج تفعيل حساب بوابة الدفع (Paymob) أولًا.</p>
        </Card>
      </div>
      <ErrorBox error={error} />
      <div className="row end sticky-save">
        {saved && <span className="green-text">✓ تم الحفظ</span>}
        <button className="btn" onClick={() => setF(fromServer())}>تراجع</button>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? "جارِ الحفظ…" : "حفظ الإعدادات"}</button>
      </div>
    </>
  );
}
