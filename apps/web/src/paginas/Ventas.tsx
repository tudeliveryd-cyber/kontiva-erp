import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { DialogoAutorizacion } from '../componentes/Autorizacion';
import { Ticket, TicketNotaCredito, type DevolucionNc } from '../componentes/Ticket';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { dinero, type CajaFila, type Venta } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import { abrirKude } from '../componentes/AccionesDocumento';

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
  const [modo, setModo] = useState<'ver' | 'autorizar' | 'anular' | 'devolver'>('ver');
  const [token, setToken] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState<string | null>(null); // devolución cuya nota de crédito se muestra
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
      {nota ? (
        <VerNotaCredito devolucionId={nota} venta={venta} empresa={{ nombre: yo.empresa.nombre, razonSocial: yo.empresa.razonSocial, ruc: yo.empresa.ruc }} alVolver={() => setNota(null)} />
      ) : (
        <div style={{ border: '1px solid var(--linea)', borderRadius: 8 }}>
          <Ticket venta={venta} empresa={{ nombre: yo.empresa.nombre, razonSocial: yo.empresa.razonSocial, ruc: yo.empresa.ruc }} />
        </div>
      )}
      {modo === 'ver' && !nota && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => window.print()}>
            <Printer size={16} /> Reimprimir
          </button>
          {venta.documentoElectronico && puede('documento_fiscal.ver') && (
            <button className="btn" onClick={() => void abrirKude(venta.documentoElectronico!.id).catch(() => undefined)}>
              <FileText size={16} /> KuDE A4
            </button>
          )}
          {venta.estado === 'confirmada' && puede('venta.crear') && venta.items.some((i) => Number(i.cantidadDevuelta) < Number(i.cantidad)) && (
            <button className="btn" onClick={() => setModo('devolver')}>
              Devolución
            </button>
          )}
          {venta.estado === 'confirmada' && puede('venta.crear') && venta.devoluciones.length === 0 && (
            <button className="btn peligro" onClick={() => setModo(puede('venta.cancelar') ? 'anular' : 'autorizar')}>
              Anular venta
            </button>
          )}
        </div>
      )}
      {venta.devoluciones.length > 0 && !nota && (
        <div className="tenue peq" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          Devoluciones:
          {venta.devoluciones.map((d) =>
            venta.comprobante === 'factura' ? (
              <button key={d.id} className="btn" style={{ height: 28, fontSize: 12.5 }} onClick={() => setNota(d.id)}>
                N.º {d.numero} · {dinero(d.total)} · nota de crédito
              </button>
            ) : (
              <span key={d.id}>N.º {d.numero} ({dinero(d.total)}, {fechaHora(d.fecha)})</span>
            ),
          )}
        </div>
      )}
      {modo === 'devolver' && (
        <Devolucion
          venta={venta}
          alTerminar={(r, devId) => {
            qc.setQueryData(['venta', id], r);
            void qc.invalidateQueries({ queryKey: ['ventas'] });
            setModo('ver');
            if (r.comprobante === 'factura') setNota(devId);
          }}
          alCancelar={() => setModo('ver')}
        />
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

function Devolucion({ venta, alTerminar, alCancelar }: { venta: Venta; alTerminar: (v: Venta, devolucionId: string) => void; alCancelar: () => void }) {
  const { puede } = useSesion();
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<CajaFila[]>('/cajas') });
  const propias = cajas.data?.filter((c) => c.sesion?.propia) ?? [];
  const [cant, setCant] = useState<Record<number, string>>({});
  const [medio, setMedio] = useState<'efectivo' | 'tarjeta' | 'transferencia' | 'otro'>('efectivo');
  const [motivo, setMotivo] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const items = Object.entries(cant).filter(([, v]) => Number(v) > 0).map(([l, v]) => ({ linea: Number(l), cantidad: Number(v) }));
  const estimado = items.reduce((a, i) => {
    const l = venta.items.find((x) => x.linea === i.linea)!;
    return a + (Number(l.total) * i.cantidad) / Number(l.cantidad);
  }, 0);
  const devolver = useMutation({
    mutationFn: async () => {
      const dev = await api<{ id: string }>('/devoluciones', { metodo: 'POST', cuerpo: { ventaId: venta.id, cajaId: propias[0]!.id, medio, motivo, items }, encabezados: token ? { 'X-Autorizacion': token } : undefined });
      return { venta: await api<Venta>(`/ventas/${venta.id}`), devId: dev.id };
    },
    onSuccess: (r) => alTerminar(r.venta, r.devId),
  });
  if (pidiendo) {
    return <DialogoAutorizacion permiso="devolucion.aprobar" titulo="Autorizar devolución" alAutorizar={(t) => { setToken(t); setPidiendo(false); }} alCerrar={() => setPidiendo(false)} />;
  }
  return (
    <div className="form" style={{ borderTop: '1px solid var(--linea)', paddingTop: 16 }}>
      <ErrorApi error={devolver.error} />
      {propias.length === 0 ? (
        <Aviso tipo="info">Para devolver dinero necesita su caja abierta. Abra la caja en "Cajas y PDV".</Aviso>
      ) : (
        <>
          <table>
            <thead><tr><th>Producto</th><th className="der">Vendido</th><th className="der">Devolver</th></tr></thead>
            <tbody>
              {venta.items.map((i) => {
                const queda = Number(i.cantidad) - Number(i.cantidadDevuelta);
                return (
                  <tr key={i.linea}>
                    <td>{i.descripcion}{Number(i.cantidadDevuelta) > 0 && <div className="tenue peq">ya devuelto {Number(i.cantidadDevuelta)}</div>}</td>
                    <td className="der num">{Number(i.cantidad)}</td>
                    <td className="der">
                      {queda > 0 ? <input className="entrada num" style={{ width: 80, height: 32 }} inputMode="decimal" placeholder={`máx. ${queda}`} value={cant[i.linea] ?? ''} onChange={(e) => setCant({ ...cant, [i.linea]: e.target.value.replace(',', '.').replace(/[^0-9.]/g, '') })} /> : <span className="tenue">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="fila-campos">
            <Campo etiqueta="Se reintegra en" id="dm">
              <select id="dm" className="entrada" value={medio} onChange={(e) => setMedio(e.target.value as typeof medio)}>
                <option value="efectivo">Efectivo (sale de {propias[0]!.nombre})</option>
                <option value="tarjeta">Reverso en tarjeta</option>
                <option value="transferencia">Transferencia</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
            <Campo etiqueta="Motivo" id="dmo">
              <input id="dmo" className="entrada" placeholder="Producto fallado, cambio de talle…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Campo>
          </div>
          <p style={{ margin: 0 }}>A reintegrar: <b>{dinero(Math.round(estimado))}</b> <span className="tenue peq">(proporcional al precio cobrado, con descuentos)</span></p>
          {!puede('devolucion.crear') && !token && <Aviso tipo="info">La devolución requiere la autorización de un supervisor.</Aviso>}
          <div style={{ display: 'flex', gap: 8 }}>
            {!puede('devolucion.crear') && !token ? (
              <button className="btn pri" disabled={!items.length} onClick={() => setPidiendo(true)}>Pedir autorización</button>
            ) : (
              <button className="btn pri" disabled={!items.length || motivo.trim().length < 3 || devolver.isPending} onClick={() => devolver.mutate()}>Registrar devolución</button>
            )}
            <button className="btn" onClick={alCancelar}>Volver</button>
          </div>
        </>
      )}
    </div>
  );
}

function VerNotaCredito({ devolucionId, venta, empresa, alVolver }: { devolucionId: string; venta: Venta; empresa: { nombre: string; razonSocial: string; ruc: string | null }; alVolver: () => void }) {
  const d = useQuery({ queryKey: ['devolucion', devolucionId], queryFn: () => api<DevolucionNc>(`/devoluciones/${devolucionId}`) });
  if (!d.data) return d.error ? <ErrorApi error={d.error} /> : <Cargando />;
  return (
    <>
      {d.data.notaCredito ? (
        <div style={{ border: '1px solid var(--linea)', borderRadius: 8 }}>
          <TicketNotaCredito dev={d.data} venta={venta} empresa={empresa} />
        </div>
      ) : (
        <Aviso tipo="info">Esta devolución no tiene nota de crédito electrónica.</Aviso>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {d.data.notaCredito && (
          <button className="btn" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir nota de crédito
          </button>
        )}
        <button className="btn" onClick={alVolver}>Volver a la venta</button>
      </div>
    </>
  );
}
