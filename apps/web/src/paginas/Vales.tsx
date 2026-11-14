import { useQuery } from '@tanstack/react-query';
import { Printer, Search } from 'lucide-react';
import { useState } from 'react';
import { TicketVale, type ValeConsulta } from '../componentes/Ropa';
import { Cajon, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { fechaHora } from '../lib/formato';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface FilaVale { id: string; numero: number; codigo: string; sucursal: string; cliente: string | null; monto: string; saldo: string; vence: string | null; estado: ValeConsulta['estado']; creadoEn: string }
interface DetalleVale extends ValeConsulta {
  usuario: string | null;
  movimientos: { id: string; tipo: 'emision' | 'uso' | 'reintegro'; monto: string; saldo: string; fecha: string; venta: number | null; usuario: string | null }[];
}

const ESTADO: Record<ValeConsulta['estado'], { texto: string; clase: string }> = { vigente: { texto: 'Vigente', clase: 'i-ok' }, usado: { texto: 'Usado', clase: 'i-n' }, vencido: { texto: 'Vencido', clase: 'i-warn' } };
const MOV: Record<DetalleVale['movimientos'][number]['tipo'], string> = { emision: 'Emitido', uso: 'Usado en la venta', reintegro: 'Repuesto (venta anulada)' };
const fechaCorta = (f: string) => f.split('-').reverse().join('/');

/** Vales de cambio emitidos por devoluciones: saldo a favor de los clientes. */
export function Vales() {
  const [estado, setEstado] = useState<'vigente' | 'usado' | 'vencido' | ''>('vigente');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const lista = useQuery({ queryKey: ['vales', estado, q], queryFn: () => api<{ saldoVigente: string; items: FilaVale[] }>(`/vales?estado=${estado}&q=${encodeURIComponent(q.trim())}`), placeholderData: (p) => p });
  return (
    <>
      <Encabezado titulo="Vales de cambio" />
      <div className="contenido">
        {lista.data && (
          <section className="panel cifras" style={{ marginBottom: 16 }}>
            <div className="cifra"><span>Saldo vigente a favor de clientes</span><b className="num">{dinero(lista.data.saldoVigente)}</b><small className="tenue">Lo que todavía se puede canjear por mercadería</small></div>
          </section>
        )}
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <select className="entrada" aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
              <option value="vigente">Vigentes</option>
              <option value="usado">Usados</option>
              <option value="vencido">Vencidos</option>
              <option value="">Todos</option>
            </select>
            <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Código, cliente o documento" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <ErrorApi error={lista.error} />
          {!lista.data ? (
            <Cargando />
          ) : !lista.data.items.length ? (
            <Vacio titulo="Sin vales">Los vales se emiten al registrar una devolución como "Vale de cambio" o desde "Cambio de mercadería" en la caja.</Vacio>
          ) : (
            <table>
              <thead><tr><th>N.º</th><th>Emitido</th><th>Código</th><th>Cliente</th><th>Sucursal</th><th className="der">Monto</th><th className="der">Saldo</th><th>Vence</th><th>Estado</th></tr></thead>
              <tbody>
                {lista.data.items.map((v) => (
                  <tr key={v.id} className="clic" onClick={() => setAbierto(v.id)}>
                    <td className="num">{v.numero}</td>
                    <td className="tenue peq">{fechaHora(v.creadoEn)}</td>
                    <td className="mono">{v.codigo}</td>
                    <td>{v.cliente ?? <span className="tenue">—</span>}</td>
                    <td className="tenue">{v.sucursal}</td>
                    <td className="der num">{dinero(v.monto)}</td>
                    <td className="der num" style={{ fontWeight: 600 }}>{dinero(v.saldo)}</td>
                    <td className="tenue">{v.vence ? fechaCorta(v.vence) : 'No vence'}</td>
                    <td><span className={`insignia ${ESTADO[v.estado].clase}`}>{ESTADO[v.estado].texto}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {abierto && <VerVale id={abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

function VerVale({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const { yo } = useSesion();
  const q = useQuery({ queryKey: ['vale', id], queryFn: () => api<DetalleVale>(`/vales/${id}`) });
  const v = q.data;
  return (
    <Cajon titulo={v ? `Vale de cambio N.º ${v.numero}` : 'Vale de cambio'} alCerrar={alCerrar} pie={v && <button className="btn" onClick={() => window.print()}><Printer size={16} /> Reimprimir</button>}>
      <ErrorApi error={q.error} />
      {!v ? (
        <Cargando />
      ) : (
        <>
          <section className="panel cifras">
            <div className="cifra"><span>Saldo</span><b className="num">{dinero(v.saldo)}</b><small className="tenue">de {dinero(v.monto)}</small></div>
            <div className="cifra"><span>Estado</span><b><span className={`insignia ${ESTADO[v.estado].clase}`}>{ESTADO[v.estado].texto}</span></b><small className="tenue">{v.vence ? `Vence el ${fechaCorta(v.vence)}` : 'No vence'}</small></div>
          </section>
          <div className="tenue peq">
            Emitido en {v.sucursal}{v.usuario ? ` por ${v.usuario}` : ''}{v.venta ? ` · devolución de la venta N.º ${v.venta}` : ''}{v.cliente ? ` · ${v.cliente.nombre}${v.cliente.documento ? ` (${v.cliente.documento})` : ''}` : ''}
          </div>
          <table>
            <thead><tr><th>Fecha</th><th>Movimiento</th><th className="der">Importe</th><th className="der">Saldo</th></tr></thead>
            <tbody>
              {v.movimientos.map((m) => (
                <tr key={m.id}>
                  <td className="tenue peq">{fechaHora(m.fecha)}</td>
                  <td>{MOV[m.tipo]}{m.venta ? ` N.º ${m.venta}` : ''}{m.usuario && <span className="tenue peq"> · {m.usuario}</span>}</td>
                  <td className="der num">{dinero(m.monto)}</td>
                  <td className="der num">{dinero(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ border: '1px solid var(--linea)', borderRadius: 8 }}>
            <TicketVale vale={{ ...v, cliente: v.cliente?.nombre ?? null }} empresa={{ nombre: yo?.empresa.nombre ?? '', ruc: yo?.empresa.ruc }} />
          </div>
        </>
      )}
    </Cajon>
  );
}
