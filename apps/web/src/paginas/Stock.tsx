import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad, type Deposito, type FilaStock } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

const TIPOS: Record<string, string> = { inicial: 'Stock inicial', ajuste: 'Ajuste', venta: 'Venta', anulacion_venta: 'Venta anulada', devolucion: 'Devolución', compra: 'Compra', transferencia: 'Transferencia', transferencia_salida: 'Transferencia (salida)', transferencia_entrada: 'Transferencia (entrada)' };

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
              <span className="tenue peq">Escriba la cantidad contada en la columna "Contado". Las filas vacías no cambian.</span>
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
                      <td style={{ fontWeight: 600 }}>{f.descripcion}</td>
                      <td className="mono tenue">{f.sku ?? ''}</td>
                      <td className="der num" style={{ color: Number(f.cantidad) <= 0 ? 'var(--bad)' : undefined, fontWeight: 600 }}>
                        {cantidad(f.cantidad)} <span className="tenue peq">{f.unidad === 'unidad' ? '' : f.unidad}</span>
                      </td>
                      {ajustando && (
                        <td className="der">
                          <input className="entrada num" style={{ width: 110, height: 32 }} inputMode="decimal" value={contado[f.varianteId] ?? ''} onChange={(e) => setContado({ ...contado, [f.varianteId]: e.target.value.replace(',', '.').replace(/[^0-9.-]/g, '') })} />
                        </td>
                      )}
                      <td className="der">
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
      </div>
      {historial && <Movimientos fila={historial} depositoId={dep} alCerrar={() => setHistorial(null)} />}
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
