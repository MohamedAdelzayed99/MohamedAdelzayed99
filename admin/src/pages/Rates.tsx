import { useEffect, useState } from "react";
import { directRateBp, egp, splitCommission, totalOf, validateRates, type Program, type RateConfig } from "@hightech/commission";
import { api } from "../api";
import { Badge, Card, date, ErrorBox, Field, Loading, money, pct, PROGRAM_AR, useAction, useApi } from "../ui";

interface RateRow { id: number; program: Program; total_bp: number; step_bp: number; floor_bp: number; created_by: number | null; created_at: string }
interface RatesData { retail: RateRow; wholesale: RateRow; history: RateRow[] }

const PROBLEM_AR: [RegExp, string][] = [
  [/floorBp cannot exceed/, "أقل نسبة لصاحب اللينك لا يمكن أن تزيد عن الإجمالي"],
  [/totalBp cannot exceed/, "الإجمالي لا يمكن أن يزيد عن 100%"],
  [/must be a non-negative integer/, "النسب يجب أن تكون أرقامًا موجبة (حتى خانتين عشريتين)"],
];
const problemAr = (p: string) => PROBLEM_AR.find(([re]) => re.test(p))?.[1] ?? p;

export function Rates() {
  const [data, error, reload] = useApi(() => api<RatesData>("GET", "/rates"), []);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  return (
    <div className="page">
      <header className="page-head"><h1>النسب</h1></header>
      <div className="alert info">أي تعديل يسري على الطلبات الجديدة فقط، والطلبات القديمة تحتفظ بالنسب التي طُلبت بها.</div>
      <div className="grid2">
        <RateEditor program="retail" current={data.retail} onSaved={reload} />
        <RateEditor program="wholesale" current={data.wholesale} onSaved={reload} />
      </div>
      <Card title="سجل التعديلات">
        <table>
          <thead><tr><th>التاريخ</th><th>التطبيق</th><th>الإجمالي</th><th>النزول لكل مستوى</th><th>الحد الأدنى لصاحب اللينك</th></tr></thead>
          <tbody>
            {data.history.map((h) => (
              <tr key={h.id}>
                <td className="num">{date(h.created_at)}</td>
                <td><Badge value={h.program} label={PROGRAM_AR[h.program]} /></td>
                <td>{pct(h.total_bp)}</td><td>{pct(h.step_bp)}</td><td>{pct(h.floor_bp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function RateEditor({ program, current, onSaved }: { program: Program; current: RateRow; onSaved: () => void }) {
  const init = () => ({ total: String(current.total_bp / 100), step: String(current.step_bp / 100), floor: String(current.floor_bp / 100) });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [current.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { busy, error, run } = useAction();
  const cfg: RateConfig = { totalBp: Math.round(Number(f.total) * 100), stepBp: Math.round(Number(f.step) * 100), floorBp: Math.round(Number(f.floor) * 100) };
  const problems = validateRates(cfg);
  const changed = cfg.totalBp !== current.total_bp || cfg.stepBp !== current.step_bp || cfg.floorBp !== current.floor_bp;
  const sale = program === "retail" ? egp(1000) : egp(10000);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Card title={program === "retail" ? "القطاعي (عمولة نقدية)" : "الجملة (خصم للمحل)"}>
      <div className="form-grid three">
        <Field label="الإجمالي الموزّع %"><input type="number" step="0.01" min="0" value={f.total} onChange={set("total")} /></Field>
        <Field label="النزول لكل مستوى %"><input type="number" step="0.01" min="0" value={f.step} onChange={set("step")} /></Field>
        <Field label="أقل نسبة لصاحب اللينك %"><input type="number" step="0.01" min="0" value={f.floor} onChange={set("floor")} /></Field>
      </div>
      {problems.length > 0 ? <div className="alert error">{[...new Set(problems.map(problemAr))].join(" · ")}</div> : (
        <>
          <h4>معاينة: {program === "retail" ? "بيعة" : "فاتورة"} بـ {money(sale)} {changed && <Badge value="amber" label="غير محفوظ" />}</h4>
          <table className="compact">
            <thead><tr><th>عدد من فوق المشتري</th><th>صاحب اللينك</th><th>كل شخص فوقه</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                const shares = splitCommission(Array.from({ length: n }, (_, i) => i), sale, cfg);
                return (
                  <tr key={n}>
                    <td>{n}</td>
                    <td>{pct(directRateBp(n, cfg))} <span className="muted">({money(shares[0].amount)})</span></td>
                    <td>{n === 1 ? "—" : <>{pct(shares[1].rateBp)} <span className="muted">({money(shares[1].amount)})</span></>}</td>
                    <td><b>{money(totalOf(shares))}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <ErrorBox error={error} />
      <div className="row end">
        {changed && <button className="btn" onClick={() => setF(init())}>تراجع</button>}
        <button className="btn primary" disabled={busy || !changed || problems.length > 0}
          onClick={() => confirm(`حفظ نسب ${PROGRAM_AR[program]} الجديدة؟ ستسري على الطلبات الجديدة فقط.`) && run(() => api("PUT", `/rates/${program}`, cfg), onSaved)}>
          حفظ النسب
        </button>
      </div>
    </Card>
  );
}
