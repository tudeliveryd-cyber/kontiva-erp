import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Clock, LayoutGrid, MoveRight, Pencil, Plus, Printer, Send, ShoppingBag, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export interface ResumenCuenta { id: string; numero: number; nombre: string | null; comensales: number; abiertaEn: string; mozo: string; total: string; pendiente: string; porEnviar: number; enCocina: number; listos: number }
interface MesaPlano { id: string; nombre: string; capacidad: number; forma: 'cuadrada' | 'redonda' | 'rectangular'; posX: number; posY: number; cuenta: ResumenCuenta | null }
interface Plano { salones: { id: string; nombre: string; orden: number; mesas: MesaPlano[] }[]; mostrador: ResumenCuenta[] }
export type EstadoItem = 'pendiente' | 'enviado' | 'preparando' | 'listo' | 'entregado' | 'anulado';
export interface ItemCuenta { id: string; varianteId: string; descripcion: string; cantidad: string; precioUnitario: string; total: string; nota: string | null; estacion: 'cocina' | 'bar' | null; tasaIva: 0 | 5 | 10; unidad: string; estado: EstadoItem; comanda: number | null; ventaId: string | null; motivoAnulacion: string | null }
export interface Cuenta {
  id: string;
  numero: number;
  tipo: 'mesa' | 'mostrador';
  mesaId: string | null;
  mesa: string | null;
  nombre: string | null;
  sucursalId: string;
  comensales: number;
  mozo: string;
  estado: 'abierta' | 'cerrada' | 'anulada';
  propina: string;
  nota: string | null;
  abiertaEn: string;
  items: ItemCuenta[];
  totales: { total: string; pagado: string; pendiente: string };
}
interface Plato { varianteId: string; descripcion: string; unidad: string; estacion: 'cocina' | 'bar' | null; categoria: string; precio: string }

const COLUMNAS = 12;
const minutosDesde = (f: string) => Math.max(0, Math.floor((Date.now() - Date.parse(f)) / 60000));
const duracion = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
export const ESTADO_ITEM: Record<EstadoItem, { texto: string; clase: string }> = {
  pendiente: { texto: 'Por enviar', clase: 'i-warn' },
  enviado: { texto: 'En cocina', clase: 'i-n' },
  preparando: { texto: 'Preparando', clase: 'i-p' },
  listo: { texto: 'Listo', clase: 'i-ok' },
  entregado: { texto: 'Servido', clase: 'i-n' },
  anulado: { texto: 'Anulado', clase: 'i-bad' },
};
export const nombreCuenta = (c: { tipo?: string; mesa?: string | null; nombre: string | null; numero: number }) =>
  c.mesa ? `Mesa ${c.mesa}` : `Mostrador${c.nombre ? ` · ${c.nombre}` : ''} (N.º ${c.numero})`;

/** Refresca la hora relativa cada 30 s. */
function useReloj() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
}

export function Salon() {
  const { yo, puede } = useSesion();
  const qc = useQueryClient();
  const [sucursalId, setSucursalId] = useState(yo?.sucursales[0]?.id ?? '');
  const [salonSel, setSalonSel] = useState<string | null>(null);
  const [cuentaAbierta, setCuentaAbierta] = useState<string | null>(null);
  const [abrirMesa, setAbrirMesa] = useState<MesaPlano | 'mostrador' | null>(null);
  const [editando, setEditando] = useState(false);
  const [editMesa, setEditMesa] = useState<Partial<MesaPlano> & { salonId: string } | null>(null);
  const [nuevoSalon, setNuevoSalon] = useState(false);
  useReloj();
  const plano = useQuery({ queryKey: ['plano', sucursalId], queryFn: () => api<Plano>(`/restaurante/plano?sucursalId=${sucursalId}`), enabled: !!sucursalId, refetchInterval: 10000 });
  const salon = plano.data?.salones.find((s) => s.id === salonSel) ?? plano.data?.salones[0];
  const filas = Math.max(6, ...(salon?.mesas.map((m) => m.posY + 2) ?? [0]));
  const editable = puede('salon.editar');
  return (
    <>
      <Encabezado titulo="Salón">
        {(yo?.sucursales.length ?? 0) > 1 && (
          <select className="entrada" aria-label="Sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            {yo?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        {puede('salon.crear') && <button className="btn" onClick={() => setAbrirMesa('mostrador')}><ShoppingBag size={16} /> Para llevar</button>}
        {editable && (
          <button className={`btn ${editando ? 'pri' : ''}`} onClick={() => setEditando(!editando)}>
            {editando ? <><Check size={16} /> Listo</> : <><Pencil size={16} /> Editar plano</>}
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <ErrorApi error={plano.error} />
        {!plano.data ? (
          <Cargando />
        ) : !plano.data.salones.length && !editando ? (
          <Vacio titulo="Todavía no hay mesas">{editable ? 'Use "Editar plano" para crear el salón y ubicar las mesas.' : 'Quien administra el local debe cargar el salón y sus mesas.'}</Vacio>
        ) : (
          <>
            <div className="pestanas">
              {plano.data.salones.map((s) => (
                <button key={s.id} className={salon?.id === s.id ? 'activa' : ''} onClick={() => setSalonSel(s.id)}>
                  {s.nombre} <span className="tenue peq">{s.mesas.filter((m) => m.cuenta).length}/{s.mesas.length}</span>
                </button>
              ))}
              {editando && <button onClick={() => setNuevoSalon(true)}><Plus size={14} /> Salón</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: plano.data.mostrador.length ? 'minmax(0, 1fr) 280px' : '1fr', gap: 16, alignItems: 'start' }}>
              <section className="panel plano" style={{ gridTemplateColumns: `repeat(${COLUMNAS}, minmax(104px, 1fr))`, gridTemplateRows: `repeat(${filas}, 104px)` }}>
                {editando &&
                  salon &&
                  Array.from({ length: COLUMNAS * filas }, (_, i) => ({ x: i % COLUMNAS, y: Math.floor(i / COLUMNAS) }))
                    .filter((c) => !salon.mesas.some((m) => m.posX === c.x && m.posY === c.y))
                    .map((c) => (
                      <button key={`${c.x}-${c.y}`} className="celda-libre" style={{ gridColumn: c.x + 1, gridRow: c.y + 1 }} aria-label="Agregar mesa aquí" onClick={() => setEditMesa({ salonId: salon.id, posX: c.x, posY: c.y, capacidad: 4, forma: 'cuadrada', nombre: '' })}>
                        <Plus size={14} />
                      </button>
                    ))}
                {salon?.mesas.map((m) => {
                  const c = m.cuenta;
                  const min = c ? minutosDesde(c.abiertaEn) : 0;
                  return (
                    <button
                      key={m.id}
                      className={`mesa forma-${m.forma} ${c ? 'ocupada' : 'libre'} ${c?.listos ? 'con-listos' : ''}`}
                      style={{ gridColumn: `${m.posX + 1} / span ${m.forma === 'rectangular' ? 2 : 1}`, gridRow: m.posY + 1 }}
                      onClick={() => (editando ? setEditMesa({ ...m, salonId: salon.id }) : c ? setCuentaAbierta(c.id) : puede('salon.crear') && setAbrirMesa(m))}
                    >
                      <b>{m.nombre}</b>
                      {c ? (
                        <>
                          <span className="num total">{dinero(c.total)}</span>
                          <span className="detalle"><Users size={11} /> {c.comensales} <Clock size={11} style={{ marginLeft: 4 }} /> {min < 60 ? `${min}'` : duracion(min)}</span>
                          {(c.listos > 0 || c.porEnviar > 0) && (
                            <span className="marcas">
                              {c.listos > 0 && <span className="insignia i-ok">{c.listos} listo{c.listos > 1 ? 's' : ''}</span>}
                              {c.porEnviar > 0 && <span className="insignia i-warn">{c.porEnviar} sin enviar</span>}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="tenue peq">{m.capacidad} lugares</span>
                      )}
                    </button>
                  );
                })}
              </section>
              {plano.data.mostrador.length > 0 && (
                <section className="panel">
                  <div className="panel-cab"><h2>Para llevar</h2></div>
                  {plano.data.mostrador.map((c) => (
                    <button key={c.id} className="fila-cuenta" onClick={() => setCuentaAbierta(c.id)}>
                      <span style={{ flex: 1 }}><b>{c.nombre ?? `N.º ${c.numero}`}</b><span className="tenue peq" style={{ display: 'block' }}>{duracion(minutosDesde(c.abiertaEn))} · {c.mozo}</span></span>
                      {c.listos > 0 && <span className="insignia i-ok">{c.listos} listo{c.listos > 1 ? 's' : ''}</span>}
                      <b className="num">{dinero(c.total)}</b>
                    </button>
                  ))}
                </section>
              )}
            </div>
            <div className="leyenda" style={{ borderTop: 0, paddingLeft: 0 }}>
              <span><span className="mesa-muestra libre" />Libre</span>
              <span><span className="mesa-muestra ocupada" />Ocupada</span>
              <span><span className="mesa-muestra con-listos" />Con platos listos para servir</span>
            </div>
          </>
        )}
      </div>
      {abrirMesa && <AbrirCuenta mesa={abrirMesa === 'mostrador' ? null : abrirMesa} sucursalId={sucursalId} alCerrar={() => setAbrirMesa(null)} alAbrir={(id) => { setAbrirMesa(null); setCuentaAbierta(id); void qc.invalidateQueries({ queryKey: ['plano'] }); }} />}
      {cuentaAbierta && <PanelCuenta id={cuentaAbierta} plano={plano.data} alCerrar={() => { setCuentaAbierta(null); void qc.invalidateQueries({ queryKey: ['plano'] }); }} />}
      {editMesa && <EditarMesa mesa={editMesa} alCerrar={() => setEditMesa(null)} />}
      {nuevoSalon && <NuevoSalon sucursalId={sucursalId} alCerrar={() => setNuevoSalon(false)} alCrear={(id) => { setNuevoSalon(false); setSalonSel(id); }} />}
    </>
  );
}

function AbrirCuenta({ mesa, sucursalId, alCerrar, alAbrir }: { mesa: MesaPlano | null; sucursalId: string; alCerrar: () => void; alAbrir: (id: string) => void }) {
  const [comensales, setComensales] = useState(mesa ? String(Math.min(2, mesa.capacidad)) : '1');
  const [nombre, setNombre] = useState('');
  const abrir = useMutation({
    mutationFn: () => api<Cuenta>('/restaurante/cuentas', { metodo: 'POST', cuerpo: mesa ? { mesaId: mesa.id, comensales: Number(comensales) } : { sucursalId, nombre: nombre || null, comensales: Number(comensales) } }),
    onSuccess: (c) => alAbrir(c.id),
  });
  return (
    <Cajon titulo={mesa ? `Abrir mesa ${mesa.nombre}` : 'Pedido para llevar'} alCerrar={alCerrar}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); abrir.mutate(); }}>
        <ErrorApi error={abrir.error} />
        {!mesa && <Campo etiqueta="A nombre de" id="ac-n"><input id="ac-n" className="entrada" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>}
        <Campo etiqueta="Comensales" id="ac-c">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <button type="button" key={n} className={`btn ${comensales === String(n) ? 'pri' : ''}`} style={{ minWidth: 44 }} onClick={() => setComensales(String(n))}>{n}</button>
            ))}
            <input id="ac-c" className="entrada num" style={{ width: 70 }} value={comensales} onChange={(e) => setComensales(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        </Campo>
        <button className="btn pri" disabled={!Number(comensales) || abrir.isPending}>Abrir cuenta</button>
      </form>
    </Cajon>
  );
}

/** Cuenta de la mesa: carta, ítems por enviar, estado de cocina, servir, mover, pre-cuenta. */
function PanelCuenta({ id, plano, alCerrar }: { id: string; plano?: Plano; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cuenta', id], queryFn: () => api<Cuenta>(`/restaurante/cuentas/${id}`), refetchInterval: 8000 });
  const c = q.data;
  const carta = useQuery({ queryKey: ['carta', c?.sucursalId], queryFn: () => api<Plato[]>(`/restaurante/carta?sucursalId=${c!.sucursalId}`), enabled: !!c && puede('salon.crear'), staleTime: 60000 });
  const [categoria, setCategoria] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [nota, setNota] = useState<{ varianteId: string; descripcion: string } | null>(null);
  const [textoNota, setTextoNota] = useState('');
  const [anulando, setAnulando] = useState<ItemCuenta | null>(null);
  const [motivo, setMotivo] = useState('');
  const [moviendo, setMoviendo] = useState(false);
  const [preCuenta, setPreCuenta] = useState(false);
  const fijar = (r: Cuenta) => {
    qc.setQueryData(['cuenta', id], r);
    void qc.invalidateQueries({ queryKey: ['plano'] });
  };
  const agregar = useMutation({ mutationFn: (it: { varianteId: string; cantidad: number; nota?: string | null }) => api<Cuenta>(`/restaurante/cuentas/${id}/items`, { metodo: 'POST', cuerpo: { items: [it] } }), onSuccess: fijar });
  const quitar = useMutation({ mutationFn: (item: string) => api<Cuenta>(`/restaurante/cuentas/${id}/items/${item}`, { metodo: 'DELETE' }), onSuccess: fijar });
  const enviar = useMutation({ mutationFn: () => api<Cuenta>(`/restaurante/cuentas/${id}/enviar`, { metodo: 'POST' }), onSuccess: fijar });
  const servido = useMutation({ mutationFn: () => api<Cuenta>(`/restaurante/cuentas/${id}/servido`, { metodo: 'POST', cuerpo: {} }), onSuccess: fijar });
  const anularItem = useMutation({ mutationFn: (item: string) => api<Cuenta>(`/restaurante/cuentas/${id}/items/${item}/anular`, { metodo: 'POST', cuerpo: { motivo } }), onSuccess: (r) => { fijar(r); setAnulando(null); setMotivo(''); } });
  const mover = useMutation({ mutationFn: (mesaId: string) => api<Cuenta>(`/restaurante/cuentas/${id}/mover`, { metodo: 'POST', cuerpo: { mesaId } }), onSuccess: (r) => { fijar(r); setMoviendo(false); } });
  const cerrar = useMutation({ mutationFn: () => api<Cuenta>(`/restaurante/cuentas/${id}/anular`, { metodo: 'POST', cuerpo: { motivo: motivo || undefined } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['plano'] }); alCerrar(); } });
  const categorias = useMemo(() => [...new Set(carta.data?.map((p) => p.categoria) ?? [])], [carta.data]);
  const cat = categoria ?? categorias[0] ?? null;
  const platos = (carta.data ?? []).filter((p) => (buscar.trim() ? p.descripcion.toLowerCase().includes(buscar.trim().toLowerCase()) : p.categoria === cat));
  const error = agregar.error ?? quitar.error ?? enviar.error ?? servido.error ?? anularItem.error ?? mover.error ?? cerrar.error;
  if (!c) return <Cajon titulo="Cuenta" alCerrar={alCerrar}>{q.error ? <ErrorApi error={q.error} /> : <Cargando />}</Cajon>;
  const porEnviar = c.items.filter((i) => i.estado === 'pendiente');
  const listos = c.items.filter((i) => i.estado === 'listo');
  const abierta = c.estado === 'abierta';
  const tomar = abierta && puede('salon.crear');
  const vivos = c.items.filter((i) => i.estado !== 'anulado');
  const mesasLibres = plano?.salones.flatMap((s) => s.mesas.filter((m) => !m.cuenta).map((m) => ({ ...m, salon: s.nombre }))) ?? [];
  return (
    <Cajon
      titulo={`${nombreCuenta(c)} · N.º ${c.numero}`}
      ancho={tomar ? 1040 : 640}
      alCerrar={alCerrar}
      pie={
        abierta ? (
          <>
            <span className="tenue peq" style={{ flex: 1 }}>Se cobra en el PDV: "Cobrar mesa". {c.mozo} · {c.comensales} comensales · {duracion(minutosDesde(c.abiertaEn))}</span>
            <button className="btn" onClick={() => setPreCuenta(true)} disabled={!vivos.length}><Printer size={16} /> Pre-cuenta</button>
            {listos.length > 0 && tomar && <button className="btn" disabled={servido.isPending} onClick={() => servido.mutate()}><Check size={16} /> Servido ({listos.length})</button>}
            {tomar && <button className="btn pri" disabled={!porEnviar.length || enviar.isPending} onClick={() => enviar.mutate()}><Send size={16} /> Enviar a cocina{porEnviar.length ? ` (${porEnviar.length})` : ''}</button>}
          </>
        ) : undefined
      }
    >
      <ErrorApi error={error} />
      {!abierta && <Aviso tipo="info">Cuenta {c.estado}.</Aviso>}
      <div style={{ display: 'grid', gridTemplateColumns: tomar ? 'minmax(0, 1.15fr) minmax(0, 1fr)' : '1fr', gap: 18, alignItems: 'start' }}>
        {tomar && (
          <div className="form">
            <input className="entrada" placeholder="Buscar en la carta" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            {!buscar.trim() && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {categorias.map((k) => <button key={k} className={`btn chico ${k === cat ? 'pri' : ''}`} onClick={() => setCategoria(k)}>{k}</button>)}
              </div>
            )}
            {carta.isLoading ? (
              <Cargando />
            ) : (
              <div className="carta">
                {platos.map((p) => (
                  <button key={p.varianteId} className="plato" disabled={agregar.isPending} onClick={() => agregar.mutate({ varianteId: p.varianteId, cantidad: 1 })} onContextMenu={(e) => { e.preventDefault(); setNota(p); setTextoNota(''); }}>
                    <span>{p.descripcion}</span>
                    <b className="num">{dinero(p.precio)}</b>
                  </button>
                ))}
                {!platos.length && <p className="tenue peq">Sin productos.</p>}
              </div>
            )}
            <p className="tenue peq" style={{ margin: 0 }}>Toque para agregar. Para agregar con una aclaración ("sin cebolla"), mantenga presionado o use el botón derecho.</p>
          </div>
        )}
        <div>
          {!c.items.length ? (
            <Vacio titulo="Cuenta vacía">{tomar ? 'Agregue productos desde la carta.' : ''}</Vacio>
          ) : (
            <table>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id} style={i.estado === 'anulado' ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                    <td className="num" style={{ width: 36 }}>{Number(i.cantidad)}×</td>
                    <td>
                      {i.descripcion}
                      {i.nota && <div className="peq" style={{ color: 'var(--warn)' }}>{i.nota}</div>}
                      {i.motivoAnulacion && <div className="tenue peq">{i.motivoAnulacion}</div>}
                    </td>
                    <td>
                      <span className={`insignia ${ESTADO_ITEM[i.estado].clase}`}>{ESTADO_ITEM[i.estado].texto}</span>
                      {i.ventaId && <span className="insignia i-n" style={{ marginLeft: 4 }}>Cobrado</span>}
                    </td>
                    <td className="der num">{dinero(i.total)}</td>
                    <td className="der" style={{ whiteSpace: 'nowrap' }}>
                      {tomar && i.estado === 'pendiente' && <button className="enlace" aria-label="Quitar" onClick={() => quitar.mutate(i.id)}><Trash2 size={15} /></button>}
                      {abierta && puede('salon.cancelar') && !i.ventaId && !['pendiente', 'anulado'].includes(i.estado) && <button className="enlace" aria-label="Anular" title="Anular" onClick={() => setAnulando(i)}><Ban size={15} /></button>}
                    </td>
                  </tr>
                ))}
                <tr className="total-fila"><td colSpan={3}>Total</td><td className="der num">{dinero(c.totales.total)}</td><td /></tr>
                {Number(c.totales.pagado) > 0 && <tr><td colSpan={3} className="tenue">Cobrado</td><td className="der num tenue">{dinero(c.totales.pagado)}</td><td /></tr>}
                {Number(c.totales.pagado) > 0 && <tr><td colSpan={3}><b>Pendiente</b></td><td className="der num"><b>{dinero(c.totales.pendiente)}</b></td><td /></tr>}
              </tbody>
            </table>
          )}
          {abierta && c.comensales > 1 && Number(c.totales.pendiente) > 0 && <p className="tenue peq">Por persona ({c.comensales}): {dinero(Math.ceil(Number(c.totales.pendiente) / c.comensales))}</p>}
          {anulando && (
            <div className="form" style={{ borderTop: '1px solid var(--linea)', paddingTop: 12 }}>
              <b className="peq">Anular {Number(anulando.cantidad)} × {anulando.descripcion}</b>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="entrada" style={{ flex: 1 }} autoFocus placeholder="Motivo: devuelto, error de carga" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <button className="btn peligro" disabled={motivo.trim().length < 3 || anularItem.isPending} onClick={() => anularItem.mutate(anulando.id)}>Anular</button>
                <button className="btn" onClick={() => setAnulando(null)}><X size={15} /></button>
              </div>
            </div>
          )}
          {tomar && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {c.tipo === 'mesa' && <button className="btn chico" onClick={() => setMoviendo(!moviendo)}><MoveRight size={14} /> Cambiar de mesa</button>}
              {!c.items.some((i) => i.ventaId) && (
                <button className="btn chico peligro" disabled={cerrar.isPending || (vivos.some((i) => i.estado !== 'pendiente') && (!puede('salon.cancelar') || motivo.trim().length < 3))} onClick={() => confirm('¿Cerrar la cuenta sin cobrar?') && cerrar.mutate()} title={vivos.some((i) => i.estado !== 'pendiente') ? 'Con productos enviados: requiere permiso y motivo' : 'Libera la mesa'}>
                  <X size={14} /> Cerrar sin cobrar
                </button>
              )}
            </div>
          )}
          {moviendo && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {mesasLibres.length ? mesasLibres.map((m) => <button key={m.id} className="btn chico" disabled={mover.isPending} onClick={() => mover.mutate(m.id)}>{m.salon} · {m.nombre}</button>) : <span className="tenue peq">No hay mesas libres.</span>}
            </div>
          )}
        </div>
      </div>
      {nota && (
        <Cajon titulo={`Aclaración · ${nota.descripcion}`} alCerrar={() => setNota(null)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); agregar.mutate({ varianteId: nota.varianteId, cantidad: 1, nota: textoNota || null }); setNota(null); }}>
            <input className="entrada" autoFocus placeholder="Sin cebolla, bien cocida, para compartir" value={textoNota} onChange={(e) => setTextoNota(e.target.value)} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Sin sal', 'Sin cebolla', 'Bien cocida', 'Jugosa', 'Para llevar', 'Sin hielo'].map((t) => <button type="button" key={t} className="btn chico" onClick={() => setTextoNota(textoNota ? `${textoNota}, ${t.toLowerCase()}` : t)}>{t}</button>)}
            </div>
            <button className="btn pri">Agregar</button>
          </form>
        </Cajon>
      )}
      {preCuenta && (
        <Cajon titulo="Pre-cuenta" alCerrar={() => setPreCuenta(false)} pie={<button className="btn pri" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>}>
          <div className="ticket">
            <div className="t-centro"><b>{yo?.empresa.nombre}</b></div>
            <div className="t-centro">PRE-CUENTA · SIN VALOR FISCAL</div>
            <div>{nombreCuenta(c)} · Cuenta N.º {c.numero}</div>
            <div>{new Date().toLocaleString('es-PY')} · {c.mozo}</div>
            <div className="t-linea" />
            {vivos.map((i) => (
              <div key={i.id} className="t-fila"><span>{Number(i.cantidad)} × {i.descripcion}</span><span>{dinero(i.total)}</span></div>
            ))}
            <div className="t-linea" />
            <div className="t-fila"><b>TOTAL</b><b>{dinero(c.totales.total)}</b></div>
            {Number(c.totales.pagado) > 0 && <div className="t-fila"><span>Pendiente</span><span>{dinero(c.totales.pendiente)}</span></div>}
            {c.comensales > 1 && <div className="t-fila"><span>Por persona ({c.comensales})</span><span>{dinero(Math.ceil(Number(c.totales.pendiente) / c.comensales))}</span></div>}
            <div className="t-fila"><span>Propina sugerida 10 %</span><span>{dinero(Math.round(Number(c.totales.pendiente) * 0.1))}</span></div>
          </div>
        </Cajon>
      )}
    </Cajon>
  );
}

function EditarMesa({ mesa, alCerrar }: { mesa: Partial<MesaPlano> & { salonId: string }; alCerrar: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({ nombre: mesa.nombre ?? '', capacidad: String(mesa.capacidad ?? 4), forma: mesa.forma ?? 'cuadrada', posX: mesa.posX ?? 0, posY: mesa.posY ?? 0 });
  const listo = () => {
    void qc.invalidateQueries({ queryKey: ['plano'] });
    alCerrar();
  };
  const guardar = useMutation({
    mutationFn: () =>
      mesa.id
        ? api(`/restaurante/mesas/${mesa.id}`, { metodo: 'PATCH', cuerpo: { ...d, capacidad: Number(d.capacidad) } })
        : api('/restaurante/mesas', { metodo: 'POST', cuerpo: { ...d, capacidad: Number(d.capacidad), salonId: mesa.salonId } }),
    onSuccess: listo,
  });
  const quitar = useMutation({ mutationFn: () => api(`/restaurante/mesas/${mesa.id}`, { metodo: 'PATCH', cuerpo: { activa: false } }), onSuccess: listo });
  return (
    <Cajon titulo={mesa.id ? `Mesa ${mesa.nombre}` : 'Nueva mesa'} alCerrar={alCerrar}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }}>
        <ErrorApi error={guardar.error ?? quitar.error} />
        <div className="fila-campos">
          <Campo etiqueta="Nombre o número" id="em-n"><input id="em-n" className="entrada" autoFocus value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Lugares" id="em-c"><input id="em-c" className="entrada num" value={d.capacidad} onChange={(e) => setD({ ...d, capacidad: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Campo>
        </div>
        <Campo etiqueta="Forma" id="em-f">
          <select id="em-f" className="entrada" value={d.forma} onChange={(e) => setD({ ...d, forma: e.target.value as MesaPlano['forma'] })}>
            <option value="cuadrada">Cuadrada</option>
            <option value="redonda">Redonda</option>
            <option value="rectangular">Rectangular (ocupa dos lugares del plano)</option>
          </select>
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Columna" id="em-x"><input id="em-x" type="number" min={1} max={COLUMNAS} className="entrada num" value={d.posX + 1} onChange={(e) => setD({ ...d, posX: Math.max(0, Math.min(COLUMNAS - 1, Number(e.target.value) - 1)) })} /></Campo>
          <Campo etiqueta="Fila" id="em-y"><input id="em-y" type="number" min={1} max={24} className="entrada num" value={d.posY + 1} onChange={(e) => setD({ ...d, posY: Math.max(0, Math.min(23, Number(e.target.value) - 1)) })} /></Campo>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri" disabled={!d.nombre.trim() || guardar.isPending}>Guardar</button>
          {mesa.id && <button type="button" className="btn peligro" disabled={quitar.isPending} onClick={() => quitar.mutate()}><Trash2 size={15} /> Quitar del plano</button>}
        </div>
      </form>
    </Cajon>
  );
}

function NuevoSalon({ sucursalId, alCerrar, alCrear }: { sucursalId: string; alCerrar: () => void; alCrear: (id: string) => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const crear = useMutation({
    mutationFn: () => api<{ id: string }>('/restaurante/salones', { metodo: 'POST', cuerpo: { sucursalId, nombre } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['plano'] });
      alCrear(r.id);
    },
  });
  return (
    <Cajon titulo="Nuevo salón" alCerrar={alCerrar}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
        <ErrorApi error={crear.error} />
        <Campo etiqueta="Nombre" id="ns-n"><input id="ns-n" className="entrada" autoFocus placeholder="Salón principal, terraza, planta alta" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <button className="btn pri" disabled={!nombre.trim() || crear.isPending}><LayoutGrid size={16} /> Crear</button>
      </form>
    </Cajon>
  );
}

