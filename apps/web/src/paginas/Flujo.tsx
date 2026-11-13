import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

interface Resumen { ventas: string; cobros: string; ingresos: string; pagos: string; devoluciones: string; gastos: string; sueldos: string; entradas: string; salidas: string; neto: string }
interface FlujoCaja {
  desde: string;
  hasta: string;
  real: { totales: Resumen; dias: (Resumen & { fecha: string })[] };
  proyeccion: { desde: string; dias: number; saldoBancos: string; vencido: { cobrar: string; pagar: string }; items: { fecha: string; cobrar: string; pagar: string; acumulado: string }[]; saldoProyectado: string };
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaCorta = (f: string) => f.split('-').reverse().join('/');

export function Flujo() {
  const { puede } = useSesion();
  const [desde, setDesde] = useState(hoy().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoy());
  const [dias, setDias] = useState(30);
  const q = useQuery({ queryKey: ['flujo', desde, hasta, dias], queryFn: () => api<FlujoCaja>(`/finanzas/flujo?desde=${desde}&hasta=${hasta}&dias=${dias}`), placeholderData: (p) => p });
  const d = q.data;
  const maximo = d ? Math.max(1, ...d.real.dias.map((x) => Math.max(Number(x.entradas), Number(x.salidas)))) : 1;
  const exportar = () => {
    if (!d) return;
    const filas = [['Fecha', 'Ventas al contado', 'Cobros', 'Ingresos bancarios', 'Pagos a proveedores', 'Devoluciones', 'Gastos bancarios', 'Sueldos', 'Entradas', 'Salidas', 'Neto']];
    for (const x of d.real.dias) filas.push([x.fecha, x.ventas, x.cobros, x.ingresos, x.pagos, x.devoluciones, x.gastos, x.sueldos, x.entradas, x.salidas, x.neto]);
    const t = d.real.totales;
    filas.push(['Total', t.ventas, t.cobros, t.ingresos, t.pagos, t.devoluciones, t.gastos, t.sueldos, t.entradas, t.salidas, t.neto]);
    const csv = filas.map((f) => f.join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `flujo-de-caja-${desde}-a-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <Encabezado titulo="Flujo de caja">
        {puede('flujo_caja.exportar') && d && <button className="btn" onClick={exportar}><Download size={16} /> Exportar CSV</button>}
      </Encabezado>
      <div className="contenido">
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="filtros" style={{ paddingTop: 16 }}>
            <Campo etiqueta="Desde" id="fl-d"><input id="fl-d" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
            <Campo etiqueta="Hasta" id="fl-h"><input id="fl-h" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
            <Campo etiqueta="Proyección" id="fl-p">
              <select id="fl-p" className="entrada" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
                <option value={15}>Próximos 15 días</option>
                <option value={30}>Próximos 30 días</option>
                <option value={60}>Próximos 60 días</option>
                <option value={90}>Próximos 90 días</option>
              </select>
            </Campo>
          </div>
        </section>
        <ErrorApi error={q.error} />
        {!d ? (
          q.isLoading && <Cargando />
        ) : (
          <>
            <section className="panel cifras" style={{ marginBottom: 16 }}>
              <div className="cifra"><span>Entradas</span><b className="num" style={{ color: 'var(--ok)' }}>{dinero(d.real.totales.entradas)}</b></div>
              <div className="cifra"><span>Salidas</span><b className="num" style={{ color: 'var(--bad)' }}>{dinero(d.real.totales.salidas)}</b></div>
              <div className="cifra"><span>Resultado del período</span><b className="num">{dinero(d.real.totales.neto)}</b></div>
            </section>

            <section className="panel" style={{ marginBottom: 16 }}>
              <h3 className="subtitulo" style={{ padding: '16px 20px 0', margin: 0 }}>Composición</h3>
              <table>
                <thead><tr><th>Entradas</th><th className="der">Monto</th><th>Salidas</th><th className="der">Monto</th></tr></thead>
                <tbody>
                  <tr><td>Ventas al contado</td><td className="der num">{dinero(d.real.totales.ventas)}</td><td>Pagos a proveedores</td><td className="der num">{dinero(d.real.totales.pagos)}</td></tr>
                  <tr><td>Cobros de clientes</td><td className="der num">{dinero(d.real.totales.cobros)}</td><td>Devoluciones reintegradas</td><td className="der num">{dinero(d.real.totales.devoluciones)}</td></tr>
                  <tr><td>Ingresos bancarios</td><td className="der num">{dinero(d.real.totales.ingresos)}</td><td>Gastos bancarios</td><td className="der num">{dinero(d.real.totales.gastos)}</td></tr>
                  <tr><td /><td /><td>Sueldos y aguinaldos pagados</td><td className="der num">{dinero(d.real.totales.sueldos)}</td></tr>
                </tbody>
              </table>
            </section>

            <section className="panel" style={{ marginBottom: 16 }}>
              <h3 className="subtitulo" style={{ padding: '16px 20px 0', margin: 0 }}>Movimiento diario</h3>
              {!d.real.dias.length ? (
                <Vacio titulo="Sin movimientos en el período" />
              ) : (
                <table>
                  <thead><tr><th>Fecha</th><th style={{ width: '40%' }} /><th className="der">Entradas</th><th className="der">Salidas</th><th className="der">Neto</th></tr></thead>
                  <tbody>
                    {d.real.dias.map((x) => (
                      <tr key={x.fecha}>
                        <td className="tenue">{fechaCorta(x.fecha)}</td>
                        <td>
                          <div className="barra-flujo"><span className="ent" style={{ width: `${(Number(x.entradas) / maximo) * 100}%` }} /></div>
                          <div className="barra-flujo"><span className="sal" style={{ width: `${(Number(x.salidas) / maximo) * 100}%` }} /></div>
                        </td>
                        <td className="der num">{dinero(x.entradas)}</td>
                        <td className="der num">{dinero(x.salidas)}</td>
                        <td className="der num" style={{ fontWeight: 600, color: Number(x.neto) < 0 ? 'var(--bad)' : undefined }}>{dinero(x.neto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="panel">
              <h3 className="subtitulo" style={{ padding: '16px 20px 0', margin: 0 }}>Proyección por vencimientos</h3>
              <p className="tenue peq" style={{ padding: '4px 20px 0', margin: 0 }}>Parte del saldo actual en bancos y suma lo que vence a cobrar y a pagar. Lo vencido se considera al inicio.</p>
              <table>
                <thead><tr><th>Fecha</th><th className="der">A cobrar</th><th className="der">A pagar</th><th className="der">Saldo proyectado</th></tr></thead>
                <tbody>
                  <tr><td className="tenue">Saldo en bancos hoy</td><td /><td /><td className="der num" style={{ fontWeight: 600 }}>{dinero(d.proyeccion.saldoBancos)}</td></tr>
                  {(Number(d.proyeccion.vencido.cobrar) > 0 || Number(d.proyeccion.vencido.pagar) > 0) && (
                    <tr>
                      <td style={{ color: 'var(--bad)' }}>Vencido</td>
                      <td className="der num">{dinero(d.proyeccion.vencido.cobrar)}</td>
                      <td className="der num">{dinero(d.proyeccion.vencido.pagar)}</td>
                      <td className="der num">{dinero(Number(d.proyeccion.saldoBancos) + Number(d.proyeccion.vencido.cobrar) - Number(d.proyeccion.vencido.pagar))}</td>
                    </tr>
                  )}
                  {d.proyeccion.items.map((x) => (
                    <tr key={x.fecha}>
                      <td className="tenue">{fechaCorta(x.fecha)}</td>
                      <td className="der num">{Number(x.cobrar) ? dinero(x.cobrar) : ''}</td>
                      <td className="der num">{Number(x.pagar) ? dinero(x.pagar) : ''}</td>
                      <td className="der num" style={{ fontWeight: 600, color: Number(x.acumulado) < 0 ? 'var(--bad)' : undefined }}>{dinero(x.acumulado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.proyeccion.items.length && <p className="tenue peq" style={{ padding: '0 20px 14px', margin: 0 }}>No hay vencimientos en los próximos {d.proyeccion.dias} días.</p>}
            </section>
          </>
        )}
      </div>
    </>
  );
}
