import { useEffect, useState } from "react";
import {
  listPrimes,
  createPrime,
  updatePrime,
  deletePrime,
  validatePrime,
  cancelPrime,
  type Prime,
  type PrimeType,
  type Employee,
} from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";
import { Modal, Field } from "./Modal";
import { useConfirm } from "./ConfirmProvider";

// Module « Primes du mois » (demande opérateur 09/09/2026). Le RH ajoute des
// primes individuelles (type, montant, motif, date, observation), les gère tant
// qu'elles sont « à valider », puis les VALIDE : elles sont alors intégrées
// automatiquement à la paie du mois (source unique des primes de la ligne de
// paie). Une prime validée peut être annulée tant que la paie n'est pas
// verrouillée. Rubrique du Moteur de Paie, juste avant la grille mensuelle.

const TYPE_LABELS: Record<PrimeType, string> = {
  rendement: "Rendement",
  transport: "Transport",
  exceptionnelle: "Exceptionnelle",
  responsabilite: "Responsabilité",
  autre: "Autre",
};

const STATUS_META: Record<Prime["status"], { label: string; color: string }> = {
  a_valider: { label: "À valider", color: "var(--amber, #B87400)" },
  validee: { label: "Validée", color: "var(--positive, #2F7D4A)" },
  annulee: { label: "Annulée", color: "var(--muted)" },
};

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

interface PrimeForm {
  id?: string;
  employee_id: string;
  period: string;
  type: PrimeType;
  amount: string;
  motif: string;
  date_awarded: string; // YYYY-MM-DD
  observation: string;
}

export function PrimesSection({ employees, canManage }: { employees: Employee[]; canManage: boolean }) {
  const confirm = useConfirm();
  const [period, setPeriod] = useState(currentPeriod());
  const [primes, setPrimes] = useState<Prime[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<PrimeForm | null>(null);

  async function refresh() {
    try {
      setPrimes(await listPrimes({ period }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement des primes impossible.");
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const money = new Intl.NumberFormat("fr-FR");
  const empName = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : "—";
  };

  function openAdd() {
    setError(null);
    setMessage(null);
    setForm({ employee_id: employees[0]?.id ?? "", period, type: "rendement", amount: "", motif: "", date_awarded: new Date().toISOString().slice(0, 10), observation: "" });
  }
  function openEdit(p: Prime) {
    setError(null);
    setMessage(null);
    setForm({ id: p.id, employee_id: p.employee_id, period: p.period, type: p.type, amount: String(p.amount), motif: p.motif ?? "", date_awarded: p.date_awarded.slice(0, 10), observation: p.observation ?? "" });
  }

  async function submitForm() {
    if (!form) return;
    if (!form.employee_id) { setError("Choisissez un salarié."); return; }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Le montant doit être supérieur à zéro."); return; }
    const payload = {
      type: form.type,
      amount,
      motif: form.motif.trim() || undefined,
      date_awarded: new Date(form.date_awarded + "T00:00:00.000Z").toISOString(),
      observation: form.observation.trim() || undefined,
    };
    try {
      if (form.id) {
        await updatePrime(form.id, { ...payload, period: form.period });
        setMessage("Prime modifiée.");
      } else {
        await createPrime({ employee_id: form.employee_id, period: form.period, ...payload });
        setMessage("Prime ajoutée (à valider).");
      }
      setForm(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  async function handleValidate(p: Prime) {
    const ok = await confirm({
      title: "Valider la prime",
      message: "Valider cette prime ? Elle sera intégrée automatiquement à la paie du mois.",
      detail: `${empName(p.employee_id)} · ${TYPE_LABELS[p.type]} · ${money.format(p.amount)} FCFA`,
      confirmLabel: "Valider",
    });
    if (!ok) return;
    try {
      await validatePrime(p.id);
      setMessage("Prime validée et intégrée à la paie du mois.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation impossible.");
    }
  }
  async function handleCancel(p: Prime) {
    const ok = await confirm({
      title: "Annuler la prime",
      message: "Annuler cette prime validée ? Elle sera retirée de la paie du mois.",
      detail: `${empName(p.employee_id)} · ${money.format(p.amount)} FCFA`,
      confirmLabel: "Annuler la prime",
    });
    if (!ok) return;
    try {
      await cancelPrime(p.id);
      setMessage("Prime annulée et retirée de la paie du mois.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }
  async function handleDelete(p: Prime) {
    const ok = await confirm({
      title: "Supprimer la prime",
      message: "Supprimer définitivement cette prime (non validée) ?",
      detail: `${empName(p.employee_id)} · ${money.format(p.amount)} FCFA`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    try {
      await deletePrime(p.id);
      setMessage("Prime supprimée.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }

  const total = primes.filter((p) => p.status === "validee").reduce((s, p) => s + p.amount, 0);

  return (
    <Card
      title="Primes du mois"
      icon={<span aria-hidden>➕</span>}
      subtitle="Ajoutez les primes du mois (rendement, transport, exceptionnelle, responsabilité…). Une fois validées, elles s'intègrent automatiquement à la paie du mois."
      collapsible
      action={
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }} title="Mois" />
          {canManage && <Button variant="add" size="sm" onClick={openAdd} disabled={employees.length === 0}>➕ Ajouter une prime</Button>}
        </div>
      }
    >
      {error && <div style={banner("var(--alert-soft)", "var(--alert)")}>{error}</div>}
      {message && <div style={banner("var(--eclosion-soft)", "var(--eclosion)")}>{message}</div>}

      {primes.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Aucune prime pour ce mois. Cliquez sur « ➕ Ajouter une prime ».</p>
      ) : (
        <>
          <div className="ecl-list">
            {primes.map((p) => {
              const st = STATUS_META[p.status];
              return (
                <div key={p.id} className="ecl-row" style={{ opacity: p.status === "annulee" ? 0.6 : 1 }}>
                  <div className="ecl-row__main" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="ecl-row__title">{p.employee_name ?? empName(p.employee_id)}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{TYPE_LABELS[p.type]}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)" }}>{money.format(p.amount)} FCFA</span>
                    {p.motif && <span className="ecl-row__desc" style={{ margin: 0 }}>{p.motif}</span>}
                    <span style={{ fontSize: 11, fontWeight: 600, color: st.color, border: `1px solid ${st.color}`, borderRadius: 999, padding: "2px 9px" }}>{st.label}</span>
                  </div>
                  {canManage && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                      {p.status === "a_valider" && (
                        <>
                          <Button variant="add" size="sm" onClick={() => handleValidate(p)}>Valider</Button>
                          <Button variant="view" size="sm" onClick={() => openEdit(p)}>Modifier</Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(p)}>Supprimer</Button>
                        </>
                      )}
                      {p.status === "validee" && (
                        <Button variant="danger" size="sm" onClick={() => handleCancel(p)}>Annuler</Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "right", marginTop: 10, fontSize: 13 }}>
            Total des primes <strong>validées</strong> du mois : <strong style={{ fontFamily: "var(--font-mono)" }}>{money.format(total)} FCFA</strong>
          </div>
        </>
      )}

      {form && (
        <Modal
          title={form.id ? "Modifier la prime" : "Ajouter une prime"}
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="view" size="sm" onClick={() => setForm(null)}>Annuler</Button>
              <Button variant="add" size="sm" onClick={submitForm}>{form.id ? "Enregistrer" : "Ajouter"}</Button>
            </>
          }
        >
          <Field label="Employé">
            <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} disabled={!!form.id}>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <Field label="Mois concerné (AAAA-MM)"><input type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} style={{ fontFamily: "var(--font-mono, monospace)" }} /></Field>
          <Field label="Type de prime">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PrimeType })}>
              {(Object.keys(TYPE_LABELS) as PrimeType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Montant (FCFA)"><input type="number" min={0} step={500} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus /></Field>
          <Field label="Motif / justification"><input value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} placeholder="Ex. Objectifs trimestriels atteints" /></Field>
          <Field label="Date"><input type="date" value={form.date_awarded} onChange={(e) => setForm({ ...form, date_awarded: e.target.value })} /></Field>
          <Field label="Observation (facultatif)"><input value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></Field>
        </Modal>
      )}
    </Card>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, borderRadius: 8, padding: "9px 13px", fontSize: 13, marginBottom: 12 };
}
