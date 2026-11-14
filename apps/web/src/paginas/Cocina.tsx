import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { useSesion } from '../lib/sesion';

interface ItemComanda { id: string; descripcion: string; cantidad: string; nota: string | null; estado: 'enviado' | 'preparando' | 'listo' }
interface ComandaCocina { comandaId: string; numero: number; cuenta: number; destino: string; mozo: string; enviadaEn: string; items: ItemComanda[] }

const minutos = (f: string) => Math.max(0, Math.floor((Date.now() - Date.parse(f)) / 60000));
const SIGUIENTE: Record<ItemComanda['estado'], ItemComanda['estado']> = { enviado: 'preparando', preparando: 'listo', listo: 'enviado' };

/** Aviso sonoro corto para una comanda nueva (sin archivos de audio). */
function pitido() {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.4);
  } catch {
    /* sin audio disponible */
  }
}

/**
 * Pantalla de cocina o de bar: comandas en orden de llegada con el tiempo transcurrido.
 * Tocar un producto lo pasa a "preparando" y luego a "listo"; el mozo lo ve en el salón.
 */
export function Cocina() {
  const { yo } = useSesion();
  const qc = useQueryClient();
  const [sucursalId, setSucursalId] = useState(yo?.sucursales[0]?.id ?? '');
  const [estacion, setEstacion] = useState<'cocina' | 'bar'>(() => (localStorage.getItem('kontiva.estacion') === 'bar' ? 'bar' : 'cocina'));
  const [sonido, setSonido] = useState(true);
  const [, setTic] = useState(0);
  const vistas = useRef<Set<string> | null>(null);
  const q = useQuery({ queryKey: ['cocina', sucursalId, estacion], queryFn: () => api<ComandaCocina[]>(`/cocina?sucursalId=${sucursalId}&estacion=${estacion}`), enabled: !!sucursalId, refetchInterval: 5000 });
  const cambiar = useMutation({
    mutationFn: (d: { items: string[]; estado: ItemComanda['estado'] }) => api('/cocina/items', { metodo: 'POST', cuerpo: d }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cocina'] }),
  });
  useEffect(() => {
    try {
      localStorage.setItem('kontiva.estacion', estacion);
    } catch {
      /* almacenamiento no disponible */
    }
    vistas.current = null;
  }, [estacion]);
  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.map((c) => c.comandaId));
    if (vistas.current && sonido && [...ids].some((id) => !vistas.current!.has(id))) pitido();
    vistas.current = ids;
  }, [q.data, sonido]);
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const pendientes = q.data?.filter((c) => c.items.some((i) => i.estado !== 'listo')) ?? [];
  const terminadas = q.data?.filter((c) => c.items.every((i) => i.estado === 'listo')) ?? [];
  return (
    <>
      <Encabezado titulo={estacion === 'cocina' ? 'Cocina' : 'Bar'}>
        {(yo?.sucursales.length ?? 0) > 1 && (
          <select className="entrada" aria-label="Sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            {yo?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        <div className="pestanas" style={{ margin: 0 }}>
          <button className={estacion === 'cocina' ? 'activa' : ''} onClick={() => setEstacion('cocina')}>Cocina</button>
          <button className={estacion === 'bar' ? 'activa' : ''} onClick={() => setEstacion('bar')}>Bar</button>
        </div>
        <button className="btn" aria-label={sonido ? 'Silenciar' : 'Activar sonido'} onClick={() => setSonido(!sonido)}>{sonido ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
      </Encabezado>
      <div className="contenido">
        <ErrorApi error={q.error ?? cambiar.error} />
        {!q.data ? (
          <Cargando />
        ) : !q.data.length ? (
          <Vacio titulo="Sin comandas pendientes">Las comandas que envían los mozos aparecen aquí al instante.</Vacio>
        ) : (
          <>
            <div className="kds">
              {pendientes.map((c) => {
                const m = minutos(c.enviadaEn);
                return (
                  <div key={c.comandaId} className={`comanda ${m >= 25 ? 'muy-tarde' : m >= 15 ? 'tarde' : ''}`}>
                    <div className="cab">
                      <span><b style={{ fontSize: 17 }}>{c.destino}</b> <span className="tenue peq">· comanda {c.numero} · {c.mozo}</span></span>
                      <b className="num">{m} min</b>
                    </div>
                    {c.items.map((i) => (
                      <button key={i.id} className={`item ${i.estado}`} disabled={cambiar.isPending} onClick={() => cambiar.mutate({ items: [i.id], estado: SIGUIENTE[i.estado] })}>
                        <b className="cant num">{Number(i.cantidad)}</b>
                        <span style={{ flex: 1 }}>
                          {i.descripcion}
                          {i.nota && <div className="nota">{i.nota}</div>}
                        </span>
                        <span className="tenue peq">{i.estado === 'preparando' ? 'Preparando' : i.estado === 'listo' ? 'Listo' : ''}</span>
                      </button>
                    ))}
                    <div style={{ padding: 10, borderTop: '1px solid var(--linea2)' }}>
                      <button className="btn pri" style={{ width: '100%' }} disabled={cambiar.isPending} onClick={() => cambiar.mutate({ items: c.items.filter((i) => i.estado !== 'listo').map((i) => i.id), estado: 'listo' })}>
                        <CheckCheck size={16} /> Todo listo
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {terminadas.length > 0 && (
              <>
                <h3 className="subtitulo" style={{ margin: '22px 0 10px' }}>Listas (últimos 15 minutos) · toque un producto para volverlo a pendiente</h3>
                <div className="kds">
                  {terminadas.map((c) => (
                    <div key={c.comandaId} className="comanda" style={{ opacity: 0.75 }}>
                      <div className="cab"><span><b>{c.destino}</b> <span className="tenue peq">· comanda {c.numero}</span></span></div>
                      {c.items.map((i) => (
                        <button key={i.id} className={`item ${i.estado}`} onClick={() => cambiar.mutate({ items: [i.id], estado: 'enviado' })}>
                          <b className="cant num">{Number(i.cantidad)}</b>
                          <span style={{ flex: 1 }}>{i.descripcion}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
