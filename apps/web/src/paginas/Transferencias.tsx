import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { cantidad, type Deposito, type FilaStock } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface Transferencia {
  id: string;
  numero: number;
  estado: 'en_transito' | 'recibida' | 'cancelada';
  nota: string | null;
  origen: { id: string; nombre: string; sucursal: string; sucursalId: string };
  destino: { id: string; nombre: string; sucursal: string; sucursalId: string };
  creadoEn: string;
  creadoPor: string | null;
  recibidaEn: string | null;
  recibidaPor: string | null;
  canceladaPor: string | null;
  motivoCancelacion: string | null;
  items: { linea: number; descripcion: string; unidad: string; cantidad: string; cantidadRecibida: string | null; faltante: string | null }[];
}

const ESTADO = { en_transito: { texto: 'En tránsito', clase: 'i-warn' }, recibida: { texto: 'Recibida', clase: 'i-ok' }, cancelada: { texto: 'Cancelada', clase: 'i-n' } } as const;

export function Transferencias() {
  const { puede } = useSesion();
  const lista = useQuery({ queryKey: ['transferencias'], queryFn: () => api<Transferencia[]>('/transferencias') });
  const [abierta, setAbierta] = useState<Transferencia | 'nueva' | null>(null);
  return (
    <>
      <Encabezado titulo="Transferencias">
        {puede('transferencia.crear') && (
          <button className="btn pri" onClick={() => setAbierta('nueva')}>
            <Plus size={16} /> Nueva transferencia
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.length ? (
            <Vacio titulo="Sin transferencias">Mueva mercadería entre depósitos o sucursales.</Vacio>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Recorrido</th>
                  <th className="der">Productos</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.data.map((t) => (
                  <tr key={t.id} className="clic" onClick={() => setAbierta(t)}>
                    <td className="num">{t.numero}</td>
                    <td className="peq num">{fechaHora(t.creadoEn)}</td>
                    <td>
                      {t.origen.sucursal} · {t.origen.nombre} <ArrowRight size={14} style={{ verticalAlign: -2, color: 'var(--t3)' }} /> {t.destino.sucursal} · {t.destino.nombre}
                    </td>
                    <td className="der num">{t.items.length}</td>
                    <td>
                      <span className={`insignia ${ESTADO[t.estado].clase}`}>{ESTADO[t.estado].texto}</span>
                      {t.items.some((i) => Number(i.faltante) > 0) && <span className="insignia i-bad" style={{ marginLeft: 6 }}>Con faltantes</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {abierta === 'nueva' && <NuevaTransferencia alCerrar={() => setAbierta(null)} />}
      {abierta && abierta !== 'nueva' && <FichaTransferencia t={abierta} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function NuevaTransferencia({ alCerrar }: { alCerrar: () => void }) {
  const qc = useQueryClient();
  const depositos = useQuery({ queryKey: ['depositos'], queryFn: () => api<Deposito[]>('/depositos') });
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<(FilaStock & { mover: string })[]>([]);
  const [directa, setDirecta] = useState(false);
  const [nota, setNota] = useState('');
  const orig = origen || depositos.data?.[0]?.id || '';
  const dest = destino || depositos.data?.find((d) => d.id !== orig)?.id || '';
  const mismaSucursal = depositos.data?.find((d) => d.id === orig)?.sucursal.id === depositos.data?.find((d) => d.id === dest)?.sucursal.id;
  const busqueda = useQuery({ queryKey: ['stock', orig, q], queryFn: () => api<FilaStock[]>(`/stock?depositoId=${orig}&q=${encodeURIComponent(q)}&limite=20`), enabled: Boolean(orig && q.length > 1) });
  const crear = useMutation({
    mutationFn: () => api('/transferencias', { metodo: 'POST', cuerpo: { origenId: orig, destinoId: dest, directa: directa || mismaSucursal, nota: nota || null, items: items.map((i) => ({ varianteId: i.varianteId, cantidad: Number(i.mover) })) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transferencias'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
      alCerrar();
    },
  });
  // La lista de depósitos ya viene filtrada por el servidor según el alcance del usuario.
  const origenes = depositos.data ?? [];
  return (
    <Cajon
      titulo="Nueva transferencia"
      alCerrar={alCerrar}
      pie={<button className="btn pri" disabled={!items.length || items.some((i) => !(Number(i.mover) > 0)) || !dest || crear.isPending} onClick={() => crear.mutate()}>{directa || mismaSucursal ? 'Transferir' : 'Enviar'}</button>}
    >
      <ErrorApi error={crear.error} />
      <div className="fila-campos">
        <Campo etiqueta="Desde" id="to">
          <select id="to" className="entrada" value={orig} onChange={(e) => { setOrigen(e.target.value); setItems([]); }}>
            {origenes.map((d) => <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Hacia" id="td">
          <select id="td" className="entrada" value={dest} onChange={(e) => setDestino(e.target.value)}>
            {depositos.data?.filter((d) => d.id !== orig).map((d) => <option key={d.id} value={d.id}>{d.sucursal.nombre} · {d.nombre}</option>)}
          </select>
        </Campo>
      </div>
      {!mismaSucursal && (
        <label className="casilla">
          <input type="checkbox" checked={directa} onChange={(e) => setDirecta(e.target.checked)} /> Entrega inmediata (sin esperar la confirmación del destino)
        </label>
      )}
      {!directa && !mismaSucursal && <Aviso tipo="info">La mercadería sale ahora y queda "en tránsito" hasta que la sucursal de destino confirme lo que llegó.</Aviso>}
      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--t3)' }} />
        <input className="entrada" style={{ paddingLeft: 36 }} placeholder="Buscar producto para agregar" value={q} onChange={(e) => setQ(e.target.value)} />
        {busqueda.data && q.length > 1 && (
          <div className="pdv-resultados" style={{ top: 44, left: 0, right: 0 }}>
            {busqueda.data.filter((f) => !items.some((i) => i.varianteId === f.varianteId)).map((f) => (
              <button key={f.varianteId} onClick={() => { setItems([...items, { ...f, mover: '' }]); setQ(''); }}>
                <span style={{ flex: 1 }}>{f.descripcion}</span>
                <span className="tenue peq">hay {cantidad(f.cantidad)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <table>
          <thead><tr><th>Producto</th><th className="der">Disponible</th><th className="der">Mover</th><th /></tr></thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.varianteId}>
                <td>{i.descripcion}</td>
                <td className="der num tenue">{cantidad(i.cantidad)}</td>
                <td className="der"><input className="entrada num" style={{ width: 90, height: 32 }} inputMode="decimal" autoFocus={n === items.length - 1} value={i.mover} onChange={(e) => setItems(items.map((x, j) => (j === n ? { ...x, mover: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') } : x)))} /></td>
                <td className="der"><button className="enlace" aria-label="Quitar" onClick={() => setItems(items.filter((_, j) => j !== n))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Campo etiqueta="Nota (opcional)" id="tn">
        <input id="tn" className="entrada" placeholder="Chofer, vehículo, remisión…" value={nota} onChange={(e) => setNota(e.target.value)} />
      </Campo>
    </Cajon>
  );
}

function FichaTransferencia({ t, alCerrar }: { t: Transferencia; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const [recibido, setRecibido] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const fin = () => {
    void qc.invalidateQueries({ queryKey: ['transferencias'] });
    void qc.invalidateQueries({ queryKey: ['stock'] });
    alCerrar();
  };
  const recibir = useMutation({ mutationFn: () => api(`/transferencias/${t.id}/recibir`, { metodo: 'POST', cuerpo: { items: Object.entries(recibido).filter(([, v]) => v !== '').map(([l, v]) => ({ linea: Number(l), cantidadRecibida: Number(v) })) } }), onSuccess: fin });
  const cancelar = useMutation({ mutationFn: () => api(`/transferencias/${t.id}/cancelar`, { metodo: 'POST', cuerpo: { motivo } }), onSuccess: fin });
  const enDestino = yo?.usuario.esPropietario || yo?.sucursales.some((s) => s.id === t.destino.sucursalId);
  const pendiente = t.estado === 'en_transito';
  return (
    <Cajon titulo={`Transferencia N.º ${t.numero}`} alCerrar={alCerrar}>
      <ErrorApi error={recibir.error ?? cancelar.error} />
      <p style={{ margin: 0 }}>
        <span className={`insignia ${ESTADO[t.estado].clase}`}>{ESTADO[t.estado].texto}</span>{' '}
        {t.origen.sucursal} · {t.origen.nombre} → {t.destino.sucursal} · {t.destino.nombre}
      </p>
      <p className="tenue peq" style={{ margin: 0 }}>
        Enviada por {t.creadoPor} el {fechaHora(t.creadoEn)}
        {t.recibidaEn && ` · recibida por ${t.recibidaPor} el ${fechaHora(t.recibidaEn)}`}
        {t.canceladaPor && ` · cancelada por ${t.canceladaPor}: ${t.motivoCancelacion}`}
        {t.nota && ` · ${t.nota}`}
      </p>
      <table>
        <thead><tr><th>Producto</th><th className="der">Enviado</th><th className="der">{pendiente ? 'Llegó' : 'Recibido'}</th></tr></thead>
        <tbody>
          {t.items.map((i) => (
            <tr key={i.linea}>
              <td>{i.descripcion}</td>
              <td className="der num">{cantidad(i.cantidad)}</td>
              <td className="der num">
                {pendiente && enDestino && puede('transferencia.aprobar') ? (
                  <input className="entrada num" style={{ width: 90, height: 32 }} inputMode="decimal" placeholder={cantidad(i.cantidad)} value={recibido[i.linea] ?? ''} onChange={(e) => setRecibido({ ...recibido, [i.linea]: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} />
                ) : i.cantidadRecibida !== null ? (
                  <span style={{ color: Number(i.faltante) > 0 ? 'var(--bad)' : undefined }}>
                    {cantidad(i.cantidadRecibida)}
                    {Number(i.faltante) > 0 && ` (faltan ${cantidad(i.faltante!)})`}
                  </span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pendiente && enDestino && puede('transferencia.aprobar') && (
        <div className="form">
          <span className="tenue peq">Deje vacío lo que llegó completo. Si falta algo, escriba lo que realmente llegó: la diferencia queda registrada.</span>
          <div><button className="btn pri" disabled={recibir.isPending} onClick={() => recibir.mutate()}>Confirmar recepción</button></div>
        </div>
      )}
      {pendiente && puede('transferencia.cancelar') && (
        cancelando ? (
          <div className="form">
            <Campo etiqueta="Motivo de la cancelación" id="tm"><input id="tm" className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn peligro" disabled={motivo.trim().length < 3 || cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar y devolver al origen</button>
              <button className="btn" onClick={() => setCancelando(false)}>Volver</button>
            </div>
          </div>
        ) : (
          <div><button className="btn chico peligro" onClick={() => setCancelando(true)}>Cancelar transferencia</button></div>
        )
      )}
    </Cajon>
  );
}
