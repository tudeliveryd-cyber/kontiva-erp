import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Grid3x3, History, Layers, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad, dinero, type Deposito, type FilaStock } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import { StockEnGrade } from '../componentes/Ropa';

const TIPOS: Record<string, string> = { inicial: 'Stock inicial', ajuste: 'Ajuste', venta: 'Venta', anulacion_venta: 'Venta anulada', devolucion: 'Devolución', compra: 'Compra', anulacion_compra: 'Compra anulada', transferencia: 'Transferencia', transferencia_salida: 'Transferencia (salida)', transferencia_entrada: 'Transferencia (entrada)', produccion: 'Producción', produccion_consumo: 'Insumo de producción', anulacion_produccion: 'Producción anulada', merma: 'Merma' };

export function Stock() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const depositos = useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
  const [depositoId, setDepositoId] = useState('');
  const [q, setQ] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [contado, setContado] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [tipo, setTipo] = useState<'inicial' | 'ajuste'>('ajuste');
  const [historial, setHistorial] = useState<FilaStock | null>(null);
  const [ok, setOk] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const pestana = params.get('tab') === 'vencimientos' ? 'vencimientos' : 'stock';
  const setPestana = (p: 'stock' | 'vencimientos') => setParams(p === 'stock' ? {} : { tab: p });
  const [lotes, setLotes] = useState<FilaStock | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const dep = depositoId || depositos.data?.[0]?.id || '';
  const filas = useQuery({
    queryKey: ['stock', dep, q, soloBajo],
    queryFn: () => api<FilaStock[]>(`/stock?depositoId=${dep}&q=${encodeURIComponent(q)}&soloBajo=${soloBajo}&limite=500`),
    enabled: Boolean(dep),
  });
  const cambios = Object.entries(contado).filter(([id, v]) => v !== '' && Number(v) !== Number(filas.data?.find((f) => f.varianteId === id)?.cantidad));
  const guardar = useMutation({
    mutationFn: () => api<{ ajustados: number }>('/stock/ajustes', { metodo: 'POST', cuerpo: { depositoId: dep, motivo, tipo, items: cambios.map(([varianteId, v]) => ({ varianteId, cantidadNueva: Number(v) })) } }),
    onSuccess: (r) => {
      setOk(r.ajustados);
      setContado({});
      setMotivo('');
      setAjustando(false);
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
  });

  return (
    <>
      <Encabezado titulo="Stock">
        {puede('stock.editar') && !ajustando && (
          <button className="btn pri" onClick={() => { setAjustando(true); setOk(null); }}>
            Cargar conteo
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <div className="pestanas">
          <button className={pestana === 'stock' ? 'activa' : ''} onClick={() => setPestana('stock')}>Stock por depósito</button>
          <button className={pestana === 'vencimientos' ? 'activa' : ''} onClick={() => setPestana('vencimientos')}>Vencimientos</button>
        </div>
        {pestana === 'vencimientos' ? (
          <Vencimientos depositos={depositos.data ?? []} />
        ) : (
        <>
        {ok !== null && <Aviso tipo="ok">{ok} producto(s) ajustado(s). Cada cambio quedó registrado con su motivo.</Aviso>}
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <select className="entrada" value={dep} onChange={(e) => setDepositoId(e.target.value)} aria-label="Depósito">
              {depositos.data?.map((d) => (
                <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>
              ))}
            </select>
            <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 380 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Buscar producto o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="casilla">
              <input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo sin stock
            </label>
          </div>
          {ajustando && (
            <div className="panel-cuerpo form" style={{ borderTop: '1px solid var(--linea2)', paddingTop: 16 }}>
              <ErrorApi error={guardar.error} />
              <div className="fila-campos">
                <Campo etiqueta="Tipo" id="at">
                  <select id="at" className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as 'inicial' | 'ajuste')}>
                    <option value="ajuste">Ajuste por conteo</option>
                    <option value="inicial">Stock inicial (empresa nueva)</option>
                  </select>
                </Campo>
                <Campo etiqueta="Motivo" id="am">
                  <input id="am" className="entrada" placeholder="Conteo mensual, rotura, vencimiento…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </Campo>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn pri" disabled={!cambios.length || motivo.trim().length < 3 || guardar.isPending} onClick={() => guardar.mutate()}>
                  Guardar {cambios.length} cambio(s)
                </button>
                <button className="btn" onClick={() => { setAjustando(false); setContado({}); }}>Cancelar</button>
              </div>
              <span className="tenue peq">Escriba la cantidad contada en la columna "Contado". Las filas vacías no cambian. Los productos con lote se cuentan por lote (botón Lotes).</span>
            </div>
          )}
          {filas.isLoading ? (
            <Cargando />
          ) : !filas.data?.length ? (
            <Vacio titulo="Sin productos con control de stock" />
          ) : (
            <div className="desplazar">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th className="der">En stock</th>
                    {ajustando && <th className="der">Contado</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filas.data.map((f) => (
                    <tr key={f.varianteId}>
                      <td style={{ fontWeight: 600 }}>
                        {f.descripcion}
                        {f.controlaLote && <span className="insignia i-n" style={{ marginLeft: 8 }}>Con lote</span>}
                      </td>
                      <td className="mono tenue">{f.sku ?? ''}</td>
                      <td className="der num" style={{ color: Number(f.cantidad) <= 0 ? 'var(--bad)' : undefined, fontWeight: 600 }}>
                        {cantidad(f.cantidad)} <span className="tenue peq">{f.unidad === 'unidad' ? '' : f.unidad}</span>
                      </td>
                      {ajustando && (
                        <td className="der">
                          {f.controlaLote ? (
                            <button className="btn" style={{ height: 32 }} onClick={() => setLotes(f)}>Por lote</button>
                          ) : (
                            <input className="entrada num" style={{ width: 110, height: 32 }} inputMode="decimal" value={contado[f.varianteId] ?? ''} onChange={(e) => setContado({ ...contado, [f.varianteId]: e.target.value.replace(',', '.').replace(/[^0-9.-]/g, '') })} />
                          )}
                        </td>
                      )}
                      <td className="der" style={{ whiteSpace: 'nowrap' }}>
                        {f.grade && f.productoId && (
                          <button className="enlace" aria-label="Stock por talle y color" title="Stock por talle y color" style={{ marginRight: 10 }} onClick={() => setGrade(f.productoId!)}>
                            <Grid3x3 size={16} />
                          </button>
                        )}
                        {f.controlaLote && (
                          <button className="enlace" aria-label="Lotes" title="Lotes" style={{ marginRight: 10 }} onClick={() => setLotes(f)}>
                            <Layers size={16} />
                          </button>
                        )}
                        <button className="enlace" aria-label="Movimientos" onClick={() => setHistorial(f)}>
                          <History size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        </>
        )}
      </div>
      {historial && <Movimientos fila={historial} depositoId={dep} alCerrar={() => setHistorial(null)} />}
      {grade && <StockEnGrade productoId={grade} alCerrar={() => setGrade(null)} />}
      {lotes && <Lotes fila={lotes} depositoId={dep} deposito={depositos.data?.find((d) => d.id === dep)} alCerrar={() => setLotes(null)} />}
    </>
  );
}

function Movimientos({ fila, depositoId, alCerrar }: { fila: FilaStock; depositoId: string; alCerrar: () => void }) {
  const q = useQuery({
    queryKey: ['movimientos', fila.varianteId, depositoId],
    queryFn: () => api<{ id: number; tipo: string; cantidad: string; saldo: string; motivo: string | null; fecha: string; usuario: string | null }[]>(`/stock/movimientos?varianteId=${fila.varianteId}&depositoId=${depositoId}`),
  });
  return (
    <Cajon titulo={fila.descripcion} alCerrar={alCerrar}>
      {q.isLoading ? (
        <Cargando />
      ) : !q.data?.length ? (
        <Vacio titulo="Sin movimientos" />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Movimiento</th>
              <th className="der">Cantidad</th>
              <th className="der">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((m) => (
              <tr key={m.id}>
                <td className="peq num">{fechaHora(m.fecha)}</td>
                <td>
                  {TIPOS[m.tipo] ?? m.tipo}
                  <div className="tenue peq">{[m.usuario, m.motivo].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="der num" style={{ color: Number(m.cantidad) < 0 ? 'var(--bad)' : 'var(--ok)' }}>
                  {Number(m.cantidad) > 0 ? '+' : ''}
                  {cantidad(m.cantidad)}
                </td>
                <td className="der num">{cantidad(m.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Cajon>
  );
}

interface Lote { loteId: string; codigo: string; vencimiento: string | null; vencido: boolean; depositoId: string; deposito: string; cantidad: string }
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '');
const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const diasHasta = (f: string) => Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${hoyPy()}T12:00:00Z`)) / 86400000);
const estadoVencimiento = (f: string | null) => {
  if (!f) return <span className="tenue peq">Sin vencimiento</span>;
  const d = diasHasta(f);
  if (d < 0) return <span className="insignia i-bad">Vencido hace {-d} {d === -1 ? 'día' : 'días'}</span>;
  if (d === 0) return <span className="insignia i-bad">Vence hoy</span>;
  if (d <= 30) return <span className="insignia i-warn">Vence en {d} {d === 1 ? 'día' : 'días'}</span>;
  return <span className="tenue peq">En {d} días</span>;
};

/** Lotes de un producto en el depósito: saldo, vencimiento y conteo por lote. */
function Lotes({ fila, depositoId, deposito, alCerrar }: { fila: FilaStock; depositoId: string; deposito?: Deposito; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lotes', fila.varianteId, depositoId], queryFn: () => api<Lote[]>(`/stock/lotes?varianteId=${fila.varianteId}&depositoId=${depositoId}`) });
  const [contado, setContado] = useState<Record<string, string>>({});
  const [nuevo, setNuevo] = useState({ codigo: '', vencimiento: '', cantidad: '' });
  const [motivo, setMotivo] = useState('');
  const editar = puede('stock.editar');
  const items = [
    ...Object.entries(contado)
      .filter(([id, v]) => v !== '' && Number(v) !== Number(q.data?.find((l) => l.loteId === id)?.cantidad))
      .map(([loteId, v]) => ({ varianteId: fila.varianteId, loteId, cantidadNueva: Number(v) })),
    ...(nuevo.codigo.trim() && Number(nuevo.cantidad) > 0 ? [{ varianteId: fila.varianteId, cantidadNueva: Number(nuevo.cantidad), lote: { codigo: nuevo.codigo.trim(), vencimiento: nuevo.vencimiento || null } }] : []),
  ];
  const guardar = useMutation({
    mutationFn: () => api('/stock/ajustes', { metodo: 'POST', cuerpo: { depositoId, motivo, tipo: 'ajuste', items } }),
    onSuccess: () => {
      setContado({});
      setNuevo({ codigo: '', vencimiento: '', cantidad: '' });
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['lotes'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['vencimientos'] });
    },
  });
  const visibles = q.data?.filter((l) => Number(l.cantidad) !== 0) ?? [];
  return (
    <Cajon
      titulo={fila.descripcion}
      ancho={720}
      alCerrar={alCerrar}
      pie={
        editar ? (
          <>
            <input className="entrada" style={{ flex: 1 }} placeholder="Motivo: conteo, baja de vencidos, rotura" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <button className="btn pri" disabled={!items.length || motivo.trim().length < 3 || guardar.isPending} onClick={() => guardar.mutate()}>Guardar {items.length || ''} {items.length === 1 ? 'cambio' : 'cambios'}</button>
          </>
        ) : undefined
      }
    >
      <ErrorApi error={guardar.error} />
      <p className="tenue peq" style={{ margin: 0 }}>
        {deposito ? `${deposito.sucursal.nombre} · ${deposito.nombre}. ` : ''}La venta toma primero el lote que vence antes y nunca uno vencido. Para dar de baja un lote vencido, cuente 0.
      </p>
      {q.isLoading ? (
        <Cargando />
      ) : (
        <table>
          <thead><tr><th>Lote</th><th>Vencimiento</th><th>Estado</th><th className="der">Cantidad</th>{editar && <th className="der">Contado</th>}</tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={5} className="tenue">Sin stock en lotes de este depósito.</td></tr>}
            {visibles.map((l) => (
              <tr key={l.loteId}>
                <td className="mono">{l.codigo === 'S/L' ? 'Sin lote' : l.codigo}</td>
                <td className="tenue">{fechaCorta(l.vencimiento) || '—'}</td>
                <td>{estadoVencimiento(l.vencimiento)}</td>
                <td className="der num" style={{ fontWeight: 600 }}>{cantidad(l.cantidad)}</td>
                {editar && (
                  <td className="der">
                    <input className="entrada num" aria-label={`Contado del lote ${l.codigo}`} style={{ width: 100, height: 32 }} inputMode="decimal" value={contado[l.loteId] ?? ''} onChange={(e) => setContado({ ...contado, [l.loteId]: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} />
                  </td>
                )}
              </tr>
            ))}
            {editar && (
              <tr>
                <td><input className="entrada" aria-label="Lote nuevo" style={{ height: 32, width: 120 }} placeholder="Lote nuevo" value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value.toUpperCase() })} /></td>
                <td colSpan={2}><input className="entrada" aria-label="Vencimiento del lote nuevo" type="date" style={{ height: 32 }} value={nuevo.vencimiento} onChange={(e) => setNuevo({ ...nuevo, vencimiento: e.target.value })} /></td>
                <td className="der tenue peq"><Plus size={14} /> agregar</td>
                <td className="der"><input className="entrada num" aria-label="Cantidad del lote nuevo" style={{ width: 100, height: 32 }} inputMode="decimal" value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} /></td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Cajon>
  );
}

interface FilaVencimiento { loteId: string; codigo: string; vencimiento: string; dias: number; vencido: boolean; varianteId: string; descripcion: string; unidad: string; depositoId: string; deposito: string; cantidad: string; valor?: string }

function Vencimientos({ depositos }: { depositos: Deposito[] }) {
  const [dias, setDias] = useState('60');
  const [depositoId, setDepositoId] = useState('');
  const q = useQuery({ queryKey: ['vencimientos', dias, depositoId], queryFn: () => api<FilaVencimiento[]>(`/stock/vencimientos?dias=${dias}${depositoId ? `&depositoId=${depositoId}` : ''}`) });
  const vencidos = q.data?.filter((f) => f.vencido) ?? [];
  const valor = (fs: FilaVencimiento[]) => fs.reduce((s, f) => s + Number(f.valor ?? 0), 0);
  const conValor = q.data?.some((f) => f.valor !== undefined);
  return (
    <section className="panel">
      <div className="filtros" style={{ paddingTop: 16, alignItems: 'center' }}>
        <select className="entrada" aria-label="Depósito" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
          <option value="">Todos los depósitos</option>
          {depositos.map((d) => <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>)}
        </select>
        <select className="entrada" aria-label="Plazo" value={dias} onChange={(e) => setDias(e.target.value)}>
          <option value="15">Vencidos y próximos 15 días</option>
          <option value="30">Vencidos y próximos 30 días</option>
          <option value="60">Vencidos y próximos 60 días</option>
          <option value="180">Vencidos y próximos 6 meses</option>
        </select>
        {q.data && (
          <span className="tenue peq">
            <CalendarClock size={14} style={{ verticalAlign: -2 }} /> {vencidos.length} {vencidos.length === 1 ? 'lote vencido' : 'lotes vencidos'} con stock
            {conValor && vencidos.length > 0 && ` (${dinero(valor(vencidos))} al costo)`} · {q.data.length - vencidos.length} por vencer
          </span>
        )}
      </div>
      <ErrorApi error={q.error} />
      {!q.data ? (
        <Cargando />
      ) : !q.data.length ? (
        <Vacio titulo="Nada vencido ni por vencer en el plazo">Solo aparecen los productos con control de lote y vencimiento.</Vacio>
      ) : (
        <table>
          <thead><tr><th>Vencimiento</th><th>Producto</th><th>Lote</th><th>Depósito</th><th className="der">Cantidad</th>{conValor && <th className="der">Valor al costo</th>}</tr></thead>
          <tbody>
            {q.data.map((f) => (
              <tr key={f.loteId + f.depositoId}>
                <td>{fechaCorta(f.vencimiento)} <div>{estadoVencimiento(f.vencimiento)}</div></td>
                <td style={{ fontWeight: 600 }}>{f.descripcion}</td>
                <td className="mono">{f.codigo === 'S/L' ? 'Sin lote' : f.codigo}</td>
                <td className="tenue">{f.deposito}</td>
                <td className="der num">{cantidad(f.cantidad)} <span className="tenue peq">{f.unidad === 'unidad' ? '' : f.unidad}</span></td>
                {conValor && <td className="der num">{f.valor ? dinero(f.valor) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
