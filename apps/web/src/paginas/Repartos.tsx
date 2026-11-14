import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Ban, CheckCircle2, MapPin, Plus, Printer, Route, Trash2, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad, dinero, type CajaFila } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

type EstadoReparto = 'preparacion' | 'en_ruta' | 'rendido' | 'anulado';
interface FilaReparto { id: string; numero: number; fecha: string; estado: EstadoReparto; repartidor: string; vehiculo: string | null; ruta: string | null; pedidos: number; total: string; cobrado: string; diferencia: string | null }
interface PedidoReparto {
  pedidoId: string;
  numero: number;
  orden: number;
  estado: 'pendiente' | 'entregado' | 'parcial' | 'rechazado';
  cliente: { id: string; nombre: string; documento: string | null; direccion: string | null; telefono: string | null } | null;
  nota: string | null;
  total: string;
  venta: { id: string; numero: number; comprobante: string } | null;
  cuenta: { id: string; saldo: string; vencimiento: string | null } | null;
  devuelto: string | null;
  cobrado: string;
  medio: string | null;
  motivo: string | null;
}
interface Reparto {
  id: string;
  numero: number;
  fecha: string;
  estado: EstadoReparto;
  sucursalId: string;
  sucursal: string;
  caja: { id: string; nombre: string };
  ruta: { id: string; nombre: string } | null;
  repartidor: string;
  vehiculo: string | null;
  nota: string | null;
  despachadoEn: string | null;
  despachador: string | null;
  rendidoEn: string | null;
  rendidor: string | null;
  efectivoEsperado: string | null;
  efectivoEntregado: string | null;
  diferencia: string | null;
  total: string;
  cobrado: string;
  pedidos: PedidoReparto[];
  carga: { varianteId: string; descripcion: string; sku: string | null; unidad: string; cantidad: string }[];
  errores?: { pedido: number; mensaje: string }[];
}
interface PedidoLibre { id: string; numero: number; entregaPrevista: string | null; total: string; estado: string; nota: string | null; cliente: { id: string; nombre: string; direccion: string | null }; ruta: { id: string; nombre: string; orden: number | null } | null }
interface RutaFila { id: string; nombre: string; dias: number[]; nota: string | null; activa: boolean; sucursalId: string; sucursal: string; clientes: number }
interface ClienteRuta { id: string; nombre: string; documento: string | null; direccion: string | null; telefono: string | null }

const ESTADO: Record<EstadoReparto, { texto: string; clase: string }> = {
  preparacion: { texto: 'En preparación', clase: 'i-warn' },
  en_ruta: { texto: 'En ruta', clase: 'i-p' },
  rendido: { texto: 'Rendido', clase: 'i-ok' },
  anulado: { texto: 'Anulado', clase: 'i-n' },
};
const ENTREGA: Record<PedidoReparto['estado'], { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'i-n' },
  entregado: { texto: 'Entregado', clase: 'i-ok' },
  parcial: { texto: 'Parcial', clase: 'i-warn' },
  rechazado: { texto: 'Rechazado', clase: 'i-bad' },
};
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const manana = () => new Date(Date.parse(`${hoy()}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const soloNumero = (t: string) => t.replace(/[^0-9]/g, '');

export function Repartos() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<'repartos' | 'rutas'>('repartos');
  return (
    <>
      <Encabezado titulo="Repartos" />
      <div className="contenido">
        <div className="pestanas">
          <button className={pestana === 'repartos' ? 'activa' : ''} onClick={() => setPestana('repartos')}>Repartos</button>
          <button className={pestana === 'rutas' ? 'activa' : ''} onClick={() => setPestana('rutas')}>Rutas y clientes</button>
        </div>
        {pestana === 'repartos' ? <ListaRepartos /> : <Rutas editable={puede('entrega.editar')} />}
      </div>
    </>
  );
}

function ListaRepartos() {
  const { puede } = useSesion();
  const [estado, setEstado] = useState<EstadoReparto | ''>('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const q = useQuery({ queryKey: ['repartos', estado], queryFn: () => api<FilaReparto[]>(`/repartos${estado ? `?estado=${estado}` : ''}`) });
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        <select className="entrada" aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as EstadoReparto | '')}>
          <option value="">Todos</option>
          <option value="preparacion">En preparación</option>
          <option value="en_ruta">En ruta</option>
          <option value="rendido">Rendidos</option>
        </select>
        {puede('entrega.crear') && <button className="btn pri" onClick={() => setNuevo(true)}><Plus size={16} /> Nuevo reparto</button>}
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.length ? (
        <Vacio titulo="Sin repartos">Arme un reparto con los pedidos a entregar: se factura al despachar y se rinde al volver.</Vacio>
      ) : (
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Repartidor</th><th>Ruta</th><th className="der">Pedidos</th><th className="der">Total</th><th className="der">Cobrado</th><th className="der">Diferencia</th><th>Estado</th></tr></thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id} className="clic" onClick={() => setAbierto(r.id)}>
                <td className="num">{r.numero}</td>
                <td>{fechaCorta(r.fecha)}</td>
                <td style={{ fontWeight: 600 }}>{r.repartidor}{r.vehiculo && <div className="tenue peq">{r.vehiculo}</div>}</td>
                <td className="tenue">{r.ruta ?? '—'}</td>
                <td className="der num">{r.pedidos}</td>
                <td className="der num">{dinero(r.total)}</td>
                <td className="der num">{r.estado === 'rendido' ? dinero(r.cobrado) : '—'}</td>
                <td className="der num">{r.diferencia === null ? '—' : Number(r.diferencia) === 0 ? <span className="tenue">0</span> : <span className={`insignia ${Number(r.diferencia) < 0 ? 'i-bad' : 'i-warn'}`}>{dinero(r.diferencia)}</span>}</td>
                <td><span className={`insignia ${ESTADO[r.estado].clase}`}>{ESTADO[r.estado].texto}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nuevo && <ArmarReparto alCerrar={() => setNuevo(false)} alCrear={(id) => { setNuevo(false); setAbierto(id); }} />}
      {abierto && <DetalleReparto id={abierto} alCerrar={() => setAbierto(null)} />}
    </section>
  );
}

/** Armar (o editar mientras se prepara) un reparto: caja, ruta, repartidor y pedidos en orden de entrega. */
function ArmarReparto({ reparto, alCerrar, alCrear }: { reparto?: Reparto; alCerrar: () => void; alCrear: (id: string) => void }) {
  const qc = useQueryClient();
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas') });
  const rutas = useQuery({ queryKey: ['rutas'], queryFn: () => api<RutaFila[]>('/rutas') });
  const activas = cajas.data?.filter((c) => c.activa) ?? [];
  const [d, setD] = useState({
    cajaId: reparto?.caja.id ?? '',
    rutaId: reparto?.ruta?.id ?? '',
    fecha: reparto?.fecha ?? manana(),
    repartidor: reparto?.repartidor ?? '',
    vehiculo: reparto?.vehiculo ?? '',
    nota: reparto?.nota ?? '',
  });
  const caja = activas.find((c) => c.id === d.cajaId) ?? activas[0];
  const [elegidos, setElegidos] = useState<string[]>(reparto?.pedidos.map((p) => p.pedidoId) ?? []);
  const [tocado, setTocado] = useState(!!reparto);
  const libres = useQuery({
    queryKey: ['repartos', 'pedidos', caja?.sucursal.id, d.fecha, d.rutaId],
    queryFn: () => api<PedidoLibre[]>(`/repartos/pedidos?sucursalId=${caja!.sucursal.id}&hasta=${d.fecha}${d.rutaId ? `&rutaId=${d.rutaId}` : ''}`),
    enabled: !!caja,
  });
  // Los del reparto en edición también se muestran (no están "libres").
  const lista: PedidoLibre[] = useMemo(() => {
    const propios = (reparto?.pedidos ?? []).map((p) => ({ id: p.pedidoId, numero: p.numero, entregaPrevista: null, total: p.total, estado: 'pendiente', nota: p.nota, cliente: { id: p.cliente?.id ?? '', nombre: p.cliente?.nombre ?? '', direccion: p.cliente?.direccion ?? null }, ruta: null }));
    return [...propios, ...(libres.data ?? []).filter((x) => !propios.some((p) => p.id === x.id))];
  }, [libres.data, reparto]);
  const marcados = tocado ? elegidos : lista.map((p) => p.id);
  const ordenados = [...marcados].sort((a, b) => lista.findIndex((p) => p.id === a) - lista.findIndex((p) => p.id === b));
  const total = lista.filter((p) => marcados.includes(p.id)).reduce((s, p) => s + Number(p.total), 0);
  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = { cajaId: caja!.id, rutaId: d.rutaId || null, fecha: d.fecha, repartidor: d.repartidor, vehiculo: d.vehiculo || null, nota: d.nota || null, pedidoIds: ordenados };
      return reparto ? api<Reparto>(`/repartos/${reparto.id}`, { metodo: 'PUT', cuerpo }) : api<Reparto>('/repartos', { metodo: 'POST', cuerpo });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['repartos'] });
      qc.setQueryData(['reparto', r.id], r);
      alCrear(r.id);
    },
  });
  const alternar = (id: string) => {
    setTocado(true);
    setElegidos(marcados.includes(id) ? marcados.filter((x) => x !== id) : [...marcados, id]);
  };
  return (
    <Cajon
      titulo={reparto ? `Reparto N.º ${reparto.numero}` : 'Nuevo reparto'}
      ancho={760}
      alCerrar={alCerrar}
      pie={<button className="btn pri" disabled={!caja || d.repartidor.trim().length < 2 || !ordenados.length || guardar.isPending} onClick={() => guardar.mutate()}><Truck size={16} /> {reparto ? 'Guardar' : `Armar reparto (${ordenados.length})`}</button>}
    >
      <div className="form">
        <ErrorApi error={guardar.error ?? libres.error} />
        <div className="fila-campos">
          <Campo etiqueta="Fecha de entrega" id="ar-f"><input id="ar-f" type="date" className="entrada" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Ruta" id="ar-r">
            <select id="ar-r" className="entrada" value={d.rutaId} onChange={(e) => { setD({ ...d, rutaId: e.target.value }); setTocado(false); }}>
              <option value="">Todas</option>
              {rutas.data?.filter((r) => r.activa).map((r) => <option key={r.id} value={r.id}>{r.nombre}{r.dias.length ? ` (${r.dias.map((x) => DIAS[x]).join(', ')})` : ''}</option>)}
            </select>
          </Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Repartidor" id="ar-p"><input id="ar-p" className="entrada" autoFocus value={d.repartidor} onChange={(e) => setD({ ...d, repartidor: e.target.value })} /></Campo>
          <Campo etiqueta="Vehículo" id="ar-v"><input id="ar-v" className="entrada" placeholder="Camión, chapa" value={d.vehiculo} onChange={(e) => setD({ ...d, vehiculo: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Caja (factura los pedidos y recibe la rendición; la mercadería sale de su depósito)" id="ar-c">
          <select id="ar-c" className="entrada" value={caja?.id ?? ''} onChange={(e) => { setD({ ...d, cajaId: e.target.value }); setTocado(false); }}>
            {activas.map((c) => <option key={c.id} value={c.id}>{c.sucursal.nombre} · {c.nombre} ({c.deposito.nombre})</option>)}
          </select>
        </Campo>
        <h3 className="subtitulo" style={{ margin: 0 }}>Pedidos · en el orden de la ruta</h3>
        {!libres.data && caja ? (
          <Cargando />
        ) : !lista.length ? (
          <Vacio titulo="No hay pedidos para entregar">Los pedidos pendientes de clientes registrados, con entrega hasta esa fecha, aparecen aquí.</Vacio>
        ) : (
          <table>
            <thead><tr><th style={{ width: 32 }} /><th>Cliente</th><th>Pedido</th><th>Ruta</th><th className="der">Total</th></tr></thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className="clic" onClick={() => alternar(p.id)}>
                  <td><input type="checkbox" aria-label={`Pedido ${p.numero}`} checked={marcados.includes(p.id)} onChange={() => alternar(p.id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td style={{ fontWeight: 600 }}>{p.cliente.nombre}{p.cliente.direccion && <div className="tenue peq">{p.cliente.direccion}</div>}</td>
                  <td className="num">N.º {p.numero}{p.entregaPrevista && <div className="tenue peq">{fechaCorta(p.entregaPrevista)}</div>}</td>
                  <td className="tenue peq">{p.ruta ? `${p.ruta.nombre}${p.ruta.orden ? ` · ${p.ruta.orden}.º` : ''}` : '—'}</td>
                  <td className="der num">{dinero(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ordenados.length > 0 && <p style={{ margin: 0 }}>{ordenados.length} {ordenados.length === 1 ? 'pedido' : 'pedidos'} · <b>{dinero(total)}</b></p>}
        <Campo etiqueta="Nota" id="ar-n"><input id="ar-n" className="entrada" value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} /></Campo>
      </div>
    </Cajon>
  );
}

function DetalleReparto({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reparto', id], queryFn: () => api<Reparto>(`/repartos/${id}`) });
  const [vista, setVista] = useState<'ruta' | 'carga'>('ruta');
  const [editando, setEditando] = useState(false);
  const [rindiendo, setRindiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [hoja, setHoja] = useState(false);
  const fijar = (r: Reparto) => {
    qc.setQueryData(['reparto', id], r);
    void qc.invalidateQueries({ queryKey: ['repartos'] });
  };
  const despachar = useMutation({ mutationFn: () => api<Reparto>(`/repartos/${id}/despachar`, { metodo: 'POST' }), onSuccess: fijar });
  const anular = useMutation({ mutationFn: () => api<Reparto>(`/repartos/${id}/anular`, { metodo: 'POST', cuerpo: { motivo } }), onSuccess: (r) => { fijar(r); setAnulando(false); } });
  const r = q.data;
  if (!r) return <Cajon titulo="Reparto" alCerrar={alCerrar}>{q.error ? <ErrorApi error={q.error} /> : <Cargando />}</Cajon>;
  if (editando) return <ArmarReparto reparto={r} alCerrar={() => setEditando(false)} alCrear={() => setEditando(false)} />;
  if (rindiendo) return <Rendicion reparto={r} alCerrar={() => setRindiendo(false)} alListo={(x) => { fijar(x); setRindiendo(false); }} />;
  const errores = despachar.data?.errores ?? [];
  return (
    <Cajon
      titulo={`Reparto N.º ${r.numero} · ${r.repartidor}`}
      ancho={880}
      alCerrar={alCerrar}
      pie={
        <>
          <button className="btn" onClick={() => setHoja(true)}><Printer size={16} /> Hoja de ruta y carga</button>
          {r.estado === 'preparacion' && puede('entrega.cancelar') && <button className="btn peligro" onClick={() => setAnulando(!anulando)}><Ban size={16} /> Anular</button>}
          {r.estado === 'preparacion' && puede('entrega.crear') && <button className="btn" onClick={() => setEditando(true)}>Editar</button>}
          {r.estado === 'preparacion' && puede('entrega.crear') && (
            <button className="btn pri" disabled={despachar.isPending} onClick={() => despachar.mutate()}><Truck size={16} /> {despachar.isPending ? 'Facturando…' : 'Facturar y despachar'}</button>
          )}
          {r.estado === 'en_ruta' && puede('entrega.editar') && <button className="btn pri" onClick={() => setRindiendo(true)}><CheckCircle2 size={16} /> Recibir rendición</button>}
        </>
      }
    >
      <ErrorApi error={despachar.error ?? anular.error} />
      {errores.length > 0 && (
        <Aviso tipo="error">
          No se pudieron facturar {errores.length === 1 ? 'un pedido' : `${errores.length} pedidos`}: {errores.map((e) => `N.º ${e.pedido}: ${e.mensaje}`).join(' · ')}. Los demás quedaron facturados; corrija y vuelva a despachar.
        </Aviso>
      )}
      {anulando && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="entrada" style={{ flex: 1 }} autoFocus placeholder="Motivo (los pedidos quedan libres)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button className="btn peligro" disabled={motivo.trim().length < 3 || anular.isPending} onClick={() => anular.mutate()}>Confirmar</button>
        </div>
      )}
      <section className="panel cifras">
        <div className="cifra"><span>Estado</span><b><span className={`insignia ${ESTADO[r.estado].clase}`}>{ESTADO[r.estado].texto}</span></b><small className="tenue">{fechaCorta(r.fecha)}{r.ruta ? ` · ${r.ruta.nombre}` : ''}</small></div>
        <div className="cifra"><span>Pedidos</span><b className="num">{r.pedidos.length}</b><small className="tenue">{r.vehiculo ?? r.caja.nombre}</small></div>
        <div className="cifra"><span>Total</span><b className="num">{dinero(r.total)}</b></div>
        {r.estado === 'rendido' && (
          <div className="cifra">
            <span>Efectivo rendido</span>
            <b className="num">{dinero(r.efectivoEntregado ?? 0)}</b>
            <small className={Number(r.diferencia) < 0 ? 'texto-error' : 'tenue'}>{Number(r.diferencia) === 0 ? `Cobrado ${dinero(r.cobrado)}` : `Diferencia ${dinero(r.diferencia ?? 0)}`}</small>
          </div>
        )}
      </section>
      <div className="tenue peq">
        {r.despachadoEn && `Despachado ${fechaHora(r.despachadoEn)} por ${r.despachador}. `}
        {r.rendidoEn && `Rendido ${fechaHora(r.rendidoEn)} por ${r.rendidor}. `}
        {r.estado === 'preparacion' && 'Al despachar, cada pedido se factura a la cuenta del cliente (la factura viaja con la mercadería) y sale del depósito de la caja.'}
      </div>
      <div className="pestanas" style={{ margin: 0 }}>
        <button className={vista === 'ruta' ? 'activa' : ''} onClick={() => setVista('ruta')}>Hoja de ruta</button>
        <button className={vista === 'carga' ? 'activa' : ''} onClick={() => setVista('carga')}>Hoja de carga</button>
      </div>
      {vista === 'ruta' ? (
        <table>
          <thead><tr><th>#</th><th>Cliente</th><th>Pedido</th><th className="der">Total</th><th className="der">{r.estado === 'rendido' ? 'Cobrado' : 'Saldo'}</th><th>Entrega</th></tr></thead>
          <tbody>
            {r.pedidos.map((p) => (
              <tr key={p.pedidoId}>
                <td className="num tenue">{p.orden}</td>
                <td>
                  <b style={{ fontWeight: 600 }}>{p.cliente?.nombre}</b>
                  <div className="tenue peq">{[p.cliente?.direccion, p.cliente?.telefono].filter(Boolean).join(' · ')}</div>
                  {p.motivo && <div className="tenue peq">{p.motivo}</div>}
                </td>
                <td className="num">N.º {p.numero}{p.venta && <div className="tenue peq">Venta N.º {p.venta.numero}</div>}</td>
                <td className="der num">{dinero(p.total)}{p.devuelto && <div className="tenue peq">devuelto {dinero(p.devuelto)}</div>}</td>
                <td className="der num">{r.estado === 'rendido' ? (Number(p.cobrado) ? dinero(p.cobrado) : '—') : p.cuenta ? dinero(p.cuenta.saldo) : '—'}{r.estado === 'rendido' && p.cuenta && Number(p.cuenta.saldo) > 0 && <div className="tenue peq">a cuenta {dinero(p.cuenta.saldo)}</div>}</td>
                <td><span className={`insignia ${ENTREGA[p.estado].clase}`}>{ENTREGA[p.estado].texto}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table>
          <thead><tr><th>Producto</th><th>SKU</th><th className="der">Cantidad</th></tr></thead>
          <tbody>
            {r.carga.map((c) => (
              <tr key={c.varianteId}>
                <td>{c.descripcion}</td>
                <td className="mono tenue">{c.sku ?? '—'}</td>
                <td className="der num" style={{ fontWeight: 600 }}>{cantidad(c.cantidad)} {c.unidad === 'unidad' ? '' : c.unidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hoja && (
        <Cajon titulo="Hoja de ruta y carga" ancho={880} alCerrar={() => setHoja(false)} pie={<button className="btn pri" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>}>
          <div className="doc-a4">
            <div className="doc-cab">
              <div><h1>{yo?.empresa.nombre}</h1><div>{r.sucursal}</div></div>
              <div className="doc-tipo"><b>Reparto N.º {r.numero}</b><div>{fechaCorta(r.fecha)}</div></div>
            </div>
            <div className="doc-datos">
              <div><span>Repartidor:</span> {r.repartidor}</div>
              <div><span>Vehículo:</span> {r.vehiculo ?? '—'}</div>
              <div><span>Ruta:</span> {r.ruta?.nombre ?? '—'}</div>
              <div><span>Total a entregar:</span> {dinero(r.total)}</div>
            </div>
            <table>
              <thead><tr><th>#</th><th>Cliente y dirección</th><th>Pedido / venta</th><th className="der">Total</th><th>Cobrado</th><th>Firma</th></tr></thead>
              <tbody>
                {r.pedidos.map((p) => (
                  <tr key={p.pedidoId}>
                    <td>{p.orden}</td>
                    <td><b>{p.cliente?.nombre}</b><br />{[p.cliente?.direccion, p.cliente?.telefono].filter(Boolean).join(' · ')}</td>
                    <td>N.º {p.numero}{p.venta ? ` / ${p.venta.numero}` : ''}</td>
                    <td className="der">{dinero(p.total)}</td>
                    <td style={{ width: 90 }} />
                    <td style={{ width: 110 }} />
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead><tr><th>Carga</th><th className="der">Cantidad</th><th>Control</th></tr></thead>
              <tbody>
                {r.carga.map((c) => (
                  <tr key={c.varianteId}><td>{c.descripcion}</td><td className="der">{cantidad(c.cantidad)} {c.unidad === 'unidad' ? '' : c.unidad}</td><td style={{ width: 90 }} /></tr>
                ))}
              </tbody>
            </table>
            <div className="doc-pie"><span>Cargó: ____________________</span><span>Recibió (repartidor): ____________________</span></div>
          </div>
        </Cajon>
      )}
    </Cajon>
  );
}

interface FilaRendicion { estado: 'entregado' | 'parcial' | 'rechazado'; cobrado: string; medio: 'efectivo' | 'transferencia' | 'cheque' | 'otro'; motivo: string; reprogramar: boolean; devuelto: Record<number, string> }

/** Rendición del repartidor: qué pasó con cada pedido, lo cobrado y el efectivo que entrega. */
function Rendicion({ reparto, alCerrar, alListo }: { reparto: Reparto; alCerrar: () => void; alListo: (r: Reparto) => void }) {
  const pendientes = reparto.pedidos.filter((p) => p.estado === 'pendiente');
  const [filas, setFilas] = useState<Record<string, FilaRendicion>>(() =>
    Object.fromEntries(pendientes.map((p) => [p.pedidoId, { estado: 'entregado', cobrado: String(Math.round(Number(p.cuenta?.saldo ?? p.total))), medio: 'efectivo', motivo: '', reprogramar: true, devuelto: {} }])),
  );
  const [efectivo, setEfectivo] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const ventas = useQuery({
    queryKey: ['reparto', reparto.id, 'ventas', abierta],
    queryFn: () => api<{ items: { linea: number; descripcion: string; cantidad: string; total: string }[] }>(`/ventas/${reparto.pedidos.find((p) => p.pedidoId === abierta)!.venta!.id}`),
    enabled: !!abierta && !!reparto.pedidos.find((p) => p.pedidoId === abierta)?.venta,
  });
  const set = (id: string, c: Partial<FilaRendicion>) => setFilas((f) => ({ ...f, [id]: { ...f[id]!, ...c } }));
  const esperado = Object.values(filas).reduce((s, f) => s + (f.estado !== 'rechazado' && f.medio === 'efectivo' ? Number(f.cobrado || 0) : 0), 0);
  const diferencia = efectivo === '' ? null : Number(efectivo) - esperado;
  const rendir = useMutation({
    mutationFn: () =>
      api<Reparto>(`/repartos/${reparto.id}/rendir`, {
        metodo: 'POST',
        cuerpo: {
          efectivoEntregado: Number(efectivo || 0),
          entregas: pendientes.map((p) => {
            const f = filas[p.pedidoId]!;
            return {
              pedidoId: p.pedidoId,
              estado: f.estado,
              cobrado: f.estado === 'rechazado' ? 0 : Number(f.cobrado || 0),
              medio: f.medio,
              motivo: f.motivo || null,
              reprogramar: f.reprogramar,
              devuelto: f.estado === 'parcial' ? Object.entries(f.devuelto).filter(([, v]) => Number(v) > 0).map(([l, v]) => ({ linea: Number(l), cantidad: Number(v) })) : [],
            };
          }),
        },
      }),
    onSuccess: alListo,
  });
  const incompleta = pendientes.some((p) => {
    const f = filas[p.pedidoId]!;
    return (f.estado === 'rechazado' && f.motivo.trim().length < 3) || (f.estado === 'parcial' && !Object.values(f.devuelto).some((v) => Number(v) > 0));
  });
  return (
    <Cajon
      titulo={`Rendición · reparto N.º ${reparto.numero}`}
      ancho={900}
      alCerrar={alCerrar}
      pie={<button className="btn pri" disabled={efectivo === '' || incompleta || rendir.isPending} onClick={() => rendir.mutate()}><CheckCircle2 size={16} /> Cerrar rendición</button>}
    >
      <ErrorApi error={rendir.error} />
      <p className="tenue peq" style={{ margin: 0 }}>
        Lo cobrado entra a la caja {reparto.caja.nombre} como cobro de la cuenta del cliente; lo que no se cobró queda en su cuenta corriente. Lo que volvió entra al stock con nota de crédito.
      </p>
      <table>
        <thead><tr><th>Cliente</th><th>Entrega</th><th className="der">Cobrado</th><th>Medio</th></tr></thead>
        <tbody>
          {pendientes.map((p) => {
            const f = filas[p.pedidoId]!;
            return (
              <FilaEntrega key={p.pedidoId}>
                <tr>
                  <td><b style={{ fontWeight: 600 }}>{p.cliente?.nombre}</b><div className="tenue peq">Pedido N.º {p.numero} · {dinero(p.cuenta?.saldo ?? p.total)}</div></td>
                  <td>
                    <select className="entrada chica" aria-label={`Entrega de ${p.cliente?.nombre}`} value={f.estado} onChange={(e) => { const estado = e.target.value as FilaRendicion['estado']; set(p.pedidoId, { estado, ...(estado === 'rechazado' && { cobrado: '0' }) }); if (estado === 'parcial') setAbierta(p.pedidoId); }}>
                      <option value="entregado">Entregado</option>
                      <option value="parcial">Entrega parcial</option>
                      <option value="rechazado">No entregado</option>
                    </select>
                  </td>
                  <td className="der"><input className="entrada num chica" style={{ width: 110 }} aria-label={`Cobrado a ${p.cliente?.nombre}`} disabled={f.estado === 'rechazado'} value={f.estado === 'rechazado' ? '' : f.cobrado} onChange={(e) => set(p.pedidoId, { cobrado: soloNumero(e.target.value) })} /></td>
                  <td>
                    <select className="entrada chica" aria-label={`Medio de ${p.cliente?.nombre}`} disabled={f.estado === 'rechazado' || !Number(f.cobrado)} value={f.medio} onChange={(e) => set(p.pedidoId, { medio: e.target.value as FilaRendicion['medio'] })}>
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="cheque">Cheque</option>
                      <option value="otro">Otro</option>
                    </select>
                  </td>
                </tr>
                {f.estado === 'rechazado' && (
                  <tr className="sub-fila">
                    <td colSpan={4}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input className="entrada chica" style={{ flex: 1, minWidth: 220 }} placeholder="Motivo: local cerrado, no lo quiso, sin dinero" value={f.motivo} onChange={(e) => set(p.pedidoId, { motivo: e.target.value })} />
                        <label className="casilla peq"><input type="checkbox" checked={f.reprogramar} onChange={(e) => set(p.pedidoId, { reprogramar: e.target.checked })} /> Reprogramar el pedido (si no, se cancela)</label>
                      </div>
                    </td>
                  </tr>
                )}
                {f.estado === 'parcial' && (
                  <tr className="sub-fila">
                    <td colSpan={4}>
                      {abierta !== p.pedidoId ? (
                        <button className="btn chico" onClick={() => setAbierta(p.pedidoId)}>Indicar lo que volvió</button>
                      ) : !ventas.data ? (
                        <Cargando />
                      ) : (
                        <div className="form" style={{ gap: 6 }}>
                          {ventas.data.items.map((i) => (
                            <div key={i.linea} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ flex: 1 }}>{i.descripcion} <span className="tenue peq">· llevó {cantidad(i.cantidad)}</span></span>
                              <span className="tenue peq">volvió</span>
                              <input className="entrada num chica" style={{ width: 80 }} aria-label={`Volvió de ${i.descripcion}`} value={f.devuelto[i.linea] ?? ''} onChange={(e) => {
                                  const devuelto = { ...f.devuelto, [i.linea]: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') };
                                  // Lo cobrado baja con lo que volvió (al precio facturado de cada línea).
                                  const valor = ventas.data!.items.reduce((s2, x) => s2 + (Number(x.total) * Math.min(Number(devuelto[x.linea] || 0), Number(x.cantidad))) / Number(x.cantidad), 0);
                                  set(p.pedidoId, { devuelto, cobrado: String(Math.max(Math.round(Number(p.cuenta?.saldo ?? p.total) - valor), 0)) });
                                }} />
                            </div>
                          ))}
                          <input className="entrada chica" placeholder="Motivo (opcional)" value={f.motivo} onChange={(e) => set(p.pedidoId, { motivo: e.target.value })} />
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </FilaEntrega>
            );
          })}
        </tbody>
      </table>
      <section className="panel" style={{ padding: 16 }}>
        <div className="fila-campos" style={{ alignItems: 'flex-end' }}>
          <div className="cifra"><span>Efectivo cobrado según lo cargado</span><b className="num">{dinero(esperado)}</b></div>
          <Campo etiqueta="Efectivo que entrega el repartidor" id="rd-e" ayuda={efectivo ? dinero(efectivo) : undefined}>
            <input id="rd-e" className="entrada num" inputMode="numeric" value={efectivo} onChange={(e) => setEfectivo(soloNumero(e.target.value))} />
          </Campo>
          {diferencia !== null && (
            <div className="cifra">
              <span>Diferencia</span>
              <b className={`num${diferencia < 0 ? ' texto-error' : ''}`}>{diferencia === 0 ? 'Sin diferencia' : dinero(diferencia)}</b>
              <small className="tenue">{diferencia < 0 ? 'Faltante del repartidor' : diferencia > 0 ? 'Sobrante' : ''}</small>
            </div>
          )}
        </div>
      </section>
    </Cajon>
  );
}

const FilaEntrega = ({ children }: { children: React.ReactNode }) => <>{children}</>;

// ── Rutas ────────────────────────────────────────────────────────────────────

function Rutas({ editable }: { editable: boolean }) {
  const q = useQuery({ queryKey: ['rutas'], queryFn: () => api<RutaFila[]>('/rutas') });
  const [abierta, setAbierta] = useState<RutaFila | 'nueva' | null>(null);
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16 }}>
        {editable && <button className="btn pri" onClick={() => setAbierta('nueva')}><Plus size={16} /> Nueva ruta</button>}
        <span className="tenue peq" style={{ alignSelf: 'center' }}>Cada ruta tiene sus clientes en el orden de visita; los pedidos se cargan en ese orden.</span>
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.length ? (
        <Vacio titulo="Sin rutas">Cree las rutas o zonas de reparto y asigne los clientes.</Vacio>
      ) : (
        <table>
          <thead><tr><th>Ruta</th><th>Días de visita</th><th>Sucursal</th><th className="der">Clientes</th></tr></thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.id} className="clic" onClick={() => setAbierta(r)} style={r.activa ? undefined : { opacity: 0.55 }}>
                <td style={{ fontWeight: 600 }}><Route size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{r.nombre}{!r.activa && <span className="insignia i-n" style={{ marginLeft: 6 }}>Inactiva</span>}</td>
                <td>{r.dias.length ? r.dias.map((d) => DIAS[d]).join(', ') : <span className="tenue">—</span>}</td>
                <td className="tenue">{r.sucursal}</td>
                <td className="der num">{r.clientes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {abierta && <EditarRuta ruta={abierta === 'nueva' ? null : abierta} editable={editable} alCerrar={() => setAbierta(null)} />}
    </section>
  );
}

function EditarRuta({ ruta, editable, alCerrar }: { ruta: RutaFila | null; editable: boolean; alCerrar: () => void }) {
  const { yo } = useSesion();
  const qc = useQueryClient();
  const [d, setD] = useState({ nombre: ruta?.nombre ?? '', sucursalId: ruta?.sucursalId ?? yo?.sucursales[0]?.id ?? '', dias: ruta?.dias ?? [], nota: ruta?.nota ?? '', activa: ruta?.activa ?? true });
  const clientes = useQuery({ queryKey: ['rutas', ruta?.id, 'clientes'], queryFn: () => api<ClienteRuta[]>(`/rutas/${ruta!.id}/clientes`), enabled: !!ruta });
  const [orden, setOrden] = useState<ClienteRuta[] | null>(null);
  const lista = orden ?? clientes.data ?? [];
  const [buscar, setBuscar] = useState('');
  const encontrados = useQuery({
    queryKey: ['clientes', 'ruta', buscar],
    queryFn: () => api<{ items: ClienteRuta[] } | ClienteRuta[]>(`/clientes?q=${encodeURIComponent(buscar.trim())}`),
    enabled: buscar.trim().length >= 2,
  });
  const candidatos = (Array.isArray(encontrados.data) ? encontrados.data : (encontrados.data?.items ?? [])).filter((c) => !lista.some((x) => x.id === c.id)).slice(0, 8);
  const guardar = useMutation({
    mutationFn: async () => {
      const cuerpo = { ...d, nota: d.nota || null };
      const r = ruta ? await api<{ id: string }>(`/rutas/${ruta.id}`, { metodo: 'PUT', cuerpo }) : await api<{ id: string }>('/rutas', { metodo: 'POST', cuerpo });
      if (orden) await api(`/rutas/${r.id}/clientes`, { metodo: 'PUT', cuerpo: { clienteIds: orden.map((c) => c.id) } });
      return r;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rutas'] });
      void qc.invalidateQueries({ queryKey: ['repartos', 'pedidos'] });
      alCerrar();
    },
  });
  const mover = (i: number, delta: number) => {
    const n = [...lista];
    const [x] = n.splice(i, 1);
    n.splice(i + delta, 0, x!);
    setOrden(n);
  };
  return (
    <Cajon titulo={ruta ? `Ruta · ${ruta.nombre}` : 'Nueva ruta'} ancho={680} alCerrar={alCerrar} pie={editable ? <button className="btn pri" disabled={d.nombre.trim().length < 2 || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button> : undefined}>
      <div className="form">
        <ErrorApi error={guardar.error} />
        <div className="fila-campos">
          <Campo etiqueta="Nombre" id="ru-n"><input id="ru-n" className="entrada" autoFocus disabled={!editable} placeholder="Centro, Ruta 6, Zona norte" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></Campo>
          {(yo?.sucursales.length ?? 0) > 1 && (
            <Campo etiqueta="Sucursal" id="ru-s">
              <select id="ru-s" className="entrada" disabled={!editable} value={d.sucursalId} onChange={(e) => setD({ ...d, sucursalId: e.target.value })}>{yo?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
            </Campo>
          )}
        </div>
        <Campo etiqueta="Días de visita" id="ru-d">
          <div className="chips" role="group" aria-label="Días de visita">
            {DIAS.map((x, i) => (
              <button key={x} type="button" disabled={!editable} className={`chip${d.dias.includes(i) ? ' activo' : ''}`} aria-pressed={d.dias.includes(i)} onClick={() => setD({ ...d, dias: d.dias.includes(i) ? d.dias.filter((y) => y !== i) : [...d.dias, i].sort() })}>{x}</button>
            ))}
          </div>
        </Campo>
        <h3 className="subtitulo" style={{ margin: 0 }}>Clientes en orden de visita</h3>
        {ruta && !clientes.data ? (
          <Cargando />
        ) : (
          <table>
            <tbody>
              {lista.map((c, i) => (
                <tr key={c.id}>
                  <td className="num tenue" style={{ width: 32 }}>{i + 1}</td>
                  <td><b style={{ fontWeight: 600 }}>{c.nombre}</b>{c.direccion && <div className="tenue peq"><MapPin size={12} style={{ verticalAlign: -1 }} /> {c.direccion}</div>}</td>
                  <td className="der" style={{ whiteSpace: 'nowrap' }}>
                    {editable && (
                      <>
                        <button className="enlace" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp size={15} /></button>
                        <button className="enlace" aria-label="Bajar" disabled={i === lista.length - 1} onClick={() => mover(i, 1)} style={{ marginLeft: 8 }}><ArrowDown size={15} /></button>
                        <button className="enlace" aria-label="Quitar de la ruta" onClick={() => setOrden(lista.filter((x) => x.id !== c.id))} style={{ marginLeft: 12 }}><Trash2 size={15} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!lista.length && <tr><td className="tenue">Sin clientes.</td></tr>}
            </tbody>
          </table>
        )}
        {editable && (
          <div style={{ position: 'relative' }}>
            <input className="entrada" placeholder="Agregar cliente a la ruta" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            {candidatos.length > 0 && (
              <div className="menu-flotante">
                {candidatos.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setOrden([...lista, c]); setBuscar(''); }}>
                    {c.nombre}{c.direccion && <span className="tenue peq"> · {c.direccion}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="tenue peq" style={{ margin: 0 }}>Un cliente está en una sola ruta: si se agrega aquí, sale de la anterior.</p>
        <Campo etiqueta="Nota" id="ru-no"><input id="ru-no" className="entrada" disabled={!editable} value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} /></Campo>
        <label className="casilla"><input type="checkbox" disabled={!editable} checked={d.activa} onChange={(e) => setD({ ...d, activa: e.target.checked })} /> Ruta activa</label>
      </div>
    </Cajon>
  );
}
