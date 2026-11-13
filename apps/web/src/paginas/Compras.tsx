import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calcularItems } from '@kontiva/shared';
import { CheckCircle2, PackagePlus, Plus, Printer, Search, Send, Trash2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad as fmtCant, dinero, type CajaFila, type Deposito } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import { SelectorBanco } from './Bancos';

// ---------------------------------------------------------------------------
// Tipos y utilidades
// ---------------------------------------------------------------------------

interface Proveedor {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contacto: string | null;
  plazoPagoDias: number;
  nota: string | null;
  activo: boolean;
  saldo?: string;
}

interface ProductoCompra {
  varianteId: string;
  descripcion: string;
  sku: string | null;
  unidad: string;
  tasaIva: 0 | 5 | 10;
  costo: string | null;
}

interface LineaCompra {
  varianteId: string;
  descripcion: string;
  unidad: string;
  tasaIva: 0 | 5 | 10;
  cantidad: string;
  costo: string;
  descuento: string;
  ordenLinea?: number;
  maximo?: number;
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');
const soloNumero = (v: string) => v.replace(/[^0-9]/g, '');
const miles = (v: string) => (v === '' ? '' : Math.round(Number(v)).toLocaleString('es-PY'));

function useProveedores() {
  return useQuery({ queryKey: ['proveedores', ''], queryFn: () => api<Proveedor[]>('/proveedores') });
}
function useDepositos() {
  return useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
}

/** Editor de líneas de compra u orden: buscar productos, cantidades, costos (IVA incluido) y descuentos. */
function Lineas({ lineas, setLineas, ruta, conDescuento }: { lineas: LineaCompra[]; setLineas: (f: (l: LineaCompra[]) => LineaCompra[]) => void; ruta: string; conDescuento: boolean }) {
  const [q, setQ] = useState('');
  const [qDif, setQDif] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQDif(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const busqueda = useQuery({ queryKey: ['compra-productos', ruta, qDif], queryFn: () => api<ProductoCompra[]>(`${ruta}?q=${encodeURIComponent(qDif)}`), enabled: qDif.length > 0 });
  const agregar = (p: ProductoCompra) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.varianteId === p.varianteId && !l.ordenLinea);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: String(Number(l.cantidad) + 1) } : l));
      return [...ls, { varianteId: p.varianteId, descripcion: p.descripcion, unidad: p.unidad, tasaIva: p.tasaIva, cantidad: '1', costo: p.costo ? String(Math.round(Number(p.costo))) : '', descuento: '' }];
    });
    setQ('');
    setQDif('');
  };
  const cambiar = (i: number, c: Partial<LineaCompra>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...c } : l)));
  const calc = useMemo(() => {
    try {
      return calcularItems(lineas.map((l) => ({ cantidad: Number(l.cantidad) > 0 ? l.cantidad : '0.0001', precioUnitario: l.costo || 0, descuento: Number(l.descuento) || 0, tasaIva: l.tasaIva })));
    } catch {
      return null;
    }
  }, [lineas]);
  return (
    <>
      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--t3)' }} />
        <input className="entrada" style={{ paddingLeft: 36 }} placeholder="Agregar producto: código, SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && busqueda.data?.length === 1 && agregar(busqueda.data[0]!)} />
        {qDif && (
          <div className="menu-flotante">
            {busqueda.isLoading ? (
              <div className="tenue" style={{ padding: 10 }}>Buscando…</div>
            ) : !busqueda.data?.length ? (
              <div className="tenue" style={{ padding: 10 }}>Sin resultados</div>
            ) : (
              busqueda.data.map((p) => (
                <button key={p.varianteId} onClick={() => agregar(p)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{p.descripcion}{p.sku && <span className="tenue peq"> · {p.sku}</span>}</span>
                  {p.costo && <span className="tenue peq">costo actual {dinero(p.costo)}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {lineas.length === 0 ? (
        <Vacio titulo="Sin productos">Busque y agregue los productos.</Vacio>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th className="der" style={{ width: 90 }}>Cantidad</th>
              <th className="der" style={{ width: 130 }}>Costo unitario</th>
              {conDescuento && <th className="der" style={{ width: 110 }}>Descuento</th>}
              <th className="der">Total</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={`${l.varianteId}-${l.ordenLinea ?? i}`}>
                <td>
                  {l.descripcion}
                  <div className="tenue peq">IVA {l.tasaIva ? `${l.tasaIva} %` : 'exento'}{l.maximo !== undefined ? ` · pendiente en la orden: ${fmtCant(String(l.maximo))}` : ''}</div>
                </td>
                <td className="der">
                  <input className="entrada num" style={{ height: 32, textAlign: 'right' }} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} />
                </td>
                <td className="der">
                  <input className="entrada num" style={{ height: 32, textAlign: 'right' }} inputMode="numeric" placeholder="0" value={miles(l.costo)} onChange={(e) => cambiar(i, { costo: soloNumero(e.target.value) })} />
                </td>
                {conDescuento && (
                  <td className="der">
                    <input className="entrada num" style={{ height: 32, textAlign: 'right' }} inputMode="numeric" placeholder="0" value={miles(l.descuento)} onChange={(e) => cambiar(i, { descuento: soloNumero(e.target.value) })} />
                  </td>
                )}
                <td className="der num">{calc ? dinero(calc.lineas[i]!.total.toNumber()) : '—'}</td>
                <td>
                  <button className="btn-icono" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {calc && lineas.length > 0 && (
        <div className="totales-compra">
          {calc.gravado10.gt(0) && <div><span>Gravado 10 % (IVA {dinero(calc.iva10.toNumber())})</span><b>{dinero(calc.gravado10.toNumber())}</b></div>}
          {calc.gravado5.gt(0) && <div><span>Gravado 5 % (IVA {dinero(calc.iva5.toNumber())})</span><b>{dinero(calc.gravado5.toNumber())}</b></div>}
          {calc.exento.gt(0) && <div><span>Exento</span><b>{dinero(calc.exento.toNumber())}</b></div>}
          <div className="total"><span>Total</span><b>{dinero(calc.total.toNumber())}</b></div>
        </div>
      )}
    </>
  );
}

const lineasValidas = (ls: LineaCompra[]) => ls.length > 0 && ls.every((l) => Number(l.cantidad) > 0 && l.costo !== '' && (l.maximo === undefined || Number(l.cantidad) <= l.maximo));

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

export function Proveedores() {
  const { puede } = useSesion();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<Proveedor | 'nuevo' | null>(null);
  const lista = useQuery({ queryKey: ['proveedores', q], queryFn: () => api<Proveedor[]>(`/proveedores?q=${encodeURIComponent(q)}`), placeholderData: (p) => p });
  return (
    <>
      <Encabezado titulo="Proveedores">
        {puede('proveedor.crear') && (
          <button className="btn pri" onClick={() => setAbierto('nuevo')}><Plus size={16} /> Nuevo proveedor</button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 440 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Nombre o RUC" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.length ? (
            <Vacio titulo={q ? 'Sin resultados' : 'Todavía no hay proveedores'} />
          ) : (
            <table>
              <thead>
                <tr><th>Proveedor</th><th>RUC</th><th>Teléfono</th><th className="der">Plazo</th><th className="der">Saldo a pagar</th></tr>
              </thead>
              <tbody>
                {lista.data.map((p) => (
                  <tr key={p.id} className="clic" onClick={() => setAbierto(p)}>
                    <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                    <td className="num">{p.ruc ?? '—'}</td>
                    <td className="tenue">{p.telefono ?? '—'}</td>
                    <td className="der tenue">{p.plazoPagoDias ? `${p.plazoPagoDias} días` : 'Contado'}</td>
                    <td className="der num">{Number(p.saldo) > 0 ? dinero(p.saldo!) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {abierto && <FichaProveedor proveedor={abierto === 'nuevo' ? null : abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

function FichaProveedor({ proveedor, alCerrar }: { proveedor: Proveedor | null; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const editable = proveedor ? puede('proveedor.editar') : puede('proveedor.crear');
  const [d, setD] = useState({
    nombre: proveedor?.nombre ?? '',
    ruc: proveedor?.ruc ?? '',
    telefono: proveedor?.telefono ?? '',
    email: proveedor?.email ?? '',
    direccion: proveedor?.direccion ?? '',
    contacto: proveedor?.contacto ?? '',
    plazoPagoDias: String(proveedor?.plazoPagoDias ?? 0),
    nota: proveedor?.nota ?? '',
  });
  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = { ...d, plazoPagoDias: Number(d.plazoPagoDias) || 0 };
      return proveedor ? api(`/proveedores/${proveedor.id}`, { metodo: 'PATCH', cuerpo }) : api('/proveedores', { metodo: 'POST', cuerpo });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proveedores'] });
      alCerrar();
    },
  });
  const campo = (k: keyof typeof d, etiqueta: string, extra?: { ayuda?: string; tipo?: string }) => (
    <Campo etiqueta={etiqueta} id={`pv-${k}`} ayuda={extra?.ayuda}>
      <input id={`pv-${k}`} className="entrada" type={extra?.tipo ?? 'text'} disabled={!editable} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </Campo>
  );
  return (
    <Cajon
      titulo={proveedor ? proveedor.nombre : 'Nuevo proveedor'}
      alCerrar={alCerrar}
      pie={editable && (<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={d.nombre.trim().length < 2 || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>)}
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        {campo('nombre', 'Nombre o razón social')}
        <div className="fila-campos">
          {campo('ruc', 'RUC', { ayuda: 'Con dígito verificador: 80012345-6' })}
          {campo('plazoPagoDias', 'Plazo de pago (días)', { ayuda: '0 = contado. Sugiere el vencimiento de sus facturas.' })}
        </div>
        <div className="fila-campos">
          {campo('telefono', 'Teléfono / WhatsApp')}
          {campo('email', 'Correo', { tipo: 'email' })}
        </div>
        <div className="fila-campos">
          {campo('contacto', 'Persona de contacto')}
          {campo('direccion', 'Dirección')}
        </div>
        {campo('nota', 'Nota')}
      </div>
    </Cajon>
  );
}

// ---------------------------------------------------------------------------
// Órdenes de compra
// ---------------------------------------------------------------------------

interface Orden {
  id: string;
  numero: number;
  estado: 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'cancelada';
  proveedor: { id: string; nombre: string; ruc: string | null; telefono: string | null; email: string | null };
  deposito: { id: string; nombre: string };
  sucursal: { id: string; nombre: string };
  fechaEntrega: string | null;
  nota: string | null;
  total: string;
  creadoPor: string;
  creadoEn: string;
  aprobada: { por: string | null; en: string } | null;
  motivoCancelacion: string | null;
  items: { linea: number; varianteId: string; descripcion: string; cantidad: string; cantidadRecibida: string; pendiente: string; costoUnitario: string; tasaIva: 0 | 5 | 10; total: string }[];
}

const ESTADO_ORDEN: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: 'Borrador', clase: 'i-n' },
  enviada: { texto: 'Enviada', clase: 'i-p' },
  parcial: { texto: 'Recibida en parte', clase: 'i-warn' },
  recibida: { texto: 'Recibida', clase: 'i-ok' },
  cancelada: { texto: 'Cancelada', clase: 'i-n' },
};

export function OrdenesCompra() {
  const { puede } = useSesion();
  const [estado, setEstado] = useState('abiertas');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [editando, setEditando] = useState<Orden | 'nueva' | null>(null);
  const [recibiendo, setRecibiendo] = useState<Orden | null>(null);
  const lista = useQuery({
    queryKey: ['ordenes-compra', estado],
    queryFn: () => api<{ id: string; numero: number; estado: string; total: string; fechaEntrega: string | null; creadoEn: string; proveedor: string; sucursal: string }[]>(`/ordenes-compra?estado=${estado === 'todas' ? '' : estado}`),
  });
  return (
    <>
      <Encabezado titulo="Órdenes de compra">
        {puede('orden_compra.crear') && (
          <button className="btn pri" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva orden</button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <select className="entrada" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="abiertas">Abiertas (borrador, enviadas y en parte)</option>
              <option value="recibida">Recibidas</option>
              <option value="cancelada">Canceladas</option>
              <option value="todas">Todas</option>
            </select>
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.length ? (
            <Vacio titulo="Sin órdenes de compra">Pida mercadería a un proveedor; al llegar, recíbala desde la orden.</Vacio>
          ) : (
            <table>
              <thead>
                <tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th>Entrega</th><th className="der">Total</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {lista.data.map((o) => (
                  <tr key={o.id} className="clic" onClick={() => setAbierta(o.id)}>
                    <td className="num" style={{ fontWeight: 600 }}>{o.numero}</td>
                    <td className="tenue">{fechaHora(o.creadoEn)}</td>
                    <td>{o.proveedor}</td>
                    <td className="tenue">{fechaCorta(o.fechaEntrega)}</td>
                    <td className="der num">{dinero(o.total)}</td>
                    <td><span className={`insignia ${ESTADO_ORDEN[o.estado]?.clase}`}>{ESTADO_ORDEN[o.estado]?.texto}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {editando && <EditorOrden orden={editando === 'nueva' ? null : editando} alCerrar={(id) => { setEditando(null); if (id) setAbierta(id); }} />}
      {recibiendo && <NuevaCompra orden={recibiendo} alCerrar={() => setRecibiendo(null)} />}
      {abierta && !editando && !recibiendo && <FichaOrden id={abierta} alCerrar={() => setAbierta(null)} alEditar={setEditando} alRecibir={setRecibiendo} />}
    </>
  );
}

function EditorOrden({ orden, alCerrar }: { orden: Orden | null; alCerrar: (id?: string) => void }) {
  const qc = useQueryClient();
  const proveedores = useProveedores();
  const depositos = useDepositos();
  const [proveedorId, setProveedorId] = useState(orden?.proveedor.id ?? '');
  const [depositoId, setDepositoId] = useState(orden?.deposito.id ?? '');
  const [fechaEntrega, setFechaEntrega] = useState(orden?.fechaEntrega ?? '');
  const [nota, setNota] = useState(orden?.nota ?? '');
  const [lineas, setLineas] = useState<LineaCompra[]>(orden?.items.map((i) => ({ varianteId: i.varianteId, descripcion: i.descripcion, unidad: 'unidad', tasaIva: i.tasaIva, cantidad: String(Number(i.cantidad)), costo: String(Math.round(Number(i.costoUnitario))), descuento: '' })) ?? []);
  useEffect(() => {
    if (!depositoId && depositos.data?.[0]) setDepositoId(depositos.data[0].id);
  }, [depositos.data, depositoId]);
  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = { proveedorId, depositoId, fechaEntrega: fechaEntrega || null, nota: nota || null, items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: Number(l.cantidad), costoUnitario: Number(l.costo) })) };
      return orden ? api<Orden>(`/ordenes-compra/${orden.id}`, { metodo: 'PATCH', cuerpo }) : api<Orden>('/ordenes-compra', { metodo: 'POST', cuerpo });
    },
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ['ordenes-compra'] });
      alCerrar(o.id);
    },
  });
  return (
    <Cajon
      ancho={860}
      titulo={orden ? `Editar orden N.º ${orden.numero}` : 'Nueva orden de compra'}
      alCerrar={() => alCerrar(orden?.id)}
      pie={<><button className="btn" onClick={() => alCerrar(orden?.id)}>Cancelar</button><button className="btn pri" disabled={!proveedorId || !depositoId || !lineasValidas(lineas) || guardar.isPending} onClick={() => guardar.mutate()}>Guardar borrador</button></>}
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Proveedor" id="oc-p">
            <select id="oc-p" className="entrada" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Elija…</option>
              {proveedores.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Recibir en" id="oc-d">
            <select id="oc-d" className="entrada" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
              {depositos.data?.map((d) => <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Entrega esperada (opcional)" id="oc-f">
            <input id="oc-f" type="date" className="entrada" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
          </Campo>
          <Campo etiqueta="Nota para el proveedor" id="oc-n">
            <input id="oc-n" className="entrada" value={nota} onChange={(e) => setNota(e.target.value)} />
          </Campo>
        </div>
        <Lineas lineas={lineas} setLineas={setLineas} ruta="/ordenes-compra/productos" conDescuento={false} />
      </div>
    </Cajon>
  );
}

function FichaOrden({ id, alCerrar, alEditar, alRecibir }: { id: string; alCerrar: () => void; alEditar: (o: Orden) => void; alRecibir: (o: Orden) => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const o = useQuery({ queryKey: ['orden-compra', id], queryFn: () => api<Orden>(`/ordenes-compra/${id}`) });
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const accion = useMutation({
    mutationFn: (r: { ruta: string; cuerpo: object }) => api<Orden>(`/ordenes-compra/${id}/${r.ruta}`, { metodo: 'POST', cuerpo: r.cuerpo }),
    onSuccess: (d) => {
      qc.setQueryData(['orden-compra', id], d);
      void qc.invalidateQueries({ queryKey: ['ordenes-compra'] });
      setCancelando(false);
    },
  });
  if (!o.data) return <Cajon titulo="Orden de compra" alCerrar={alCerrar}>{o.error ? <ErrorApi error={o.error} /> : <Cargando />}</Cajon>;
  const d = o.data;
  return (
    <Cajon titulo={`Orden de compra N.º ${d.numero}`} alCerrar={alCerrar} ancho={820}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`insignia ${ESTADO_ORDEN[d.estado]?.clase}`}>{ESTADO_ORDEN[d.estado]?.texto}</span>
        {d.aprobada && <span className="tenue peq">Aprobada por {d.aprobada.por} el {fechaHora(d.aprobada.en)}</span>}
        {d.motivoCancelacion && <span className="tenue peq">· {d.motivoCancelacion}</span>}
      </div>
      <ErrorApi error={accion.error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Imprimir o PDF</button>
        {d.estado === 'borrador' && puede('orden_compra.editar') && <button className="btn" onClick={() => alEditar(d)}>Editar</button>}
        {d.estado === 'borrador' && puede('orden_compra.aprobar') && (
          <button className="btn pri" disabled={accion.isPending} onClick={() => accion.mutate({ ruta: 'enviar', cuerpo: {} })}><Send size={16} /> Aprobar y enviar</button>
        )}
        {(d.estado === 'enviada' || d.estado === 'parcial') && puede('recepcion.crear') && (
          <button className="btn pri" onClick={() => alRecibir(d)}><PackagePlus size={16} /> Recibir mercadería</button>
        )}
        {d.estado !== 'recibida' && d.estado !== 'cancelada' && puede('orden_compra.cancelar') && !cancelando && (
          <button className="btn peligro" onClick={() => setCancelando(true)}>Cancelar orden</button>
        )}
      </div>
      {cancelando && (
        <div className="form">
          <Campo etiqueta="Motivo" id="oc-m"><input id="oc-m" className="entrada" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn peligro" disabled={motivo.trim().length < 3} onClick={() => accion.mutate({ ruta: 'cancelar', cuerpo: { motivo } })}>Confirmar</button>
            <button className="btn" onClick={() => setCancelando(false)}>Volver</button>
          </div>
        </div>
      )}
      <div className="doc-a4">
        <div className="doc-cab">
          <div>
            <h1>{yo?.empresa.nombre}</h1>
            <div>{yo?.empresa.razonSocial}</div>
            {yo?.empresa.ruc && <div>RUC {yo.empresa.ruc}</div>}
          </div>
          <div className="doc-tipo">
            <b>Orden de compra</b>
            N.º {String(d.numero).padStart(6, '0')}
            <div>{fechaHora(d.creadoEn).split(',')[0]}</div>
          </div>
        </div>
        <div className="doc-datos">
          <div><span>Proveedor: </span>{d.proveedor.nombre}</div>
          <div><span>RUC: </span>{d.proveedor.ruc ?? '—'}</div>
          <div><span>Entregar en: </span>{d.sucursal.nombre} · {d.deposito.nombre}</div>
          <div><span>Entrega esperada: </span>{fechaCorta(d.fechaEntrega)}</div>
        </div>
        <table>
          <thead>
            <tr><th>Cant.</th><th>Descripción</th><th className="der">Costo unit.</th><th className="der">Total</th>{d.estado !== 'borrador' && <th className="der">Recibido</th>}</tr>
          </thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.linea}>
                <td>{fmtCant(i.cantidad)}</td>
                <td>{i.descripcion}</td>
                <td className="der">{dinero(i.costoUnitario)}</td>
                <td className="der">{dinero(i.total)}</td>
                {d.estado !== 'borrador' && <td className="der">{fmtCant(i.cantidadRecibida)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="doc-totales"><div className="total"><span>Total</span><span>{dinero(d.total)}</span></div><div className="tenue peq"><span>Costos con IVA incluido</span></div></div>
        {d.nota && <p style={{ marginTop: 18 }}>{d.nota}</p>}
        <div className="doc-pie"><span>Emitida por {d.creadoPor}</span><span>KONTIVA ERP · Desarrollado por Araújo Tech Sistemas</span></div>
      </div>
    </Cajon>
  );
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

interface Compra {
  id: string;
  numero: number;
  estado: 'confirmada' | 'anulada';
  proveedor: { id: string; nombre: string; ruc: string | null };
  orden: { id: string; numero: number } | null;
  deposito: { id: string; nombre: string };
  sucursal: { id: string; nombre: string };
  documento: { tipo: string; timbrado: string | null; numero: string | null; cdc: string | null; fecha: string };
  condicion: 'contado' | 'credito';
  vencimiento: string | null;
  subtotal: string | null;
  descuento: string | null;
  total: string | null;
  gravado10: string | null;
  gravado5: string | null;
  exento: string | null;
  iva10: string | null;
  iva5: string | null;
  cuenta: { id: string; saldo: string | null; estado: string; vencimiento: string } | null;
  nota: string | null;
  creadoPor: string;
  creadoEn: string;
  anulacion: { por: string | null; en: string; motivo: string | null } | null;
  items: { linea: number; descripcion: string; cantidad: string; costoUnitario: string | null; descuento: string | null; tasaIva: number; total: string | null }[];
}

const TIPO_DOC: Record<string, string> = { factura: 'Factura', factura_electronica: 'Factura electrónica', remision: 'Nota de remisión', otro: 'Otro' };

export function Compras() {
  const { puede } = useSesion();
  const [q, setQ] = useState('');
  const [nueva, setNueva] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['compras', q],
    queryFn: () => api<{ id: string; numero: number; estado: string; total: string | null; condicion: string; documento: { tipo: string; numero: string | null; fecha: string }; proveedor: string; sucursal: string }[]>(`/compras?q=${encodeURIComponent(q)}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <Encabezado titulo="Compras">
        {puede('recepcion.crear') && <button className="btn pri" onClick={() => setNueva(true)}><Plus size={16} /> Cargar compra</button>}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <input className="entrada" style={{ flex: '1 1 260px', maxWidth: 400 }} placeholder="Proveedor o número de factura" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.length ? (
            <Vacio titulo={q ? 'Sin resultados' : 'Todavía no hay compras'}>Cargue la factura del proveedor: suma el stock, actualiza el costo y genera la cuenta a pagar.</Vacio>
          ) : (
            <table>
              <thead>
                <tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Condición</th><th className="der">Total</th></tr>
              </thead>
              <tbody>
                {lista.data.map((c) => (
                  <tr key={c.id} className="clic" onClick={() => setAbierta(c.id)} style={c.estado === 'anulada' ? { opacity: 0.55 } : undefined}>
                    <td className="num" style={{ fontWeight: 600 }}>{c.numero}</td>
                    <td className="tenue">{fechaCorta(c.documento.fecha)}</td>
                    <td>{c.proveedor}</td>
                    <td>{TIPO_DOC[c.documento.tipo]} {c.documento.numero ?? ''}{c.estado === 'anulada' && <span className="insignia i-n" style={{ marginLeft: 6 }}>Anulada</span>}</td>
                    <td className="tenue">{c.condicion === 'credito' ? 'Crédito' : 'Contado'}</td>
                    <td className="der num">{c.total ? dinero(c.total) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {nueva && <NuevaCompra alCerrar={(id) => { setNueva(false); if (id) setAbierta(id); }} />}
      {abierta && !nueva && <FichaCompra id={abierta} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function NuevaCompra({ orden, alCerrar }: { orden?: Orden; alCerrar: (id?: string) => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const proveedores = useProveedores();
  const depositos = useDepositos();
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas'), enabled: puede('caja.ver') });
  const propias = cajas.data?.filter((c) => c.sesion?.propia) ?? [];
  const [proveedorId, setProveedorId] = useState(orden?.proveedor.id ?? '');
  const [depositoId, setDepositoId] = useState(orden?.deposito.id ?? '');
  const [doc, setDoc] = useState({ tipo: 'factura', timbrado: '', numero: '', cdc: '', fecha: hoy() });
  const [condicion, setCondicion] = useState<'contado' | 'credito'>('credito');
  const [vencimiento, setVencimiento] = useState('');
  const [pago, setPago] = useState<{ registrar: boolean; medio: string; cajaId: string; cuentaBancariaId: string; referencia: string }>({ registrar: false, medio: 'transferencia', cajaId: '', cuentaBancariaId: '', referencia: '' });
  const [nota, setNota] = useState('');
  const [lineas, setLineas] = useState<LineaCompra[]>(
    orden?.items
      .filter((i) => Number(i.pendiente) > 0)
      .map((i) => ({ varianteId: i.varianteId, descripcion: i.descripcion, unidad: 'unidad', tasaIva: i.tasaIva, cantidad: String(Number(i.pendiente)), costo: String(Math.round(Number(i.costoUnitario))), descuento: '', ordenLinea: i.linea, maximo: Number(i.pendiente) })) ?? [],
  );
  useEffect(() => {
    if (!depositoId && depositos.data?.[0]) setDepositoId(depositos.data[0].id);
  }, [depositos.data, depositoId]);
  const prov = proveedores.data?.find((p) => p.id === proveedorId);
  useEffect(() => {
    if (prov && condicion === 'credito' && !vencimiento) {
      const d = new Date(`${doc.fecha}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + (prov.plazoPagoDias || 30));
      setVencimiento(d.toISOString().slice(0, 10));
    }
  }, [prov, condicion, doc.fecha, vencimiento]);
  const guardar = useMutation({
    mutationFn: () =>
      api<Compra>('/compras', {
        metodo: 'POST',
        cuerpo: {
          proveedorId,
          depositoId,
          ordenId: orden?.id ?? null,
          documentoTipo: doc.tipo,
          timbrado: doc.timbrado || null,
          documentoNumero: doc.numero || null,
          cdc: doc.cdc || null,
          fechaDocumento: doc.fecha,
          condicion,
          vencimiento: condicion === 'credito' ? vencimiento || null : null,
          pago: condicion === 'contado' && pago.registrar ? { medio: pago.medio, cajaId: pago.medio === 'efectivo' ? pago.cajaId || propias[0]?.id || null : null, cuentaBancariaId: pago.medio !== 'efectivo' && pago.cuentaBancariaId ? pago.cuentaBancariaId : null, referencia: pago.referencia || null } : null,
          nota: nota || null,
          items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: Number(l.cantidad), costoUnitario: Number(l.costo), ...(Number(l.descuento) > 0 && { descuento: Number(l.descuento) }), ...(l.ordenLinea && { ordenLinea: l.ordenLinea }) })),
        },
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['compras'] });
      void qc.invalidateQueries({ queryKey: ['ordenes-compra'] });
      void qc.invalidateQueries({ queryKey: ['orden-compra'] });
      void qc.invalidateQueries({ queryKey: ['cuentas-pagar'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      alCerrar(c.id);
    },
  });
  const docValido =
    (doc.tipo === 'factura' && /^[0-9]{8}$/.test(doc.timbrado) && /^[0-9]{3}-[0-9]{3}-[0-9]{7}$/.test(doc.numero)) ||
    (doc.tipo === 'factura_electronica' && /^[0-9]{44}$/.test(doc.cdc) && /^[0-9]{3}-[0-9]{3}-[0-9]{7}$/.test(doc.numero)) ||
    doc.tipo === 'remision' ||
    doc.tipo === 'otro';
  const pagoValido = !(condicion === 'contado' && pago.registrar && pago.medio === 'efectivo' && !propias.length);
  return (
    <Cajon
      ancho={900}
      titulo={orden ? `Recibir la orden N.º ${orden.numero}` : 'Cargar compra'}
      alCerrar={() => alCerrar()}
      pie={<><button className="btn" onClick={() => alCerrar()}>Cancelar</button><button className="btn pri" disabled={!proveedorId || !depositoId || !docValido || !lineasValidas(lineas) || !pagoValido || guardar.isPending} onClick={() => guardar.mutate()}>Confirmar compra</button></>}
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Proveedor" id="co-p">
            <select id="co-p" className="entrada" disabled={!!orden} value={proveedorId} onChange={(e) => { setProveedorId(e.target.value); setVencimiento(''); }}>
              <option value="">Elija…</option>
              {proveedores.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Ingresa al depósito" id="co-d">
            <select id="co-d" className="entrada" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
              {depositos.data?.map((d) => <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Documento del proveedor" id="co-t">
            <select id="co-t" className="entrada" value={doc.tipo} onChange={(e) => setDoc({ ...doc, tipo: e.target.value })}>
              <option value="factura">Factura (preimpresa / autoimpresor)</option>
              <option value="factura_electronica">Factura electrónica</option>
              <option value="remision">Nota de remisión (la factura llega después)</option>
              <option value="otro">Otro</option>
            </select>
          </Campo>
          <Campo etiqueta="Fecha del documento" id="co-f">
            <input id="co-f" type="date" className="entrada" value={doc.fecha} onChange={(e) => setDoc({ ...doc, fecha: e.target.value })} />
          </Campo>
        </div>
        {(doc.tipo === 'factura' || doc.tipo === 'factura_electronica') && (
          <div className="fila-campos">
            {doc.tipo === 'factura' ? (
              <Campo etiqueta="Timbrado" id="co-tim">
                <input id="co-tim" className="entrada num" maxLength={8} placeholder="8 dígitos" value={doc.timbrado} onChange={(e) => setDoc({ ...doc, timbrado: soloNumero(e.target.value) })} />
              </Campo>
            ) : (
              <Campo etiqueta="CDC (44 dígitos)" id="co-cdc">
                <input id="co-cdc" className="entrada num" maxLength={44} value={doc.cdc} onChange={(e) => setDoc({ ...doc, cdc: soloNumero(e.target.value) })} />
              </Campo>
            )}
            <Campo etiqueta="Número de factura" id="co-num">
              <input id="co-num" className="entrada num" placeholder="001-001-0000001" value={doc.numero} onChange={(e) => setDoc({ ...doc, numero: e.target.value.replace(/[^0-9-]/g, '') })} />
            </Campo>
          </div>
        )}
        <div className="fila-campos">
          <Campo etiqueta="Condición" id="co-c">
            <select id="co-c" className="entrada" value={condicion} onChange={(e) => setCondicion(e.target.value as 'contado' | 'credito')}>
              <option value="credito">Crédito</option>
              <option value="contado">Contado</option>
            </select>
          </Campo>
          {condicion === 'credito' ? (
            <Campo etiqueta="Vencimiento" id="co-v" ayuda={prov ? `Plazo del proveedor: ${prov.plazoPagoDias || 30} días` : undefined}>
              <input id="co-v" type="date" className="entrada" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
            </Campo>
          ) : (
            <Campo etiqueta="Pago" id="co-pg">
              {puede('cuenta_pagar.aprobar') ? (
                <label className="casilla" style={{ height: 40 }}>
                  <input type="checkbox" checked={pago.registrar} onChange={(e) => setPago({ ...pago, registrar: e.target.checked })} />
                  Ya se pagó: registrar el pago ahora
                </label>
              ) : (
                <div className="tenue peq" style={{ paddingTop: 10 }}>Queda como cuenta a pagar para Finanzas.</div>
              )}
            </Campo>
          )}
        </div>
        {condicion === 'contado' && pago.registrar && (
          <div className="fila-campos">
            <Campo etiqueta="Medio de pago" id="co-m">
              <select id="co-m" className="entrada" value={pago.medio} onChange={(e) => setPago({ ...pago, medio: e.target.value })}>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo{propias[0] ? ` (sale de ${propias[0].nombre})` : ''}</option>
                <option value="cheque">Cheque</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
            <Campo etiqueta="Referencia (opcional)" id="co-r">
              <input id="co-r" className="entrada" placeholder="N.º de transferencia o cheque" value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
            </Campo>
            {pago.medio !== 'efectivo' && <SelectorBanco id="co-b" valor={pago.cuentaBancariaId} alCambiar={(v) => setPago({ ...pago, cuentaBancariaId: v })} />}
          </div>
        )}
        {!pagoValido && <Aviso tipo="error">Para pagar en efectivo abra su caja en "Cajas y PDV".</Aviso>}
        <Lineas lineas={lineas} setLineas={setLineas} ruta="/compras/productos" conDescuento />
        <Campo etiqueta="Nota (opcional)" id="co-n">
          <input id="co-n" className="entrada" value={nota} onChange={(e) => setNota(e.target.value)} />
        </Campo>
        <p className="tenue peq" style={{ margin: 0 }}>Costos con IVA incluido, como figuran en la factura. Al confirmar: el stock entra al depósito, el costo de cada producto pasa a ser el promedio ponderado y se genera la cuenta a pagar.</p>
      </div>
    </Cajon>
  );
}

function FichaCompra({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['compra', id], queryFn: () => api<Compra>(`/compras/${id}`) });
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api<Compra>(`/compras/${id}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    onSuccess: (d) => {
      qc.setQueryData(['compra', id], d);
      void qc.invalidateQueries({ queryKey: ['compras'] });
      void qc.invalidateQueries({ queryKey: ['cuentas-pagar'] });
      setAnulando(false);
    },
  });
  if (!c.data) return <Cajon titulo="Compra" alCerrar={alCerrar}>{c.error ? <ErrorApi error={c.error} /> : <Cargando />}</Cajon>;
  const d = c.data;
  return (
    <Cajon titulo={`Compra N.º ${d.numero}`} alCerrar={alCerrar} ancho={760}>
      {d.anulacion && <Aviso tipo="error">Anulada el {fechaHora(d.anulacion.en)} por {d.anulacion.por}: {d.anulacion.motivo}</Aviso>}
      <dl className="datos">
        <dt>Proveedor</dt><dd>{d.proveedor.nombre}{d.proveedor.ruc ? ` · RUC ${d.proveedor.ruc}` : ''}</dd>
        <dt>Documento</dt><dd>{TIPO_DOC[d.documento.tipo]} {d.documento.numero ?? ''}{d.documento.timbrado ? ` · timbrado ${d.documento.timbrado}` : ''}</dd>
        {d.documento.cdc && (<><dt>CDC</dt><dd className="num" style={{ wordBreak: 'break-all' }}>{d.documento.cdc}</dd></>)}
        <dt>Fecha</dt><dd>{fechaCorta(d.documento.fecha)}</dd>
        <dt>Depósito</dt><dd>{d.sucursal.nombre} · {d.deposito.nombre}</dd>
        {d.orden && (<><dt>Orden de compra</dt><dd>N.º {d.orden.numero}</dd></>)}
        <dt>Condición</dt><dd>{d.condicion === 'credito' ? `Crédito · vence ${fechaCorta(d.vencimiento)}` : 'Contado'}</dd>
        {d.cuenta && d.cuenta.saldo !== null && (<><dt>Cuenta a pagar</dt><dd>{d.cuenta.estado === 'pagada' ? 'Pagada' : d.cuenta.estado === 'anulada' ? 'Anulada' : `Saldo ${dinero(d.cuenta.saldo)}`}</dd></>)}
        <dt>Cargada por</dt><dd>{d.creadoPor} · {fechaHora(d.creadoEn)}</dd>
      </dl>
      <table>
        <thead><tr><th>Producto</th><th className="der">Cantidad</th><th className="der">Costo</th><th className="der">Total</th></tr></thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.linea}>
              <td>{i.descripcion}</td>
              <td className="der num">{fmtCant(i.cantidad)}</td>
              <td className="der num">{i.costoUnitario ? dinero(i.costoUnitario) : '—'}</td>
              <td className="der num">{i.total ? dinero(i.total) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.total && (
        <div className="totales-compra">
          {Number(d.gravado10) > 0 && <div><span>Gravado 10 % (IVA {dinero(d.iva10!)})</span><b>{dinero(d.gravado10!)}</b></div>}
          {Number(d.gravado5) > 0 && <div><span>Gravado 5 % (IVA {dinero(d.iva5!)})</span><b>{dinero(d.gravado5!)}</b></div>}
          {Number(d.exento) > 0 && <div><span>Exento</span><b>{dinero(d.exento!)}</b></div>}
          <div className="total"><span>Total</span><b>{dinero(d.total)}</b></div>
        </div>
      )}
      <ErrorApi error={anular.error} />
      {d.estado === 'confirmada' && puede('recepcion.cancelar') && !anulando && (
        <div><button className="btn peligro" onClick={() => setAnulando(true)}>Anular compra</button></div>
      )}
      {anulando && (
        <div className="form">
          <Campo etiqueta="Motivo" id="ca-m" ayuda="El stock sale del depósito. Si tiene pagos, anúlelos primero en Cuentas a pagar."><input id="ca-m" className="entrada" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn peligro" disabled={motivo.trim().length < 3 || anular.isPending} onClick={() => anular.mutate()}>Confirmar anulación</button>
            <button className="btn" onClick={() => setAnulando(false)}>Volver</button>
          </div>
        </div>
      )}
    </Cajon>
  );
}

// ---------------------------------------------------------------------------
// Cuentas a pagar
// ---------------------------------------------------------------------------

interface CuentaPagar {
  id: string;
  descripcion: string;
  fecha: string;
  vencimiento: string;
  vencida: boolean;
  monto: string;
  saldo: string;
  estado: 'pendiente' | 'parcial' | 'pagada' | 'anulada';
  compra: { id: string; numero: number } | null;
  proveedor: { id: string; nombre: string };
}

const ESTADO_CUENTA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'i-warn' },
  parcial: { texto: 'Pago parcial', clase: 'i-p' },
  pagada: { texto: 'Pagada', clase: 'i-ok' },
  anulada: { texto: 'Anulada', clase: 'i-n' },
};
const MEDIOS: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', tarjeta: 'Tarjeta', otro: 'Otro' };

export function CuentasPagar() {
  const { puede } = useSesion();
  const [pestana, setPestana] = useState<'cuentas' | 'pagos'>('cuentas');
  const [estado, setEstado] = useState('abiertas');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pagando, setPagando] = useState<CuentaPagar[] | null>(null);
  const [nueva, setNueva] = useState(false);
  const resumen = useQuery({ queryKey: ['cuentas-pagar', 'resumen'], queryFn: () => api<{ abierto: string; vencido: string; proximos7Dias: string; cuentas: number }>('/cuentas-pagar/resumen') });
  const lista = useQuery({ queryKey: ['cuentas-pagar', estado], queryFn: () => api<CuentaPagar[]>(`/cuentas-pagar?estado=${estado}`) });
  const seleccionadas = lista.data?.filter((c) => sel.has(c.id)) ?? [];
  const mismoProveedor = new Set(seleccionadas.map((c) => c.proveedor.id)).size === 1;
  const alternar = (c: CuentaPagar) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(c.id)) n.delete(c.id);
      else n.add(c.id);
      return n;
    });
  return (
    <>
      <Encabezado titulo="Cuentas a pagar">
        {puede('cuenta_pagar.crear') && <button className="btn" onClick={() => setNueva(true)}><Plus size={16} /> Cuenta manual</button>}
      </Encabezado>
      <div className="contenido">
        {resumen.data && (
          <section className="panel cifras" style={{ marginBottom: 16 }}>
            <div className="cifra"><span>A pagar</span><b className="num">{dinero(resumen.data.abierto)}</b></div>
            <div className="cifra"><span>Vencido</span><b className="num" style={Number(resumen.data.vencido) > 0 ? { color: 'var(--bad)' } : undefined}>{dinero(resumen.data.vencido)}</b></div>
            <div className="cifra"><span>Vence en 7 días</span><b className="num">{dinero(resumen.data.proximos7Dias)}</b></div>
          </section>
        )}
        <div className="pestanas">
          <button className={pestana === 'cuentas' ? 'activa' : ''} onClick={() => setPestana('cuentas')}>Cuentas</button>
          <button className={pestana === 'pagos' ? 'activa' : ''} onClick={() => setPestana('pagos')}>Pagos realizados</button>
        </div>
        {pestana === 'pagos' ? (
          <Pagos />
        ) : (
          <section className="panel">
            <div className="filtros" style={{ paddingTop: 16 }}>
              <select className="entrada" value={estado} onChange={(e) => { setEstado(e.target.value); setSel(new Set()); }}>
                <option value="abiertas">A pagar</option>
                <option value="vencidas">Vencidas</option>
                <option value="pagadas">Pagadas</option>
                <option value="todas">Todas</option>
              </select>
              {puede('cuenta_pagar.aprobar') && seleccionadas.length > 0 && (
                <button className="btn pri" style={{ marginLeft: 'auto' }} disabled={!mismoProveedor} title={mismoProveedor ? undefined : 'Elija cuentas de un solo proveedor'} onClick={() => setPagando(seleccionadas)}>
                  <Wallet size={16} /> Pagar {seleccionadas.length} {seleccionadas.length === 1 ? 'cuenta' : 'cuentas'}
                </button>
              )}
            </div>
            {seleccionadas.length > 0 && !mismoProveedor && <div style={{ padding: '0 20px 12px' }}><Aviso tipo="info">Un pago se aplica a cuentas de un mismo proveedor.</Aviso></div>}
            {lista.isLoading ? (
              <Cargando />
            ) : !lista.data?.length ? (
              <Vacio titulo={estado === 'abiertas' ? 'No hay cuentas a pagar' : 'Sin resultados'} />
            ) : (
              <table>
                <thead>
                  <tr>{puede('cuenta_pagar.aprobar') && <th style={{ width: 36 }} />}<th>Proveedor</th><th>Concepto</th><th>Vencimiento</th><th className="der">Monto</th><th className="der">Saldo</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {lista.data.map((c) => {
                    const abierta = c.estado === 'pendiente' || c.estado === 'parcial';
                    return (
                      <tr key={c.id} className={abierta && puede('cuenta_pagar.aprobar') ? 'clic' : undefined} onClick={() => abierta && puede('cuenta_pagar.aprobar') && alternar(c)}>
                        {puede('cuenta_pagar.aprobar') && <td>{abierta && <input type="checkbox" checked={sel.has(c.id)} onChange={() => alternar(c)} onClick={(e) => e.stopPropagation()} />}</td>}
                        <td style={{ fontWeight: 600 }}>{c.proveedor.nombre}</td>
                        <td>{c.descripcion}{c.compra && <span className="tenue peq"> · compra N.º {c.compra.numero}</span>}</td>
                        <td style={c.vencida ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{fechaCorta(c.vencimiento)}{c.vencida && ' · vencida'}</td>
                        <td className="der num tenue">{dinero(c.monto)}</td>
                        <td className="der num" style={{ fontWeight: 600 }}>{abierta ? dinero(c.saldo) : '—'}</td>
                        <td><span className={`insignia ${ESTADO_CUENTA[c.estado]?.clase}`}>{ESTADO_CUENTA[c.estado]?.texto}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
      {pagando && <PagarCuentas cuentas={pagando} alCerrar={(ok) => { setPagando(null); if (ok) setSel(new Set()); }} />}
      {nueva && <NuevaCuenta alCerrar={() => setNueva(false)} />}
    </>
  );
}

function PagarCuentas({ cuentas, alCerrar }: { cuentas: CuentaPagar[]; alCerrar: (ok: boolean) => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas'), enabled: puede('caja.ver') });
  const propias = cajas.data?.filter((c) => c.sesion?.propia) ?? [];
  const [montos, setMontos] = useState<Record<string, string>>(Object.fromEntries(cuentas.map((c) => [c.id, String(Math.round(Number(c.saldo)))])));
  const [medio, setMedio] = useState('transferencia');
  const [banco, setBanco] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [referencia, setReferencia] = useState('');
  const total = Object.values(montos).reduce((a, v) => a + (Number(v) || 0), 0);
  const pagar = useMutation({
    mutationFn: () =>
      api('/pagos-proveedor', {
        metodo: 'POST',
        cuerpo: { proveedorId: cuentas[0]!.proveedor.id, fecha, medio, cajaId: medio === 'efectivo' ? propias[0]?.id ?? null : null, cuentaBancariaId: medio !== 'efectivo' && banco ? banco : null, referencia: referencia || null, aplicaciones: cuentas.filter((c) => Number(montos[c.id]) > 0).map((c) => ({ cuentaId: c.id, monto: Number(montos[c.id]) })) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cuentas-pagar'] });
      void qc.invalidateQueries({ queryKey: ['pagos-proveedor'] });
      void qc.invalidateQueries({ queryKey: ['proveedores'] });
      alCerrar(true);
    },
  });
  const excede = cuentas.some((c) => Number(montos[c.id]) > Number(c.saldo));
  return (
    <Cajon
      titulo={`Pago a ${cuentas[0]!.proveedor.nombre}`}
      alCerrar={() => alCerrar(false)}
      pie={<><span className="tenue" style={{ marginRight: 'auto' }}>Total <b style={{ color: 'var(--t1)', fontSize: 16 }}>{dinero(total)}</b></span><button className="btn" onClick={() => alCerrar(false)}>Cancelar</button><button className="btn pri" disabled={total <= 0 || excede || (medio === 'efectivo' && !propias.length) || pagar.isPending} onClick={() => pagar.mutate()}><CheckCircle2 size={16} /> Registrar pago</button></>}
    >
      <ErrorApi error={pagar.error} />
      <div className="form">
        <table>
          <thead><tr><th>Cuenta</th><th className="der">Saldo</th><th className="der" style={{ width: 150 }}>Paga</th></tr></thead>
          <tbody>
            {cuentas.map((c) => (
              <tr key={c.id}>
                <td>{c.descripcion}<div className="tenue peq">vence {fechaCorta(c.vencimiento)}</div></td>
                <td className="der num">{dinero(c.saldo)}</td>
                <td className="der"><input className="entrada num" style={{ height: 32, textAlign: 'right' }} value={miles(montos[c.id] ?? '')} onChange={(e) => setMontos({ ...montos, [c.id]: soloNumero(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {excede && <Aviso tipo="error">Un monto supera el saldo de su cuenta.</Aviso>}
        <div className="fila-campos">
          <Campo etiqueta="Medio" id="pg-m">
            <select id="pg-m" className="entrada" value={medio} onChange={(e) => setMedio(e.target.value)}>
              {Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}{k === 'efectivo' && propias[0] ? ` (sale de ${propias[0].nombre})` : ''}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Fecha" id="pg-f"><input id="pg-f" type="date" className="entrada" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        </div>
        {medio === 'efectivo' && !propias.length && <Aviso tipo="info">El efectivo sale de una caja abierta: abra su caja en "Cajas y PDV".</Aviso>}
        {medio !== 'efectivo' && <SelectorBanco id="pg-b" valor={banco} alCambiar={setBanco} />}
        <Campo etiqueta="Referencia (opcional)" id="pg-r"><input id="pg-r" className="entrada" placeholder="N.º de transferencia o cheque" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Campo>
      </div>
    </Cajon>
  );
}

function Pagos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['pagos-proveedor'], queryFn: () => api<{ id: string; numero: number; fecha: string; medio: string; monto: string; referencia: string | null; estado: string; desdeCaja: boolean; proveedor: string; usuario: string }[]>('/pagos-proveedor') });
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api(`/pagos-proveedor/${anulando}/anular`, { metodo: 'POST', cuerpo: { motivo } }),
    onSuccess: () => {
      setAnulando(null);
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['pagos-proveedor'] });
      void qc.invalidateQueries({ queryKey: ['cuentas-pagar'] });
    },
  });
  return (
    <section className="panel">
      <ErrorApi error={anular.error} />
      {lista.isLoading ? (
        <Cargando />
      ) : !lista.data?.length ? (
        <Vacio titulo="Todavía no hay pagos" />
      ) : (
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th>Medio</th><th className="der">Monto</th><th>Registró</th><th /></tr></thead>
          <tbody>
            {lista.data.map((g) => (
              <tr key={g.id} style={g.estado === 'anulado' ? { opacity: 0.55 } : undefined}>
                <td className="num">{g.numero}</td>
                <td className="tenue">{fechaCorta(g.fecha)}</td>
                <td>{g.proveedor}</td>
                <td>{MEDIOS[g.medio]}{g.desdeCaja ? ' · caja' : ''}{g.referencia ? <span className="tenue peq"> · {g.referencia}</span> : ''}</td>
                <td className="der num">{dinero(g.monto)}</td>
                <td className="tenue">{g.usuario}</td>
                <td className="der">
                  {g.estado === 'anulado' ? (
                    <span className="insignia i-n">Anulado</span>
                  ) : (
                    puede('cuenta_pagar.cancelar') &&
                    (anulando === g.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input className="entrada" style={{ height: 30, width: 180 }} autoFocus placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                        <button className="btn peligro" style={{ height: 30 }} disabled={motivo.trim().length < 3 || anular.isPending} onClick={() => anular.mutate()}>Anular</button>
                      </span>
                    ) : (
                      <button className="btn" style={{ height: 30 }} onClick={() => { setAnulando(g.id); setMotivo(''); }}>Anular</button>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NuevaCuenta({ alCerrar }: { alCerrar: () => void }) {
  const qc = useQueryClient();
  const proveedores = useProveedores();
  const [d, setD] = useState({ proveedorId: '', descripcion: '', fecha: hoy(), vencimiento: hoy(), monto: '' });
  const guardar = useMutation({
    mutationFn: () => api('/cuentas-pagar', { metodo: 'POST', cuerpo: { ...d, monto: Number(d.monto) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cuentas-pagar'] });
      alCerrar();
    },
  });
  return (
    <Cajon
      titulo="Cuenta a pagar manual"
      alCerrar={alCerrar}
      pie={<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={!d.proveedorId || d.descripcion.trim().length < 3 || !(Number(d.monto) > 0) || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>}
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        <p className="tenue" style={{ margin: 0 }}>Para gastos sin mercadería: alquiler, fletes, servicios, honorarios.</p>
        <Campo etiqueta="Proveedor" id="cm-p">
          <select id="cm-p" className="entrada" value={d.proveedorId} onChange={(e) => setD({ ...d, proveedorId: e.target.value })}>
            <option value="">Elija…</option>
            {proveedores.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Concepto" id="cm-c"><input id="cm-c" className="entrada" value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} /></Campo>
        <div className="fila-campos">
          <Campo etiqueta="Fecha" id="cm-f"><input id="cm-f" type="date" className="entrada" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Vencimiento" id="cm-v"><input id="cm-v" type="date" className="entrada" value={d.vencimiento} onChange={(e) => setD({ ...d, vencimiento: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Monto (Gs.)" id="cm-m"><input id="cm-m" className="entrada num" value={miles(d.monto)} onChange={(e) => setD({ ...d, monto: soloNumero(e.target.value) })} /></Campo>
      </div>
    </Cajon>
  );
}
