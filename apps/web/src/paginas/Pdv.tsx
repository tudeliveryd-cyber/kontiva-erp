import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Minus, Percent, Plus, Printer, Search, Trash2, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { calcularItems, calcularPagos, ErrorCalculo, type Cotizaciones } from '@kontiva/shared';
import { DialogoAutorizacion } from '../componentes/Autorizacion';
import { Ticket } from '../componentes/Ticket';
import { Aviso, Cajon, Campo, Cargando, ErrorApi, Vacio } from '../componentes/ui';
import { api, FalloApi } from '../lib/api';
import { cantidad as fmtCant, dinero, NOMBRE_MEDIO, NOMBRE_MONEDA, nuevaClave, type Cliente, type Medio, type Moneda, type Venta } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface ContextoPdv {
  caja: { id: string; nombre: string };
  sucursal: { id: string; nombre: string; codigo: string };
  empresa: { nombre: string; razonSocial: string; ruc: string | null };
  sesion: { id: string; propia: boolean; abiertaEn: string } | null;
  cotizaciones: { moneda: 'USD' | 'BRL'; compra: string; venta: string }[];
  permiteStockNegativo: boolean;
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
}

interface Linea extends ItemBusqueda {
  cantidad: string;
  descuento: number;
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

function CabeceraPdv({ c }: { c: ContextoPdv }) {
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
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<'cobro' | 'cliente' | 'descuento' | 'autorizar' | null>(null);
  const [autorizacion, setAutorizacion] = useState<{ token: string; nombre: string } | null>(null);
  const [vendida, setVendida] = useState<Venta | null>(null);
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
      if (i >= 0 && it.unidad === 'unidad') {
        const n = [...ls];
        n[i] = { ...n[i]!, cantidad: String(Number(n[i]!.cantidad) + 1) };
        setSel(i);
        return n;
      }
      setSel(ls.length);
      return [...ls, { ...it, cantidad: it.unidad === 'unidad' ? '1' : '1', descuento: 0 }];
    });
    if (it.controlaStock && it.stock !== null && Number(it.stock) <= 0 && !c.permiteStockNegativo) setAviso(`Sin stock: ${it.descripcion}`);
    else setAviso(null);
    setQ('');
    setResultados(null);
    enfocar();
  }, [c.permiteStockNegativo]);

  const buscar = async () => {
    const texto = q.trim();
    if (!texto) return;
    try {
      const r = await api<{ porCodigo: boolean; items: ItemBusqueda[] }>(`/pdv/buscar?cajaId=${c.caja.id}&q=${encodeURIComponent(texto)}`);
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

  const cambiarCantidad = (i: number, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: v } : l)));
  const quitar = (i: number) => {
    setLineas((ls) => ls.filter((_, j) => j !== i));
    setSel(null);
    enfocar();
  };
  const nuevaVenta = () => {
    setLineas([]);
    setCliente(null);
    setAutorizacion(null);
    setVendida(null);
    setSel(null);
    setAviso(null);
    enfocar();
  };

  // Atajos de teclado del PDV.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (vendida) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          nuevaVenta();
        }
        return;
      }
      if (dialogo) return;
      if (e.key === 'F2' && lineas.length) {
        e.preventDefault();
        setDialogo('cobro');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setDialogo('cliente');
      } else if (e.key === 'F8' && sel !== null) {
        e.preventDefault();
        setDialogo(c.puede.descuento || autorizacion ? 'descuento' : 'autorizar');
      } else if (e.key === 'Delete' && sel !== null) {
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
      <CabeceraPdv c={c} />
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
              <Aviso tipo="error">{aviso}</Aviso>
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
                          <div style={{ fontWeight: 600 }}>{l.descripcion}</div>
                          <div className="tenue peq">
                            {l.tasaIva === 0 ? 'Exento' : `IVA ${l.tasaIva} %`}
                            {l.descuento > 0 && <span className="insignia i-warn" style={{ marginLeft: 6 }}>Descuento {dinero(l.descuento)}</span>}
                          </div>
                        </td>
                        <td>
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
                        </td>
                        <td className="der num">{dinero(l.precio)}</td>
                        <td className="der num" style={{ fontWeight: 600 }}>{total !== undefined ? dinero(total) : '—'}</td>
                        <td className="der">
                          <button className="enlace" aria-label="Quitar" onClick={(e) => { e.stopPropagation(); quitar(i); }}>
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
          <button className="btn cobrar" disabled={!lineas.length || !calc} onClick={() => setDialogo('cobro')}>
            Cobrar <span className="tecla">F2</span>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setDialogo('cliente')}>
              <UserRound size={16} /> {cliente ? cliente.nombre : 'Cliente'} <span className="tecla">F4</span>
            </button>
            <button className="btn" style={{ flex: 1 }} disabled={sel === null} onClick={() => setDialogo(c.puede.descuento || autorizacion ? 'descuento' : 'autorizar')}>
              <Percent size={16} /> Descuento <span className="tecla">F8</span>
            </button>
          </div>
          {autorizacion && <Aviso tipo="info">Descuento autorizado por {autorizacion.nombre}</Aviso>}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lineas.length > 0 && (
              <button className="btn peligro" onClick={() => confirm('¿Descartar la venta en curso?') && nuevaVenta()}>
                <X size={16} /> Cancelar venta
              </button>
            )}
            <div className="tenue peq">
              {yo?.usuario.nombre} · Supr: quitar línea · F2 cobrar · F4 cliente · F8 descuento
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
          autorizacion={autorizacion?.token}
          alCerrar={() => {
            setDialogo(null);
            enfocar();
          }}
          alVender={(v) => {
            setDialogo(null);
            setVendida(v);
          }}
        />
      )}
      {dialogo === 'cliente' && (
        <ElegirCliente
          alElegir={(cl) => {
            setCliente(cl);
            setDialogo(null);
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
              <button className="btn" onClick={() => window.print()}>
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

function Cobro(props: { c: ContextoPdv; cot: Cotizaciones; total: number; lineas: Linea[]; clienteId: string | null; autorizacion?: string; alCerrar: () => void; alVender: (v: Venta) => void }) {
  const [pagos, setPagos] = useState<PagoUI[]>([{ medio: 'efectivo', moneda: 'PYG', monto: String(props.total) }]);
  const [vueltoMoneda, setVueltoMoneda] = useState<Moneda>('PYG');
  // La clave se fija al abrir el cobro: si la red falla y se reintenta, no se duplica la venta.
  const [clave] = useState(nuevaClave);
  const monedas: Moneda[] = ['PYG', ...props.c.cotizaciones.map((q) => q.moneda)];

  const resultado = useMemo(() => {
    try {
      const validos = pagos.filter((p) => Number(p.monto) > 0);
      if (!validos.length) return { error: 'Ingrese el monto recibido' };
      return { r: calcularPagos(props.total, validos, props.cot, vueltoMoneda) };
    } catch (e) {
      return { error: e instanceof ErrorCalculo ? e.message : 'Revise los montos' };
    }
  }, [pagos, vueltoMoneda, props.total, props.cot]);

  const vender = useMutation({
    mutationFn: () =>
      api<Venta>('/ventas', {
        metodo: 'POST',
        encabezados: props.autorizacion ? { 'X-Autorizacion': props.autorizacion } : undefined,
        cuerpo: {
          claveIdempotencia: clave,
          cajaId: props.c.caja.id,
          clienteId: props.clienteId,
          items: props.lineas.map((l) => ({ varianteId: l.varianteId, cantidad: Number(l.cantidad), ...(l.descuento > 0 ? { descuento: l.descuento } : {}) })),
          pagos: pagos.filter((p) => Number(p.monto) > 0).map((p) => ({ medio: p.medio, moneda: p.moneda, monto: Number(p.monto) })),
          vueltoMoneda,
        },
      }),
    onSuccess: props.alVender,
  });

  const set = (i: number, cambio: Partial<PagoUI>) => setPagos((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  const falta = resultado.r ? 0 : null;
  const confirmar = () => resultado.r && !vender.isPending && vender.mutate();

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
          {[50000, 100000].filter((b) => b >= props.total).slice(0, 2).map((b) => (
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
