import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, ClipboardList, Factory, Plus, Printer, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { cantidad, dinero, type Deposito, type FilaStock } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface InsumoReceta { linea: number; varianteId: string; descripcion: string; unidad: string; cantidad: string; costo?: string; subtotal?: string }
interface Receta { id: string; varianteId: string; descripcion: string; unidad: string; rendimiento: string; minutos: number | null; nota: string | null; activa: boolean; insumos: InsumoReceta[]; costoTanda?: string; costoUnitario?: string; precio?: string; margen?: string }
interface FilaOrden { id: string; numero: number; estado: 'planificada' | 'terminada' | 'anulada'; fecha: string; descripcion: string; unidad: string; deposito: string; cantidadPlanificada: string; cantidadProducida: string | null; costoUnitario?: string | null }
interface Orden extends FilaOrden {
  varianteId: string;
  depositoId: string;
  sucursal: string;
  controlaLote: boolean;
  lote: { codigo: string; vencimiento: string | null } | null;
  nota: string | null;
  creador: string;
  motivoAnulacion: string | null;
  costoTotal?: string | null;
  insumos: { linea: number; varianteId: string; descripcion: string; unidad: string; cantidadTeorica: string; cantidadReal: string | null; stock: string | null; costoUnitario?: string }[];
}
interface Necesidades {
  productos: { varianteId: string; descripcion: string; unidad: string; pedidos: number; pedido: string; stock: string; planificado: string; sugerido: string }[];
  insumos: { varianteId: string; descripcion: string; unidad: string; necesario: string; stock: string; faltante: string }[];
}
interface FilaMerma { id: string; fecha: string; descripcion: string; unidad: string; deposito: string; cantidad: string; motivo: string | null; usuario: string | null; valor?: string }

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const num = (t: string) => t.replace(',', '.').replace(/[^0-9.]/g, '');
const unidadCorta = (u: string) => (u === 'unidad' ? 'u.' : u);
const ESTADO: Record<FilaOrden['estado'], { texto: string; clase: string }> = { planificada: { texto: 'Planificada', clase: 'i-warn' }, terminada: { texto: 'Terminada', clase: 'i-ok' }, anulada: { texto: 'Anulada', clase: 'i-n' } };

type Pestana = 'ordenes' | 'pedidos' | 'recetas' | 'mermas';

export function Produccion() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<Pestana>('ordenes');
  const depositos = useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
  const deps = depositos.data ?? [];
  return (
    <>
      <Encabezado titulo="Producción" />
      <div className="contenido">
        <div className="pestanas">
          <button className={pestana === 'ordenes' ? 'activa' : ''} onClick={() => setPestana('ordenes')}>Órdenes</button>
          <button className={pestana === 'pedidos' ? 'activa' : ''} onClick={() => setPestana('pedidos')}>Para pedidos</button>
          <button className={pestana === 'recetas' ? 'activa' : ''} onClick={() => setPestana('recetas')}>Recetas</button>
          <button className={pestana === 'mermas' ? 'activa' : ''} onClick={() => setPestana('mermas')}>Mermas</button>
        </div>
        {!depositos.data ? <Cargando /> : pestana === 'ordenes' ? <Ordenes depositos={deps} /> : pestana === 'pedidos' ? <ParaPedidos depositos={deps} /> : pestana === 'recetas' ? <Recetas depositos={deps} editable={puede('produccion.editar')} /> : <Mermas depositos={deps} />}
      </div>
    </>
  );
}

/** Buscador de productos sobre el stock del depósito (muestra el disponible). */
function BuscarProducto({ depositoId, alElegir, placeholder }: { depositoId: string; alElegir: (f: FilaStock) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['stock', depositoId, 'buscar', q], queryFn: () => api<FilaStock[]>(`/stock?depositoId=${depositoId}&q=${encodeURIComponent(q.trim())}`), enabled: !!depositoId && q.trim().length >= 2 });
  return (
    <div style={{ position: 'relative' }}>
      <input className="entrada" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && !!r.data?.length && (
        <div className="pdv-resultados" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0 }}>
          {r.data.slice(0, 12).map((f) => (
            <button key={f.varianteId} type="button" onClick={() => { alElegir(f); setQ(''); }}>
              <span style={{ flex: 1 }}>{f.descripcion}</span>
              <span className="tenue peq">stock {cantidad(f.cantidad)} {unidadCorta(f.unidad)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Ordenes({ depositos }: { depositos: Deposito[] }) {
  const { puede } = useSesion();
  const [estado, setEstado] = useState<'planificada' | 'terminada' | ''>('planificada');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const q = useQuery({ queryKey: ['produccion', 'ordenes', estado], queryFn: () => api<FilaOrden[]>(`/produccion/ordenes${estado ? `?estado=${estado}` : ''}`) });
  const verCosto = q.data?.some((o) => o.costoUnitario !== undefined);
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <select className="entrada" aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
          <option value="planificada">Planificadas</option>
          <option value="terminada">Terminadas</option>
          <option value="">Todas</option>
        </select>
        {puede('produccion.crear') && <button className="btn pri" onClick={() => setNueva(true)}><Plus size={16} /> Nueva orden</button>}
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.length ? (
        <Vacio titulo="Sin órdenes">Planifique una orden o genérelas desde "Para pedidos".</Vacio>
      ) : (
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Producto</th><th>Depósito</th><th className="der">Planificado</th><th className="der">Producido</th>{verCosto && <th className="der">Costo unitario</th>}<th>Estado</th></tr></thead>
          <tbody>
            {q.data.map((o) => (
              <tr key={o.id} className="clic" onClick={() => setAbierta(o.id)}>
                <td className="num">{o.numero}</td>
                <td className="tenue">{fechaCorta(o.fecha)}</td>
                <td style={{ fontWeight: 600 }}>{o.descripcion}</td>
                <td className="tenue">{o.deposito}</td>
                <td className="der num">{cantidad(o.cantidadPlanificada)} {unidadCorta(o.unidad)}</td>
                <td className="der num">{o.cantidadProducida ? `${cantidad(o.cantidadProducida)} ${unidadCorta(o.unidad)}` : '—'}</td>
                {verCosto && <td className="der num">{o.costoUnitario ? dinero(o.costoUnitario) : '—'}</td>}
                <td><span className={`insignia ${ESTADO[o.estado].clase}`}>{ESTADO[o.estado].texto}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nueva && <NuevaOrden depositos={depositos} alCerrar={() => setNueva(false)} alCrear={(id) => { setNueva(false); setAbierta(id); }} />}
      {abierta && <DetalleOrden id={abierta} alCerrar={() => setAbierta(null)} />}
    </section>
  );
}

function NuevaOrden({ depositos, alCerrar, alCrear }: { depositos: Deposito[]; alCerrar: () => void; alCrear: (id: string) => void }) {
  const qc = useQueryClient();
  const recetas = useQuery({ queryKey: ['produccion', 'recetas'], queryFn: () => api<Receta[]>('/produccion/recetas') });
  const activas = recetas.data?.filter((r) => r.activa) ?? [];
  const [d, setD] = useState({ varianteId: '', depositoId: depositos[0]?.id ?? '', cantidad: '', fecha: hoy(), nota: '' });
  const receta = activas.find((r) => r.varianteId === (d.varianteId || activas[0]?.varianteId));
  const crear = useMutation({
    mutationFn: () => api<Orden>('/produccion/ordenes', { metodo: 'POST', cuerpo: { ...d, varianteId: receta!.varianteId, cantidad: Number(d.cantidad), nota: d.nota || null } }),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ['produccion'] });
      alCrear(o.id);
    },
  });
  return (
    <Cajon titulo="Nueva orden de producción" alCerrar={alCerrar}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
        <ErrorApi error={crear.error ?? recetas.error} />
        {recetas.data && !activas.length && <Aviso tipo="info">Primero cargue la receta del producto en la pestaña "Recetas".</Aviso>}
        <Campo etiqueta="Producto" id="no-p">
          <select id="no-p" className="entrada" value={receta?.varianteId ?? ''} onChange={(e) => setD({ ...d, varianteId: e.target.value })}>
            {activas.map((r) => <option key={r.id} value={r.varianteId}>{r.descripcion}</option>)}
          </select>
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta={`Cantidad (${receta ? unidadCorta(receta.unidad) : ''})`} id="no-c" ayuda={receta ? `Una tanda rinde ${cantidad(receta.rendimiento)}` : undefined}>
            <input id="no-c" className="entrada num" autoFocus value={d.cantidad} onChange={(e) => setD({ ...d, cantidad: num(e.target.value) })} />
          </Campo>
          <Campo etiqueta="Fecha" id="no-f"><input id="no-f" type="date" className="entrada" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Depósito (de donde salen los insumos y adonde entra lo producido)" id="no-d">
          <select id="no-d" className="entrada" value={d.depositoId} onChange={(e) => setD({ ...d, depositoId: e.target.value })}>
            {depositos.map((x) => <option key={x.id} value={x.id}>{x.sucursal.nombre} · {x.nombre}</option>)}
          </select>
        </Campo>
        {receta && Number(d.cantidad) > 0 && (
          <div className="peq tenue">
            Insumos: {receta.insumos.map((i) => `${cantidad(String((Number(i.cantidad) * Number(d.cantidad)) / Number(receta.rendimiento)))} ${unidadCorta(i.unidad)} de ${i.descripcion}`).join(' · ')}
          </div>
        )}
        <Campo etiqueta="Nota" id="no-n"><input id="no-n" className="entrada" value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} /></Campo>
        <button className="btn pri" disabled={!receta || !Number(d.cantidad) || crear.isPending}>Planificar</button>
      </form>
    </Cajon>
  );
}

function DetalleOrden({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['produccion', 'orden', id], queryFn: () => api<Orden>(`/produccion/ordenes/${id}`) });
  const o = q.data;
  const [producida, setProducida] = useState('');
  const [reales, setReales] = useState<Record<number, string>>({});
  const [lote, setLote] = useState({ codigo: '', vencimiento: '' });
  const [motivo, setMotivo] = useState('');
  const [anulando, setAnulando] = useState(false);
  const [hoja, setHoja] = useState(false);
  useEffect(() => {
    if (o && !producida) setProducida(String(Number(o.cantidadPlanificada)));
  }, [o, producida]);
  const fijar = (r: Orden) => {
    qc.setQueryData(['produccion', 'orden', id], r);
    void qc.invalidateQueries({ queryKey: ['produccion', 'ordenes'] });
    void qc.invalidateQueries({ queryKey: ['stock'] });
  };
  const terminar = useMutation({
    mutationFn: () =>
      api<Orden>(`/produccion/ordenes/${id}/terminar`, {
        metodo: 'POST',
        cuerpo: {
          cantidadProducida: Number(producida),
          insumos: Object.entries(reales).filter(([, v]) => v !== '').map(([l, v]) => ({ linea: Number(l), cantidadReal: Number(v) })),
          ...(o?.controlaLote && { lote: { codigo: lote.codigo || null, vencimiento: lote.vencimiento || null } }),
        },
      }),
    onSuccess: fijar,
  });
  const anular = useMutation({ mutationFn: () => api<Orden>(`/produccion/ordenes/${id}/anular`, { metodo: 'POST', cuerpo: { motivo } }), onSuccess: (r) => { fijar(r); setAnulando(false); } });
  if (!o) return <Cajon titulo="Orden de producción" alCerrar={alCerrar}>{q.error ? <ErrorApi error={q.error} /> : <Cargando />}</Cajon>;
  const planificada = o.estado === 'planificada';
  const falta = (i: Orden['insumos'][number]) => i.stock !== null && Number(reales[i.linea] || i.cantidadTeorica) > Number(i.stock);
  return (
    <Cajon
      titulo={`Orden N.º ${o.numero} · ${o.descripcion}`}
      ancho={760}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={() => setHoja(true)}><Printer size={16} /> Hoja de producción</button>
          {o.estado !== 'anulada' && puede('produccion.cancelar') && <button className="btn peligro" onClick={() => setAnulando(!anulando)}><Ban size={16} /> Anular</button>}
          {planificada && puede('produccion.crear') && (
            <button className="btn pri" disabled={!Number(producida) || terminar.isPending} onClick={() => terminar.mutate()}><CheckCircle2 size={16} /> Terminar</button>
          )}
        </>
      }
    >
      <ErrorApi error={terminar.error ?? anular.error} />
      <section className="panel cifras">
        <div className="cifra"><span>Estado</span><b><span className={`insignia ${ESTADO[o.estado].clase}`}>{ESTADO[o.estado].texto}</span></b><small className="tenue">{fechaCorta(o.fecha)} · {o.deposito}</small></div>
        <div className="cifra"><span>Planificado</span><b className="num">{cantidad(o.cantidadPlanificada)} {unidadCorta(o.unidad)}</b></div>
        {o.cantidadProducida && <div className="cifra"><span>Producido</span><b className="num">{cantidad(o.cantidadProducida)} {unidadCorta(o.unidad)}</b>{o.lote && <small className="tenue">Lote {o.lote.codigo}{o.lote.vencimiento && ` · vence ${fechaCorta(o.lote.vencimiento)}`}</small>}</div>}
        {o.costoUnitario && <div className="cifra"><span>Costo unitario</span><b className="num">{dinero(o.costoUnitario)}</b><small className="tenue">Total {dinero(o.costoTotal ?? 0)}</small></div>}
      </section>
      {o.motivoAnulacion && <Aviso tipo="info">Anulada: {o.motivoAnulacion}</Aviso>}
      {anulando && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="entrada" style={{ flex: 1 }} autoFocus placeholder={o.estado === 'terminada' ? 'Motivo (lo producido sale del stock y vuelven los insumos)' : 'Motivo'} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button className="btn peligro" disabled={motivo.trim().length < 3 || anular.isPending} onClick={() => anular.mutate()}>Confirmar</button>
        </div>
      )}
      <table>
        <thead><tr><th>Insumo</th><th className="der">Según receta</th>{planificada && <th className="der">Stock</th>}<th className="der">{planificada ? 'Usado' : 'Usado'}</th>{o.insumos[0]?.costoUnitario !== undefined && <th className="der">Costo</th>}</tr></thead>
        <tbody>
          {o.insumos.map((i) => (
            <tr key={i.linea}>
              <td>{i.descripcion}</td>
              <td className="der num">{cantidad(i.cantidadTeorica)} {unidadCorta(i.unidad)}</td>
              {planificada && <td className="der num">{i.stock === null ? '—' : <span className={falta(i) ? 'insignia i-bad' : ''}>{cantidad(i.stock)}</span>}</td>}
              <td className="der">
                {planificada ? (
                  <input className="entrada num" aria-label={`Usado de ${i.descripcion}`} style={{ width: 100, height: 32 }} placeholder={cantidad(i.cantidadTeorica)} value={reales[i.linea] ?? ''} onChange={(e) => setReales({ ...reales, [i.linea]: num(e.target.value) })} />
                ) : (
                  <span className="num">{i.cantidadReal ? cantidad(i.cantidadReal) : '—'}</span>
                )}
              </td>
              {i.costoUnitario !== undefined && <td className="der num">{dinero(Number(i.cantidadReal ?? i.cantidadTeorica) * Number(i.costoUnitario))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {planificada && puede('produccion.crear') && (
        <div className="form">
          <div className="fila-campos">
            <Campo etiqueta={`Cantidad producida (${unidadCorta(o.unidad)})`} id="do-p"><input id="do-p" className="entrada num" value={producida} onChange={(e) => setProducida(num(e.target.value))} /></Campo>
            {o.controlaLote && <Campo etiqueta="Lote (opcional)" id="do-l" ayuda={`Sin código: OP-${o.numero}`}><input id="do-l" className="entrada" value={lote.codigo} onChange={(e) => setLote({ ...lote, codigo: e.target.value.toUpperCase() })} /></Campo>}
            {o.controlaLote && <Campo etiqueta="Vencimiento" id="do-v"><input id="do-v" type="date" className="entrada" value={lote.vencimiento} onChange={(e) => setLote({ ...lote, vencimiento: e.target.value })} /></Campo>}
          </div>
          <p className="tenue peq" style={{ margin: 0 }}>Deje "Usado" vacío si se usó lo de la receta. Al terminar se descuentan los insumos y entra lo producido al costo real.</p>
          {o.insumos.some(falta) && <Aviso tipo="error">No alcanza el stock de algún insumo para terminar la orden.</Aviso>}
        </div>
      )}
      {hoja && (
        <Cajon titulo="Hoja de producción" alCerrar={() => setHoja(false)} pie={<button className="btn pri" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>}>
          <div className="ticket">
            <div className="t-centro t-fuerte">{yo?.empresa.nombre}</div>
            <div className="t-centro">ORDEN DE PRODUCCIÓN N.º {o.numero}</div>
            <div>{fechaCorta(o.fecha)} · {o.sucursal} · {o.deposito}</div>
            <div className="t-linea" />
            <div className="t-fuerte">{o.descripcion}</div>
            <div>Cantidad: {cantidad(o.cantidadPlanificada)} {unidadCorta(o.unidad)}</div>
            <div className="t-linea" />
            {o.insumos.map((i) => <div key={i.linea} className="t-fila"><span>{i.descripcion}</span><span>{cantidad(i.cantidadTeorica)} {unidadCorta(i.unidad)}</span></div>)}
            {o.nota && <><div className="t-linea" /><div>{o.nota}</div></>}
            <div className="t-linea" />
            <div>Producido: ________ Firma: ________</div>
          </div>
        </Cajon>
      )}
    </Cajon>
  );
}

function ParaPedidos({ depositos }: { depositos: Deposito[] }) {
  const { yo, puede } = useSesion();
  const qc = useQueryClient();
  const [sucursalId, setSucursalId] = useState(yo?.sucursales[0]?.id ?? '');
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(sumarDias(hoy(), 1));
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const deps = depositos.filter((d) => d.sucursal.id === sucursalId);
  const [depositoId, setDepositoId] = useState('');
  const dep = depositoId || deps[0]?.id || '';
  const q = useQuery({ queryKey: ['produccion', 'necesidades', sucursalId, desde, hasta], queryFn: () => api<Necesidades>(`/produccion/necesidades?sucursalId=${sucursalId}&desde=${desde}&hasta=${hasta}`), enabled: !!sucursalId });
  const items = (q.data?.productos ?? []).map((p) => ({ ...p, aProducir: cantidades[p.varianteId] ?? String(Number(p.sugerido)) })).filter((p) => Number(p.aProducir) > 0);
  const crear = useMutation({
    mutationFn: () => api<{ ids: string[] }>('/produccion/ordenes/lote', { metodo: 'POST', cuerpo: { depositoId: dep, fecha: desde, items: items.map((p) => ({ varianteId: p.varianteId, cantidad: Number(p.aProducir) })) } }),
    onSuccess: () => {
      setCantidades({});
      void qc.invalidateQueries({ queryKey: ['produccion'] });
    },
  });
  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="filtros" style={{ paddingTop: 16, alignItems: 'flex-end' }}>
          {(yo?.sucursales.length ?? 0) > 1 && (
            <Campo etiqueta="Sucursal" id="pp-s">
              <select id="pp-s" className="entrada" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>{yo?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
            </Campo>
          )}
          <Campo etiqueta="Entrega desde" id="pp-d"><input id="pp-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
          <Campo etiqueta="hasta" id="pp-h"><input id="pp-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
          <span className="tenue peq" style={{ alignSelf: 'center', flex: 1, minWidth: 240 }}>Pedidos pendientes con entrega en el rango, de productos con receta. A producir = pedido − stock de la sucursal − lo ya planificado.</span>
        </div>
        <ErrorApi error={q.error ?? crear.error} />
        {crear.isSuccess && <Aviso tipo="ok">{crear.data.ids.length} órdenes planificadas. Están en la pestaña "Órdenes".</Aviso>}
        {!q.data ? (
          <Cargando />
        ) : !q.data.productos.length ? (
          <Vacio titulo="Nada para producir en esas fechas">Los pedidos con fecha de entrega de productos con receta aparecen aquí.</Vacio>
        ) : (
          <>
            <table>
              <thead><tr><th>Producto</th><th className="der">Pedidos</th><th className="der">Pedido</th><th className="der">Stock</th><th className="der">Planificado</th><th className="der">A producir</th></tr></thead>
              <tbody>
                {q.data.productos.map((p) => (
                  <tr key={p.varianteId}>
                    <td style={{ fontWeight: 600 }}>{p.descripcion}</td>
                    <td className="der num">{p.pedidos}</td>
                    <td className="der num">{cantidad(p.pedido)}</td>
                    <td className="der num">{cantidad(p.stock)}</td>
                    <td className="der num">{Number(p.planificado) ? cantidad(p.planificado) : '—'}</td>
                    <td className="der">
                      <input className="entrada num" aria-label={`A producir de ${p.descripcion}`} style={{ width: 100, height: 32 }} value={cantidades[p.varianteId] ?? String(Number(p.sugerido))} onChange={(e) => setCantidades({ ...cantidades, [p.varianteId]: num(e.target.value) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {puede('produccion.crear') && (
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--linea2)' }}>
                {deps.length > 1 && (
                  <select className="entrada" aria-label="Depósito" value={dep} onChange={(e) => setDepositoId(e.target.value)}>{deps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
                )}
                <button className="btn pri" disabled={!items.length || !dep || crear.isPending} onClick={() => crear.mutate()}><Factory size={16} /> Planificar {items.length} {items.length === 1 ? 'orden' : 'órdenes'}</button>
              </div>
            )}
          </>
        )}
      </section>
      {!!q.data?.insumos.length && (
        <section className="panel">
          <div className="panel-cab"><h2>Insumos para lo sugerido</h2><span className="sub">Lo que falta es lo que hay que comprar antes de producir.</span></div>
          <table>
            <thead><tr><th>Insumo</th><th className="der">Necesario</th><th className="der">Stock</th><th className="der">Falta</th></tr></thead>
            <tbody>
              {q.data.insumos.map((i) => (
                <tr key={i.varianteId}>
                  <td>{i.descripcion}</td>
                  <td className="der num">{cantidad(i.necesario)} {unidadCorta(i.unidad)}</td>
                  <td className="der num">{cantidad(i.stock)}</td>
                  <td className="der num">{Number(i.faltante) > 0 ? <span className="insignia i-bad">{cantidad(i.faltante)} {unidadCorta(i.unidad)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Recetas({ depositos, editable }: { depositos: Deposito[]; editable: boolean }) {
  const { yo } = useSesion();
  const sucursalId = yo?.sucursales[0]?.id;
  const q = useQuery({ queryKey: ['produccion', 'recetas', sucursalId], queryFn: () => api<Receta[]>(`/produccion/recetas${sucursalId ? `?sucursalId=${sucursalId}` : ''}`) });
  const [editando, setEditando] = useState<Receta | 'nueva' | null>(null);
  const verCosto = q.data?.some((r) => r.costoUnitario !== undefined);
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        {editable && <button className="btn pri" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva receta</button>}
        <span className="tenue peq" style={{ alignSelf: 'center' }}>Qué insumos lleva una tanda y cuánto rinde. El costo se calcula con el costo actual de cada insumo.</span>
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.length ? (
        <Vacio titulo="Sin recetas">{editable ? 'Cargue la primera receta.' : ''}</Vacio>
      ) : (
        <table>
          <thead><tr><th>Producto</th><th className="der">Rinde</th><th>Insumos</th>{verCosto && <><th className="der">Costo por unidad</th><th className="der">Precio</th><th className="der">Margen</th></>}</tr></thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id} className="clic" onClick={() => setEditando(r)} style={r.activa ? undefined : { opacity: 0.55 }}>
                <td style={{ fontWeight: 600 }}>{r.descripcion}{!r.activa && <span className="insignia i-n" style={{ marginLeft: 6 }}>Inactiva</span>}</td>
                <td className="der num">{cantidad(r.rendimiento)} {unidadCorta(r.unidad)}</td>
                <td className="tenue peq">{r.insumos.map((i) => i.descripcion).join(', ')}</td>
                {verCosto && (
                  <>
                    <td className="der num">{r.costoUnitario ? dinero(r.costoUnitario) : '—'}</td>
                    <td className="der num">{r.precio ? dinero(r.precio) : '—'}</td>
                    <td className="der num">{r.margen ? <span className={Number(r.margen) < 20 ? 'insignia i-warn' : ''}>{r.margen.replace('.', ',')} %</span> : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editando && <EditorReceta receta={editando === 'nueva' ? null : editando} depositoId={depositos[0]?.id ?? ''} editable={editable} alCerrar={() => setEditando(null)} />}
    </section>
  );
}

function EditorReceta({ receta, depositoId, editable, alCerrar }: { receta: Receta | null; depositoId: string; editable: boolean; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [producto, setProducto] = useState<{ varianteId: string; descripcion: string; unidad: string } | null>(receta ? { varianteId: receta.varianteId, descripcion: receta.descripcion, unidad: receta.unidad } : null);
  const [rendimiento, setRendimiento] = useState(receta ? String(Number(receta.rendimiento)) : '');
  const [minutos, setMinutos] = useState(receta?.minutos ? String(receta.minutos) : '');
  const [nota, setNota] = useState(receta?.nota ?? '');
  const [activa, setActiva] = useState(receta?.activa ?? true);
  const [insumos, setInsumos] = useState<{ varianteId: string; descripcion: string; unidad: string; cantidad: string }[]>(receta?.insumos.map((i) => ({ varianteId: i.varianteId, descripcion: i.descripcion, unidad: i.unidad, cantidad: String(Number(i.cantidad)) })) ?? []);
  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = { varianteId: producto!.varianteId, rendimiento: Number(rendimiento), minutos: minutos ? Number(minutos) : null, nota: nota || null, activa, insumos: insumos.map((i) => ({ varianteId: i.varianteId, cantidad: Number(i.cantidad) })) };
      return receta ? api<Receta>(`/produccion/recetas/${receta.id}`, { metodo: 'PUT', cuerpo }) : api<Receta>('/produccion/recetas', { metodo: 'POST', cuerpo });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['produccion'] });
      alCerrar();
    },
  });
  const valida = !!producto && Number(rendimiento) > 0 && insumos.length > 0 && insumos.every((i) => Number(i.cantidad) > 0);
  const costo = useMemo(() => receta?.costoTanda, [receta]);
  return (
    <Cajon
      titulo={receta ? `Receta · ${receta.descripcion}` : 'Nueva receta'}
      ancho={720}
      alCerrar={alCerrar}
      pie={editable ? <button className="btn pri" disabled={!valida || guardar.isPending} onClick={() => guardar.mutate()}>Guardar receta</button> : undefined}
    >
      <div className="form">
        <ErrorApi error={guardar.error} />
        {!receta && (
          <Campo etiqueta="Producto que se elabora" id="er-p">
            {producto ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ flex: 1 }}>{producto.descripcion}</b><button type="button" className="btn chico" onClick={() => setProducto(null)}>Cambiar</button></div>
            ) : (
              <BuscarProducto depositoId={depositoId} placeholder="Buscar el producto" alElegir={(f) => setProducto({ varianteId: f.varianteId, descripcion: f.descripcion, unidad: f.unidad })} />
            )}
          </Campo>
        )}
        <div className="fila-campos">
          <Campo etiqueta={`Una tanda rinde (${producto ? unidadCorta(producto.unidad) : ''})`} id="er-r"><input id="er-r" className="entrada num" disabled={!editable} value={rendimiento} onChange={(e) => setRendimiento(num(e.target.value))} /></Campo>
          <Campo etiqueta="Tiempo (minutos)" id="er-m"><input id="er-m" className="entrada num" disabled={!editable} value={minutos} onChange={(e) => setMinutos(e.target.value.replace(/\D/g, '').slice(0, 5))} /></Campo>
        </div>
        <h3 className="subtitulo" style={{ margin: 0 }}>Insumos por tanda</h3>
        <table>
          <tbody>
            {insumos.map((i, n) => (
              <tr key={i.varianteId}>
                <td>{i.descripcion}</td>
                <td className="der" style={{ whiteSpace: 'nowrap' }}>
                  <input className="entrada num" aria-label={`Cantidad de ${i.descripcion}`} disabled={!editable} style={{ width: 100, height: 32 }} value={i.cantidad} onChange={(e) => setInsumos(insumos.map((x, k) => (k === n ? { ...x, cantidad: num(e.target.value) } : x)))} /> <span className="tenue peq">{unidadCorta(i.unidad)}</span>
                </td>
                <td className="der">{editable && <button type="button" className="enlace" aria-label="Quitar" onClick={() => setInsumos(insumos.filter((_, k) => k !== n))}><Trash2 size={15} /></button>}</td>
              </tr>
            ))}
            {!insumos.length && <tr><td className="tenue">Agregue los insumos.</td></tr>}
          </tbody>
        </table>
        {editable && (
          <BuscarProducto
            depositoId={depositoId}
            placeholder="Agregar insumo: harina, levadura, azúcar"
            alElegir={(f) => f.varianteId !== producto?.varianteId && !insumos.some((x) => x.varianteId === f.varianteId) && setInsumos([...insumos, { varianteId: f.varianteId, descripcion: f.descripcion, unidad: f.unidad, cantidad: '' }])}
          />
        )}
        {receta?.costoUnitario && (
          <p className="tenue peq" style={{ margin: 0 }}>
            Costo actual: {dinero(costo ?? 0)} por tanda, {dinero(receta.costoUnitario)} por unidad{receta.margen && ` · margen ${receta.margen.replace('.', ',')} % sobre ${dinero(receta.precio!)}`}.
          </p>
        )}
        <Campo etiqueta="Procedimiento o notas" id="er-n"><textarea id="er-n" className="entrada" rows={3} disabled={!editable} value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
        <label className="casilla"><input type="checkbox" disabled={!editable} checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Receta activa</label>
      </div>
    </Cajon>
  );
}

function Mermas({ depositos }: { depositos: Deposito[] }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [desde, setDesde] = useState(`${hoy().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy());
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? '');
  const [items, setItems] = useState<{ varianteId: string; descripcion: string; unidad: string; cantidad: string; stock: string }[]>([]);
  const [motivo, setMotivo] = useState('');
  const q = useQuery({ queryKey: ['produccion', 'mermas', desde, hasta], queryFn: () => api<FilaMerma[]>(`/produccion/mermas?desde=${desde}&hasta=${hasta}`) });
  const registrar = useMutation({
    mutationFn: () => api<{ items: number; valor?: string }>('/produccion/mermas', { metodo: 'POST', cuerpo: { depositoId, motivo, items: items.map((i) => ({ varianteId: i.varianteId, cantidad: Number(i.cantidad) })) } }),
    onSuccess: () => {
      setItems([]);
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['produccion', 'mermas'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });
  const total = q.data?.reduce((s, m) => s + Number(m.valor ?? 0), 0) ?? 0;
  return (
    <>
      {puede('produccion.crear') && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-cab"><h2>Registrar merma</h2><span className="sub">Producto vencido, roto o que no se vendió en el día: sale del stock con su costo.</span></div>
          <div className="form" style={{ padding: 16 }}>
            <ErrorApi error={registrar.error} />
            {registrar.isSuccess && <Aviso tipo="ok">Merma registrada{registrar.data.valor ? `: ${dinero(registrar.data.valor)} al costo` : ''}.</Aviso>}
            <div className="fila-campos">
              <Campo etiqueta="Depósito" id="me-d">
                <select id="me-d" className="entrada" value={depositoId} onChange={(e) => { setDepositoId(e.target.value); setItems([]); }}>{depositos.map((x) => <option key={x.id} value={x.id}>{x.sucursal.nombre} · {x.nombre}</option>)}</select>
              </Campo>
              <Campo etiqueta="Motivo" id="me-m"><input id="me-m" className="entrada" placeholder="Sobrante del día, vencido, roto" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            </div>
            {items.length > 0 && (
              <table>
                <tbody>
                  {items.map((i, n) => (
                    <tr key={i.varianteId}>
                      <td>{i.descripcion} <span className="tenue peq">· stock {cantidad(i.stock)}</span></td>
                      <td className="der"><input className="entrada num" aria-label={`Cantidad de ${i.descripcion}`} style={{ width: 100, height: 32 }} value={i.cantidad} onChange={(e) => setItems(items.map((x, k) => (k === n ? { ...x, cantidad: num(e.target.value) } : x)))} /> <span className="tenue peq">{unidadCorta(i.unidad)}</span></td>
                      <td className="der"><button className="enlace" aria-label="Quitar" onClick={() => setItems(items.filter((_, k) => k !== n))}><Trash2 size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <BuscarProducto depositoId={depositoId} placeholder="Agregar producto" alElegir={(f) => !items.some((x) => x.varianteId === f.varianteId) && setItems([...items, { varianteId: f.varianteId, descripcion: f.descripcion, unidad: f.unidad, cantidad: '', stock: f.cantidad }])} />
            <div><button className="btn pri" disabled={!items.length || items.some((i) => !Number(i.cantidad)) || motivo.trim().length < 3 || registrar.isPending} onClick={() => registrar.mutate()}><ClipboardList size={16} /> Registrar merma</button></div>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="filtros" style={{ paddingTop: 16, alignItems: 'center' }}>
          <input type="date" className="entrada" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <input type="date" className="entrada" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          {total > 0 && <span className="tenue peq">Total del período al costo: <b>{dinero(total)}</b></span>}
        </div>
        <ErrorApi error={q.error} />
        {!q.data ? (
          <Cargando />
        ) : !q.data.length ? (
          <Vacio titulo="Sin mermas en el período" />
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Producto</th><th className="der">Cantidad</th><th>Motivo</th><th>Depósito</th>{q.data.some((m) => m.valor !== undefined) && <th className="der">Valor</th>}</tr></thead>
            <tbody>
              {q.data.map((m) => (
                <tr key={m.id}>
                  <td className="tenue peq">{new Date(m.fecha).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{m.descripcion}</td>
                  <td className="der num">{cantidad(m.cantidad)} {unidadCorta(m.unidad)}</td>
                  <td className="tenue">{m.motivo}{m.usuario && <span className="peq"> · {m.usuario}</span>}</td>
                  <td className="tenue">{m.deposito}</td>
                  {m.valor !== undefined && <td className="der num">{dinero(m.valor)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
