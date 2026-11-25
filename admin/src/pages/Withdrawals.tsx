import { useState } from "react";
import { api, qs } from "../api";
import { Badge, Card, date, Empty, ErrorBox, Loading, METHOD_AR, Modal, money, useAction, useApi, WD_STATUS_AR } from "../ui";

interface Withdrawal {
  id: number;
  member_id: number;
  member_name: string;
  member_phone: string;
  amount: number;
  method: string;
  account: string;
  status: string;
  note: string;
  created_at: string;
  decided_at: string | null;
}

export function Withdrawals() {
  const [status, setStatus] = useState("requested");
  const [rows, error, reload] = useApi(() => api<Withdrawal[]>("GET", "/withdrawals" + qs({ status })), [status]);
  const [rejecting, setRejecting] = useState<Withdrawal | null>(null);
  const { busy, error: actionError, run } = useAction();
  const decide = (w: Withdrawal, to: string, note = "") => run(() => api("POST", `/withdrawals/${w.id}`, { status: to, note }), () => { setRejecting(null); reload(); });
  const total = (rows ?? []).reduce((s, w) => s + w.amount, 0);

  return (
    <div className="page">
      <header className="page-head">
        <h1>السحب والخصومات</h1>
        <div className="tabs inline">
          {[["requested", "قيد المراجعة"], ["approved", "تمت الموافقة (لم يُحوّل)"], ["paid", "تم التحويل"], ["rejected", "مرفوض"], ["", "الكل"]].map(([k, v]) => (
            <button key={k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>{v}</button>
          ))}
        </div>
      </header>
      <p className="muted small">عمولات القطاعي تُسحب بطلب من العميل وموافقتك. خصم الجملة يُستخدم في الفواتير القادمة (يمكن تغيير ذلك من الإعدادات).</p>
      <ErrorBox error={error ?? actionError} />
      <Card title={rows ? `${rows.length} طلب · ${money(total)}` : ""}>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty text="لا توجد طلبات" /> : (
          <table>
            <thead><tr><th>#</th><th>العميل</th><th>المبلغ</th><th>الطريقة والحساب</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td>{w.id}</td>
                  <td><a href={`#/members/${w.member_id}`}>{w.member_name}</a><div className="muted small num" dir="ltr">{w.member_phone}</div></td>
                  <td><b>{money(w.amount)}</b></td>
                  <td>{METHOD_AR[w.method] ?? w.method}<div className="mono small" dir="ltr">{w.account}</div></td>
                  <td className="num">{date(w.created_at)}{w.decided_at && <div className="muted small">قرار: {date(w.decided_at)}</div>}</td>
                  <td><Badge value={w.status} label={WD_STATUS_AR[w.status]} />{w.note && <div className="muted small">{w.note}</div>}</td>
                  <td>
                    <div className="row">
                      {w.status === "requested" && (
                        <button className="btn small primary" disabled={busy} onClick={() => decide(w, "approved")}>موافقة</button>
                      )}
                      {(w.status === "requested" || w.status === "approved") && (
                        <>
                          {w.status === "approved" && (
                            <button className="btn small primary" disabled={busy}
                              onClick={() => confirm(`تأكيد تحويل ${money(w.amount)} إلى ${w.account}؟`) && decide(w, "paid")}>تم التحويل</button>
                          )}
                          <button className="btn small danger" disabled={busy} onClick={() => setRejecting(w)}>رفض</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {rejecting && <RejectModal w={rejecting} busy={busy} onClose={() => setRejecting(null)} onReject={(note) => decide(rejecting, "rejected", note)} />}
    </div>
  );
}

function RejectModal({ w, busy, onClose, onReject }: { w: Withdrawal; busy: boolean; onClose: () => void; onReject: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal title={`رفض سحب ${money(w.amount)} — ${w.member_name}`} onClose={onClose}>
      <p className="muted small">المبلغ يعود لرصيد العميل المتاح، ويصله إشعار بالسبب.</p>
      <input className="block" placeholder="سبب الرفض" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row end" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn danger" disabled={busy} onClick={() => onReject(note)}>رفض الطلب</button>
      </div>
    </Modal>
  );
}
