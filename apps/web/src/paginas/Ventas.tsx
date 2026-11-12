import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { DialogoAutorizacion } from '../componentes/Autorizacion';
import { Ticket } from '../componentes/Ticket';
import { Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { dinero, type Venta } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface FilaVenta {
  id: string;
  numero: number;
  fecha: string;
  total: string;
  estado: 'confirmada' | 'anulada';
  caja: string;
  vendedor: string;
  cliente: string | null;
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

export function Ventas() {
  const [fecha, setFecha] = useState(hoy());
  const [abierta, setAbierta] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['ventas', fecha],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limite: '100', desde: new Date(`${fecha}T00:00:00-03:00`).toISOString(), hasta: new Date(`${fecha}T23:59:59.999-03:00`).toISOString() });
      if (pageParam) p.set('cursor', pageParam);
      return api<{ items: FilaVenta[]; siguiente: string | null }>(`/ventas?${p}`);
    },
    getNextPageParam: (u) => u.siguiente,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const confirmadas = items.filter((v) => v.estado === 'confirmada');
  const total = confirmadas.reduce((a, v) => a + Number(v.total), 0);

  return (
    <>
      <Encabezado titulo="Ventas">
        <input type="date" className="entrada" style={{ width: 'auto' }} value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha" />
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="cifras">
            <div className="cifra"><span>Ventas</span><b className="num">{confirmadas.length}</b></div>
            <div className="cifra"><span>Total vendido</span><b className="num">{dinero(total)}</b></div>
            <div className="cifra"><span>Ticket promedio</span><b className="num">{dinero(confirmadas.length ? Math.round(total / confirmadas.length) : 0)}</b></div>
            <div className="cifra"><span>Anuladas</span><b className="num">{items.length - confirmadas.length}</b></div>
          </div>
        </section>
        <section className="panel">
          {q.isLoading ? (
            <Cargando />
          ) : items.length === 0 ? (
            <Vacio titulo="Sin ventas en esta fecha" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Hora</th>
                  <th>Caja</th>
                  <th>Vendedor</th>
                  <th>Cliente</th>
                  <th className="der">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} className="clic" onClick={() => setAbierta(v.id)} style={v.estado === 'anulada' ? { opacity: 0.55 } : undefined}>
                    <td className="num">{v.numero}</td>
                    <td className="num peq">{fechaHora(v.fecha)}</td>
                    <td>{v.caja}</td>
                    <td className="tenue">{v.vendedor}</td>
                    <td className="tenue">{v.cliente ?? 'Consumidor final'}</td>
                    <td className="der num" style={{ fontWeight: 600, textDecoration: v.estado === 'anulada' ? 'line-through' : undefined }}>{dinero(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {q.hasNextPage && (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <button className="btn" onClick={() => void q.fetchNextPage()}>Cargar más</button>
            </div>
          )}
        </section>
      </div>
      {abierta && <FichaVenta id={abierta} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function FichaVenta({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { yo, puede } = useSesion();
  const qc = useQueryClient();
  const v = useQuery({ queryKey: ['venta', id], queryFn: () => api<Venta>(`/ventas/${id}`) });
  const [modo, setModo] = useState<'ver' | 'autorizar' | 'anular'>('ver');
  const [token, setToken] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const anular = useMutation({
    mutationFn: () => api<Venta>(`/ventas/${id}/anular`, { metodo: 'POST', cuerpo: { motivo }, encabezados: token ? { 'X-Autorizacion': token } : undefined }),
    onSuccess: (r) => {
      qc.setQueryData(['venta', id], r);
      void qc.invalidateQueries({ queryKey: ['ventas'] });
      setModo('ver');
    },
  });
  if (!v.data || !yo) return <Cajon titulo="Venta" alCerrar={alCerrar}>{v.error ? <ErrorApi error={v.error} /> : <Cargando />}</Cajon>;
  const venta = v.data;
  return (
    <Cajon titulo={`Venta N.º ${venta.numero}`} alCerrar={alCerrar}>
      <ErrorApi error={anular.error} />
      {venta.anulacion && (
        <div className="aviso error">
          Anulada el {fechaHora(venta.anulacion.fecha)} por {venta.anulacion.por}: {venta.anulacion.motivo}
        </div>
      )}
      <div style={{ border: '1px solid var(--linea)', borderRadius: 8 }}>
        <Ticket venta={venta} empresa={{ nombre: yo.empresa.nombre, razonSocial: yo.empresa.razonSocial, ruc: yo.empresa.ruc }} />
      </div>
      {modo === 'ver' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => window.print()}>
            <Printer size={16} /> Reimprimir
          </button>
          {venta.estado === 'confirmada' && puede('venta.crear') && (
            <button className="btn peligro" onClick={() => setModo(puede('venta.cancelar') ? 'anular' : 'autorizar')}>
              Anular venta
            </button>
          )}
        </div>
      )}
      {modo === 'autorizar' && (
        <DialogoAutorizacion permiso="venta.cancelar" titulo="Autorizar anulación" alAutorizar={(t) => { setToken(t); setModo('anular'); }} alCerrar={() => setModo('ver')} />
      )}
      {modo === 'anular' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); anular.mutate(); }}>
          <Campo etiqueta="Motivo de la anulación" id="mo">
            <input id="mo" className="entrada" autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <p className="tenue peq" style={{ margin: 0 }}>El stock vuelve al depósito y el dinero se descuenta de la caja. Solo mientras la caja de la venta siga abierta.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn peligro" disabled={motivo.trim().length < 3 || anular.isPending}>Confirmar anulación</button>
            <button type="button" className="btn" onClick={() => setModo('ver')}>Volver</button>
          </div>
        </form>
      )}
    </Cajon>
  );
}
