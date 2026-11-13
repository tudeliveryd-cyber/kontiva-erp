import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, MessageCircle, Pencil, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { calcularItems } from '@kontiva/shared';
import { DialogoAutorizacion } from '../componentes/Autorizacion';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad as fmtCant, dinero, type Cliente } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export type TipoDoc = 'presupuesto' | 'pedido';

export interface DocComercial {
  id: string;
  tipo: TipoDoc;
  numero: number;
  estado: string;
  vencido: boolean;
  sucursal: { id: string; nombre: string };
  cliente: { id: string | null; nombre: string; documento: string | null; telefono: string | null; email: string | null; direccion: string | null } | null;
  lista: { id: string; nombre: string } | null;
  validoHasta: string | null;
  entregaPrevista: string | null;
  nota: string | null;
  subtotal: string;
  descuento: string;
  total: string;
  vendedor: string;
  creadoEn: string;
  cierre: { en: string; por: string | null; motivo: string | null } | null;
  origen: { id: string; numero: number } | null;
  pedidoGenerado: { id: string; numero: number } | null;
  venta: { id: string; numero: number } | null;
  items: { linea: number; varianteId: string; descripcion: string; sku: string | null; unidad: string; cantidad: string; precioUnitario: string; descuento: string; total: string; tasaIva: 0 | 5 | 10 }[];
}

interface FilaListado {
  id: string;
  numero: number;
  estado: string;
  vencido: boolean;
  total: string;
  cliente: string | null;
  sucursal: string;
  vendedor: string;
  validoHasta: string | null;
  entregaPrevista: string | null;
  items: number;
  creadoEn: string;
}

interface ProductoBuscado {
  varianteId: string;
  descripcion: string;
  sku: string | null;
  unidad: string;
  tasaIva: 0 | 5 | 10;
  precio: string;
  stock: string | null;
}

const CONF = {
  presupuesto: { titulo: 'Presupuestos', uno: 'Presupuesto', ruta: '/presupuestos', permiso: 'presupuesto' },
  pedido: { titulo: 'Pedidos', uno: 'Pedido', ruta: '/pedidos', permiso: 'pedido' },
} as const;

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  vigente: { texto: 'Vigente', clase: 'i-p' },
  aceptado: { texto: 'Aceptado', clase: 'i-ok' },
  rechazado: { texto: 'Rechazado', clase: 'i-n' },
  anulado: { texto: 'Anulado', clase: 'i-n' },
  pendiente: { texto: 'Pendiente', clase: 'i-warn' },
  preparado: { texto: 'Preparado', clase: 'i-p' },
  entregado: { texto: 'Entregado', clase: 'i-ok' },
  cancelado: { texto: 'Cancelado', clase: 'i-n' },
};

/** "2026-11-20" → "20/11/2026" sin pasar por la zona horaria. */
export const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');

function Estado({ d }: { d: { estado: string; vencido: boolean } }) {
  if (d.vencido) return <span className="insignia i-bad">Vencido</span>;
  const e = ESTADOS[d.estado] ?? { texto: d.estado, clase: 'i-n' };
  return <span className={`insignia ${e.clase}`}>{e.texto}</span>;
}

export function Presupuestos() {
  return <Documentos tipo="presupuesto" />;
}
export function Pedidos() {
  return <Documentos tipo="pedido" />;
}

function Documentos({ tipo }: { tipo: TipoDoc }) {
  const { puede } = useSesion();
  const conf = CONF[tipo];
  const [estado, setEstado] = useState('abiertos');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | 'nuevo' | null>(null);
  const [editando, setEditando] = useState<DocComercial | null>(null);
  const lista = useQuery({
    queryKey: [tipo, 'lista', estado, q],
    queryFn: () => api<FilaListado[]>(`${conf.ruta}?estado=${estado === 'todos' ? '' : estado}&q=${encodeURIComponent(q)}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <Encabezado titulo={conf.titulo}>
        {puede(`${conf.permiso}.crear`) && (
          <button className="btn pri" onClick={() => setAbierto('nuevo')}>
            <Plus size={16} /> {tipo === 'presupuesto' ? 'Nuevo presupuesto' : 'Nuevo pedido'}
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 400 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Cliente o número" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="entrada" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="abiertos">{tipo === 'presupuesto' ? 'Vigentes' : 'Pendientes y preparados'}</option>
              {tipo === 'presupuesto' ? (
                <>
                  <option value="aceptado">Aceptados</option>
                  <option value="rechazado">Rechazados</option>
                  <option value="anulado">Anulados</option>
                </>
              ) : (
                <>
                  <option value="entregado">Entregados</option>
                  <option value="cancelado">Cancelados</option>
                </>
              )}
              <option value="todos">Todos</option>
            </select>
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.length ? (
            <Vacio titulo={q ? 'Sin resultados' : tipo === 'presupuesto' ? 'Sin presupuestos' : 'Sin pedidos'}>
              {!q && (tipo === 'presupuesto' ? 'Cotice productos a un cliente; si acepta, se convierte en pedido.' : 'Registre lo que el cliente encargó y cóbrelo en la caja al entregar.')}
            </Vacio>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>{tipo === 'presupuesto' ? 'Válido hasta' : 'Entrega'}</th>
                  <th>Vendedor</th>
                  <th className="der">Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.data.map((r) => (
                  <tr key={r.id} className="clic" onClick={() => setAbierto(r.id)}>
                    <td className="num" style={{ fontWeight: 600 }}>{r.numero}</td>
                    <td className="tenue">{fechaHora(r.creadoEn)}</td>
                    <td>{r.cliente ?? <span className="tenue">Sin cliente</span>}</td>
                    <td className="tenue">{fechaCorta(tipo === 'presupuesto' ? r.validoHasta : r.entregaPrevista)}</td>
                    <td className="tenue">{r.vendedor}</td>
                    <td className="der num" style={{ fontWeight: 600 }}>{dinero(r.total)}</td>
                    <td><Estado d={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {abierto === 'nuevo' && <Editor tipo={tipo} alCerrar={(id) => setAbierto(id ?? null)} />}
      {editando && <Editor tipo={tipo} doc={editando} alCerrar={(id) => { setEditando(null); setAbierto(id ?? null); }} />}
      {abierto && abierto !== 'nuevo' && !editando && <Ficha tipo={tipo} id={abierto} alCerrar={() => setAbierto(null)} alEditar={setEditando} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

interface LineaEditor {
  varianteId: string;
  descripcion: string;
  unidad: string;
  tasaIva: 0 | 5 | 10;
  precio: string; // precio de lista mostrado
  precioManual: string | null;
  cantidad: string;
  descuento: string;
  stock: string | null;
}

function Editor({ tipo, doc, alCerrar }: { tipo: TipoDoc; doc?: DocComercial; alCerrar: (id?: string) => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const conf = CONF[tipo];
  const sucursales = yo?.sucursales ?? [];
  const [sucursalId, setSucursalId] = useState(doc?.sucursal.id ?? sucursales[0]?.id ?? '');
  const [cliente, setCliente] = useState<{ id: string | null; nombre: string } | null>(doc?.cliente ? { id: doc.cliente.id, nombre: doc.cliente.nombre } : null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [fecha, setFecha] = useState((tipo === 'presupuesto' ? doc?.validoHasta : doc?.entregaPrevista) ?? (tipo === 'presupuesto' && !doc ? enDias(15) : ''));
  const [nota, setNota] = useState(doc?.nota ?? '');
  const [lineas, setLineas] = useState<LineaEditor[]>(
    doc?.items.map((i) => ({ varianteId: i.varianteId, descripcion: i.descripcion, unidad: i.unidad, tasaIva: i.tasaIva, precio: i.precioUnitario, precioManual: null, cantidad: String(Number(i.cantidad)), descuento: Number(i.descuento) ? String(Number(i.descuento)) : '', stock: null })) ?? [],
  );
  const [q, setQ] = useState('');
  const [qDif, setQDif] = useState('');
  const [pidePin, setPidePin] = useState(false);
  const [preciosViejos, setPreciosViejos] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDif(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const clientes = useQuery({
    queryKey: ['clientes', buscaCliente],
    queryFn: () => api<Cliente[]>(`/clientes?q=${encodeURIComponent(buscaCliente)}&limite=8`),
    enabled: buscaCliente.trim().length > 1 && puede('cliente.ver'),
  });
  const productos = useQuery({
    queryKey: [tipo, 'productos', sucursalId, cliente?.id, qDif],
    queryFn: () => api<ProductoBuscado[]>(`${conf.ruta}/productos?sucursalId=${sucursalId}&q=${encodeURIComponent(qDif)}${cliente?.id ? `&clienteId=${cliente.id}` : ''}`),
    enabled: qDif.length > 0 && !!sucursalId,
  });

  const precioDe = (l: LineaEditor) => l.precioManual ?? l.precio;
  const calc = useMemo(() => {
    try {
      return calcularItems(lineas.map((l) => ({ cantidad: Number(l.cantidad) > 0 ? l.cantidad : '0.0001', precioUnitario: precioDe(l) || 0, descuento: Number(l.descuento) || 0, tasaIva: l.tasaIva })));
    } catch {
      return null;
    }
  }, [lineas]);
  const hayDescuento = lineas.some((l) => Number(l.descuento) > 0);

  const guardar = useMutation({
    mutationFn: (autorizacion?: string) => {
      const cuerpo = {
        sucursalId,
        clienteId: cliente?.id ?? null,
        clienteNombre: cliente && !cliente.id ? cliente.nombre : null,
        ...(tipo === 'presupuesto' ? { validoHasta: fecha || null } : { entregaPrevista: fecha || null }),
        nota: nota.trim() || null,
        items: lineas.map((l) => ({
          varianteId: l.varianteId,
          cantidad: Number(l.cantidad),
          ...(l.precioManual !== null && puede('precio.editar') ? { precioUnitario: Number(l.precioManual) } : {}),
          ...(Number(l.descuento) > 0 ? { descuento: Number(l.descuento) } : {}),
        })),
      };
      const op = { metodo: doc ? ('PATCH' as const) : ('POST' as const), cuerpo, encabezados: autorizacion ? { 'X-Autorizacion': autorizacion } : undefined };
      return api<DocComercial>(doc ? `${conf.ruta}/${doc.id}` : conf.ruta, op);
    },
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: [tipo] });
      qc.setQueryData([tipo, d.id], d);
      alCerrar(d.id);
    },
  });
  const intentarGuardar = () => {
    if (hayDescuento && !puede('descuento.aprobar')) setPidePin(true);
    else guardar.mutate(undefined);
  };

  const agregar = (p: ProductoBuscado) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.varianteId === p.varianteId);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: String(Number(l.cantidad) + 1) } : l));
      return [...ls, { varianteId: p.varianteId, descripcion: p.descripcion, unidad: p.unidad, tasaIva: p.tasaIva, precio: p.precio, precioManual: null, cantidad: '1', descuento: '', stock: p.stock }];
    });
    setQ('');
    setQDif('');
  };
  const cambiar = (i: number, c: Partial<LineaEditor>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...c } : l)));
  const elegirCliente = (c: { id: string | null; nombre: string } | null) => {
    if (lineas.length && (c?.id ?? null) !== (cliente?.id ?? null)) setPreciosViejos(true);
    setCliente(c);
    setBuscaCliente('');
  };
  const valido = !!sucursalId && lineas.length > 0 && lineas.every((l) => Number(l.cantidad) > 0) && (tipo === 'presupuesto' || !!cliente) && !!calc;

  if (pidePin) {
    return (
      <DialogoAutorizacion
        permiso="descuento.aprobar"
        titulo="Autorizar descuento"
        alAutorizar={(t) => {
          setPidePin(false);
          guardar.mutate(t);
        }}
        alCerrar={() => setPidePin(false)}
      />
    );
  }

  return (
    <Cajon
      ancho={860}
      titulo={doc ? `Editar ${conf.uno.toLowerCase()} N.º ${doc.numero}` : tipo === 'presupuesto' ? 'Nuevo presupuesto' : 'Nuevo pedido'}
      alCerrar={() => alCerrar(doc?.id)}
      pie={
        <>
          <span className="tenue" style={{ marginRight: 'auto' }}>
            Total <b style={{ color: 'var(--t1)', fontSize: 16 }}>{dinero(calc?.total.toNumber() ?? 0)}</b>
          </span>
          <button className="btn" onClick={() => alCerrar(doc?.id)}>Cancelar</button>
          <button className="btn pri" disabled={!valido || guardar.isPending} onClick={intentarGuardar}>Guardar</button>
        </>
      }
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Cliente" id="dc-cli">
            {cliente ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="entrada" style={{ display: 'flex', alignItems: 'center' }}>
                  {cliente.nombre}
                  {!cliente.id && <span className="tenue peq">&nbsp;· sin registrar</span>}
                </div>
                <button className="btn" aria-label="Quitar cliente" onClick={() => elegirCliente(null)}><X size={16} /></button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input id="dc-cli" className="entrada" placeholder="Buscar cliente o escribir un nombre" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                {buscaCliente.trim().length > 1 && (
                  <div className="menu-flotante">
                    {clientes.data?.map((c) => (
                      <button key={c.id} onClick={() => elegirCliente({ id: c.id, nombre: c.nombre })}>
                        {c.nombre} {c.documento && <span className="tenue peq">{c.documento}</span>}
                      </button>
                    ))}
                    <button onClick={() => elegirCliente({ id: null, nombre: buscaCliente.trim() })}>
                      <Plus size={14} /> Usar "{buscaCliente.trim()}" sin registrar
                    </button>
                  </div>
                )}
              </div>
            )}
          </Campo>
          {sucursales.length > 1 ? (
            <Campo etiqueta="Sucursal" id="dc-suc">
              <select id="dc-suc" className="entrada" value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); if (lineas.length) setPreciosViejos(true); }}>
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
          ) : (
            <Campo etiqueta={tipo === 'presupuesto' ? 'Válido hasta' : 'Entrega prevista'} id="dc-f">
              <input id="dc-f" type="date" className="entrada" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
          )}
        </div>
        {sucursales.length > 1 && (
          <div className="fila-campos">
            <Campo etiqueta={tipo === 'presupuesto' ? 'Válido hasta' : 'Entrega prevista'} id="dc-f">
              <input id="dc-f" type="date" className="entrada" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
            <div />
          </div>
        )}
        {preciosViejos && <Aviso tipo="info">Cambió el cliente o la sucursal: los precios se recalculan con su lista al guardar.</Aviso>}

        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--t3)' }} />
          <input className="entrada" style={{ paddingLeft: 36 }} placeholder="Agregar producto: código, SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && productos.data?.length === 1) agregar(productos.data[0]!); }} />
          {qDif && (
            <div className="menu-flotante">
              {productos.isLoading ? (
                <div className="tenue" style={{ padding: 10 }}>Buscando…</div>
              ) : !productos.data?.length ? (
                <div className="tenue" style={{ padding: 10 }}>Sin resultados</div>
              ) : (
                productos.data.map((p) => (
                  <button key={p.varianteId} onClick={() => agregar(p)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{p.descripcion}{p.sku && <span className="tenue peq"> · {p.sku}</span>}</span>
                    <span>
                      {p.stock !== null && <span className="tenue peq">stock {fmtCant(p.stock)} · </span>}
                      <b className="num">{dinero(p.precio)}</b>
                    </span>
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
                <th className="der" style={{ width: 130 }}>Precio</th>
                <th className="der" style={{ width: 110 }}>Descuento</th>
                <th className="der">Total</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.varianteId}>
                  <td>
                    {l.descripcion}
                    {l.stock !== null && Number(l.stock) < Number(l.cantidad) && <div className="peq" style={{ color: 'var(--bad)' }}>Stock disponible: {fmtCant(l.stock)}</div>}
                  </td>
                  <td className="der">
                    <input className="entrada num" style={{ height: 32, textAlign: 'right' }} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} />
                  </td>
                  <td className="der">
                    {puede('precio.editar') ? (
                      <input className="entrada num" style={{ height: 32, textAlign: 'right' }} inputMode="numeric" value={Math.round(Number(precioDe(l))).toLocaleString('es-PY')} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); cambiar(i, { precioManual: v === '' || Number(v) === Number(l.precio) ? null : v }); }} />
                    ) : (
                      <span className="num">{dinero(l.precio)}</span>
                    )}
                  </td>
                  <td className="der">
                    <input className="entrada num" style={{ height: 32, textAlign: 'right' }} inputMode="numeric" placeholder="0" value={l.descuento ? Number(l.descuento).toLocaleString('es-PY') : ''} onChange={(e) => cambiar(i, { descuento: e.target.value.replace(/[^0-9]/g, '') })} />
                  </td>
                  <td className="der num">{calc ? dinero(calc.lineas[i]!.total.toNumber()) : '—'}</td>
                  <td>
                    <button className="btn-icono" aria-label="Quitar" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hayDescuento && !puede('descuento.aprobar') && <Aviso tipo="info">Los descuentos se guardan con la autorización (PIN) de un supervisor.</Aviso>}
        <Campo etiqueta="Nota para el cliente" id="dc-n">
          <textarea id="dc-n" className="entrada" style={{ height: 70, paddingTop: 8 }} placeholder="Condiciones, forma de entrega, observaciones…" value={nota} onChange={(e) => setNota(e.target.value)} />
        </Campo>
      </div>
    </Cajon>
  );
}

function enDias(n: number): string {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(d);
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

function Ficha({ tipo, id, alCerrar, alEditar }: { tipo: TipoDoc; id: string; alCerrar: () => void; alEditar: (d: DocComercial) => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const conf = CONF[tipo];
  const doc = useQuery({ queryKey: [tipo, id], queryFn: () => api<DocComercial>(`${conf.ruta}/${id}`) });
  const [cierre, setCierre] = useState<'rechazar' | 'anular' | 'cancelar' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aceptando, setAceptando] = useState(false);
  const [aceptado, setAceptado] = useState<DocComercial | null>(null);

  const accion = useMutation({
    mutationFn: ({ ruta, cuerpo }: { ruta: string; cuerpo: object }) => api<DocComercial>(`${conf.ruta}/${id}/${ruta}`, { metodo: 'POST', cuerpo }),
    onSuccess: (d, v) => {
      void qc.invalidateQueries({ queryKey: [tipo] });
      void qc.invalidateQueries({ queryKey: ['pedido'] });
      if (v.ruta === 'aceptar') {
        setAceptado(d);
        void qc.invalidateQueries({ queryKey: [tipo, id] });
      } else qc.setQueryData([tipo, id], d);
      setCierre(null);
      setMotivo('');
    },
  });

  if (doc.isLoading || !doc.data) {
    return (
      <Cajon titulo={conf.uno} alCerrar={alCerrar} ancho={860}>
        {doc.error ? <ErrorApi error={doc.error} /> : <Cargando />}
      </Cajon>
    );
  }
  const d = doc.data;
  const abierto = tipo === 'presupuesto' ? d.estado === 'vigente' : d.estado === 'pendiente' || d.estado === 'preparado';
  const telefono = d.cliente?.telefono?.replace(/[^0-9]/g, '');
  const whatsapp = telefono ? `https://wa.me/${telefono.startsWith('0') ? '595' + telefono.slice(1) : telefono}?text=${encodeURIComponent(textoWhatsapp(d))}` : null;

  return (
    <Cajon titulo={`${conf.uno} N.º ${d.numero}`} alCerrar={alCerrar} ancho={860}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Estado d={d} />
        {d.origen && <span className="tenue peq">Desde el presupuesto N.º {d.origen.numero}</span>}
        {d.venta && <span className="tenue peq">Cobrado en la venta N.º {d.venta.numero}</span>}
        {d.cierre?.motivo && <span className="tenue peq">· {d.cierre.motivo}{d.cierre.por ? ` (${d.cierre.por})` : ''}</span>}
      </div>
      <ErrorApi error={accion.error} />
      {aceptado && (
        <Aviso tipo="ok">
          Se generó el pedido N.º {aceptado.numero}. <Link to="/pedidos" onClick={alCerrar}>Ver pedidos</Link>
        </Aviso>
      )}
      {d.vencido && <Aviso tipo="error">Este presupuesto venció. Edítelo para actualizar la validez y los precios antes de aceptarlo.</Aviso>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Imprimir o PDF</button>
        {whatsapp && (
          <a className="btn" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Enviar por WhatsApp</a>
        )}
        {abierto && puede(`${conf.permiso}.editar`) && (
          <button className="btn" onClick={() => alEditar(d)}><Pencil size={16} /> Editar</button>
        )}
        {tipo === 'presupuesto' && abierto && puede('pedido.crear') && !d.vencido && (
          <button className="btn pri" onClick={() => setAceptando(true)}><CheckCircle2 size={16} /> Cliente aceptó: crear pedido</button>
        )}
        {tipo === 'presupuesto' && d.pedidoGenerado && (
          <span className="tenue peq" style={{ alignSelf: 'center' }}>
            Generó el pedido N.º {d.pedidoGenerado.numero}
            {puede('pedido.ver') && <> · <Link to="/pedidos" onClick={alCerrar}>ver pedidos</Link></>}
          </span>
        )}
        {tipo === 'pedido' && abierto && puede('pedido.editar') && (
          <button className="btn" disabled={accion.isPending} onClick={() => accion.mutate({ ruta: 'estado', cuerpo: { estado: d.estado === 'pendiente' ? 'preparado' : 'pendiente' } })}>
            {d.estado === 'pendiente' ? 'Marcar preparado' : 'Volver a pendiente'}
          </button>
        )}
        {tipo === 'pedido' && abierto && puede('venta.crear') && (
          <Link className="btn pri" to="/cajas"><ArrowRight size={16} /> Cobrar en caja</Link>
        )}
      </div>

      {aceptando && (
        <div className="form" style={{ borderTop: '1px solid var(--linea)', paddingTop: 14 }}>
          {!d.cliente && <Aviso tipo="info">El presupuesto no tiene cliente. Edítelo y elija o escriba el cliente antes de crear el pedido.</Aviso>}
          <Campo etiqueta="Entrega prevista (opcional)" id="ac-f">
            <input id="ac-f" type="date" className="entrada" style={{ maxWidth: 220 }} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn pri" disabled={!d.cliente || accion.isPending} onClick={() => { accion.mutate({ ruta: 'aceptar', cuerpo: { entregaPrevista: motivo || null } }); setAceptando(false); }}>Crear pedido</button>
            <button className="btn" onClick={() => { setAceptando(false); setMotivo(''); }}>Volver</button>
          </div>
        </div>
      )}

      <DocumentoImprimible d={d} />

      {abierto && !aceptando && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tipo === 'presupuesto' && puede('presupuesto.editar') && (
            <>
              <button className="btn" onClick={() => setCierre('rechazar')}>El cliente rechazó</button>
              <button className="btn peligro" onClick={() => setCierre('anular')}>Anular</button>
            </>
          )}
          {tipo === 'pedido' && puede('pedido.cancelar') && <button className="btn peligro" onClick={() => setCierre('cancelar')}>Cancelar pedido</button>}
        </div>
      )}
      {cierre && (
        <div className="form" style={{ borderTop: '1px solid var(--linea)', paddingTop: 14 }}>
          <Campo etiqueta={cierre === 'rechazar' ? 'Motivo del rechazo' : 'Motivo'} id="ci-m">
            <input id="ci-m" className="entrada" autoFocus placeholder={cierre === 'rechazar' ? 'Precio, plazo de entrega, compró en otro lado…' : ''} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn peligro" disabled={motivo.trim().length < 3 || accion.isPending} onClick={() => accion.mutate({ ruta: cierre, cuerpo: { motivo } })}>Confirmar</button>
            <button className="btn" onClick={() => { setCierre(null); setMotivo(''); }}>Volver</button>
          </div>
        </div>
      )}
    </Cajon>
  );
}

function textoWhatsapp(d: DocComercial): string {
  const lineas = d.items.map((i) => `• ${fmtCant(i.cantidad)} × ${i.descripcion}: ${dinero(i.total)}`).join('\n');
  const tipo = d.tipo === 'presupuesto' ? 'Presupuesto' : 'Pedido';
  const extra = d.tipo === 'presupuesto' && d.validoHasta ? `\nVálido hasta el ${fechaCorta(d.validoHasta)}.` : d.entregaPrevista ? `\nEntrega prevista: ${fechaCorta(d.entregaPrevista)}.` : '';
  return `${tipo} N.º ${d.numero}${d.cliente ? ` para ${d.cliente.nombre}` : ''}\n\n${lineas}\n\nTotal: ${dinero(d.total)} (IVA incluido)${extra}${d.nota ? `\n\n${d.nota}` : ''}`;
}

export function DocumentoImprimible({ d }: { d: DocComercial }) {
  const { yo } = useSesion();
  return (
    <div className="doc-a4">
      <div className="doc-cab">
        <div>
          <h1>{yo?.empresa.nombre}</h1>
          <div>{yo?.empresa.razonSocial}</div>
          {yo?.empresa.ruc && <div>RUC {yo.empresa.ruc}</div>}
          <div>{d.sucursal.nombre}</div>
        </div>
        <div className="doc-tipo">
          <b>{d.tipo === 'presupuesto' ? 'Presupuesto' : 'Pedido'}</b>
          N.º {String(d.numero).padStart(6, '0')}
          <div>{fechaHora(d.creadoEn).split(',')[0]}</div>
        </div>
      </div>
      <div className="doc-datos">
        <div><span>Cliente: </span>{d.cliente?.nombre ?? 'Consumidor final'}</div>
        <div><span>RUC / CI: </span>{d.cliente?.documento ?? '—'}</div>
        {d.cliente?.telefono && <div><span>Teléfono: </span>{d.cliente.telefono}</div>}
        {d.cliente?.direccion && <div><span>Dirección: </span>{d.cliente.direccion}</div>}
        {d.tipo === 'presupuesto' ? <div><span>Válido hasta: </span>{fechaCorta(d.validoHasta)}</div> : <div><span>Entrega prevista: </span>{fechaCorta(d.entregaPrevista)}</div>}
        <div><span>Atendió: </span>{d.vendedor}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Cant.</th>
            <th>Descripción</th>
            <th className="der">Precio unit.</th>
            <th className="der">Descuento</th>
            <th className="der">IVA</th>
            <th className="der">Total</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.linea}>
              <td>{fmtCant(i.cantidad)}</td>
              <td>{i.descripcion}</td>
              <td className="der">{dinero(i.precioUnitario)}</td>
              <td className="der">{Number(i.descuento) ? dinero(i.descuento) : '—'}</td>
              <td className="der">{i.tasaIva ? `${i.tasaIva} %` : 'Exenta'}</td>
              <td className="der">{dinero(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-totales">
        {Number(d.descuento) > 0 && (
          <>
            <div><span>Subtotal</span><span>{dinero(d.subtotal)}</span></div>
            <div><span>Descuentos</span><span>− {dinero(d.descuento)}</span></div>
          </>
        )}
        <div className="total"><span>Total</span><span>{dinero(d.total)}</span></div>
        <div className="tenue peq"><span>Precios con IVA incluido</span></div>
      </div>
      {d.nota && <p style={{ marginTop: 18, whiteSpace: 'pre-wrap' }}>{d.nota}</p>}
      <div className="doc-pie">
        <span>Documento no válido como factura.</span>
        <span>KONTIVA ERP · Desarrollado por Araújo Tech Sistemas</span>
      </div>
    </div>
  );
}

