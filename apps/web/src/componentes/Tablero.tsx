import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Minus, PackageX, Receipt, Undo2, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dinero } from '../lib/operacion';

export interface DatosTablero {
  desde: string;
  hasta: string;
  ventas?: {
    cantidad: number;
    total: string;
    credito: string;
    ticketPromedio: string;
    anterior: { cantidad: number; total: string; ticketPromedio: string; desde: string; hasta: string };
    porDia: { fecha: string; cantidad: number; total: string }[];
    porHora: { hora: number; cantidad: number; total: string }[];
    porSucursal: { id: string; nombre: string; cantidad: number; total: string }[];
    porMedio: { medio: string; total: string }[];
    porVendedor: { id: string; nombre: string; cantidad: number; total: string }[];
    topProductos: { id: string; nombre: string; cantidad: string; total: string; margen?: string }[];
    devoluciones: { cantidad: number; total: string };
    anuladas: { cantidad: number; total: string };
  };
  ganancia?: { ventas: string; costo: string; margen: string; porcentaje: string };
  cobrar?: { saldo: string; vencido: string; clientesVencidos: number };
  pagar?: { saldo: string; vencido: string; proximos7: string };
  bancos?: { saldo: string };
  cajas?: { abiertas: number; efectivo: string; lista: { caja: string; sucursal: string; usuario: string; abiertaEn: string; efectivo: string }[] };
  stockBajo?: { cantidad: number; items: { varianteId: string; nombre: string; deposito: string; cantidad: string; minimo: string }[] };
  vencimientos?: { vencidos: number; porVencer: number };
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const masDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export type Periodo = 'hoy' | 'ayer' | '7' | '30' | 'mes' | 'mesAnterior';
export const PERIODOS: [Periodo, string][] = [
  ['hoy', 'Hoy'],
  ['ayer', 'Ayer'],
  ['7', 'Últimos 7 días'],
  ['30', 'Últimos 30 días'],
  ['mes', 'Este mes'],
  ['mesAnterior', 'Mes anterior'],
];
export function rangoPeriodo(p: Periodo): { desde: string; hasta: string } {
  const h = hoy();
  if (p === 'hoy') return { desde: h, hasta: h };
  if (p === 'ayer') return { desde: masDias(h, -1), hasta: masDias(h, -1) };
  if (p === '7') return { desde: masDias(h, -6), hasta: h };
  if (p === '30') return { desde: masDias(h, -29), hasta: h };
  if (p === 'mes') return { desde: `${h.slice(0, 8)}01`, hasta: h };
  const fin = masDias(`${h.slice(0, 8)}01`, -1);
  return { desde: `${fin.slice(0, 8)}01`, hasta: fin };
}

export function useTablero(p: Periodo, sucursalId?: string, refresco?: number) {
  const r = rangoPeriodo(p);
  return useQuery({
    queryKey: ['tablero', r.desde, r.hasta, sucursalId ?? ''],
    queryFn: () => api<DatosTablero>(`/tablero?desde=${r.desde}&hasta=${r.hasta}${sucursalId ? `&sucursalId=${sucursalId}` : ''}`),
    placeholderData: (x) => x,
    refetchInterval: refresco,
  });
}

const MEDIOS: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otros medios', credito: 'A crédito' };
const fmt = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
const corto = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1).replace('.', ',')} mil M` : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} M` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : fmt.format(v));

/** Variación contra el período anterior, con ícono y texto (no solo color). */
/** Horas a mostrar: de 6 a 22, ampliado si hubo ventas antes o después. */
export function horasDelDia(porHora: { hora: number; cantidad: number; total: string }[]) {
  const desde = Math.min(6, ...porHora.map((x) => x.hora));
  const hasta = Math.max(22, ...porHora.map((x) => x.hora));
  return Array.from({ length: hasta - desde + 1 }, (_, i) => {
    const h = desde + i;
    const x = porHora.find((p) => p.hora === h);
    return { etiqueta: `${h}h`, valor: Number(x?.total ?? 0), detalle: `${dinero(x?.total ?? 0)} · ${x?.cantidad ?? 0} ticket${x?.cantidad === 1 ? '' : 's'}` };
  });
}

export const unidades = (c: string) => `${c.replace('.', ',')} ${Number(c) === 1 ? 'unidad' : 'unidades'}`;

export function Variacion({ actual, anterior }: { actual: number; anterior: number }) {
  if (!anterior) return <small className="tenue">{actual ? 'Sin datos del período anterior' : '—'}</small>;
  const pct = ((actual - anterior) / anterior) * 100;
  const Icono = Math.abs(pct) < 0.5 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <small className={`variacion ${Math.abs(pct) < 0.5 ? '' : pct > 0 ? 'sube' : 'baja'}`}>
      <Icono size={13} /> {pct > 0 ? '+' : ''}
      {pct.toFixed(1).replace('.', ',')} % vs. período anterior
    </small>
  );
}

/** Barras verticales de una sola serie, con tooltip al pasar el mouse. */
export function Barras({ datos, alto = 180, etiquetaCada = 1 }: { datos: { etiqueta: string; valor: number; detalle: string }[]; alto?: number; etiquetaCada?: number }) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const ancho = 100 / Math.max(1, datos.length);
  return (
    <div className="barras" style={{ height: alto }} onMouseLeave={() => setActivo(null)}>
      <div className="barras-area">
        {datos.map((d, i) => (
          <div key={i} className="barras-col" style={{ width: `${ancho}%` }} onMouseEnter={() => setActivo(i)} onFocus={() => setActivo(i)} tabIndex={0} aria-label={`${d.etiqueta}: ${d.detalle}`}>
            <div className={`barras-barra${activo === i ? ' activa' : ''}`} style={{ height: `${(d.valor / max) * 100}%` }} />
          </div>
        ))}
        {activo !== null && datos[activo] && (
          <div className="barras-tip" style={{ left: `${Math.min(85, Math.max(15, (activo + 0.5) * ancho))}%` }}>
            <b>{datos[activo].etiqueta}</b>
            <span>{datos[activo].detalle}</span>
          </div>
        )}
      </div>
      <div className="barras-ejes">
        {datos.map((d, i) => (
          <span key={i} style={{ width: `${ancho}%` }}>{i % etiquetaCada === 0 ? d.etiqueta : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Ranking horizontal: barra proporcional y el valor en texto. */
export function Ranking({ filas }: { filas: { nombre: string; valor: number; texto: string; detalle?: string }[] }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <div className="ranking">
      {filas.map((f, i) => (
        <div key={i} className="ranking-fila" title={f.detalle}>
          <div className="ranking-cab"><span>{f.nombre}</span><b className="num">{f.texto}</b></div>
          <div className="ranking-pista"><i style={{ width: `${Math.max(1.5, (f.valor / max) * 100)}%` }} /></div>
          {f.detalle && <small className="tenue">{f.detalle}</small>}
        </div>
      ))}
    </div>
  );
}

function Tarjeta({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="panel tarjeta-tablero">
      <div className="tarjeta-cab"><h3>{titulo}</h3>{accion}</div>
      {children}
    </section>
  );
}

export function Alertas({ d }: { d: DatosTablero }) {
  const a: { icono: typeof AlertTriangle; texto: string; a?: string; tono: 'warn' | 'bad' | 'n' }[] = [];
  if (d.stockBajo?.cantidad) a.push({ icono: PackageX, texto: `${d.stockBajo.cantidad} producto${d.stockBajo.cantidad > 1 ? 's' : ''} bajo el stock mínimo`, a: '/informes?tab=stock', tono: 'warn' });
  if (d.vencimientos?.vencidos) a.push({ icono: CalendarClock, texto: `${d.vencimientos.vencidos} ${d.vencimientos.vencidos > 1 ? 'lotes vencidos' : 'lote vencido'} con stock: retírelos`, a: '/stock?tab=vencimientos', tono: 'bad' });
  if (d.vencimientos?.porVencer) a.push({ icono: CalendarClock, texto: `${d.vencimientos.porVencer} ${d.vencimientos.porVencer > 1 ? 'lotes vencen' : 'lote vence'} en los próximos 30 días`, a: '/stock?tab=vencimientos', tono: 'warn' });
  if (d.cobrar && Number(d.cobrar.vencido)) a.push({ icono: Receipt, texto: `${dinero(d.cobrar.vencido)} vencido por cobrar (${d.cobrar.clientesVencidos} cliente${d.cobrar.clientesVencidos > 1 ? 's' : ''})`, a: '/cuentas-cobrar', tono: 'bad' });
  if (d.pagar && Number(d.pagar.vencido)) a.push({ icono: Wallet, texto: `${dinero(d.pagar.vencido)} vencido por pagar`, a: '/cuentas-pagar', tono: 'bad' });
  if (d.pagar && Number(d.pagar.proximos7)) a.push({ icono: Wallet, texto: `${dinero(d.pagar.proximos7)} a pagar en los próximos 7 días`, a: '/cuentas-pagar', tono: 'warn' });
  if (d.ventas?.anuladas.cantidad) a.push({ icono: AlertTriangle, texto: `${d.ventas.anuladas.cantidad} venta${d.ventas.anuladas.cantidad > 1 ? 's' : ''} anulada${d.ventas.anuladas.cantidad > 1 ? 's' : ''} por ${dinero(d.ventas.anuladas.total)}`, a: '/ventas', tono: 'n' });
  if (d.ventas?.devoluciones.cantidad) a.push({ icono: Undo2, texto: `${d.ventas.devoluciones.cantidad} ${d.ventas.devoluciones.cantidad > 1 ? 'devoluciones' : 'devolución'} por ${dinero(d.ventas.devoluciones.total)}`, a: '/ventas', tono: 'n' });
  if (!a.length) return <p className="tenue peq" style={{ margin: 0, padding: '4px 0' }}>Sin alertas para el período.</p>;
  return (
    <ul className="alertas">
      {a.map((x, i) => (
        <li key={i} className={`alerta-${x.tono}`}>
          <x.icono size={16} />
          {x.a ? <Link to={x.a}>{x.texto}</Link> : <span>{x.texto}</span>}
        </li>
      ))}
    </ul>
  );
}

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/** Tablero completo para la pantalla de inicio. */
export function Tablero({ d }: { d: DatosTablero }) {
  const v = d.ventas;
  // Días del período sin ventas también se muestran (en cero).
  const dias: { fecha: string; total: number; cantidad: number }[] = [];
  if (v && d.desde !== d.hasta) {
    for (let f = d.desde; f <= d.hasta; f = masDias(f, 1)) {
      const x = v.porDia.find((p) => p.fecha === f);
      dias.push({ fecha: f, total: Number(x?.total ?? 0), cantidad: x?.cantidad ?? 0 });
    }
  }
  return (
    <>
      <section className="panel cifras" style={{ marginBottom: 16 }}>
        {v && (
          <>
            <div className="cifra"><span>Ventas</span><b className="num">{dinero(v.total)}</b><Variacion actual={Number(v.total)} anterior={Number(v.anterior.total)} /></div>
            <div className="cifra"><span>Tickets</span><b className="num">{v.cantidad}</b><Variacion actual={v.cantidad} anterior={v.anterior.cantidad} /></div>
            <div className="cifra"><span>Ticket promedio</span><b className="num">{dinero(v.ticketPromedio)}</b><Variacion actual={Number(v.ticketPromedio)} anterior={Number(v.anterior.ticketPromedio)} /></div>
          </>
        )}
        {d.ganancia && <div className="cifra"><span>Margen bruto</span><b className="num">{dinero(d.ganancia.margen)}</b><small className="tenue">{d.ganancia.porcentaje.replace('.', ',')} % sobre ventas</small></div>}
        {d.cajas && <div className="cifra"><span>Efectivo en cajas abiertas</span><b className="num">{dinero(d.cajas.efectivo)}</b><small className="tenue">{d.cajas.abiertas} caja{d.cajas.abiertas === 1 ? '' : 's'} abierta{d.cajas.abiertas === 1 ? '' : 's'}</small></div>}
        {d.bancos && <div className="cifra"><span>Saldo en bancos</span><b className="num">{dinero(d.bancos.saldo)}</b></div>}
      </section>

      <div className="tablero-grilla">
        {v && (
          <Tarjeta titulo={dias.length ? 'Ventas por día' : 'Ventas por hora'}>
            {dias.length ? (
              <Barras datos={dias.map((x) => ({ etiqueta: fechaCorta(x.fecha), valor: x.total, detalle: `${dinero(x.total)} · ${x.cantidad} ticket${x.cantidad === 1 ? '' : 's'}` }))} etiquetaCada={Math.ceil(dias.length / 10)} />
            ) : (
              <Barras datos={horasDelDia(v.porHora)} etiquetaCada={2} />
            )}
          </Tarjeta>
        )}
        <Tarjeta titulo="Alertas"><Alertas d={d} /></Tarjeta>
        {v && v.topProductos.length > 0 && (
          <Tarjeta titulo="Productos más vendidos" accion={<Link className="peq" to="/informes">Ver informe</Link>}>
            <Ranking filas={v.topProductos.map((p) => ({ nombre: p.nombre, valor: Number(p.total), texto: corto(Number(p.total)), detalle: `${unidades(p.cantidad)}${p.margen ? ` · margen ${dinero(p.margen)}` : ''}` }))} />
          </Tarjeta>
        )}
        {v && v.porMedio.length > 0 && (
          <Tarjeta titulo="Medios de pago">
            <Ranking filas={v.porMedio.map((m) => ({ nombre: MEDIOS[m.medio] ?? m.medio, valor: Number(m.total), texto: `${Math.round((Number(m.total) / Math.max(1, Number(v.total))) * 100)} %`, detalle: dinero(m.total) }))} />
          </Tarjeta>
        )}
        {v && v.porSucursal.length > 1 && (
          <Tarjeta titulo="Por sucursal">
            <Ranking filas={v.porSucursal.map((s) => ({ nombre: s.nombre, valor: Number(s.total), texto: corto(Number(s.total)), detalle: `${s.cantidad} tickets` }))} />
          </Tarjeta>
        )}
        {v && v.porVendedor.length > 0 && (
          <Tarjeta titulo="Por vendedor">
            <Ranking filas={v.porVendedor.map((s) => ({ nombre: s.nombre, valor: Number(s.total), texto: corto(Number(s.total)), detalle: `${s.cantidad} tickets` }))} />
          </Tarjeta>
        )}
        {(d.cobrar || d.pagar) && (
          <Tarjeta titulo="Cuentas">
            <dl className="datos">
              {d.cobrar && <><dt>Por cobrar</dt><dd className="num">{dinero(d.cobrar.saldo)}</dd><dt>Vencido por cobrar</dt><dd className="num">{dinero(d.cobrar.vencido)}</dd></>}
              {d.pagar && <><dt>Por pagar</dt><dd className="num">{dinero(d.pagar.saldo)}</dd><dt>Vence en 7 días</dt><dd className="num">{dinero(d.pagar.proximos7)}</dd></>}
            </dl>
          </Tarjeta>
        )}
        {d.cajas && d.cajas.lista.length > 0 && (
          <Tarjeta titulo="Cajas abiertas">
            <Ranking filas={d.cajas.lista.map((c) => ({ nombre: `${c.caja} · ${c.usuario}`, valor: Number(c.efectivo), texto: dinero(c.efectivo), detalle: `${c.sucursal} · desde las ${new Date(c.abiertaEn).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}` }))} />
          </Tarjeta>
        )}
      </div>
    </>
  );
}
