import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, CheckCircle2, Download, Lock, LockOpen, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { useSesion } from '../lib/sesion';

// ── Tipos de la API ──
interface Cuenta { id: string; codigo: string; nombre: string; tipo: TipoCuenta; imputable: boolean; padreId: string | null; activa: boolean; conMovimientos: boolean }
type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';
interface Plan { cuentas: Cuenta[]; conceptos: { concepto: string; nombre: string; cuentaId: string | null }[]; bancos: { id: string; banco: string; nombre: string; activa: boolean; cuentaContableId: string | null }[] }
interface Estado {
  tienePlan: boolean;
  faltanConceptos: string[];
  faltanConceptosSueldos: string[];
  cerradoHasta: string | null;
  pendientes: { total: number; porTipo: { tipo: string; nombre: string; cantidad: number }[] };
  cierres: { accion: 'cierre' | 'reapertura'; hasta: string | null; motivo: string | null; fecha: string; usuario: string }[];
}
interface Asiento { id: string; numero: number; fecha: string; descripcion: string; origen: string; estado: 'confirmado' | 'anulado'; motivoAnulacion: string | null; total: string; lineas: { cuentaId: string; codigo: string; cuenta: string; debe: string; haber: string; detalle: string | null }[] }
interface Diario { total: number; pagina: number; paginas: number; sumaPeriodo: string; items: Asiento[] }
interface Mayor { cuenta: { codigo: string; nombre: string }; saldoInicial: string; debe: string; haber: string; saldoFinal: string; items: { asientoId: string; numero: number; fecha: string; descripcion: string; codigo: string; debe: string; haber: string; saldo: string }[] }
interface FilaBalance { id: string; codigo: string; nombre: string; tipo: TipoCuenta; imputable: boolean; nivel: number; saldoAnterior: string; debe: string; haber: string; saldo: string }
interface Balance { desde: string; hasta: string; filas: FilaBalance[]; totales: { debe: string; haber: string }; activo: string; pasivo: string; patrimonio: string; resultadoAcumulado: string; resultadoPeriodo: string }

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const ayer = () => {
  const d = new Date(`${hoy()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const inicioMes = () => hoy().slice(0, 8) + '01';
const inicioAnio = () => hoy().slice(0, 5) + '01-01';
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '');
const fmt = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
const imp = (v: string | number) => (Number(v) === 0 ? '' : fmt.format(Number(v)));
const impCero = (v: string | number) => fmt.format(Number(v));
/** Saldo con su naturaleza: D (deudor) o A (acreedor). */
const saldoDA = (v: string | number) => (Number(v) === 0 ? '—' : `${fmt.format(Math.abs(Number(v)))} ${Number(v) > 0 ? 'D' : 'A'}`);
const TIPOS: Record<TipoCuenta, string> = { activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio neto', ingreso: 'Ingresos', gasto: 'Egresos' };
const ORIGENES: Record<string, string> = {
  manual: 'Manual',
  reversion: 'Anulación de asiento',
  venta: 'Venta',
  venta_anulacion: 'Anulación de venta',
  devolucion: 'Devolución',
  compra: 'Compra',
  compra_anulacion: 'Anulación de compra',
  cuenta_pagar: 'Cuenta a pagar',
  cuenta_pagar_anulacion: 'Anulación de cuenta a pagar',
  pago_proveedor: 'Pago a proveedor',
  pago_proveedor_anulacion: 'Anulación de pago',
  cobro: 'Cobro',
  cobro_anulacion: 'Anulación de cobro',
  movimiento_bancario: 'Banco',
};
const sangria = (nivel: number) => ({ paddingLeft: 20 + (nivel - 1) * 16 });

function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((f) => f.map((c) => (typeof c === 'string' && /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

type Pestana = 'diario' | 'mayor' | 'balances' | 'plan' | 'cierres';

export function Contabilidad() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [pestana, setPestana] = useState<Pestana>('diario');
  const estado = useQuery({ queryKey: ['contabilidad', 'estado'], queryFn: () => api<Estado>('/contabilidad/estado') });
  const crearPlan = useMutation({
    mutationFn: () => api('/contabilidad/cuentas/plan-sugerido', { metodo: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contabilidad'] }),
  });
  const contabilizar = useMutation({
    mutationFn: () => api<{ generados: number }>('/contabilidad/contabilizar', { metodo: 'POST', cuerpo: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contabilidad'] }),
  });
  const completar = useMutation({
    mutationFn: () => api('/contabilidad/cuentas/completar-sugerido', { metodo: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contabilidad'] }),
  });
  const e = estado.data;
  return (
    <>
      <Encabezado titulo="Contabilidad" />
      <div className="contenido">
        {!e ? (
          <Cargando />
        ) : !e.tienePlan ? (
          <section className="panel">
            <Vacio
              titulo="Todavía no hay un plan de cuentas"
              accion={
                puede('contabilidad.aprobar') && (
                  <button className="btn pri" disabled={crearPlan.isPending} onClick={() => crearPlan.mutate()}>
                    <BookOpenCheck size={16} /> Crear el plan de cuentas sugerido
                  </button>
                )
              }
            >
              El plan sugerido trae las cuentas habituales de un comercio en Paraguay y deja configurados los asientos automáticos de ventas, compras, cobros, pagos y bancos. Después puede agregar o renombrar cuentas.
            </Vacio>
            <div style={{ padding: '0 20px 20px' }}><ErrorApi error={crearPlan.error} /></div>
          </section>
        ) : (
          <>
            <section className="panel cifras" style={{ marginBottom: 16 }}>
              <div className="cifra">
                <span>Documentos sin contabilizar</span>
                <b className="num">{e.pendientes.total}</b>
                {e.pendientes.total > 0 && <small className="tenue">{e.pendientes.porTipo.filter((p) => p.cantidad).map((p) => `${p.nombre}: ${p.cantidad}`).join(' · ')}</small>}
              </div>
              <div className="cifra">
                <span>Período cerrado hasta</span>
                <b className="num">{e.cerradoHasta ? fechaCorta(e.cerradoHasta) : 'Sin cierres'}</b>
              </div>
              <div className="cifra" style={{ justifyContent: 'center' }}>
                {puede('contabilidad.crear') && (
                  <button className="btn pri" disabled={contabilizar.isPending || e.pendientes.total === 0 || e.faltanConceptos.length > 0} onClick={() => contabilizar.mutate()}>
                    <CheckCircle2 size={16} /> {contabilizar.isPending ? 'Contabilizando…' : 'Contabilizar ahora'}
                  </button>
                )}
                {contabilizar.data && <small className="tenue">{contabilizar.data.generados} asientos generados</small>}
              </div>
            </section>
            <ErrorApi error={contabilizar.error} />
            {(e.faltanConceptos.length > 0 || e.faltanConceptosSueldos.length > 0) && puede('contabilidad.aprobar') && (
              <div className="aviso info" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <span>Faltan cuentas del plan sugerido para: {[...e.faltanConceptos, ...e.faltanConceptosSueldos].join(', ')}.</span>
                <button className="btn" style={{ marginLeft: 'auto' }} disabled={completar.isPending} onClick={() => completar.mutate()}>Agregar las cuentas sugeridas</button>
              </div>
            )}
            <ErrorApi error={completar.error} />
            {e.faltanConceptos.length > 0 && <Aviso tipo="info">Para los asientos automáticos falta asignar cuenta a: {e.faltanConceptos.join(', ')}. Hágalo en "Plan de cuentas".</Aviso>}
            <div className="pestanas">
              {(
                [
                  ['diario', 'Libro diario'],
                  ['mayor', 'Libro mayor'],
                  ['balances', 'Balances'],
                  ['plan', 'Plan de cuentas'],
                  ['cierres', 'Cierres'],
                ] as [Pestana, string][]
              ).map(([k, t]) => (
                <button key={k} className={pestana === k ? 'activa' : ''} onClick={() => setPestana(k)}>{t}</button>
              ))}
            </div>
            {pestana === 'diario' && <LibroDiario cerradoHasta={e.cerradoHasta} />}
            {pestana === 'mayor' && <LibroMayor />}
            {pestana === 'balances' && <Balances />}
            {pestana === 'plan' && <PlanCuentas />}
            {pestana === 'cierres' && <Cierres estado={e} />}
          </>
        )}
      </div>
    </>
  );
}

function usePlan() {
  return useQuery({ queryKey: ['contabilidad', 'plan'], queryFn: () => api<Plan>('/contabilidad/cuentas') });
}

// ── Libro diario ──

function LibroDiario({ cerradoHasta }: { cerradoHasta: string | null }) {
  const { puede } = useSesion();
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [origen, setOrigen] = useState('');
  const [pagina, setPagina] = useState(1);
  const [nuevo, setNuevo] = useState(false);
  const [anulando, setAnulando] = useState<Asiento | null>(null);
  const q = useQuery({
    queryKey: ['contabilidad', 'diario', desde, hasta, origen, pagina],
    queryFn: () => api<Diario>(`/contabilidad/asientos?desde=${desde}&hasta=${hasta}&pagina=${pagina}${origen ? `&origen=${origen}` : ''}`),
    placeholderData: (p) => p,
  });
  const exportar = () => {
    if (!q.data) return;
    const filas: (string | number)[][] = [['Asiento', 'Fecha', 'Descripción', 'Cuenta', 'Nombre', 'Debe', 'Haber', 'Detalle']];
    for (const a of q.data.items) for (const l of a.lineas) filas.push([a.numero, a.fecha, a.descripcion, l.codigo, l.cuenta, l.debe, l.haber, l.detalle ?? '']);
    descargarCsv(`libro-diario-${desde}-a-${hasta}.csv`, filas);
  };
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <Campo etiqueta="Desde" id="di-d"><input id="di-d" type="date" className="entrada" value={desde} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} /></Campo>
        <Campo etiqueta="Hasta" id="di-h"><input id="di-h" type="date" className="entrada" value={hasta} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} /></Campo>
        <Campo etiqueta="Asientos" id="di-o">
          <select id="di-o" className="entrada" value={origen} onChange={(e) => { setOrigen(e.target.value); setPagina(1); }}>
            <option value="">Todos</option>
            <option value="automatico">Automáticos</option>
            <option value="manual">Manuales</option>
          </select>
        </Campo>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignSelf: 'flex-end' }}>
          {puede('contabilidad.exportar') && q.data && q.data.items.length > 0 && <button className="btn" onClick={exportar}><Download size={16} /> Exportar CSV</button>}
          {puede('contabilidad.crear') && <button className="btn pri" onClick={() => setNuevo(true)}><Plus size={16} /> Asiento manual</button>}
        </div>
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.items.length ? (
        <Vacio titulo="Sin asientos en el período">Los asientos automáticos aparecen al contabilizar los documentos.</Vacio>
      ) : (
        <>
          <table className="diario">
            <thead><tr><th style={{ width: 90 }}>Cuenta</th><th>Nombre</th><th className="der" style={{ width: 140 }}>Debe</th><th className="der" style={{ width: 140 }}>Haber</th></tr></thead>
            {q.data.items.map((a) => (
              <tbody key={a.id} className={a.estado === 'anulado' ? 'anulado' : undefined}>
                <tr className="cab-asiento">
                  <td colSpan={4}>
                    <b>N.º {a.numero}</b> <span className="tenue">· {fechaCorta(a.fecha)} ·</span> {a.descripcion}
                    <span className="insignia i-n" style={{ marginLeft: 8 }}>{ORIGENES[a.origen] ?? a.origen}</span>
                    {a.estado === 'anulado' && <span className="insignia i-bad" style={{ marginLeft: 6 }} title={a.motivoAnulacion ?? ''}>Anulado</span>}
                    {a.origen === 'manual' && a.estado === 'confirmado' && puede('contabilidad.crear') && (
                      <button className="btn" style={{ height: 26, float: 'right' }} onClick={() => setAnulando(a)}><Undo2 size={13} /> Anular</button>
                    )}
                  </td>
                </tr>
                {a.lineas.map((l, i) => (
                  <tr key={i}>
                    <td className="num tenue">{l.codigo}</td>
                    <td style={Number(l.haber) > 0 ? { paddingLeft: 40 } : undefined}>
                      {l.cuenta}
                      {l.detalle && <span className="tenue peq"> · {l.detalle}</span>}
                    </td>
                    <td className="der num">{imp(l.debe)}</td>
                    <td className="der num">{imp(l.haber)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
            <span className="tenue peq">{q.data.total} asientos · Sumas del período: {impCero(q.data.sumaPeriodo)}</span>
            {q.data.paginas > 1 && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
                <span className="tenue peq">Página {pagina} de {q.data.paginas}</span>
                <button className="btn" disabled={pagina >= q.data.paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
              </span>
            )}
          </div>
        </>
      )}
      {nuevo && <FormAsiento cerradoHasta={cerradoHasta} alCerrar={() => setNuevo(false)} />}
      {anulando && <AnularAsiento asiento={anulando} alCerrar={() => setAnulando(null)} />}
    </section>
  );
}

function FormAsiento({ cerradoHasta, alCerrar }: { cerradoHasta: string | null; alCerrar: () => void }) {
  const qc = useQueryClient();
  const plan = usePlan();
  const imputables = (plan.data?.cuentas ?? []).filter((c) => c.imputable && c.activa);
  const [fecha, setFecha] = useState(hoy());
  const [descripcion, setDescripcion] = useState('');
  const [lineas, setLineas] = useState([{ cuentaId: '', debe: '', haber: '', detalle: '' }, { cuentaId: '', debe: '', haber: '', detalle: '' }]);
  const debe = lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
  const haber = lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
  const cambiar = (i: number, k: 'cuentaId' | 'debe' | 'haber' | 'detalle', v: string) =>
    setLineas(lineas.map((l, j) => (j !== i ? l : { ...l, [k]: k === 'debe' || k === 'haber' ? v.replace(/[^0-9]/g, '') : v, ...(k === 'debe' && v ? { haber: '' } : {}), ...(k === 'haber' && v ? { debe: '' } : {}) })));
  const guardar = useMutation({
    mutationFn: () =>
      api('/contabilidad/asientos', {
        metodo: 'POST',
        cuerpo: { fecha, descripcion, lineas: lineas.filter((l) => l.cuentaId && (l.debe || l.haber)).map((l) => ({ cuentaId: l.cuentaId, debe: Number(l.debe || 0), haber: Number(l.haber || 0), detalle: l.detalle || null })) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
      alCerrar();
    },
  });
  const listo = descripcion.trim().length >= 3 && debe > 0 && debe === haber && lineas.filter((l) => l.cuentaId && (l.debe || l.haber)).length >= 2;
  return (
    <Cajon
      titulo="Asiento manual"
      ancho={860}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={!listo || guardar.isPending} onClick={() => guardar.mutate()}>Registrar asiento</button></>}
    >
      <div className="form">
        <ErrorApi error={guardar.error} />
        {cerradoHasta && <p className="tenue peq" style={{ margin: 0 }}>El período está cerrado hasta el {fechaCorta(cerradoHasta)}: la fecha debe ser posterior.</p>}
        <div className="fila-campos">
          <Campo etiqueta="Fecha" id="as-f"><input id="as-f" type="date" className="entrada" value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)} /></Campo>
          <Campo etiqueta="Descripción" id="as-d"><input id="as-d" className="entrada" placeholder="Por ejemplo: aporte de capital, sueldos del mes" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
        </div>
        <table>
          <thead><tr><th>Cuenta</th><th>Detalle</th><th className="der" style={{ width: 130 }}>Debe</th><th className="der" style={{ width: 130 }}>Haber</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  <select aria-label="Cuenta" className="entrada" value={l.cuentaId} onChange={(e) => cambiar(i, 'cuentaId', e.target.value)}>
                    <option value="">Elegir cuenta</option>
                    {imputables.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                  </select>
                </td>
                <td><input aria-label="Detalle" className="entrada" value={l.detalle} onChange={(e) => cambiar(i, 'detalle', e.target.value)} /></td>
                <td><input aria-label="Debe" className="entrada num der" value={l.debe ? impCero(l.debe) : ''} onChange={(e) => cambiar(i, 'debe', e.target.value)} /></td>
                <td><input aria-label="Haber" className="entrada num der" value={l.haber ? impCero(l.haber) : ''} onChange={(e) => cambiar(i, 'haber', e.target.value)} /></td>
                <td>{lineas.length > 2 && <button className="btn" aria-label="Quitar línea" style={{ height: 34, padding: '0 8px' }} onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2}><button className="btn" onClick={() => setLineas([...lineas, { cuentaId: '', debe: '', haber: '', detalle: '' }])}><Plus size={14} /> Línea</button></td>
              <td className="der num" style={{ fontWeight: 600 }}>{impCero(debe)}</td>
              <td className="der num" style={{ fontWeight: 600 }}>{impCero(haber)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {debe !== haber && <p className="peq" style={{ color: 'var(--bad)', margin: 0 }}>Diferencia: {impCero(Math.abs(debe - haber))}. El debe y el haber deben sumar lo mismo.</p>}
      </div>
    </Cajon>
  );
}

function AnularAsiento({ asiento, alCerrar }: { asiento: Asiento; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api(`/contabilidad/asientos/${asiento.id}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
      alCerrar();
    },
  });
  return (
    <Cajon
      titulo={`Anular asiento N.º ${asiento.numero}`}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Volver</button><button className="btn peligro" disabled={motivo.trim().length < 5 || anular.isPending} onClick={() => anular.mutate()}>Anular</button></>}
    >
      <div className="form">
        <ErrorApi error={anular.error} />
        <p style={{ margin: 0 }}>Se registra un asiento inverso con fecha de hoy. El original queda en el libro, marcado como anulado.</p>
        <Campo etiqueta="Motivo" id="an-m"><input id="an-m" className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      </div>
    </Cajon>
  );
}

// ── Libro mayor ──

function LibroMayor() {
  const { puede } = useSesion();
  const plan = usePlan();
  const [cuentaId, setCuentaId] = useState('');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const q = useQuery({
    queryKey: ['contabilidad', 'mayor', cuentaId, desde, hasta],
    queryFn: () => api<Mayor>(`/contabilidad/mayor?cuentaId=${cuentaId}&desde=${desde}&hasta=${hasta}`),
    enabled: !!cuentaId,
  });
  const exportar = () => {
    if (!q.data) return;
    const filas: (string | number)[][] = [['Fecha', 'Asiento', 'Cuenta', 'Descripción', 'Debe', 'Haber', 'Saldo']];
    filas.push([desde, '', '', 'Saldo anterior', '', '', q.data.saldoInicial]);
    for (const m of q.data.items) filas.push([m.fecha, m.numero, m.codigo, m.descripcion, m.debe, m.haber, m.saldo]);
    descargarCsv(`mayor-${q.data.cuenta.codigo}-${desde}-a-${hasta}.csv`, filas);
  };
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <Campo etiqueta="Cuenta" id="ma-c">
          <select id="ma-c" className="entrada" style={{ minWidth: 300 }} value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
            <option value="">Elegir cuenta</option>
            {(plan.data?.cuentas ?? []).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}{c.imputable ? '' : ' (grupo)'}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Desde" id="ma-d"><input id="ma-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="Hasta" id="ma-h"><input id="ma-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        {puede('contabilidad.exportar') && q.data && <button className="btn" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={exportar}><Download size={16} /> Exportar CSV</button>}
      </div>
      <ErrorApi error={q.error} />
      {!cuentaId ? (
        <Vacio titulo="Elija una cuenta">El mayor muestra todos sus movimientos con el saldo corrido. Si elige un grupo, incluye sus subcuentas.</Vacio>
      ) : !q.data ? (
        <Cargando />
      ) : (
        <table>
          <thead><tr><th style={{ width: 100 }}>Fecha</th><th style={{ width: 70 }}>Asiento</th><th>Descripción</th><th className="der">Debe</th><th className="der">Haber</th><th className="der">Saldo</th></tr></thead>
          <tbody>
            <tr><td className="tenue">{fechaCorta(desde)}</td><td /><td className="tenue">Saldo anterior</td><td /><td /><td className="der num" style={{ fontWeight: 600 }}>{saldoDA(q.data.saldoInicial)}</td></tr>
            {q.data.items.map((m, i) => (
              <tr key={i}>
                <td className="tenue">{fechaCorta(m.fecha)}</td>
                <td className="num">{m.numero}</td>
                <td>{m.descripcion}</td>
                <td className="der num">{imp(m.debe)}</td>
                <td className="der num">{imp(m.haber)}</td>
                <td className="der num">{saldoDA(m.saldo)}</td>
              </tr>
            ))}
            <tr className="total-fila">
              <td colSpan={3}>Totales del período</td>
              <td className="der num">{impCero(q.data.debe)}</td>
              <td className="der num">{impCero(q.data.haber)}</td>
              <td className="der num">{saldoDA(q.data.saldoFinal)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Balances ──

function Balances() {
  const { puede } = useSesion();
  const [vista, setVista] = useState<'sumas' | 'general' | 'resultados'>('sumas');
  const [desde, setDesde] = useState(inicioAnio());
  const [hasta, setHasta] = useState(hoy());
  const [ceros, setCeros] = useState(false);
  const q = useQuery({ queryKey: ['contabilidad', 'balance', desde, hasta], queryFn: () => api<Balance>(`/contabilidad/balance?desde=${desde}&hasta=${hasta}`), enabled: desde <= hasta });
  const b = q.data;
  const conMovimiento = (f: FilaBalance) => ceros || Number(f.saldoAnterior) !== 0 || Number(f.debe) !== 0 || Number(f.haber) !== 0;
  const exportar = () => {
    if (!b) return;
    const filas: (string | number)[][] = [['Cuenta', 'Nombre', 'Saldo anterior', 'Debe', 'Haber', 'Saldo']];
    for (const f of b.filas.filter(conMovimiento)) filas.push([f.codigo, f.nombre, f.saldoAnterior, f.debe, f.haber, f.saldo]);
    descargarCsv(`sumas-y-saldos-${desde}-a-${hasta}.csv`, filas);
  };
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <Campo etiqueta="Informe" id="ba-v">
          <select id="ba-v" className="entrada" value={vista} onChange={(e) => setVista(e.target.value as typeof vista)}>
            <option value="sumas">Sumas y saldos</option>
            <option value="general">Balance general</option>
            <option value="resultados">Estado de resultados</option>
          </select>
        </Campo>
        {vista !== 'general' && <Campo etiqueta="Desde" id="ba-d"><input id="ba-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>}
        <Campo etiqueta={vista === 'general' ? 'Al' : 'Hasta'} id="ba-h"><input id="ba-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', alignSelf: 'flex-end', paddingBottom: 8 }}>
          <input type="checkbox" checked={ceros} onChange={(e) => setCeros(e.target.checked)} /> Mostrar cuentas sin movimiento
        </label>
        {puede('contabilidad.exportar') && b && vista === 'sumas' && <button className="btn" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={exportar}><Download size={16} /> Exportar CSV</button>}
        <button className="btn" style={{ alignSelf: 'flex-end', marginLeft: vista === 'sumas' && puede('contabilidad.exportar') ? 0 : 'auto' }} onClick={() => window.print()}>Imprimir</button>
      </div>
      <ErrorApi error={q.error} />
      {!b ? (
        <Cargando />
      ) : vista === 'sumas' ? (
        <table>
          <thead><tr><th>Cuenta</th><th className="der">Saldo anterior</th><th className="der">Debe</th><th className="der">Haber</th><th className="der">Saldo</th></tr></thead>
          <tbody>
            {b.filas.filter(conMovimiento).map((f) => (
              <tr key={f.id} style={f.imputable ? undefined : { fontWeight: 600 }}>
                <td style={sangria(f.nivel)}><span className="num tenue">{f.codigo}</span> {f.nombre}</td>
                <td className="der num">{saldoDA(f.saldoAnterior)}</td>
                <td className="der num">{imp(f.debe)}</td>
                <td className="der num">{imp(f.haber)}</td>
                <td className="der num">{saldoDA(f.saldo)}</td>
              </tr>
            ))}
            <tr className="total-fila"><td>Totales</td><td /><td className="der num">{impCero(b.totales.debe)}</td><td className="der num">{impCero(b.totales.haber)}</td><td /></tr>
          </tbody>
        </table>
      ) : vista === 'general' ? (
        <BalanceGeneral b={b} filtro={conMovimiento} />
      ) : (
        <EstadoResultados b={b} filtro={conMovimiento} />
      )}
    </section>
  );
}

function BalanceGeneral({ b, filtro }: { b: Balance; filtro: (f: FilaBalance) => boolean }) {
  const grupo = (t: TipoCuenta, signo: 1 | -1) => (
    <>
      {b.filas.filter((f) => f.tipo === t && filtro(f) && Number(f.saldo) !== 0).map((f) => (
        <tr key={f.id} style={f.imputable ? undefined : { fontWeight: 600 }}>
          <td style={sangria(f.nivel)}><span className="num tenue">{f.codigo}</span> {f.nombre}</td>
          <td className="der num">{impCero(Number(f.saldo) * signo)}</td>
        </tr>
      ))}
    </>
  );
  const pasivoMasPn = Number(b.pasivo) + Number(b.patrimonio) + Number(b.resultadoAcumulado);
  const cuadra = Math.round(Number(b.activo) - pasivoMasPn) === 0;
  return (
    <table>
      <thead><tr><th>Al {fechaCorta(b.hasta)}</th><th className="der">Importe</th></tr></thead>
      <tbody>
        {grupo('activo', 1)}
        <tr className="total-fila"><td>Total del activo</td><td className="der num">{impCero(b.activo)}</td></tr>
        {grupo('pasivo', -1)}
        <tr className="total-fila"><td>Total del pasivo</td><td className="der num">{impCero(b.pasivo)}</td></tr>
        {grupo('patrimonio', -1)}
        <tr><td style={sangria(2)}>Resultado del ejercicio (ingresos − egresos sin cerrar)</td><td className="der num">{impCero(b.resultadoAcumulado)}</td></tr>
        <tr className="total-fila"><td>Total del patrimonio neto</td><td className="der num">{impCero(Number(b.patrimonio) + Number(b.resultadoAcumulado))}</td></tr>
        <tr className="total-fila"><td>Pasivo + patrimonio neto</td><td className="der num">{impCero(pasivoMasPn)}</td></tr>
      </tbody>
      {!cuadra && <caption style={{ captionSide: 'bottom', color: 'var(--bad)', padding: 12 }}>El balance no cuadra: revise los asientos.</caption>}
    </table>
  );
}

function EstadoResultados({ b, filtro }: { b: Balance; filtro: (f: FilaBalance) => boolean }) {
  // Movimiento del período: ingresos por su saldo acreedor, egresos por su saldo deudor.
  const mov = (f: FilaBalance) => (f.tipo === 'ingreso' ? Number(f.haber) - Number(f.debe) : Number(f.debe) - Number(f.haber));
  const total = (t: TipoCuenta) => b.filas.filter((f) => f.tipo === t && f.imputable).reduce((s, f) => s + mov(f), 0);
  const filas = (t: TipoCuenta) =>
    b.filas.filter((f) => f.tipo === t && filtro(f) && mov(f) !== 0).map((f) => (
      <tr key={f.id} style={f.imputable ? undefined : { fontWeight: 600 }}>
        <td style={sangria(f.nivel)}><span className="num tenue">{f.codigo}</span> {f.nombre}</td>
        <td className="der num">{impCero(mov(f))}</td>
      </tr>
    ));
  return (
    <table>
      <thead><tr><th>Del {fechaCorta(b.desde)} al {fechaCorta(b.hasta)}</th><th className="der">Importe</th></tr></thead>
      <tbody>
        {filas('ingreso')}
        <tr className="total-fila"><td>Total de ingresos</td><td className="der num">{impCero(total('ingreso'))}</td></tr>
        {filas('gasto')}
        <tr className="total-fila"><td>Total de egresos</td><td className="der num">{impCero(total('gasto'))}</td></tr>
        <tr className="total-fila"><td>{Number(b.resultadoPeriodo) >= 0 ? 'Ganancia del período' : 'Pérdida del período'}</td><td className="der num" style={{ color: Number(b.resultadoPeriodo) < 0 ? 'var(--bad)' : 'var(--ok)' }}>{impCero(b.resultadoPeriodo)}</td></tr>
      </tbody>
    </table>
  );
}

// ── Plan de cuentas y configuración de asientos automáticos ──

function PlanCuentas() {
  const { puede } = useSesion();
  const plan = usePlan();
  const [editando, setEditando] = useState<Cuenta | 'nueva' | null>(null);
  const [config, setConfig] = useState(false);
  if (!plan.data) return <Cargando />;
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <span className="tenue peq" style={{ alignSelf: 'center' }}>{plan.data.cuentas.length} cuentas. Las imputables reciben asientos; los grupos suman a sus subcuentas.</span>
        {puede('contabilidad.aprobar') && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setConfig(true)}>Asientos automáticos</button>
            <button className="btn pri" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva cuenta</button>
          </div>
        )}
      </div>
      <table>
        <thead><tr><th>Código y nombre</th><th>Tipo</th><th>Clase</th><th /></tr></thead>
        <tbody>
          {plan.data.cuentas.map((c) => (
            <tr key={c.id} style={{ ...(c.imputable ? {} : { fontWeight: 600 }), ...(c.activa ? {} : { opacity: 0.5 }) }}>
              <td style={sangria(c.codigo.split('.').length)}><span className="num tenue">{c.codigo}</span> {c.nombre}</td>
              <td className="tenue">{TIPOS[c.tipo]}</td>
              <td>{c.imputable ? <span className="insignia i-ok">Imputable</span> : <span className="insignia i-n">Grupo</span>}{!c.activa && <span className="insignia i-n" style={{ marginLeft: 6 }}>Inactiva</span>}</td>
              <td className="der">{puede('contabilidad.aprobar') && <button className="btn" style={{ height: 28 }} onClick={() => setEditando(c)}><Pencil size={13} /> Editar</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editando && <FormCuenta cuenta={editando === 'nueva' ? null : editando} alCerrar={() => setEditando(null)} />}
      {config && <ConfigAutomaticos plan={plan.data} alCerrar={() => setConfig(false)} />}
    </section>
  );
}

function FormCuenta({ cuenta, alCerrar }: { cuenta: Cuenta | null; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ codigo: cuenta?.codigo ?? '', nombre: cuenta?.nombre ?? '', imputable: cuenta?.imputable ?? true, activa: cuenta?.activa ?? true });
  const guardar = useMutation({
    mutationFn: () => api(cuenta ? `/contabilidad/cuentas/${cuenta.id}` : '/contabilidad/cuentas', { metodo: cuenta ? 'PATCH' : 'POST', cuerpo: f }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
      alCerrar();
    },
  });
  return (
    <Cajon
      titulo={cuenta ? `Cuenta ${cuenta.codigo}` : 'Nueva cuenta contable'}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>}
    >
      <div className="form">
        <ErrorApi error={guardar.error} />
        <div className="fila-campos">
          <Campo etiqueta="Código" id="cc-c" ayuda={cuenta ? 'El código no se cambia.' : 'Debajo de un grupo existente, por ejemplo 1.1.08.'}>
            <input id="cc-c" className="entrada num" disabled={!!cuenta} value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.replace(/[^0-9.]/g, '') })} />
          </Campo>
          <Campo etiqueta="Nombre" id="cc-n"><input id="cc-n" className="entrada" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={f.imputable} disabled={!!cuenta?.conMovimientos} onChange={(e) => setF({ ...f, imputable: e.target.checked })} /> Imputable (recibe asientos). Si no, es un grupo que suma a sus subcuentas.
        </label>
        {cuenta && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} /> Cuenta activa
          </label>
        )}
      </div>
    </Cajon>
  );
}

function ConfigAutomaticos({ plan, alCerrar }: { plan: Plan; alCerrar: () => void }) {
  const qc = useQueryClient();
  const imputables = plan.cuentas.filter((c) => c.imputable && c.activa);
  const [conceptos, setConceptos] = useState<Record<string, string>>(Object.fromEntries(plan.conceptos.map((c) => [c.concepto, c.cuentaId ?? ''])));
  const [bancos, setBancos] = useState<Record<string, string>>(Object.fromEntries(plan.bancos.map((b) => [b.id, b.cuentaContableId ?? ''])));
  const guardar = useMutation({
    mutationFn: () =>
      api('/contabilidad/conceptos', {
        metodo: 'PUT',
        cuerpo: {
          conceptos: Object.fromEntries(Object.entries(conceptos).filter(([, v]) => v)),
          bancos: Object.fromEntries(Object.entries(bancos).map(([k, v]) => [k, v || null])),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contabilidad'] });
      alCerrar();
    },
  });
  const selector = (id: string, valor: string, alCambiar: (v: string) => void, vacio: string) => (
    <select id={id} className="entrada" value={valor} onChange={(e) => alCambiar(e.target.value)}>
      <option value="">{vacio}</option>
      {imputables.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
    </select>
  );
  return (
    <Cajon
      titulo="Cuentas de los asientos automáticos"
      ancho={720}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>}
    >
      <div className="form">
        <ErrorApi error={guardar.error} />
        <p className="tenue peq" style={{ margin: 0 }}>Cada operación del sistema usa estas cuentas al contabilizarse. Los cambios valen para lo que se contabilice desde ahora.</p>
        {plan.conceptos.map((c) => (
          <Campo key={c.concepto} etiqueta={c.nombre} id={`co-${c.concepto}`}>
            {selector(`co-${c.concepto}`, conceptos[c.concepto] ?? '', (v) => setConceptos({ ...conceptos, [c.concepto]: v }), 'Sin asignar')}
          </Campo>
        ))}
        {plan.bancos.length > 0 && (
          <>
            <h3 className="subtitulo" style={{ margin: '8px 0 0' }}>Cuentas bancarias</h3>
            {plan.bancos.map((b) => (
              <Campo key={b.id} etiqueta={`${b.banco} · ${b.nombre}`} id={`cb-${b.id}`}>
                {selector(`cb-${b.id}`, bancos[b.id] ?? '', (v) => setBancos({ ...bancos, [b.id]: v }), 'Usar la cuenta Bancos general')}
              </Campo>
            ))}
          </>
        )}
      </div>
    </Cajon>
  );
}

// ── Cierres ──

function Cierres({ estado }: { estado: Estado }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [hasta, setHasta] = useState(ayer());
  const [motivo, setMotivo] = useState('');
  const [reabrirHasta, setReabrirHasta] = useState('');
  const [motivoReapertura, setMotivoReapertura] = useState('');
  const refrescar = () => void qc.invalidateQueries({ queryKey: ['contabilidad'] });
  const cerrar = useMutation({ mutationFn: () => api('/contabilidad/cierre', { metodo: 'POST', cuerpo: { hasta, motivo: motivo || null } }), onSuccess: () => { setMotivo(''); refrescar(); } });
  const reabrir = useMutation({
    mutationFn: () => api('/contabilidad/cierre/reabrir', { metodo: 'POST', cuerpo: { hasta: reabrirHasta || null, motivo: motivoReapertura } }),
    onSuccess: () => { setMotivoReapertura(''); setReabrirHasta(''); refrescar(); },
  });
  const pendientesHasta = useMemo(() => estado.pendientes.total, [estado]);
  return (
    <section className="panel">
      <div className="form" style={{ padding: 20 }}>
        <p style={{ margin: 0 }}>
          Cerrar un período contabiliza todo lo pendiente hasta esa fecha y bloquea los asientos con fecha anterior. Si después se carga un documento con fecha de un período cerrado,
          su asiento se registra en el primer día abierto, con la fecha original en la descripción.
        </p>
        {puede('contabilidad.aprobar') ? (
          <>
            <ErrorApi error={cerrar.error ?? reabrir.error} />
            <div className="fila-campos" style={{ alignItems: 'flex-end' }}>
              <Campo etiqueta="Cerrar hasta el" id="ci-h"><input id="ci-h" type="date" className="entrada" max={ayer()} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
              <Campo etiqueta="Nota (opcional)" id="ci-m"><input id="ci-m" className="entrada" placeholder="Cierre de octubre" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
              <button className="btn pri" style={{ marginBottom: 2 }} disabled={cerrar.isPending || !hasta} onClick={() => cerrar.mutate()}><Lock size={16} /> Cerrar período</button>
            </div>
            {pendientesHasta > 0 && <p className="tenue peq" style={{ margin: 0 }}>Hay {pendientesHasta} documentos sin contabilizar: los del período se contabilizan al cerrar.</p>}
            {estado.cerradoHasta && (
              <div className="fila-campos" style={{ alignItems: 'flex-end', borderTop: '1px solid var(--linea)', paddingTop: 14 }}>
                <Campo etiqueta="Reabrir: nuevo cierre (vacío = todo abierto)" id="ci-r"><input id="ci-r" type="date" className="entrada" max={estado.cerradoHasta} value={reabrirHasta} onChange={(e) => setReabrirHasta(e.target.value)} /></Campo>
                <Campo etiqueta="Motivo de la reapertura" id="ci-rm"><input id="ci-rm" className="entrada" value={motivoReapertura} onChange={(e) => setMotivoReapertura(e.target.value)} /></Campo>
                <button className="btn" style={{ marginBottom: 2 }} disabled={reabrir.isPending || motivoReapertura.trim().length < 5} onClick={() => reabrir.mutate()}><LockOpen size={16} /> Reabrir</button>
              </div>
            )}
          </>
        ) : (
          <p className="tenue peq" style={{ margin: 0 }}>Cerrar y reabrir períodos requiere el permiso de aprobación contable.</p>
        )}
      </div>
      <h3 className="subtitulo" style={{ padding: '0 20px', margin: 0 }}>Historial</h3>
      {!estado.cierres.length ? (
        <Vacio titulo="Todavía no hay cierres" />
      ) : (
        <table>
          <thead><tr><th>Fecha</th><th>Acción</th><th>Cerrado hasta</th><th>Usuario</th><th>Nota</th></tr></thead>
          <tbody>
            {estado.cierres.map((c, i) => (
              <tr key={i}>
                <td className="tenue">{new Date(c.fecha).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{c.accion === 'cierre' ? <span className="insignia i-ok">Cierre</span> : <span className="insignia i-warn">Reapertura</span>}</td>
                <td className="num">{c.hasta ? fechaCorta(c.hasta) : 'Todo abierto'}</td>
                <td>{c.usuario}</td>
                <td className="tenue">{c.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
