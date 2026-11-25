import { useState } from "react";
import { api, qs } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading, money, ORDER_STATUS_AR, PROGRAM_AR, Stat, useApi } from "../ui";

interface ReportData {
  sales: { program: string; orders: number; revenue: number }[];
  daily: { day: string; program: string; revenue: number; orders: number }[];
  commissions: { program: string; status: string; total: number }[];
  payable: { retail_available_unpaid: number; withdrawals_open: number };
  topNetworks: { id: number; program: string; name: string; phone: string; earned: number; orders: number }[];
  counts: { program: string; members: number; pending: number }[];
  openOrders: { status: string; n: number }[];
}

export function Reports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, error, reload, loading] = useApi(() => api<ReportData>("GET", "/reports" + qs({ from, to })), [from, to]);

  const sale = (p: string) => data?.sales.find((s) => s.program === p);
  const comm = (p: string, st: string) => data?.commissions.find((c) => c.program === p && c.status === st)?.total ?? 0;
  const count = (p: string) => data?.counts.find((c) => c.program === p);
  const open = (st: string) => data?.openOrders.find((o) => o.status === st)?.n ?? 0;

  return (
    <div className="page">
      <header className="page-head">
        <h1>الرئيسية والتقارير</h1>
        <div className="row">
          <label className="inline">من <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inline">إلى <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn" onClick={reload}>تحديث</button>
        </div>
      </header>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="stats">
            <Stat label="مبيعات القطاعي (مُسلّمة)" value={money(sale("retail")?.revenue)} sub={`${sale("retail")?.orders ?? 0} طلب`} />
            <Stat label="مبيعات الجملة (مُسلّمة)" value={money(sale("wholesale")?.revenue)} sub={`${sale("wholesale")?.orders ?? 0} فاتورة`} />
            <Stat label="عمولات قطاعي مستحقة غير مسحوبة" value={money(data.payable.retail_available_unpaid)} tone="green" />
            <Stat label="طلبات سحب مفتوحة" value={money(data.payable.withdrawals_open)} tone="amber" sub={<a href="#/withdrawals">مراجعة ←</a>} />
          </div>
          <div className="stats">
            <Stat label="طلبات جديدة" value={open("placed")} sub={<a href="#/orders">إدارة الطلبات ←</a>} />
            <Stat label="مؤكدة" value={open("confirmed")} />
            <Stat label="في الطريق" value={open("shipped")} />
            <Stat label="عملاء القطاعي" value={count("retail")?.members ?? 0} />
            <Stat label="محلات الجملة" value={count("wholesale")?.members ?? 0}
              sub={count("wholesale")?.pending ? <a href="#/members">{count("wholesale")!.pending} في انتظار التفعيل ←</a> : "لا يوجد انتظار"}
              tone={count("wholesale")?.pending ? "amber" : ""} />
          </div>

          <div className="grid2">
            <Card title="المبيعات اليومية">
              <DailyChart daily={data.daily} />
            </Card>
            <Card title="العمولات والخصومات">
              <table>
                <thead><tr><th></th><th>معلّق</th><th>متاح</th><th>ملغي</th></tr></thead>
                <tbody>
                  {(["retail", "wholesale"] as const).map((p) => (
                    <tr key={p}>
                      <td><Badge value={p} label={p === "retail" ? "عمولة القطاعي" : "خصم الجملة"} /></td>
                      <td>{money(comm(p, "pending"))}</td>
                      <td>{money(comm(p, "available"))}</td>
                      <td className="muted">{money(comm(p, "cancelled"))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">«معلّق» = داخل مدة الإرجاع، «متاح» = يمكن سحبه أو استخدامه.</p>
            </Card>
          </div>

          <Card title="أقوى الشبكات بيعًا">
            {data.topNetworks.length === 0 ? <Empty /> : (
              <table>
                <thead><tr><th>#</th><th>الاسم</th><th>التطبيق</th><th>الموبايل</th><th>عدد الطلبات تحته</th><th>إجمالي ما كسبه</th></tr></thead>
                <tbody>
                  {data.topNetworks.map((n, i) => (
                    <tr key={n.id} className="clickable" onClick={() => (location.hash = `/members/${n.id}`)}>
                      <td>{i + 1}</td>
                      <td><b>{n.name}</b></td>
                      <td><Badge value={n.program} label={PROGRAM_AR[n.program]} /></td>
                      <td dir="ltr" className="num">{n.phone}</td>
                      <td>{n.orders}</td>
                      <td><b>{money(n.earned)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="muted small">الطلبات المفتوحة: {Object.entries(ORDER_STATUS_AR).slice(0, 3).map(([k, v]) => `${v} ${open(k)}`).join(" · ")}</p>
        </>
      )}
    </div>
  );
}

function DailyChart({ daily }: { daily: ReportData["daily"] }) {
  if (daily.length === 0) return <Empty text="لا توجد مبيعات مُسلّمة في هذه الفترة" />;
  const days = [...new Set(daily.map((d) => d.day))].sort().slice(-30);
  const val = (day: string, p: string) => daily.find((d) => d.day === day && d.program === p)?.revenue ?? 0;
  const max = Math.max(...days.map((d) => val(d, "retail") + val(d, "wholesale")), 1);
  return (
    <div>
      <div className="chart">
        {days.map((d) => {
          const r = val(d, "retail");
          const w = val(d, "wholesale");
          return (
            <div key={d} className="bar-col" title={`${d}\nقطاعي: ${money(r)}\nجملة: ${money(w)}`}>
              <div className="bar-stack" style={{ height: `${((r + w) / max) * 100}%` }}>
                <div className="bar wholesale" style={{ flex: w }} />
                <div className="bar retail" style={{ flex: r }} />
              </div>
              <div className="bar-label">{d.slice(5)}</div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="dot retail" /> قطاعي</span>
        <span><i className="dot wholesale" /> جملة</span>
        <span className="muted">أعلى يوم: {money(max)}</span>
      </div>
    </div>
  );
}
