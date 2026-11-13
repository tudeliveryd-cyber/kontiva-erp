import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, CloudOff, FileText, Minus, Percent, Pill, Plus, Printer, RefreshCw, Scissors, Search, Trash2, UserRound, UtensilsCrossed, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { calcularItems, calcularPagos, ErrorCalculo, type ConfigBalanza, type Cotizaciones } from '@kontiva/shared';
import { DialogoAutorizacion } from '../componentes/Autorizacion';
import { Ticket, TicketProvisorio } from '../componentes/Ticket';
import { Aviso, Cajon, Campo, Cargando, ErrorApi, Vacio } from '../componentes/ui';
import { api, FalloApi } from '../lib/api';
import { cantidad as fmtCant, dinero, NOMBRE_MEDIO, NOMBRE_MONEDA, nuevaClave, type Cliente, type Medio, type Moneda, type Venta } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import { buscarEnCatalogo, encolar, esErrorDeRed, usePdvOffline } from '../lib/offline';
import { estadoAgente, guardarAgente, imprimirEnAgente, leerAgente, pruebaAgente, ticketDeVenta, ticketProvisorio, type ConfigAgente } from '../lib/impresora';
import { fechaCorta, type DocComercial } from './Pedidos';
import { nombreCuenta, type Cuenta } from './Salon';

/** Cuenta del salón que se está cobrando: los ítems elegidos van fijos en la venta. */
export interface CobroCuenta { id: string; numero: number; nombre: string; items: string[]; propina: number }

interface ContextoPdv {
  caja: { id: string; nombre: string };
  sucursal: { id: string; nombre: string; codigo: string };
  empresa: { nombre: string; razonSocial: string; ruc: string | null };
  sesion: { id: string; propia: boolean; abiertaEn: string } | null;
  cotizaciones: { moneda: 'USD' | 'BRL'; compra: string; venta: string }[];
  permiteStockNegativo: boolean;
  balanza: ConfigBalanza;
  puede: { descuento: boolean; cambiarPrecio: boolean; anular: boolean };
}

interface ItemBusqueda {
  varianteId: string;
  descripcion: string;
  sku: string | null;
  unidad: string;
  tasaIva: 0 | 5 | 10;
  precio: string;
  controlaStock: boolean;
  stock: string | null;
  /** Cantidad leída de una etiqueta de balanza. */
  cantidad?: string;
  /** Farmacia. */
  principioActivo?: string | null;
  concentracion?: string | null;
  condicionVenta?: 'libre' | 'receta' | 'receta_archivada';
}

export interface RecetaVenta { medico: string; matricula: string; paciente: string; pacienteDocumento: string; fecha: string; numero: string; retenida: boolean }
const conReceta = (l: { condicionVenta?: string }) => l.condicionVenta === 'receta' || l.condicionVenta === 'receta_archivada';
function InsigniaReceta({ condicion }: { condicion?: string }) {
  if (condicion === 'receta_archivada') return <span className="insignia i-bad" style={{ marginLeft: 6 }}>Receta archivada</span>;
  if (condicion === 'receta') return <span className="insignia i-warn" style={{ marginLeft: 6 }}>Bajo receta</span>;
  return null;
}

interface Linea extends ItemBusqueda {
  cantidad: string;
  descuento: number;
}

/** Venta hecha sin conexión: comprobante provisional hasta que se sincroniza. */
export interface VentaProvisoria {
  numero: number;
  creadaEn: string;
  lineas: { descripcion: string; cantidad: string; precio: string; total: number }[];
  total: number;
  pagos: { medio: Medio; moneda: Moneda; monto: number }[];
  vuelto: { moneda: Moneda; monto: number }[];
}

interface PagoUI {
  medio: Medio;
  moneda: Moneda;
  monto: string;
}

export function Pdv() {
  const { cajaId = '' } = useParams();
  const ctx = useQuery({ queryKey: ['pdv', cajaId], queryFn: () => api<ContextoPdv>(`/pdv/contexto?cajaId=${cajaId}`) });

  if (ctx.isLoading) return <Cargando />;
  if (ctx.error) return <div className="contenido"><ErrorApi error={ctx.error} /></div>;
  const c = ctx.data!;
  if (!c.sesion || !c.sesion.propia) {
    return (
      <div className="pdv">
        <CabeceraPdv c={c} />
        <div className="contenido">
          <section className="panel">
            <Vacio
              titulo={c.sesion ? 'Esta caja está abierta por otro usuario' : 'La caja está cerrada'}
              accion={<Link className="btn pri" to="/cajas">Ir a cajas</Link>}
            >
              {c.sesion ? 'Solo quien abrió la caja puede vender en ella.' : 'Abra la caja con el fondo inicial para empezar a vender.'}
            </Vacio>
          </section>
        </div>
      </div>
    );
  }
  return <PuntoDeVenta c={c} />;
}

function CabeceraPdv({ c, alImpresora }: { c: ContextoPdv; alImpresora?: () => void }) {
  return (
    <div className="pdv-cab">
      <Link to="/cajas" style={{ color: '#fff', display: 'flex' }} aria-label="Volver">
        <ArrowLeft size={20} />
      </Link>
      <div className="marca-k" style={{ width: 28, height: 28, fontSize: 15 }}>K</div>
      <div>
        <b>{c.caja.nombre}</b>
        <span style={{ color: '#b9a6cc', marginLeft: 8, fontSize: 13 }}>{c.sucursal.nombre}</span>
      </div>
      <div className="cot">
        {c.cotizaciones.length === 0 ? (
          <span>Sin cotizaciones cargadas: solo guaraníes</span>
        ) : (
          c.cotizaciones.map((q) => (
            <span key={q.moneda} className="num">
              {q.moneda} compra {Number(q.compra).toLocaleString('es-PY')} · venta {Number(q.venta).toLocaleString('es-PY')}
            </span>
          ))
        )}
      </div>
      {alImpresora && (
        <button className="btn" style={{ height: 30, background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.3)' }} onClick={alImpresora} title="Impresora térmica y cajón">
          <Printer size={15} /> Impresora
        </button>
      )}
    </div>
  );
}

function PuntoDeVenta({ c }: { c: ContextoPdv }) {
  const { yo } = useSesion();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ItemBusqueda[] | null>(null);
  const [selRes, setSelRes] = useState(0);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [listaCliente, setListaCliente] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<'cobro' | 'cliente' | 'descuento' | 'autorizar' | 'pedidos' | 'receta' | 'equivalentes' | 'mesas' | null>(null);
  const [cuentaCobro, setCuentaCobro] = useState<CobroCuenta | null>(null);
  const { puede: puedeUsuario } = useSesion();
  const gastronomia = ['restaurante', 'panaderia'].includes(yo?.empresa.rubro ?? '') && puedeUsuario('salon.ver');
  const [receta, setReceta] = useState<RecetaVenta | null>(null);
  const [equivDe, setEquivDe] = useState<ItemBusqueda | null>(null);
  const [pedido, setPedido] = useState<DocComercial | null>(null);
  const [autorizacion, setAutorizacion] = useState<{ token: string; nombre: string } | null>(null);
  const [vendida, setVendida] = useState<Venta | null>(null);
  const [provisoria, setProvisoria] = useState<VentaProvisoria | null>(null);
  const off = usePdvOffline(c.caja.id);
  const [agente, setAgente] = useState<ConfigAgente | null>(leerAgente);
  const [verImpresora, setVerImpresora] = useState(false);
  /** Ticket por el agente local; sin agente, la impresión del navegador. */
  const imprimir = (doc: Parameters<typeof imprimirEnAgente>[1] | null, conCajon: boolean) => {
    if (!agente || !doc) {
      window.print();
      return;
    }
    imprimirEnAgente(agente, { ...doc, abrirCajon: conCajon && agente.cajon }).catch((e: Error) => setAviso(`Impresora: ${e.message}`));
  };
  const buscador = useRef<HTMLInputElement>(null);
  const cot: Cotizaciones = useMemo(() => Object.fromEntries(c.cotizaciones.map((x) => [x.moneda, { compra: x.compra, venta: x.venta }])), [c.cotizaciones]);

  const calc = useMemo(() => {
    try {
      return calcularItems(lineas.map((l) => ({ cantidad: l.cantidad || '0.0001', precioUnitario: l.precio, descuento: l.descuento, tasaIva: l.tasaIva })));
    } catch {
      return null;
    }
  }, [lineas]);
  const total = calc?.total.toNumber() ?? 0;

  const enfocar = () => {
    setTimeout(() => buscador.current?.focus(), 0);
  };
  useEffect(enfocar, []);

  const agregar = useCallback((it: ItemBusqueda) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.varianteId === it.varianteId && l.descuento === 0);
      if (i >= 0 && it.unidad === 'unidad' && !it.cantidad) {
        const n = [...ls];
        n[i] = { ...n[i]!, cantidad: String(Number(n[i]!.cantidad) + 1) };
        setSel(i);
        return n;
      }
      setSel(ls.length);
      return [...ls, { ...it, cantidad: it.cantidad ?? '1', descuento: 0 }];
    });
    if (it.controlaStock && it.stock !== null && Number(it.stock) <= 0 && !c.permiteStockNegativo) {
      setAviso(`Sin stock: ${it.descripcion}`);
      setEquivDe(it.principioActivo ? it : null);
    } else {
      setAviso(null);
      setEquivDe(null);
    }
    setNota(null);
    setQ('');
    setResultados(null);
    enfocar();
  }, [c.permiteStockNegativo]);

  const buscar = async () => {
    const texto = q.trim();
    if (!texto) return;
    try {
      let r: { porCodigo: boolean; items: ItemBusqueda[] };
      try {
        if (!navigator.onLine) throw new TypeError('sin conexión');
        r = await api<{ porCodigo: boolean; items: ItemBusqueda[] }>(`/pdv/buscar?cajaId=${c.caja.id}&q=${encodeURIComponent(texto)}${cliente ? `&clienteId=${cliente.id}` : ''}`, off.enLinea ? { tiempo: 5000 } : { tiempo: 1500 });
      } catch (e) {
        // Sin conexión: se busca en el catálogo guardado de la caja.
        if (!esErrorDeRed(e) || !off.catalogo) throw e;
        off.setEnLinea(false);
        r = buscarEnCatalogo(off.catalogo, texto, c.balanza);
      }
      if (r.items.length === 0) {
        setAviso(`No se encontró "${texto}"`);
        setResultados(null);
        setQ('');
      } else if (r.porCodigo && r.items.length === 1) agregar(r.items[0]!);
      else {
        setResultados(r.items);
        setSelRes(0);
      }
    } catch (e) {
      setAviso(e instanceof FalloApi ? e.mensaje : 'Error de conexión');
    }
  };

  /** Al elegir o quitar el cliente, el carrito pasa a los precios de su lista (el servidor cobra lo mismo). */
  const aplicarPreciosCliente = async (cl: Cliente | null) => {
    if (!cl?.listaPrecioId && !listaCliente) {
      setListaCliente(null);
      return;
    }
    try {
      const r = await api<{ lista: { id: string; nombre: string } | null; precios: Record<string, string> }>('/pdv/precios', {
        metodo: 'POST',
        cuerpo: { cajaId: c.caja.id, clienteId: cl?.id ?? null, varianteIds: lineas.map((l) => l.varianteId) },
      });
      setListaCliente(r.lista?.nombre ?? null);
      setLineas((ls) => ls.map((l) => ({ ...l, precio: r.precios[l.varianteId] ?? l.precio })));
      setAviso(null);
      setNota(lineas.length ? (r.lista ? `Precios de la lista "${r.lista.nombre}" aplicados` : 'Precios normales aplicados') : null);
    } catch (e) {
      setAviso(e instanceof FalloApi ? e.mensaje : 'No se pudieron actualizar los precios');
    }
  };

  const cambiarCantidad = (i: number, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: v } : l)));
  const quitar = (i: number) => {
    setLineas((ls) => ls.filter((_, j) => j !== i));
    setSel(null);
    enfocar();
  };
  const nuevaVenta = () => {
    setLineas([]);
    setCliente(null);
    setListaCliente(null);
    setNota(null);
    setPedido(null);
    setCuentaCobro(null);
    setAutorizacion(null);
    setVendida(null);
    setProvisoria(null);
    setSel(null);
    setAviso(null);
    setReceta(null);
    setEquivDe(null);
    enfocar();
  };
  /** Con medicamentos bajo receta, primero los datos de la receta. */
  const pedirCobro = () => setDialogo(lineas.some(conReceta) && !receta ? 'receta' : 'cobro');

  // Atajos de teclado del PDV.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (vendida || provisoria) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          nuevaVenta();
        }
        return;
      }
      if (dialogo) return;
      if (e.key === 'F2' && lineas.length) {
        e.preventDefault();
        pedirCobro();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setDialogo('cliente');
      } else if (e.key === 'F6') {
        e.preventDefault();
        setDialogo('pedidos');
      } else if (e.key === 'F7' && gastronomia) {
        e.preventDefault();
        setDialogo('mesas');
      } else if (e.key === 'F8' && sel !== null) {
        e.preventDefault();
        setDialogo(c.puede.descuento || autorizacion ? 'descuento' : 'autorizar');
      } else if (e.key === 'Delete' && sel !== null && !cuentaCobro) {
        e.preventDefault();
        quitar(sel);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  });

  const equivalencias = c.cotizaciones.map((x) => ({ moneda: x.moneda, monto: total / Number(x.compra) }));

  return (
    <div className="pdv">
      <CabeceraPdv c={c} alImpresora={() => setVerImpresora(true)} />
      {verImpresora && (
        <ConfigImpresora
          actual={agente}
          alCerrar={() => {
            setVerImpresora(false);
            enfocar();
          }}
          alGuardar={(cfg) => {
            guardarAgente(cfg);
            setAgente(cfg);
            setVerImpresora(false);
            enfocar();
          }}
        />
      )}
      {(!off.enLinea || off.cola.length > 0) && (
        <div className={`pdv-conexion${off.enLinea ? '' : ' sin'}`}>
          {!off.enLinea && (
            <span>
              <CloudOff size={16} /> Sin conexión: se vende con el catálogo guardado
              {off.catalogo ? ` (actualizado a las ${new Date(off.catalogo.generado).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })})` : ' (no hay catálogo guardado)'}. Las ventas se registran al volver la conexión.
            </span>
          )}
          {off.pendientes > 0 && (
            <span>
              {off.pendientes} venta{off.pendientes > 1 ? 's' : ''} por sincronizar
              {off.enLinea && (
                <button className="btn" style={{ height: 26, marginLeft: 8 }} disabled={off.sincronizando} onClick={() => void off.sincronizar()}>
                  <RefreshCw size={13} /> Sincronizar
                </button>
              )}
            </span>
          )}
          {off.errores.map((v) => (
            <span key={v.clave} className="error">
              Venta sin conexión S/C-{v.numero} ({dinero(v.total)}) rechazada: {v.error}
              <button className="btn" style={{ height: 26, marginLeft: 8 }} onClick={() => void off.reintentar(v.clave)}>Reintentar</button>
            </span>
          ))}
        </div>
      )}
      <div className="pdv-cuerpo">
        <div className="pdv-izq">
          <div className="pdv-buscar">
            <Search size={20} className="lupa" />
            <input
              ref={buscador}
              className="entrada"
              placeholder="Escanee o escriba el código o nombre del producto"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (!e.target.value) setResultados(null);
              }}
              onKeyDown={(e) => {
                if (resultados) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelRes((i) => Math.min(i + 1, resultados.length - 1));
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelRes((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === 'Escape') {
                    setResultados(null);
                    return;
                  }
                  if (e.key === 'Enter' && resultados[selRes]) {
                    e.preventDefault();
                    agregar(resultados[selRes]!);
                    return;
                  }
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void buscar();
                }
              }}
            />
            {resultados && (
              <div className="pdv-resultados" role="listbox">
                {resultados.map((r, i) => (
                  <button key={r.varianteId} className={i === selRes ? 'sel' : ''} onClick={() => agregar(r)} role="option" aria-selected={i === selRes}>
                    <span style={{ flex: 1 }}>
                      <b style={{ fontWeight: 600 }}>{r.descripcion}</b>
                      {r.sku && <span className="tenue peq"> · {r.sku}</span>}
                      <InsigniaReceta condicion={r.condicionVenta} />
                      {r.principioActivo && <span className="tenue peq" style={{ display: 'block' }}>{r.principioActivo}{r.concentracion ? ` ${r.concentracion}` : ''}</span>}
                    </span>
                    {r.stock !== null && <span className={`peq ${Number(r.stock) <= 0 ? 'insignia i-bad' : 'tenue'}`}>stock {fmtCant(r.stock)}</span>}
                    <b className="num">{dinero(r.precio)}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
          {aviso && (
            <div style={{ padding: '10px 18px 0' }}>
              <Aviso tipo="error">
                {aviso}
                {equivDe && aviso.startsWith('Sin stock') && (
                  <button className="btn chico" style={{ marginLeft: 10 }} onClick={() => setDialogo('equivalentes')}><Pill size={14} /> Ver equivalentes</button>
                )}
              </Aviso>
            </div>
          )}
          {!aviso && nota && (
            <div style={{ padding: '10px 18px 0' }}>
              <Aviso tipo="info">{nota}</Aviso>
            </div>
          )}
          <div className="pdv-items">
            {lineas.length === 0 ? (
              <Vacio titulo="Venta vacía">Escanee un producto o búsquelo por nombre.</Vacio>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th className="der">Precio</th>
                    <th className="der">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => {
                    const total = calc?.lineas[i]?.total.toNumber();
                    return (
                      <tr key={i} className={`clic ${sel === i ? 'sel' : ''}`} onClick={() => setSel(i)}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{l.descripcion}<InsigniaReceta condicion={l.condicionVenta} /></div>
                          <div className="tenue peq">
                            {l.principioActivo && `${l.principioActivo}${l.concentracion ? ` ${l.concentracion}` : ''} · `}
                            {l.tasaIva === 0 ? 'Exento' : `IVA ${l.tasaIva} %`}
                            {l.descuento > 0 && <span className="insignia i-warn" style={{ marginLeft: 6 }}>Descuento {dinero(l.descuento)}</span>}
                          </div>
                        </td>
                        <td>
                          {cuentaCobro ? (
                            <span className="num" style={{ fontWeight: 600 }}>{fmtCant(l.cantidad)}</span>
                          ) : (
                          <div className="cant" onClick={(e) => e.stopPropagation()}>
                            <button aria-label="Menos" onClick={() => cambiarCantidad(i, String(Math.max(Number(l.cantidad) - 1, l.unidad === 'unidad' ? 1 : 0.001)))}>
                              <Minus size={14} />
                            </button>
                            <input
                              className="num"
                              inputMode="decimal"
                              value={l.cantidad}
                              onChange={(e) => cambiarCantidad(i, l.unidad === 'unidad' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
                              onBlur={enfocar}
                            />
                            <button aria-label="Más" onClick={() => cambiarCantidad(i, String(Number(l.cantidad) + 1))}>
                              <Plus size={14} />
                            </button>
                            {l.unidad !== 'unidad' && <span className="tenue peq">{l.unidad}</span>}
                          </div>
                          )}
                        </td>
                        <td className="der num">{dinero(l.precio)}</td>
                        <td className="der num" style={{ fontWeight: 600 }}>{total !== undefined ? dinero(total) : '—'}</td>
                        <td className="der" style={{ whiteSpace: 'nowrap' }}>
                          {l.principioActivo && (
                            <button className="enlace" aria-label="Equivalentes" title="Productos con el mismo principio activo" style={{ marginRight: 10 }} onClick={(e) => { e.stopPropagation(); setEquivDe(l); setDialogo('equivalentes'); }}>
                              <Pill size={16} />
                            </button>
                          )}
                          <button className="enlace" aria-label="Quitar" disabled={!!cuentaCobro} onClick={(e) => { e.stopPropagation(); quitar(i); }}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="pdv-der">
          <div className="pdv-total">
            <div className="tenue">Total a cobrar</div>
            <div className="grande num">{dinero(total)}</div>
            {total > 0 && (
              <div className="equiv num">
                {equivalencias.map((e) => (
                  <span key={e.moneda}>{dinero(e.monto, e.moneda)}</span>
                ))}
              </div>
            )}
            {calc && Number(calc.descuento) > 0 && <div className="tenue peq" style={{ marginTop: 8 }}>Descuentos: {dinero(calc.descuento.toNumber())}</div>}
          </div>
          {receta && lineas.some(conReceta) && (
            <button className="btn" onClick={() => setDialogo('receta')} title="Editar la receta">
              <FileText size={16} /> Receta: {receta.paciente} · {receta.medico}
            </button>
          )}
          <button className="btn cobrar" disabled={!lineas.length || !calc} onClick={pedirCobro}>
            Cobrar <span className="tecla">F2</span>
          </button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" style={{ flex: '1 1 200px', minWidth: 0 }} onClick={() => setDialogo('cliente')}>
              <UserRound size={16} /> {cliente ? cliente.nombre : 'Cliente'}
              {listaCliente && <span className="insignia i-p" style={{ padding: '1px 7px' }}>{listaCliente}</span>}
              <span className="tecla">F4</span>
            </button>
            <button className="btn" style={{ flex: '1 1 120px' }} disabled={sel === null} onClick={() => setDialogo(c.puede.descuento || autorizacion ? 'descuento' : 'autorizar')}>
              <Percent size={16} /> Descuento <span className="tecla">F8</span>
            </button>
          </div>
          <button className="btn" onClick={() => setDialogo('pedidos')}>
            <ClipboardCheck size={16} /> {pedido ? `Pedido N.º ${pedido.numero}` : 'Cobrar un pedido'} <span className="tecla">F6</span>
          </button>
          {gastronomia && (
            <button className="btn" onClick={() => setDialogo('mesas')}>
              <UtensilsCrossed size={16} /> {cuentaCobro ? cuentaCobro.nombre : 'Cobrar mesa'} <span className="tecla">F7</span>
            </button>
          )}
          {cuentaCobro && cuentaCobro.propina > 0 && <Aviso tipo="info">Propina {dinero(cuentaCobro.propina)}: se cobra aparte, en efectivo, y entra a la caja para el personal.</Aviso>}
          {autorizacion && <Aviso tipo="info">Descuento autorizado por {autorizacion.nombre}</Aviso>}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lineas.length > 0 && (
              <button className="btn peligro" onClick={() => confirm('¿Descartar la venta en curso?') && nuevaVenta()}>
                <X size={16} /> Cancelar venta
              </button>
            )}
            <div className="tenue peq">
              {yo?.usuario.nombre} · Supr: quitar línea · F2 cobrar · F4 cliente · F6 pedido{gastronomia ? " · F7 mesa" : ""} · F8 descuento
            </div>
            <button className="btn chico" onClick={() => navigate('/ventas')}>
              Ventas de la caja
            </button>
          </div>
        </div>
      </div>

      {dialogo === 'cobro' && calc && (
        <Cobro
          c={c}
          cot={cot}
          total={total}
          lineas={lineas}
          clienteId={cliente?.id ?? null}
          cliente={cliente}
          pedidoId={pedido?.id ?? null}
          autorizacion={autorizacion?.token}
          receta={lineas.some(conReceta) ? receta : null}
          cuenta={cuentaCobro}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
          alVender={(v) => {
            setDialogo(null);
            setVendida(v);
            if (agente?.automatico) imprimir(ticketDeVenta(v, c.empresa), v.pagos.some((p) => p.medio === 'efectivo'));
          }}
          catalogoGuardado={!!off.catalogo}
          alVenderSinConexion={(p) => {
            setDialogo(null);
            setProvisoria(p);
            if (agente?.automatico) imprimir(ticketProvisorio(p, c.empresa, c.caja.nombre, c.sucursal.nombre, yo?.usuario.nombre), p.pagos.some((x) => x.medio === 'efectivo'));
            off.setEnLinea(false);
            void off.refrescarCola();
          }}
        />
      )}
      {dialogo === 'receta' && (
        <DialogoReceta
          actual={receta}
          archivada={lineas.some((l) => l.condicionVenta === 'receta_archivada')}
          productos={lineas.filter(conReceta).map((l) => l.descripcion)}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
          alGuardar={(r) => {
            setReceta(r);
            setDialogo('cobro');
          }}
        />
      )}
      {dialogo === 'equivalentes' && equivDe && (
        <Equivalentes
          cajaId={c.caja.id}
          de={equivDe}
          catalogo={off.enLinea ? null : off.catalogo}
          alElegir={(it) => {
            setDialogo(null);
            setEquivDe(null);
            agregar(it);
          }}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
        />
      )}
      {dialogo === 'mesas' && (
        <CobrarMesa
          sucursalId={c.sucursal.id}
          alElegir={(cu, items, propina) => {
            if (lineas.length && !cuentaCobro && !confirm('Se reemplazan los productos cargados por los de la cuenta. ¿Continuar?')) return;
            const elegidos = cu.items.filter((i) => items.includes(i.id));
            const porVar = new Map<string, Linea>();
            for (const i of elegidos) {
              const a = porVar.get(i.varianteId);
              if (a) a.cantidad = String(Number(a.cantidad) + Number(i.cantidad));
              else porVar.set(i.varianteId, { varianteId: i.varianteId, descripcion: i.descripcion, sku: null, unidad: i.unidad, tasaIva: i.tasaIva, precio: i.precioUnitario, controlaStock: false, stock: null, cantidad: String(Number(i.cantidad)), descuento: 0 });
            }
            setLineas([...porVar.values()]);
            setCuentaCobro({ id: cu.id, numero: cu.numero, nombre: nombreCuenta(cu), items, propina });
            setPedido(null);
            setSel(null);
            setAviso(null);
            setNota(`${nombreCuenta(cu)} · cuenta N.º ${cu.numero}: ${elegidos.length === cu.items.filter((i) => !i.ventaId && i.estado !== 'anulado').length ? 'se cobra completa' : `se cobran ${elegidos.length} de sus productos`}`);
            setDialogo(null);
            enfocar();
          }}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
        />
      )}
      {dialogo === 'pedidos' && (
        <ElegirPedido
          cajaId={c.caja.id}
          alElegir={(p) => {
            if (lineas.length && !confirm('Se reemplazan los productos cargados por los del pedido. ¿Continuar?')) return;
            setPedido(p);
            setLineas(
              p.items.map((i) => ({
                varianteId: i.varianteId,
                descripcion: i.descripcion,
                sku: i.sku,
                unidad: i.unidad,
                tasaIva: i.tasaIva,
                precio: i.precioUnitario,
                controlaStock: false,
                stock: null,
                cantidad: String(Number(i.cantidad)),
                descuento: Number(i.descuento),
              })),
            );
            setCliente(p.cliente?.id ? { id: p.cliente.id, nombre: p.cliente.nombre, documento: p.cliente.documento, telefono: p.cliente.telefono, email: p.cliente.email, direccion: p.cliente.direccion, listaPrecioId: p.lista?.id ?? null, limiteCredito: '0', plazoCreditoDias: 30, activo: true } : null);
            setListaCliente(p.lista?.nombre ?? null);
            setAutorizacion(null);
            setSel(null);
            setAviso(null);
            setNota(`Pedido N.º ${p.numero} cargado${p.cliente ? ` · ${p.cliente.nombre}` : ''}: se cobra con sus precios y descuentos`);
            setDialogo(null);
            enfocar();
          }}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
        />
      )}
      {dialogo === 'cliente' && (
        <ElegirCliente
          alElegir={(cl) => {
            setCliente(cl);
            setDialogo(null);
            void aplicarPreciosCliente(cl);
            enfocar();
          }}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
        />
      )}
      {dialogo === 'autorizar' && (
        <DialogoAutorizacion
          permiso="descuento.aprobar"
          titulo="Autorizar descuento"
          alAutorizar={(token, nombre) => {
            setAutorizacion({ token, nombre });
            setDialogo('descuento');
          }}
          alCerrar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'descuento' && sel !== null && lineas[sel] && (
        <Descuento
          linea={lineas[sel]!}
          totalLinea={calc?.lineas[sel]?.bruto.toNumber() ?? 0}
          alAplicar={(d) => {
            setLineas((ls) => ls.map((l, j) => (j === sel ? { ...l, descuento: d } : l)));
            setDialogo(null);
            enfocar();
          }}
          alCerrar={() => setDialogo(null)}
        />
      )}
      {provisoria && (
        <div className="fondo" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div className="panel" style={{ padding: 20, display: 'flex', gap: 20, maxHeight: '92vh', overflow: 'auto' }}>
            <TicketProvisorio p={provisoria} empresa={c.empresa} caja={c.caja.nombre} sucursal={c.sucursal.nombre} cajero={yo?.usuario.nombre} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 240 }}>
              <Aviso tipo="info">Venta S/C-{provisoria.numero} guardada sin conexión. Se registrará sola al volver la conexión.</Aviso>
              {provisoria.vuelto.length > 0 && (
                <div className="pdv-total" style={{ padding: 14 }}>
                  <div className="tenue">Vuelto</div>
                  {provisoria.vuelto.map((v, i) => (
                    <div key={i} className="num" style={{ fontSize: 26, fontWeight: 800 }}>
                      {dinero(v.monto, v.moneda)}
                    </div>
                  ))}
                </div>
              )}
              <button className="btn" onClick={() => imprimir(ticketProvisorio(provisoria, c.empresa, c.caja.nombre, c.sucursal.nombre, yo?.usuario.nombre), false)}>
                <Printer size={16} /> Imprimir comprobante
              </button>
              <button className="btn pri" autoFocus onClick={nuevaVenta}>
                Nueva venta <span className="tecla">Enter</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {vendida && (
        <div className="fondo" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div className="panel" style={{ padding: 20, display: 'flex', gap: 20, maxHeight: '92vh', overflow: 'auto' }}>
            <Ticket venta={vendida} empresa={c.empresa} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 240 }}>
              <Aviso tipo="ok">Venta N.º {vendida.numero} registrada</Aviso>
              {vendida.vuelto.length > 0 && (
                <div className="pdv-total" style={{ padding: 14 }}>
                  <div className="tenue">Vuelto</div>
                  {vendida.vuelto.map((v, i) => (
                    <div key={i} className="num" style={{ fontSize: 26, fontWeight: 800 }}>
                      {dinero(v.monto, v.moneda)}
                    </div>
                  ))}
                </div>
              )}
              <button className="btn" onClick={() => imprimir(ticketDeVenta(vendida, c.empresa), false)}>
                <Printer size={16} /> Imprimir
              </button>
              <button className="btn pri" autoFocus onClick={nuevaVenta}>
                Nueva venta <span className="tecla">Enter</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Cobro(props: { c: ContextoPdv; cot: Cotizaciones; total: number; lineas: Linea[]; clienteId: string | null; cliente?: Cliente | null; pedidoId: string | null; autorizacion?: string; receta: RecetaVenta | null; cuenta: CobroCuenta | null; alCerrar: () => void; alVender: (v: Venta) => void; catalogoGuardado: boolean; alVenderSinConexion: (p: VentaProvisoria) => void }) {
  const [pagos, setPagos] = useState<PagoUI[]>([{ medio: 'efectivo', moneda: 'PYG', monto: String(props.total) }]);
  // Venta a crédito (cuenta corriente del cliente).
  const [credito, setCredito] = useState('');
  const [tokenCredito, setTokenCredito] = useState<string | null>(null);
  const [pidePinCredito, setPidePinCredito] = useState(false);
  const montoCredito = Math.min(Number(credito) || 0, props.total);
  const aCobrar = props.total - montoCredito;
  const disponible = props.cliente ? Math.max(Number(props.cliente.limiteCredito) - Number(props.cliente.saldo ?? 0), 0) : 0;
  const [vueltoMoneda, setVueltoMoneda] = useState<Moneda>('PYG');
  // La clave se fija al abrir el cobro: si la red falla y se reintenta, no se duplica la venta.
  const [clave] = useState(nuevaClave);
  const monedas: Moneda[] = ['PYG', ...props.c.cotizaciones.map((q) => q.moneda)];

  const resultado = useMemo(() => {
    try {
      const validos = pagos.filter((p) => Number(p.monto) > 0);
      if (!validos.length && aCobrar > 0) return { error: 'Ingrese el monto recibido' };
      return { r: calcularPagos(aCobrar, validos, props.cot, vueltoMoneda) };
    } catch (e) {
      return { error: e instanceof ErrorCalculo ? e.message : 'Revise los montos' };
    }
  }, [pagos, vueltoMoneda, aCobrar, props.cot]);

  const cuerpoVenta = () => ({
    claveIdempotencia: clave,
    ...(montoCredito > 0 && { credito: montoCredito }),
    cajaId: props.c.caja.id,
    clienteId: props.clienteId,
    ...(props.pedidoId && { pedidoId: props.pedidoId }),
    items: props.lineas.map((l) => ({ varianteId: l.varianteId, cantidad: Number(l.cantidad), ...(l.descuento > 0 ? { descuento: l.descuento } : {}) })),
    pagos: pagos.filter((p) => Number(p.monto) > 0).map((p) => ({ medio: p.medio, moneda: p.moneda, monto: Number(p.monto) })),
    vueltoMoneda,
    ...(props.receta && { receta: { ...props.receta, pacienteDocumento: props.receta.pacienteDocumento || null, numero: props.receta.numero || null } }),
    ...(props.cuenta && { cuentaId: props.cuenta.id, cuentaItems: props.cuenta.items, ...(props.cuenta.propina > 0 && { propina: { monto: props.cuenta.propina, medio: 'efectivo' } }) }),
  });
  /**
   * Sin conexión se puede vender al contado, sin pedido y sin descuentos que pidan PIN (el PIN lo valida el servidor).
   * Los precios van en la venta: el servidor los respeta solo si cambiaron después.
   */
  const sinConexionPermitida = props.catalogoGuardado && montoCredito === 0 && !props.pedidoId && !props.cuenta && (props.c.puede.descuento || props.lineas.every((l) => l.descuento === 0));
  const guardarSinConexion = async () => {
    const creadaEn = new Date().toISOString();
    const clave_ = `kontiva.sc.${props.c.caja.id}`;
    let numero = 1;
    try {
      numero = Number(localStorage.getItem(clave_) ?? '0') + 1;
      localStorage.setItem(clave_, String(numero));
    } catch {
      numero = Date.now() % 100000;
    }
    const base = cuerpoVenta();
    const cuerpo = { ...base, items: props.lineas.map((l) => ({ varianteId: l.varianteId, cantidad: Number(l.cantidad), precioUnitario: Number(l.precio), ...(l.descuento > 0 ? { descuento: l.descuento } : {}) })), offline: { registradaEn: creadaEn } };
    await encolar({ clave, cajaId: props.c.caja.id, cuerpo, numero, total: props.total, creadaEn, estado: 'pendiente' });
    props.alVenderSinConexion({
      numero,
      creadaEn,
      lineas: props.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, total: Number(l.cantidad) * Number(l.precio) - l.descuento })),
      total: props.total,
      pagos: base.pagos,
      vuelto: resultado.r ? resultado.r.vuelto.map((v) => ({ moneda: v.moneda, monto: v.monto.toNumber() })) : [],
    });
  };
  const vender = useMutation({
    // Por defecto TanStack Query pausa las mutaciones sin conexión: el PDV decide qué hacer.
    networkMode: 'always',
    mutationFn: async () => {
      try {
        if (!navigator.onLine) throw new TypeError('sin conexión');
        return await api<Venta>('/ventas', {
          metodo: 'POST',
          encabezados: tokenCredito ? { 'X-Autorizacion': tokenCredito } : props.autorizacion ? { 'X-Autorizacion': props.autorizacion } : undefined,
          cuerpo: cuerpoVenta(),
          // Si no responde a tiempo se guarda sin conexión; la misma clave evita duplicados si llegó al servidor.
          tiempo: sinConexionPermitida ? 8000 : undefined,
        });
      } catch (e) {
        if (esErrorDeRed(e) && sinConexionPermitida) {
          await guardarSinConexion();
          return null;
        }
        if (esErrorDeRed(e)) throw new FalloApi(0, 'SIN_CONEXION', 'Sin conexión: sin conexión solo se vende al contado, sin pedido y sin descuentos que requieran PIN');
        throw e;
      }
    },
    onSuccess: (v) => v && props.alVender(v),
    onError: (e) => {
      if (e instanceof FalloApi && e.codigo === 'CREDITO_EXCEDIDO') setPidePinCredito(true);
    },
  });

  const set = (i: number, cambio: Partial<PagoUI>) => setPagos((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  const falta = resultado.r ? 0 : null;
  const confirmar = () => resultado.r && !vender.isPending && vender.mutate();

  if (pidePinCredito) {
    return (
      <DialogoAutorizacion
        permiso="credito_cliente.aprobar"
        titulo="Autorizar crédito sobre el límite"
        alAutorizar={(t) => {
          setTokenCredito(t);
          setPidePinCredito(false);
        }}
        alCerrar={() => setPidePinCredito(false)}
      />
    );
  }

  return (
    <Cajon
      titulo={`Cobrar ${dinero(props.total)}`}
      alCerrar={props.alCerrar}
      pie={
        <>
          <button className="btn" onClick={props.alCerrar}>
            Volver
          </button>
          <button className="btn pri" disabled={!resultado.r || vender.isPending} onClick={confirmar}>
            Confirmar venta <span className="tecla">Enter</span>
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          confirmar();
        }}
      >
        <ErrorApi error={vender.error} />
        {tokenCredito && <Aviso tipo="info">Crédito autorizado por un supervisor. Confirme la venta.</Aviso>}
        {props.cliente && (
          <div className="credito-cobro">
            <div style={{ flex: 1 }}>
              <Campo etiqueta={`A crédito (cuenta de ${props.cliente.nombre})`} id="cr" ayuda={Number(props.cliente.limiteCredito) > 0 ? `Disponible ${dinero(disponible)} de ${dinero(props.cliente.limiteCredito)}` : 'El cliente no tiene límite de crédito: requiere autorización'}>
                <input id="cr" className="entrada num" inputMode="numeric" placeholder="0" value={credito ? Number(credito).toLocaleString('es-PY') : ''} onChange={(e) => setCredito(e.target.value.replace(/[^0-9]/g, ''))} />
              </Campo>
            </div>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 22 }}
              onClick={() => {
                setCredito(String(props.total));
                setPagos([{ medio: 'efectivo', moneda: 'PYG', monto: '' }]);
              }}
            >
              Todo a crédito
            </button>
          </div>
        )}
        {pagos.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Campo etiqueta="Medio" id={`m${i}`}>
              <select id={`m${i}`} className="entrada" value={p.medio} onChange={(e) => set(i, { medio: e.target.value as Medio })}>
                {(['efectivo', 'tarjeta', 'transferencia', 'otro'] as Medio[]).map((m) => (
                  <option key={m} value={m}>
                    {NOMBRE_MEDIO[m]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Moneda" id={`mo${i}`}>
              <select id={`mo${i}`} className="entrada" value={p.moneda} onChange={(e) => set(i, { moneda: e.target.value as Moneda })}>
                {monedas.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Campo>
            <div style={{ flex: 1 }}>
              <Campo etiqueta="Monto" id={`mt${i}`}>
                <input id={`mt${i}`} className="entrada num" inputMode="decimal" autoFocus={i === pagos.length - 1} value={p.monto} onChange={(e) => set(i, { monto: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} />
              </Campo>
            </div>
            {pagos.length > 1 && (
              <button type="button" className="enlace" style={{ marginBottom: 12 }} aria-label="Quitar pago" onClick={() => setPagos((ps) => ps.filter((_, j) => j !== i))}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        <div className="pagos-rapidos">
          {[50000, 100000].filter((b) => aCobrar > 0 && b >= aCobrar).slice(0, 2).map((b) => (
            <button type="button" key={b} className="btn chico" onClick={() => setPagos([{ medio: 'efectivo', moneda: 'PYG', monto: String(b) }])}>
              Recibe {dinero(b)}
            </button>
          ))}
          {pagos.length < 6 && (
            <button type="button" className="btn chico" onClick={() => setPagos((ps) => [...ps, { medio: 'efectivo', moneda: monedas[1] ?? 'PYG', monto: '' }])}>
              <Plus size={14} /> Otro pago
            </button>
          )}
        </div>
        {monedas.length > 1 && (
          <Campo etiqueta="Vuelto en" id="vm">
            <select id="vm" className="entrada" value={vueltoMoneda} onChange={(e) => setVueltoMoneda(e.target.value as Moneda)}>
              {monedas.map((m) => (
                <option key={m} value={m}>
                  {NOMBRE_MONEDA[m]}
                  {m !== 'PYG' ? ' (unidades enteras, el resto en guaraníes)' : ''}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <div className="pdv-total resumen-cobro">
          <span>Total</span>
          <b className="num">{dinero(props.total)}</b>
          {montoCredito > 0 && (
            <>
              <span>A crédito</span>
              <b className="num">{dinero(montoCredito)}</b>
              <span>A cobrar ahora</span>
              <b className="num">{dinero(aCobrar)}</b>
            </>
          )}
          {resultado.r ? (
            <>
              <span>Recibido</span>
              <b className="num">{dinero(resultado.r.pagado.toNumber())}</b>
              <span style={{ fontSize: 20 }}>Vuelto</span>
              <b className="num" style={{ fontSize: 20 }}>
                {resultado.r.vuelto.length === 0 ? dinero(0) : resultado.r.vuelto.map((v) => dinero(v.monto.toNumber(), v.moneda)).join(' + ')}
              </b>
            </>
          ) : (
            <>
              <span style={{ color: 'var(--bad)' }}>{resultado.error}</span>
              <b>{falta}</b>
            </>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Cajon>
  );
}

function ElegirCliente({ alElegir, alCerrar }: { alElegir: (c: Cliente | null) => void; alCerrar: () => void }) {
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [datos, setDatos] = useState({ nombre: '', documento: '', telefono: '' });
  const lista = useQuery({ queryKey: ['clientes', q], queryFn: () => api<Cliente[]>(`/clientes?q=${encodeURIComponent(q)}&limite=20`) });
  const crear = useMutation({ mutationFn: () => api<Cliente>('/clientes', { metodo: 'POST', cuerpo: datos }), onSuccess: alElegir });
  return (
    <Cajon titulo="Cliente" alCerrar={alCerrar}>
      {nuevo ? (
        <form className="form" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <ErrorApi error={crear.error} />
          <Campo etiqueta="Nombre o razón social" id="cn">
            <input id="cn" className="entrada" autoFocus value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} />
          </Campo>
          <Campo etiqueta="RUC o cédula" id="cd">
            <input id="cd" className="entrada num" value={datos.documento} onChange={(e) => setDatos({ ...datos, documento: e.target.value })} />
          </Campo>
          <Campo etiqueta="Teléfono" id="ct">
            <input id="ct" className="entrada" value={datos.telefono} onChange={(e) => setDatos({ ...datos, telefono: e.target.value })} />
          </Campo>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn pri" disabled={datos.nombre.trim().length < 2}>Guardar y usar</button>
            <button type="button" className="btn" onClick={() => setNuevo(false)}>Volver</button>
          </div>
        </form>
      ) : (
        <>
          <input className="entrada" placeholder="Buscar por nombre, RUC, cédula o teléfono" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="lista-empresas">
            <button onClick={() => alElegir(null)}>Sin cliente (consumidor final)</button>
            {lista.data?.map((c) => (
              <button key={c.id} onClick={() => alElegir(c)}>
                <span style={{ flex: 1 }}>{c.nombre}</span>
                <span className="tenue peq">{c.documento}</span>
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => setNuevo(true)}>
            <Plus size={16} /> Cliente nuevo
          </button>
        </>
      )}
    </Cajon>
  );
}

function Descuento({ linea, totalLinea, alAplicar, alCerrar }: { linea: Linea; totalLinea: number; alAplicar: (d: number) => void; alCerrar: () => void }) {
  const [modo, setModo] = useState<'monto' | 'porcentaje'>('porcentaje');
  const [valor, setValor] = useState('');
  const d = modo === 'monto' ? Number(valor || 0) : Math.round((totalLinea * Number(valor || 0)) / 100);
  const valido = d >= 0 && d <= totalLinea;
  return (
    <Cajon titulo={`Descuento · ${linea.descripcion}`} alCerrar={alCerrar}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (valido) alAplicar(d); }}>
        <p className="tenue" style={{ margin: 0 }}>Total de la línea: {dinero(totalLinea)}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={`btn chico ${modo === 'porcentaje' ? 'pri' : ''}`} onClick={() => setModo('porcentaje')}>Porcentaje</button>
          <button type="button" className={`btn chico ${modo === 'monto' ? 'pri' : ''}`} onClick={() => setModo('monto')}>Monto</button>
        </div>
        <Campo etiqueta={modo === 'porcentaje' ? 'Porcentaje' : 'Monto en guaraníes'} id="dv" error={!valido ? 'No puede superar el total de la línea' : undefined}>
          <input id="dv" className="entrada num" inputMode="decimal" autoFocus value={valor} onChange={(e) => setValor(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Campo>
        <p style={{ margin: 0 }}>Descuento: <b>{dinero(d)}</b></p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri" disabled={!valido}>Aplicar</button>
          {linea.descuento > 0 && <button type="button" className="btn" onClick={() => alAplicar(0)}>Quitar descuento</button>}
        </div>
      </form>
    </Cajon>
  );
}

function ElegirPedido({ cajaId, alElegir, alCerrar }: { cajaId: string; alElegir: (p: DocComercial) => void; alCerrar: () => void }) {
  const [q, setQ] = useState('');
  const lista = useQuery({ queryKey: ['pdv-pedidos', cajaId, q], queryFn: () => api<DocComercial[]>(`/pdv/pedidos?cajaId=${cajaId}&q=${encodeURIComponent(q)}`), placeholderData: (p) => p });
  return (
    <Cajon titulo="Cobrar un pedido" alCerrar={alCerrar}>
      <input className="entrada" autoFocus placeholder="Cliente o número de pedido" value={q} onChange={(e) => setQ(e.target.value)} />
      {lista.isLoading ? (
        <Cargando />
      ) : !lista.data?.length ? (
        <Vacio titulo="No hay pedidos pendientes en esta sucursal" />
      ) : (
        <div className="lista-empresas">
          {lista.data.map((p) => (
            <button key={p.id} onClick={() => alElegir(p)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <b>N.º {p.numero} · {p.cliente?.nombre ?? 'Sin cliente'}</b>
                <b className="num">{dinero(p.total)}</b>
              </div>
              <div className="tenue peq">
                {p.estado === 'preparado' ? 'Preparado' : 'Pendiente'} · {p.items.length} {p.items.length === 1 ? 'producto' : 'productos'}
                {p.entregaPrevista && ` · entrega ${fechaCorta(p.entregaPrevista)}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </Cajon>
  );
}

/** Impresora térmica del equipo: el agente local de KONTIVA (ESC/POS) imprime el ticket y abre el cajón. */
function ConfigImpresora({ actual, alCerrar, alGuardar }: { actual: ConfigAgente | null; alCerrar: () => void; alGuardar: (c: ConfigAgente | null) => void }) {
  const [f, setF] = useState<ConfigAgente>(actual ?? { url: 'http://127.0.0.1:9420', token: '', automatico: true, cajon: true });
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [probando, setProbando] = useState(false);
  const probar = async (imprimirPrueba: boolean) => {
    setProbando(true);
    try {
      const e = await estadoAgente(f);
      if (imprimirPrueba) await pruebaAgente(f);
      setEstado({ ok: true, texto: `${e.impresora} · ${e.ancho} columnas${imprimirPrueba ? ' · prueba impresa' : ''}` });
    } catch (e) {
      setEstado({ ok: false, texto: (e as Error).message });
    } finally {
      setProbando(false);
    }
  };
  return (
    <Cajon
      titulo="Impresora térmica y cajón"
      alCerrar={alCerrar}
      pie={
        <>
          {actual && <button className="btn peligro" onClick={() => alGuardar(null)}>Quitar</button>}
          <button className="btn" onClick={alCerrar}>Cancelar</button>
          <button className="btn pri" disabled={!f.url || f.token.length < 8} onClick={() => alGuardar(f)}>Guardar</button>
        </>
      }
    >
      <div className="form">
        <p className="tenue peq" style={{ margin: 0 }}>
          Instale el agente de KONTIVA en esta computadora: imprime directo en la impresora de tickets (ESC/POS, por red o USB) y abre el cajón de dinero. Al iniciarlo muestra la clave que va abajo. Sin agente, se usa la impresión del navegador.
        </p>
        <Campo etiqueta="Dirección del agente" id="ag-u"><input id="ag-u" className="entrada mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value.trim() })} /></Campo>
        <Campo etiqueta="Clave del agente" id="ag-t"><input id="ag-t" className="entrada mono" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value.trim() })} /></Campo>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.automatico} onChange={(e) => setF({ ...f, automatico: e.target.checked })} /> Imprimir el ticket al confirmar cada venta</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.cajon} onChange={(e) => setF({ ...f, cajon: e.target.checked })} /> Abrir el cajón en las ventas con efectivo</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={probando || f.token.length < 8} onClick={() => void probar(false)}>Probar conexión</button>
          <button className="btn" disabled={probando || f.token.length < 8} onClick={() => void probar(true)}><Printer size={16} /> Imprimir prueba</button>
        </div>
        {estado && <Aviso tipo={estado.ok ? 'ok' : 'error'}>{estado.texto}</Aviso>}
      </div>
    </Cajon>
  );
}

const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

/** Datos de la receta para los medicamentos bajo receta; la de psicotrópicos queda retenida con la cédula del paciente. */
function DialogoReceta({ actual, archivada, productos, alCerrar, alGuardar }: { actual: RecetaVenta | null; archivada: boolean; productos: string[]; alCerrar: () => void; alGuardar: (r: RecetaVenta) => void }) {
  const [r, setR] = useState<RecetaVenta>(actual ?? { medico: '', matricula: '', paciente: '', pacienteDocumento: '', fecha: hoyLocal(), numero: '', retenida: archivada });
  const t = (k: keyof RecetaVenta) => ({ value: r[k] as string, onChange: (e: { target: { value: string } }) => setR({ ...r, [k]: e.target.value }) });
  const valida = r.medico.trim().length >= 3 && r.matricula.trim().length >= 1 && r.paciente.trim().length >= 3 && !!r.fecha && r.fecha <= hoyLocal() && (!archivada || (r.retenida && r.pacienteDocumento.trim().length >= 3));
  return (
    <Cajon titulo="Receta" alCerrar={alCerrar}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (valida) alGuardar(r); }}>
        <p className="tenue peq" style={{ margin: 0 }}>Bajo receta: {productos.join(', ')}.</p>
        <div className="fila-campos">
          <Campo etiqueta="Médico" id="rc-m"><input id="rc-m" className="entrada" autoFocus {...t('medico')} /></Campo>
          <Campo etiqueta="Registro profesional" id="rc-r"><input id="rc-r" className="entrada" {...t('matricula')} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Paciente" id="rc-p"><input id="rc-p" className="entrada" {...t('paciente')} /></Campo>
          <Campo etiqueta={archivada ? 'Cédula del paciente' : 'Cédula (opcional)'} id="rc-d"><input id="rc-d" className="entrada num" {...t('pacienteDocumento')} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Fecha de la receta" id="rc-f"><input id="rc-f" type="date" className="entrada" max={hoyLocal()} {...t('fecha')} /></Campo>
          <Campo etiqueta="N.º de receta (opcional)" id="rc-n"><input id="rc-n" className="entrada" {...t('numero')} /></Campo>
        </div>
        {archivada ? (
          <label className="casilla">
            <input type="checkbox" checked={r.retenida} onChange={(e) => setR({ ...r, retenida: e.target.checked })} /> La receta queda retenida en la farmacia (receta archivada)
          </label>
        ) : (
          <label className="casilla">
            <input type="checkbox" checked={r.retenida} onChange={(e) => setR({ ...r, retenida: e.target.checked })} /> Se retiene la receta
          </label>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri" disabled={!valida}>Continuar al cobro</button>
          <button type="button" className="btn" onClick={alCerrar}>Volver</button>
        </div>
      </form>
    </Cajon>
  );
}

/** Alternativas con el mismo principio activo y concentración, primero las que tienen stock. */
function Equivalentes({ cajaId, de, catalogo, alElegir, alCerrar }: { cajaId: string; de: ItemBusqueda; catalogo: { items: (ItemBusqueda & { codigos: string[] })[] } | null; alElegir: (i: ItemBusqueda) => void; alCerrar: () => void }) {
  const q = useQuery({
    queryKey: ['equivalentes', de.varianteId, !!catalogo],
    queryFn: async () => {
      if (catalogo) {
        const n = (x?: string | null) => (x ?? '').trim().toLowerCase();
        return {
          items: catalogo.items
            .filter((i) => i.varianteId !== de.varianteId && n(i.principioActivo) === n(de.principioActivo) && (!de.concentracion || n(i.concentracion) === n(de.concentracion)))
            .sort((a, b) => Number(Number(b.stock ?? 1) > 0) - Number(Number(a.stock ?? 1) > 0)),
        };
      }
      return api<{ items: ItemBusqueda[] }>(`/pdv/equivalentes?cajaId=${cajaId}&varianteId=${de.varianteId}`);
    },
  });
  return (
    <Cajon titulo={`Equivalentes · ${de.principioActivo ?? ''}${de.concentracion ? ` ${de.concentracion}` : ''}`} alCerrar={alCerrar}>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.items.length ? (
        <Vacio titulo="Sin equivalentes">No hay otros productos con el mismo principio activo y concentración.</Vacio>
      ) : (
        <div className="pdv-resultados" style={{ position: 'static', boxShadow: 'none' }}>
          {q.data.items.map((r) => (
            <button key={r.varianteId} onClick={() => alElegir(r)}>
              <span style={{ flex: 1 }}>
                <b style={{ fontWeight: 600 }}>{r.descripcion}</b>
                <InsigniaReceta condicion={r.condicionVenta} />
              </span>
              {r.stock !== null && <span className={`peq ${Number(r.stock) <= 0 ? 'insignia i-bad' : 'tenue'}`}>stock {fmtCant(r.stock)}</span>}
              <b className="num">{dinero(r.precio)}</b>
            </button>
          ))}
        </div>
      )}
    </Cajon>
  );
}

/** Cuentas abiertas del salón: se elige qué ítems se cobran (cuenta dividida) y la propina. */
function CobrarMesa({ sucursalId, alElegir, alCerrar }: { sucursalId: string; alElegir: (c: Cuenta, items: string[], propina: number) => void; alCerrar: () => void }) {
  const q = useQuery({ queryKey: ['cuentas-abiertas', sucursalId], queryFn: () => api<Cuenta[]>(`/restaurante/cuentas?sucursalId=${sucursalId}`) });
  const [elegida, setElegida] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [propina, setPropina] = useState('');
  const cuenta = q.data?.find((c) => c.id === elegida);
  const cobrables = cuenta?.items.filter((i) => !i.ventaId && i.estado !== 'anulado' && i.estado !== 'pendiente') ?? [];
  const sinEnviar = cuenta?.items.filter((i) => i.estado === 'pendiente').length ?? 0;
  const separar = useMutation({
    mutationFn: (item: string) => api<Cuenta>(`/restaurante/cuentas/${elegida}/items/${item}/dividir`, { metodo: 'POST', cuerpo: { cantidad: 1 } }),
    onSuccess: () => void q.refetch(),
  });
  const total = cobrables.filter((i) => marcados.has(i.id)).reduce((s, i) => s + Number(i.total), 0);
  const elegir = (c: Cuenta) => {
    setElegida(c.id);
    setMarcados(new Set(c.items.filter((i) => !i.ventaId && i.estado !== 'anulado' && i.estado !== 'pendiente').map((i) => i.id)));
    setPropina('');
  };
  return (
    <Cajon titulo={cuenta ? `${nombreCuenta(cuenta)} · cuenta N.º ${cuenta.numero}` : 'Cobrar mesa'} ancho={620} alCerrar={alCerrar}>
      <ErrorApi error={q.error ?? separar.error} />
      {!q.data ? (
        <Cargando />
      ) : !cuenta ? (
        !q.data.length ? (
          <Vacio titulo="No hay cuentas abiertas" />
        ) : (
          <div>
            {q.data.map((c) => (
              <button key={c.id} className="fila-cuenta" onClick={() => elegir(c)}>
                <span style={{ flex: 1 }}><b>{nombreCuenta(c)}</b><span className="tenue peq" style={{ display: 'block' }}>N.º {c.numero} · {c.mozo} · {c.comensales} comensales</span></span>
                <b className="num">{dinero(c.totales.pendiente)}</b>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="form">
          {sinEnviar > 0 && <Aviso tipo="info">{sinEnviar} producto(s) sin enviar a cocina no se cobran hasta enviarlos.</Aviso>}
          <table>
            <tbody>
              {cobrables.map((i) => (
                <tr key={i.id}>
                  <td style={{ width: 32 }}>
                    <input type="checkbox" aria-label={`Cobrar ${i.descripcion}`} checked={marcados.has(i.id)} onChange={(e) => { const n = new Set(marcados); if (e.target.checked) n.add(i.id); else n.delete(i.id); setMarcados(n); }} />
                  </td>
                  <td>{Number(i.cantidad)} × {i.descripcion}</td>
                  <td className="der num">{dinero(i.total)}</td>
                  <td className="der">
                    {Number(i.cantidad) > 1 && (
                      <button className="btn chico" title="Separar una unidad para cobrarla aparte" disabled={separar.isPending} onClick={() => separar.mutate(i.id)}><Scissors size={13} /> 1</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn chico" onClick={() => setMarcados(new Set(cobrables.map((i) => i.id)))}>Todo</button>
            <button className="btn chico" onClick={() => setMarcados(new Set())}>Nada</button>
            <span className="tenue peq" style={{ marginLeft: 'auto' }}>
              {cuenta.comensales > 1 && `Por persona (${cuenta.comensales}): ${dinero(Math.ceil(Number(cuenta.totales.pendiente) / cuenta.comensales))} · `}A cobrar: <b>{dinero(total)}</b>
            </span>
          </div>
          <Campo etiqueta="Propina (en efectivo, para el personal)" id="cm-p">
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn chico" onClick={() => setPropina('')}>Sin propina</button>
              <button type="button" className="btn chico" onClick={() => setPropina(String(Math.round(total * 0.1)))}>10 %</button>
              <input id="cm-p" className="entrada num" style={{ width: 140 }} value={propina} onChange={(e) => setPropina(e.target.value.replace(/\D/g, ''))} />
            </div>
          </Campo>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setElegida(null)}>Otra cuenta</button>
            <button className="btn pri" disabled={!marcados.size} onClick={() => alElegir(cuenta, [...marcados], Number(propina) || 0)}>Cargar en la caja</button>
          </div>
        </div>
      )}
    </Cajon>
  );
}
