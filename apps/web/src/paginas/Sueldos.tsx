import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, CalendarCheck, CheckCircle2, Download, Plus, Printer, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { dinero, type CajaFila } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import type { CuentaBancaria } from './Bancos';
import { nombrePeriodo, type Funcionario } from './Funcionarios';

interface FilaLiquidacion { id: string; tipo: 'mensual' | 'aguinaldo' | 'final'; funcionario: string | null; periodo: string; estado: 'borrador' | 'confirmada' | 'anulada'; funcionarios: number; bruto: string; ipsObrero: string; ipsPatronal: string; descuentos: string; neto: string; pagada: boolean }
interface Item {
  funcionarioId: string;
  nombre: string;
  documento: string;
  cargo: string;
  remuneracion: 'mensual' | 'jornal';
  salario: string;
  hijos: number;
  aseguradoIps: boolean;
  numeroIps: string | null;
  fechaIngreso: string;
  banco: string | null;
  cuentaBancaria: string | null;
  dias: string;
  salarioBase: string;
  horasExtra50: string;
  horasExtra100: string;
  montoHorasExtra: string;
  otrosIngresos: string;
  bonificacion: string;
  imponible: string;
  bruto: string;
  ipsObrero: string;
  ipsPatronal: string;
  descuentos: string;
  detalleDescuentos: string | null;
  neto: string;
}
type MotivoEgreso = 'renuncia' | 'despido_injustificado' | 'despido_justificado' | 'mutuo_acuerdo' | 'fin_contrato';
interface OpcionesFinal { diasTrabajados: number; preavisoOtorgado: number; vacacionesPendientes: number; vacacionesProporcionales: boolean; ipsPreaviso: boolean; ipsVacaciones: boolean; otrosIngresos: number; descuentos: number }
interface DatosFinal {
  funcionarioId: string;
  fechaEgreso: string;
  motivo: MotivoEgreso;
  motivoTexto: string;
  detalleMotivo: string | null;
  detalleDescuentos: string | null;
  promedioMensual: string | null;
  cobradoAnio: string;
  opciones: OpcionesFinal;
  calculo: { antiguedad: { anios: number; meses: number; dias: number }; aniosIndemnizacion: number; diasPreaviso: number; estabilidad: boolean; jornal: string; baseDiaria: string };
  conceptos: { concepto: string; descripcion: string; dias: string; base: string; monto: string; imponible: boolean }[];
}
const MOTIVOS: Record<MotivoEgreso, string> = {
  renuncia: 'Renuncia',
  despido_injustificado: 'Despido sin justa causa',
  despido_justificado: 'Despido con justa causa',
  mutuo_acuerdo: 'Mutuo acuerdo',
  fin_contrato: 'Fin de contrato',
};
interface Liquidacion {
  id: string;
  tipo: 'mensual' | 'aguinaldo' | 'final';
  final: DatosFinal | null;
  periodo: string;
  estado: 'borrador' | 'confirmada' | 'anulada';
  parametros: { salarioMinimo: string; ipsObrero: string; ipsPatronal: string };
  totales: { bruto: string; ipsObrero: string; ipsPatronal: string; descuentos: string; neto: string };
  pago: { fecha: string; medio: 'banco' | 'efectivo'; cuenta: string | null } | null;
  motivoAnulacion: string | null;
  items: Item[];
}
interface Parametros { salarioMinimo: number | string; ipsObrero: number | string; ipsPatronal: number | string; bonificacionPct: number | string; bonificacionTope: number | string; personalizado: boolean }

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const fmt = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
const num = (v: string | number) => fmt.format(Number(v));
const cant = (v: string) => String(Number(v));
const pct = (v: string | number) => Number(v).toLocaleString('es-PY');
const ESTADOS = { borrador: <span className="insignia i-warn">Borrador</span>, confirmada: <span className="insignia i-ok">Confirmada</span>, anulada: <span className="insignia i-n">Anulada</span> };

export function Sueldos() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<'planillas' | 'parametros'>('planillas');
  const [params, setParams] = useSearchParams();
  const abierta = params.get('liquidacion');
  const setAbierta = (id: string | null) => setParams(id ? { liquidacion: id } : {});
  return (
    <>
      <Encabezado titulo="Sueldos y aguinaldo" />
      <div className="contenido">
        {abierta ? (
          <Planilla id={abierta} alVolver={() => setAbierta(null)} />
        ) : (
          <>
            <div className="pestanas">
              <button className={pestana === 'planillas' ? 'activa' : ''} onClick={() => setPestana('planillas')}>Planillas</button>
              <button className={pestana === 'parametros' ? 'activa' : ''} onClick={() => setPestana('parametros')}>Salario mínimo e IPS</button>
            </div>
            {pestana === 'planillas' ? <Planillas alAbrir={setAbierta} puedeCrear={puede('salario.editar')} /> : <ParametrosRrhh />}
          </>
        )}
      </div>
    </>
  );
}

function Planillas({ alAbrir, puedeCrear }: { alAbrir: (id: string) => void; puedeCrear: boolean }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['liquidaciones'], queryFn: () => api<FilaLiquidacion[]>('/liquidaciones') });
  const [nueva, setNueva] = useState(false);
  const { puede } = useSesion();
  const [tipo, setTipo] = useState<'mensual' | 'aguinaldo' | 'final'>('mensual');
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [anio, setAnio] = useState(hoy().slice(0, 4));
  const [fin, setFin] = useState({ funcionarioId: '', fechaEgreso: hoy(), motivo: 'renuncia' as MotivoEgreso, detalleMotivo: '' });
  const funcionarios = useQuery({ queryKey: ['funcionarios', 'activos', ''], queryFn: () => api<Funcionario[]>('/funcionarios?estado=activos'), enabled: nueva && tipo === 'final' });
  const funcionarioId = fin.funcionarioId || funcionarios.data?.[0]?.id || '';
  const crear = useMutation({
    mutationFn: () =>
      tipo === 'final'
        ? api<Liquidacion>('/liquidaciones/final', { metodo: 'POST', cuerpo: { ...fin, funcionarioId, detalleMotivo: fin.detalleMotivo || null } })
        : api<Liquidacion>('/liquidaciones', { metodo: 'POST', cuerpo: tipo === 'mensual' ? { tipo, periodo: mes } : { tipo, anio: Number(anio) } }),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['liquidaciones'] });
      setNueva(false);
      alAbrir(l.id);
    },
  });
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <span className="tenue peq" style={{ alignSelf: 'center' }}>Una planilla por mes y una de aguinaldo por año; una liquidación final por cada egreso. Se ajustan antes de confirmar.</span>
        {puedeCrear && <button className="btn pri" style={{ marginLeft: 'auto' }} onClick={() => setNueva(true)}><Plus size={16} /> Nueva planilla</button>}
      </div>
      <ErrorApi error={lista.error} />
      {!lista.data ? (
        <Cargando />
      ) : !lista.data.length ? (
        <Vacio titulo="Todavía no hay planillas">Genere la planilla del mes: calcula sueldos, bonificación familiar, horas extra y aportes al IPS.</Vacio>
      ) : (
        <table>
          <thead><tr><th>Período</th><th className="der">Funcionarios</th><th className="der">Bruto</th><th className="der">IPS (obrero + patronal)</th><th className="der">Neto a pagar</th><th>Estado</th></tr></thead>
          <tbody>
            {lista.data.map((l) => (
              <tr key={l.id} className="clic" style={l.estado === 'anulada' ? { opacity: 0.55 } : undefined} onClick={() => alAbrir(l.id)}>
                <td style={{ fontWeight: 600 }}>
                  {nombrePeriodo(l.tipo, l.periodo)}
                  {l.funcionario && <span className="tenue" style={{ fontWeight: 400 }}> · {l.funcionario}</span>}
                </td>
                <td className="der num">{l.funcionarios}</td>
                <td className="der num">{dinero(l.bruto)}</td>
                <td className="der num">{dinero(Number(l.ipsObrero) + Number(l.ipsPatronal))}</td>
                <td className="der num" style={{ fontWeight: 600 }}>{dinero(l.neto)}</td>
                <td>{ESTADOS[l.estado]}{l.pagada && <span className="insignia i-ok" style={{ marginLeft: 6 }}>Pagada</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nueva && (
        <Cajon
          titulo="Nueva planilla"
          alCerrar={() => setNueva(false)}
          pie={<><button className="btn" onClick={() => setNueva(false)}>Cancelar</button><button className="btn pri" disabled={crear.isPending || (tipo === 'final' && !funcionarioId)} onClick={() => crear.mutate()}>Generar</button></>}
        >
          <div className="form">
            <ErrorApi error={crear.error} />
            <Campo etiqueta="Tipo" id="nl-t">
              <select id="nl-t" className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                <option value="mensual">Sueldos del mes</option>
                <option value="aguinaldo">Aguinaldo del año</option>
                {puede('funcionario.ver') && <option value="final">Liquidación final (egreso de un funcionario)</option>}
              </select>
            </Campo>
            {tipo === 'final' ? (
              <>
                <Campo etiqueta="Funcionario" id="nl-f">
                  <select id="nl-f" className="entrada" value={funcionarioId} onChange={(e) => setFin({ ...fin, funcionarioId: e.target.value })}>
                    {funcionarios.data?.map((f) => <option key={f.id} value={f.id}>{f.nombre} · {f.cargo}</option>)}
                  </select>
                </Campo>
                <div className="fila-campos">
                  <Campo etiqueta="Fecha de egreso" id="nl-e"><input id="nl-e" type="date" className="entrada" value={fin.fechaEgreso} onChange={(e) => setFin({ ...fin, fechaEgreso: e.target.value })} /></Campo>
                  <Campo etiqueta="Motivo" id="nl-mo">
                    <select id="nl-mo" className="entrada" value={fin.motivo} onChange={(e) => setFin({ ...fin, motivo: e.target.value as MotivoEgreso })}>
                      {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Campo>
                </div>
                <Campo etiqueta="Detalle (opcional)" id="nl-d"><input id="nl-d" className="entrada" placeholder="Causa invocada, acuerdo, número de nota" value={fin.detalleMotivo} onChange={(e) => setFin({ ...fin, detalleMotivo: e.target.value })} /></Campo>
                <p className="tenue peq" style={{ margin: 0 }}>
                  Se calculan los días trabajados del último mes, el aguinaldo proporcional y las vacaciones pendientes; en el despido sin causa, también el preaviso (art. 87) y la indemnización (art. 91, doble con 10 años o más).
                  Queda en borrador para revisar; al confirmarla, el legajo queda con la fecha y el motivo de egreso.
                </p>
              </>
            ) : tipo === 'mensual' ? (
              <>
                <Campo etiqueta="Mes" id="nl-m"><input id="nl-m" type="month" className="entrada" max={hoy().slice(0, 7)} value={mes} onChange={(e) => setMes(e.target.value)} /></Campo>
                <p className="tenue peq" style={{ margin: 0 }}>Toma las ausencias, el reposo y las horas extra cargadas en "Asistencia y vacaciones".</p>
              </>
            ) : (
              <>
                <Campo etiqueta="Año" id="nl-a"><input id="nl-a" className="entrada num" value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Campo>
                <p className="tenue peq" style={{ margin: 0 }}>Se calcula como la doceava parte de lo cobrado en las planillas confirmadas del año (sin la bonificación familiar). Se paga antes del 31 de diciembre y no lleva aporte al IPS. Puede ajustar cada monto antes de confirmar.</p>
              </>
            )}
          </div>
        </Cajon>
      )}
    </section>
  );
}

function Planilla({ id, alVolver }: { id: string; alVolver: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['liquidacion', id], queryFn: () => api<Liquidacion>(`/liquidaciones/${id}`) });
  const [pagar, setPagar] = useState(false);
  const [anular, setAnular] = useState(false);
  const [recibos, setRecibos] = useState(false);
  const fijar = (l: Liquidacion) => {
    qc.setQueryData(['liquidacion', id], l);
    void qc.invalidateQueries({ queryKey: ['liquidaciones'] });
  };
  const ajustar = useMutation({ mutationFn: (c: Record<string, unknown>) => api<Liquidacion>(`/liquidaciones/${id}/items`, { metodo: 'PATCH', cuerpo: c }), onSuccess: fijar });
  const quitar = useMutation({ mutationFn: (funcionarioId: string) => api<Liquidacion>(`/liquidaciones/${id}/quitar`, { metodo: 'POST', cuerpo: { funcionarioId } }), onSuccess: fijar });
  const confirmar = useMutation({ mutationFn: () => api<Liquidacion>(`/liquidaciones/${id}/confirmar`, { metodo: 'POST' }), onSuccess: fijar });
  const novedades = useMutation({ mutationFn: () => api<Liquidacion>(`/liquidaciones/${id}/novedades`, { metodo: 'POST' }), onSuccess: fijar });
  const l = q.data;
  if (!l) return <Cargando />;
  const editable = l.estado === 'borrador' && puede('salario.editar');
  const mensual = l.tipo === 'mensual';
  const exportarIps = () => {
    const filas = [['Cédula', 'Nombre', 'N.º asegurado', 'Días', 'Salario imponible', 'Aporte obrero', 'Aporte patronal']];
    for (const i of l.items.filter((x) => x.aseguradoIps)) filas.push([i.documento, i.nombre, i.numeroIps ?? '', cant(i.dias), i.imponible, i.ipsObrero, i.ipsPatronal]);
    descargar(`ips-${l.periodo.slice(0, 7)}.csv`, filas);
  };
  const exportarPlanilla = () => {
    const filas = [['Cédula', 'Nombre', 'Cargo', 'Días', 'Salario', 'Horas extra', 'Otros ingresos', 'Bonificación familiar', 'Bruto', 'IPS', 'Descuentos', 'Neto', 'Banco', 'Cuenta']];
    for (const i of l.items) filas.push([i.documento, i.nombre, i.cargo, cant(i.dias), i.salarioBase, i.montoHorasExtra, i.otrosIngresos, i.bonificacion, i.bruto, i.ipsObrero, i.descuentos, i.neto, i.banco ?? '', i.cuentaBancaria ?? '']);
    descargar(`planilla-${l.tipo}-${l.periodo.slice(0, 7)}.csv`, filas);
  };
  const campo = (i: Item, k: 'dias' | 'horasExtra50' | 'horasExtra100' | 'otrosIngresos' | 'descuentos' | 'monto', valor: string) =>
    editable ? (
      <input
        key={`${i.funcionarioId}-${k}-${valor}`}
        aria-label={k}
        className="entrada num der"
        style={{ height: 32, width: k === 'dias' || k.startsWith('horas') ? 58 : 100 }}
        defaultValue={k === 'dias' || k.startsWith('horas') ? cant(valor) : num(valor)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
          if (!Number.isFinite(v) || v === Number(valor)) return;
          ajustar.mutate({ funcionarioId: i.funcionarioId, [k]: v });
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    ) : k === 'dias' || k.startsWith('horas') ? (
      cant(valor)
    ) : (
      num(valor)
    );
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn" onClick={alVolver}><ArrowLeft size={16} /> Planillas</button>
        <h2 style={{ margin: 0, fontSize: 20 }}>{nombrePeriodo(l.tipo, l.periodo)}{l.final && ` · ${l.items[0]?.nombre ?? ''}`}</h2>
        {ESTADOS[l.estado]}
        {l.pago && <span className="insignia i-ok">Pagada el {fechaCorta(l.pago.fecha)}{l.pago.cuenta ? ` · ${l.pago.cuenta}` : ' · efectivo'}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportarPlanilla}><Download size={16} /> Planilla CSV</button>
          {(mensual || l.tipo === 'final') && <button className="btn" onClick={exportarIps}><Download size={16} /> Aportes IPS</button>}
          {editable && mensual && <button className="btn" disabled={novedades.isPending} onClick={() => novedades.mutate()} title="Vuelve a tomar días y horas extra de la asistencia"><CalendarCheck size={16} /> Tomar asistencia</button>}
          {l.estado !== 'anulada' && <button className="btn" onClick={() => setRecibos(true)}><Printer size={16} /> Recibos</button>}
          {editable && <button className="btn pri" disabled={confirmar.isPending || !l.items.length} onClick={() => confirmar.mutate()}><CheckCircle2 size={16} /> Confirmar</button>}
          {l.estado === 'confirmada' && !l.pago && puede('salario.editar') && <button className="btn pri" onClick={() => setPagar(true)}><Banknote size={16} /> Registrar pago</button>}
          {l.estado !== 'anulada' && !l.pago && puede('salario.editar') && <button className="btn peligro" onClick={() => setAnular(true)}><XCircle size={16} /> {l.estado === 'borrador' ? 'Descartar' : 'Anular'}</button>}
        </div>
      </div>
      <ErrorApi error={ajustar.error ?? quitar.error ?? confirmar.error ?? novedades.error} />
      {l.estado === 'anulada' && <Aviso tipo="info">Planilla anulada: {l.motivoAnulacion}</Aviso>}
      {l.final ? (
        <LiquidacionFinal l={l} editable={editable} alCambiar={fijar} />
      ) : (
      <>
      <section className="panel cifras" style={{ marginBottom: 16 }}>
        <div className="cifra"><span>Bruto</span><b className="num">{dinero(l.totales.bruto)}</b></div>
        {mensual && <div className="cifra"><span>IPS ({pct(l.parametros.ipsObrero)} % + {pct(l.parametros.ipsPatronal)} %)</span><b className="num">{dinero(Number(l.totales.ipsObrero) + Number(l.totales.ipsPatronal))}</b><small className="tenue">Obrero {num(l.totales.ipsObrero)} · patronal {num(l.totales.ipsPatronal)}</small></div>}
        <div className="cifra"><span>Neto a pagar</span><b className="num">{dinero(l.totales.neto)}</b></div>
        <div className="cifra"><span>Costo para la empresa</span><b className="num">{dinero(Number(l.totales.bruto) + Number(l.totales.ipsPatronal))}</b></div>
      </section>
      {editable && (
        <p className="tenue peq" style={{ margin: '0 0 10px' }}>
          {mensual
            ? 'Ajuste días, horas extra (al 50 % las diurnas, al 100 % las nocturnas y feriados), comisiones o premios y descuentos (adelantos, faltas). Los jornaleros sin días cargados se quitan al confirmar.'
            : 'Puede ajustar el monto de cada aguinaldo y cargar descuentos.'}
        </p>
      )}
      <section className="panel" style={{ overflowX: 'auto' }}>
        {!l.items.length ? (
          <Vacio titulo="La planilla no tiene funcionarios" />
        ) : (
          <table className="planilla">
            <thead>
              {mensual ? (
                <tr>
                  <th>Funcionario</th><th className="der">Días</th><th className="der">Salario</th><th className="der">HE 50 %</th><th className="der">HE 100 %</th><th className="der">Horas extra</th>
                  <th className="der">Otros ingresos</th><th className="der">Bonif. familiar</th><th className="der">IPS {pct(l.parametros.ipsObrero)} %</th><th className="der">Descuentos</th><th className="der">Neto</th>{editable && <th />}
                </tr>
              ) : (
                <tr><th>Funcionario</th><th className="der">Aguinaldo</th><th className="der">Descuentos</th><th className="der">Neto</th>{editable && <th />}</tr>
              )}
            </thead>
            <tbody>
              {l.items.map((i) => (
                <tr key={i.funcionarioId}>
                  <td style={{ minWidth: 180 }}>
                    <b>{i.nombre}</b>
                    <div className="tenue peq">{i.cargo} · {i.remuneracion === 'jornal' ? `jornal ${num(i.salario)}` : `mensual ${num(i.salario)}`}{!i.aseguradoIps && ' · sin IPS'}</div>
                  </td>
                  {mensual ? (
                    <>
                      <td className="der num">{campo(i, 'dias', i.dias)}</td>
                      <td className="der num">{num(i.salarioBase)}</td>
                      <td className="der num">{campo(i, 'horasExtra50', i.horasExtra50)}</td>
                      <td className="der num">{campo(i, 'horasExtra100', i.horasExtra100)}</td>
                      <td className="der num">{num(i.montoHorasExtra)}</td>
                      <td className="der num">{campo(i, 'otrosIngresos', i.otrosIngresos)}</td>
                      <td className="der num">{Number(i.bonificacion) ? num(i.bonificacion) : '—'}</td>
                      <td className="der num">{Number(i.ipsObrero) ? num(i.ipsObrero) : '—'}</td>
                    </>
                  ) : (
                    <td className="der num">{campo(i, 'monto', i.bruto)}</td>
                  )}
                  <td className="der num" title={i.detalleDescuentos ?? ''}>{campo(i, 'descuentos', i.descuentos)}</td>
                  <td className="der num" style={{ fontWeight: 700 }}>{num(i.neto)}</td>
                  {editable && <td><button className="btn" aria-label="Quitar de la planilla" style={{ height: 30, padding: '0 8px' }} onClick={() => quitar.mutate(i.funcionarioId)}><Trash2 size={14} /></button></td>}
                </tr>
              ))}
              <tr className="total-fila">
                <td>Totales</td>
                {mensual && <><td /><td /><td /><td /><td /><td /><td /><td className="der num">{num(l.totales.ipsObrero)}</td></>}
                {!mensual && <td className="der num">{num(l.totales.bruto)}</td>}
                <td className="der num">{num(l.totales.descuentos)}</td>
                <td className="der num">{num(l.totales.neto)}</td>
                {editable && <td />}
              </tr>
            </tbody>
          </table>
        )}
      </section>
      </>
      )}
      {pagar && <PagarPlanilla l={l} alCerrar={() => setPagar(false)} alPagar={fijar} />}
      {anular && <AnularPlanilla l={l} alCerrar={() => setAnular(false)} alAnular={fijar} />}
      {recibos && (
        <Cajon titulo={l.final ? 'Recibo de liquidación final' : 'Recibos de salario'} ancho={900} alCerrar={() => setRecibos(false)} pie={<button className="btn pri" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>}>
          <div className="recibos-imprimir">
            {l.items.map((i) => (l.final ? <ReciboFinal key={i.funcionarioId} l={l} f={l.final} i={i} empresa={yo?.empresa} /> : <Recibo key={i.funcionarioId} l={l} i={i} empresa={yo?.empresa} />))}
          </div>
        </Cajon>
      )}
    </>
  );
}

function Recibo({ l, i, empresa }: { l: Liquidacion; i: Item; empresa?: { nombre: string; razonSocial?: string | null; ruc?: string | null } }) {
  const mensual = l.tipo === 'mensual';
  const lineas: [string, string, string][] = mensual
    ? [
        [`Salario (${cant(i.dias)} ${i.remuneracion === 'jornal' ? 'jornales' : 'días'})`, i.salarioBase, ''],
        ...(Number(i.montoHorasExtra) ? [[`Horas extra (${cant(i.horasExtra50)} al 50 %, ${cant(i.horasExtra100)} al 100 %)`, i.montoHorasExtra, ''] as [string, string, string]] : []),
        ...(Number(i.otrosIngresos) ? [['Comisiones y premios', i.otrosIngresos, ''] as [string, string, string]] : []),
        ...(Number(i.bonificacion) ? [[`Bonificación familiar (${i.hijos} hijo${i.hijos > 1 ? 's' : ''})`, i.bonificacion, ''] as [string, string, string]] : []),
        ...(Number(i.ipsObrero) ? [[`Aporte al IPS (${pct(l.parametros.ipsObrero)} %)`, '', i.ipsObrero] as [string, string, string]] : []),
        ...(Number(i.descuentos) ? [[i.detalleDescuentos || 'Descuentos', '', i.descuentos] as [string, string, string]] : []),
      ]
    : [['Aguinaldo (doceava parte de lo cobrado en el año)', i.bruto, ''], ...(Number(i.descuentos) ? [[i.detalleDescuentos || 'Descuentos', '', i.descuentos] as [string, string, string]] : [])];
  return (
    <div className="doc-a4 recibo">
      <div className="doc-cab">
        <div>
          <h1>{empresa?.nombre}</h1>
          {empresa?.razonSocial && <div>{empresa.razonSocial}</div>}
          {empresa?.ruc && <div>RUC {empresa.ruc}</div>}
        </div>
        <div className="doc-tipo">
          <b>Recibo de {mensual ? 'salario' : 'aguinaldo'}</b>
          {nombrePeriodo(l.tipo, l.periodo)}
        </div>
      </div>
      <div className="doc-datos">
        <div><span>Funcionario: </span>{i.nombre}</div>
        <div><span>Cédula: </span>{i.documento}</div>
        <div><span>Cargo: </span>{i.cargo}</div>
        <div><span>Ingreso: </span>{fechaCorta(i.fechaIngreso)}</div>
        {i.numeroIps && <div><span>N.º IPS: </span>{i.numeroIps}</div>}
      </div>
      <table>
        <thead><tr><th>Concepto</th><th className="der">Haberes</th><th className="der">Descuentos</th></tr></thead>
        <tbody>
          {lineas.map(([c, h, d], k) => (
            <tr key={k}><td>{c}</td><td className="der">{h ? num(h) : ''}</td><td className="der">{d ? num(d) : ''}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="doc-totales">
        <div><span>Total haberes</span><span>{num(i.bruto)}</span></div>
        <div><span>Total descuentos</span><span>{num(Number(i.ipsObrero) + Number(i.descuentos))}</span></div>
        <div className="total"><span>Neto a cobrar</span><span>Gs. {num(i.neto)}</span></div>
      </div>
      <div className="firmas">
        <div>Firma del empleador</div>
        <div>Recibí conforme: {i.nombre}</div>
      </div>
      <div className="doc-pie"><span>KONTIVA ERP · Desarrollado por Araújo Tech Sistemas</span></div>
    </div>
  );
}

const antiguedadTexto = (a: { anios: number; meses: number; dias: number }) =>
  [a.anios && `${a.anios} ${a.anios === 1 ? 'año' : 'años'}`, a.meses && `${a.meses} ${a.meses === 1 ? 'mes' : 'meses'}`, a.dias && `${a.dias} ${a.dias === 1 ? 'día' : 'días'}`].filter(Boolean).join(', ') || 'menos de un día';

/** Liquidación final: datos del egreso, opciones ajustables y conceptos calculados. */
function LiquidacionFinal({ l, editable, alCambiar }: { l: Liquidacion; editable: boolean; alCambiar: (l: Liquidacion) => void }) {
  const f = l.final!;
  const i = l.items[0];
  const o = f.opciones;
  const ajustar = useMutation({ mutationFn: (c: Record<string, unknown>) => api<Liquidacion>(`/liquidaciones/${l.id}/final`, { metodo: 'PATCH', cuerpo: c }), onSuccess: alCambiar });
  const injustificado = f.motivo === 'despido_injustificado';
  const numero = (k: keyof OpcionesFinal, etiqueta: string, ayuda?: string, entero = true) => (
    <Campo etiqueta={etiqueta} id={`lf-${k}`} ayuda={ayuda}>
      <input
        id={`lf-${k}`}
        key={`${k}-${String(o[k])}`}
        className="entrada num"
        disabled={!editable || ajustar.isPending}
        defaultValue={entero ? String(o[k]) : num(o[k] as number)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
          if (Number.isFinite(v) && v !== Number(o[k])) ajustar.mutate({ [k]: v });
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </Campo>
  );
  const casilla = (k: 'vacacionesProporcionales' | 'ipsPreaviso' | 'ipsVacaciones', texto: string) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" disabled={!editable || ajustar.isPending} checked={o[k]} onChange={(e) => ajustar.mutate({ [k]: e.target.checked })} /> {texto}
    </label>
  );
  const ips = Number(l.totales.ipsObrero);
  return (
    <>
      <ErrorApi error={ajustar.error} />
      <section className="panel cifras" style={{ marginBottom: 16 }}>
        <div className="cifra"><span>Antigüedad</span><b>{antiguedadTexto(f.calculo.antiguedad)}</b><small className="tenue">{fechaCorta(i?.fechaIngreso ?? '')} al {fechaCorta(f.fechaEgreso)}</small></div>
        <div className="cifra"><span>Salario diario</span><b className="num">{dinero(f.calculo.jornal)}</b>{injustificado && <small className="tenue">Base de despido {num(f.calculo.baseDiaria)}{f.promedioMensual ? ' (promedio de 6 meses)' : ''}</small>}</div>
        <div className="cifra"><span>Total bruto</span><b className="num">{dinero(l.totales.bruto)}</b></div>
        <div className="cifra"><span>Neto a pagar</span><b className="num">{dinero(l.totales.neto)}</b></div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
        <section className="panel">
          <div className="form" style={{ padding: 18 }}>
            <dl className="datos" style={{ margin: 0 }}>
              <dt>Motivo</dt><dd>{f.motivoTexto}{f.detalleMotivo && <div className="tenue peq">{f.detalleMotivo}</div>}</dd>
              <dt>Remuneración</dt><dd>{i ? `${i.remuneracion === 'jornal' ? 'Jornal' : 'Mensual'} ${num(i.salario)}` : '—'}</dd>
              {injustificado && <><dt>Preaviso legal</dt><dd>{f.calculo.diasPreaviso} días</dd></>}
              {injustificado && <><dt>Indemnización</dt><dd>{f.calculo.aniosIndemnizacion} {f.calculo.aniosIndemnizacion === 1 ? 'año' : 'años'} × 15 días{f.calculo.estabilidad && ' × 2 (estabilidad)'}</dd></>}
            </dl>
            <div className="fila-campos">
              {numero('diasTrabajados', 'Días trabajados del mes', 'Los no pagados en la planilla mensual.')}
              {numero('vacacionesPendientes', 'Vacaciones pendientes', 'Días causados no gozados.')}
            </div>
            {injustificado && numero('preavisoOtorgado', 'Días de preaviso ya otorgados', 'Si se avisó con anticipación, se paga solo la diferencia.')}
            <div className="fila-campos">
              {numero('otrosIngresos', 'Otros ingresos (Gs.)', 'Horas extra del mes, comisiones.', false)}
              {numero('descuentos', 'Descuentos (Gs.)', 'Adelantos, préstamos documentados.', false)}
            </div>
            {editable && Number(o.descuentos) > 0 && (
              <Campo etiqueta="Detalle de descuentos" id="lf-dd">
                <input id="lf-dd" key={f.detalleDescuentos ?? ''} className="entrada" defaultValue={f.detalleDescuentos ?? ''} onBlur={(e) => e.target.value !== (f.detalleDescuentos ?? '') && ajustar.mutate({ detalleDescuentos: e.target.value || null })} />
              </Campo>
            )}
            {casilla('vacacionesProporcionales', 'Pagar vacaciones proporcionales del año en curso')}
            {casilla('ipsVacaciones', 'Aporte al IPS sobre vacaciones')}
            {injustificado && casilla('ipsPreaviso', 'Aporte al IPS sobre el preaviso')}
            <p className="tenue peq" style={{ margin: 0 }}>
              El aguinaldo y la indemnización no llevan aporte al IPS. El criterio sobre vacaciones y preaviso pagados en dinero varía: confírmelo con su contador.
            </p>
          </div>
        </section>
        <section className="panel" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Concepto</th><th className="der">Días</th><th className="der">Base diaria</th><th>IPS</th><th className="der">Monto</th></tr></thead>
            <tbody>
              {f.conceptos.map((c) => (
                <tr key={c.concepto}>
                  <td>{c.descripcion}</td>
                  <td className="der num">{Number(c.dias) ? Number(c.dias).toLocaleString('es-PY') : ''}</td>
                  <td className="der num">{Number(c.base) ? num(c.base) : ''}</td>
                  <td>{c.imponible ? <span className="insignia i-n">Sí</span> : <span className="tenue peq">No</span>}</td>
                  <td className="der num">{num(c.monto)}</td>
                </tr>
              ))}
              <tr className="total-fila"><td colSpan={4}>Total haberes</td><td className="der num">{num(l.totales.bruto)}</td></tr>
              {ips > 0 && <tr><td colSpan={4}>Aporte al IPS ({pct(l.parametros.ipsObrero)} % sobre {num(i?.imponible ?? 0)})</td><td className="der num">−{num(ips)}</td></tr>}
              {Number(l.totales.descuentos) > 0 && <tr><td colSpan={4}>{f.detalleDescuentos || 'Descuentos'}</td><td className="der num">−{num(l.totales.descuentos)}</td></tr>}
              <tr className="total-fila"><td colSpan={4}>Neto a pagar</td><td className="der num">{num(l.totales.neto)}</td></tr>
            </tbody>
          </table>
          {ips > 0 && <p className="tenue peq" style={{ margin: 0, padding: '10px 16px' }}>Aporte patronal al IPS: {num(l.totales.ipsPatronal)}.</p>}
        </section>
      </div>
    </>
  );
}

function ReciboFinal({ l, f, i, empresa }: { l: Liquidacion; f: DatosFinal; i: Item; empresa?: { nombre: string; razonSocial?: string | null; ruc?: string | null } }) {
  return (
    <div className="doc-a4 recibo">
      <div className="doc-cab">
        <div>
          <h1>{empresa?.nombre}</h1>
          {empresa?.razonSocial && <div>{empresa.razonSocial}</div>}
          {empresa?.ruc && <div>RUC {empresa.ruc}</div>}
        </div>
        <div className="doc-tipo">
          <b>Liquidación final</b>
          {f.motivoTexto}
        </div>
      </div>
      <div className="doc-datos">
        <div><span>Funcionario: </span>{i.nombre}</div>
        <div><span>Cédula: </span>{i.documento}</div>
        <div><span>Cargo: </span>{i.cargo}</div>
        <div><span>Ingreso: </span>{fechaCorta(i.fechaIngreso)}</div>
        <div><span>Egreso: </span>{fechaCorta(f.fechaEgreso)}</div>
        <div><span>Antigüedad: </span>{antiguedadTexto(f.calculo.antiguedad)}</div>
        {i.numeroIps && <div><span>N.º IPS: </span>{i.numeroIps}</div>}
      </div>
      <table>
        <thead><tr><th>Concepto</th><th className="der">Días</th><th className="der">Haberes</th><th className="der">Descuentos</th></tr></thead>
        <tbody>
          {f.conceptos.map((c) => (
            <tr key={c.concepto}><td>{c.descripcion}</td><td className="der">{Number(c.dias) ? Number(c.dias).toLocaleString('es-PY') : ''}</td><td className="der">{num(c.monto)}</td><td /></tr>
          ))}
          {Number(i.ipsObrero) > 0 && <tr><td>Aporte al IPS ({pct(l.parametros.ipsObrero)} %)</td><td /><td /><td className="der">{num(i.ipsObrero)}</td></tr>}
          {Number(i.descuentos) > 0 && <tr><td>{f.detalleDescuentos || 'Descuentos'}</td><td /><td /><td className="der">{num(i.descuentos)}</td></tr>}
        </tbody>
      </table>
      <div className="doc-totales">
        <div><span>Total haberes</span><span>{num(i.bruto)}</span></div>
        <div><span>Total descuentos</span><span>{num(Number(i.ipsObrero) + Number(i.descuentos))}</span></div>
        <div className="total"><span>Neto a cobrar</span><span>Gs. {num(i.neto)}</span></div>
      </div>
      <p style={{ fontSize: 12, margin: '14px 0 0' }}>
        Recibí de {empresa?.razonSocial || empresa?.nombre} la suma indicada en concepto de liquidación final de haberes por {f.motivoTexto.toLowerCase()}.
      </p>
      <div className="firmas">
        <div>Firma del empleador</div>
        <div>Recibí conforme: {i.nombre}</div>
      </div>
      <div className="doc-pie"><span>KONTIVA ERP · Desarrollado por Araújo Tech Sistemas</span></div>
    </div>
  );
}

function PagarPlanilla({ l, alCerrar, alPagar }: { l: Liquidacion; alCerrar: () => void; alPagar: (l: Liquidacion) => void }) {
  const { puede } = useSesion();
  const cuentas = useQuery({ queryKey: ['cuentas-bancarias'], queryFn: () => api<CuentaBancaria[]>('/cuentas-bancarias'), enabled: puede('banco.ver') });
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas'), enabled: puede('caja.ver') });
  const activas = cuentas.data?.filter((c) => c.activa) ?? [];
  const propia = cajas.data?.find((c) => c.sesion?.propia);
  const [medio, setMedio] = useState<'banco' | 'efectivo'>('banco');
  const [cuenta, setCuenta] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const cuentaId = cuenta || activas[0]?.id || '';
  const pagar = useMutation({
    mutationFn: () => api<Liquidacion>(`/liquidaciones/${l.id}/pagar`, { metodo: 'POST', cuerpo: { fecha, medio, ...(medio === 'banco' ? { cuentaBancariaId: cuentaId } : { cajaId: propia?.id }) } }),
    onSuccess: (r) => {
      alPagar(r);
      alCerrar();
    },
  });
  return (
    <Cajon
      titulo={`Pago de ${nombrePeriodo(l.tipo, l.periodo).toLowerCase()}`}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={pagar.isPending || (medio === 'banco' ? !cuentaId : !propia)} onClick={() => pagar.mutate()}>Registrar pago de {dinero(l.totales.neto)}</button></>}
    >
      <div className="form">
        <ErrorApi error={pagar.error} />
        <div className="fila-campos">
          <Campo etiqueta="Medio" id="pp-m">
            <select id="pp-m" className="entrada" value={medio} onChange={(e) => setMedio(e.target.value as typeof medio)}>
              <option value="banco">Transferencia desde el banco</option>
              <option value="efectivo">Efectivo de la caja</option>
            </select>
          </Campo>
          <Campo etiqueta="Fecha" id="pp-f"><input id="pp-f" type="date" className="entrada" max={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        </div>
        {medio === 'banco' ? (
          activas.length ? (
            <Campo etiqueta="Cuenta bancaria" id="pp-c">
              <select id="pp-c" className="entrada" value={cuentaId} onChange={(e) => setCuenta(e.target.value)}>
                {activas.map((c) => <option key={c.id} value={c.id}>{c.banco} · {c.nombre} (saldo {dinero(c.saldo)})</option>)}
              </select>
            </Campo>
          ) : (
            <Aviso tipo="info">No hay cuentas bancarias activas: regístrelas en "Bancos".</Aviso>
          )
        ) : propia ? (
          <p className="tenue peq" style={{ margin: 0 }}>Sale de {propia.nombre} y aparece en su arqueo.</p>
        ) : (
          <Aviso tipo="info">Para pagar en efectivo, abra su caja en "Cajas y PDV".</Aviso>
        )}
        <p className="tenue peq" style={{ margin: 0 }}>Se registra el pago del neto total. Los aportes al IPS se pagan aparte, con la planilla de aportes.</p>
      </div>
    </Cajon>
  );
}

function AnularPlanilla({ l, alCerrar, alAnular }: { l: Liquidacion; alCerrar: () => void; alAnular: (l: Liquidacion) => void }) {
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api<Liquidacion>(`/liquidaciones/${l.id}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    onSuccess: (r) => {
      alAnular(r);
      alCerrar();
    },
  });
  return (
    <Cajon
      titulo={l.estado === 'borrador' ? 'Descartar planilla' : 'Anular planilla'}
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Volver</button><button className="btn peligro" disabled={motivo.trim().length < 5 || anular.isPending} onClick={() => anular.mutate()}>{l.estado === 'borrador' ? 'Descartar' : 'Anular'}</button></>}
    >
      <div className="form">
        <ErrorApi error={anular.error} />
        {l.estado === 'confirmada' && <p style={{ margin: 0 }}>Si ya se contabilizó, se registra el asiento inverso. Después puede generar de nuevo la planilla del período.</p>}
        <Campo etiqueta="Motivo" id="ap-m"><input id="ap-m" className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      </div>
    </Cajon>
  );
}

function ParametrosRrhh() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rrhh', 'configuracion'], queryFn: () => api<Parametros>('/rrhh/configuracion') });
  const [f, setF] = useState<Record<string, string> | null>(null);
  const guardar = useMutation({
    mutationFn: () => api<Parametros>('/rrhh/configuracion', { metodo: 'PUT', cuerpo: Object.fromEntries(Object.entries(f!).map(([k, v]) => [k, Number(v.replace(/\./g, '').replace(',', '.'))])) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rrhh'] });
      setF(null);
    },
  });
  if (!q.data) return <Cargando />;
  const p = q.data;
  const valores = f ?? {
    salarioMinimo: num(p.salarioMinimo),
    ipsObrero: String(Number(p.ipsObrero)).replace('.', ','),
    ipsPatronal: String(Number(p.ipsPatronal)).replace('.', ','),
    bonificacionPct: String(Number(p.bonificacionPct)).replace('.', ','),
    bonificacionTope: String(Number(p.bonificacionTope)).replace('.', ','),
  };
  const editar = puede('salario.editar');
  const cambiar = (k: string) => (e: { target: { value: string } }) => setF({ ...valores, [k]: e.target.value });
  return (
    <section className="panel">
      <div className="form" style={{ padding: 20, maxWidth: 720 }}>
        <ErrorApi error={guardar.error} />
        <p className="tenue peq" style={{ margin: 0 }}>
          {p.personalizado ? 'Valores de la empresa.' : 'Valores vigentes en Paraguay desde el 1 de julio de 2026 (Decreto 6225/2026).'} Cada planilla guarda los valores con que se generó; un cambio vale para las planillas nuevas.
        </p>
        <div className="fila-campos">
          <Campo etiqueta="Salario mínimo (Gs.)" id="pr-s"><input id="pr-s" className="entrada num" disabled={!editar} value={valores.salarioMinimo} onChange={cambiar('salarioMinimo')} /></Campo>
          <Campo etiqueta="IPS obrero (%)" id="pr-o"><input id="pr-o" className="entrada num" disabled={!editar} value={valores.ipsObrero} onChange={cambiar('ipsObrero')} /></Campo>
          <Campo etiqueta="IPS patronal (%)" id="pr-p"><input id="pr-p" className="entrada num" disabled={!editar} value={valores.ipsPatronal} onChange={cambiar('ipsPatronal')} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Bonificación familiar por hijo (% del mínimo)" id="pr-b"><input id="pr-b" className="entrada num" disabled={!editar} value={valores.bonificacionPct} onChange={cambiar('bonificacionPct')} /></Campo>
          <Campo etiqueta="Tope para la bonificación (salarios mínimos)" id="pr-t"><input id="pr-t" className="entrada num" disabled={!editar} value={valores.bonificacionTope} onChange={cambiar('bonificacionTope')} /></Campo>
        </div>
        {editar && f && <div><button className="btn pri" disabled={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></div>}
      </div>
    </section>
  );
}

function descargar(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((f) => f.map((c) => (typeof c === 'string' && /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}
