import { useQuery } from '@tanstack/react-query';
import { LogOut, Monitor, RefreshCw, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alertas, Barras, horasDelDia, Ranking, unidades, useTablero, Variacion, type Periodo } from '../componentes/Tablero';
import { Marca } from '../componentes/ui';
import { api, type SucursalFila } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

const PERIODOS_MOVIL: [Periodo, string][] = [
  ['hoy', 'Hoy'],
  ['ayer', 'Ayer'],
  ['7', '7 días'],
  ['mes', 'Mes'],
];

/** Aviso para instalar la app en la pantalla de inicio del celular (una vez descartado, no vuelve). */
function Instalar() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      const instalada = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
      setVisible(!instalada && localStorage.getItem('kontiva.instalar') !== 'no');
    } catch {
      setVisible(false);
    }
  }, []);
  if (!visible) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div className="movil-instalar">
      <Share size={18} />
      <span>{ios ? 'Para usarla como app: toque Compartir y luego "Agregar a inicio".' : 'Para usarla como app: abra el menú del navegador y elija "Instalar aplicación".'}</span>
      <button
        onClick={() => {
          try {
            localStorage.setItem('kontiva.instalar', 'no');
          } catch {
            /* sin almacenamiento */
          }
          setVisible(false);
        }}
      >
        Entendido
      </button>
    </div>
  );
}

/** App del dueño: lo esencial del negocio en el celular, actualizado cada minuto. */
export function Movil() {
  const { yo, puede, salir } = useSesion();
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [sucursalId, setSucursalId] = useState('');
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales'), enabled: puede('sucursal.ver') });
  const t = useTablero(periodo, sucursalId || undefined, 60_000);
  const d = t.data;
  const v = d?.ventas;
  return (
    <div className="movil">
      <header className="movil-cab">
        <Marca claro />
        <div className="movil-empresa">{yo?.empresa.nombre}</div>
      </header>
      <Instalar />
      <div className="movil-controles">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS_MOVIL.map(([k, x]) => (
            <button key={k} className={periodo === k ? 'activo' : ''} onClick={() => setPeriodo(k)}>{x}</button>
          ))}
        </div>
        <button className="btn" aria-label="Actualizar" style={{ height: 34, padding: '0 10px' }} onClick={() => void t.refetch()}>
          <RefreshCw size={16} className={t.isFetching ? 'girando' : undefined} />
        </button>
      </div>
      {(sucursales.data?.length ?? 0) > 1 && (
        <select aria-label="Sucursal" className="entrada" style={{ margin: '0 16px 12px', width: 'calc(100% - 32px)' }} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
          <option value="">Todas las sucursales</option>
          {sucursales.data!.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      )}
      {!d ? (
        <p className="tenue" style={{ textAlign: 'center', padding: 40 }}>Cargando…</p>
      ) : (
        <div className="movil-cuerpo">
          {v && (
            <section className="movil-tarjeta movil-heroe">
              <span>Ventas</span>
              <b className="num">{dinero(v.total)}</b>
              <Variacion actual={Number(v.total)} anterior={Number(v.anterior.total)} />
              <div className="movil-mini">
                <div><span>Tickets</span><b className="num">{v.cantidad}</b></div>
                <div><span>Promedio</span><b className="num">{dinero(v.ticketPromedio)}</b></div>
                {d.ganancia && <div><span>Margen</span><b className="num">{d.ganancia.porcentaje.replace('.', ',')} %</b></div>}
              </div>
            </section>
          )}
          {v && (
            <section className="movil-tarjeta">
              <h3>{periodo === 'hoy' || periodo === 'ayer' ? 'Por hora' : 'Por día'}</h3>
              {periodo === 'hoy' || periodo === 'ayer' ? (
                <Barras datos={horasDelDia(v.porHora)} alto={130} etiquetaCada={4} />
              ) : (
                <Barras datos={v.porDia.map((x) => ({ etiqueta: `${x.fecha.slice(8, 10)}/${x.fecha.slice(5, 7)}`, valor: Number(x.total), detalle: `${dinero(x.total)} · ${x.cantidad} tickets` }))} alto={130} etiquetaCada={Math.ceil(v.porDia.length / 6)} />
              )}
            </section>
          )}
          <section className="movil-tarjeta">
            <h3>Alertas</h3>
            <Alertas d={d} />
          </section>
          {d.cajas && (
            <section className="movil-tarjeta">
              <h3>Cajas abiertas · {dinero(d.cajas.efectivo)} en efectivo</h3>
              {d.cajas.lista.length ? (
                <Ranking filas={d.cajas.lista.map((c) => ({ nombre: `${c.caja} · ${c.usuario}`, valor: Number(c.efectivo), texto: dinero(c.efectivo), detalle: c.sucursal }))} />
              ) : (
                <p className="tenue peq" style={{ margin: 0 }}>No hay cajas abiertas.</p>
              )}
            </section>
          )}
          {v && v.porSucursal.length > 1 && (
            <section className="movil-tarjeta">
              <h3>Por sucursal</h3>
              <Ranking filas={v.porSucursal.map((s) => ({ nombre: s.nombre, valor: Number(s.total), texto: dinero(s.total) }))} />
            </section>
          )}
          {v && v.topProductos.length > 0 && (
            <section className="movil-tarjeta">
              <h3>Lo más vendido</h3>
              <Ranking filas={v.topProductos.slice(0, 5).map((p) => ({ nombre: p.nombre, valor: Number(p.total), texto: dinero(p.total), detalle: unidades(p.cantidad) }))} />
            </section>
          )}
          {(d.cobrar || d.bancos || d.pagar) && (
            <section className="movil-tarjeta">
              <h3>Dinero</h3>
              <dl className="datos">
                {d.bancos && <><dt>En bancos</dt><dd className="num">{dinero(d.bancos.saldo)}</dd></>}
                {d.cobrar && <><dt>Por cobrar</dt><dd className="num">{dinero(d.cobrar.saldo)}</dd></>}
                {d.pagar && <><dt>A pagar en 7 días</dt><dd className="num">{dinero(d.pagar.proximos7)}</dd></>}
              </dl>
            </section>
          )}
          {!v && !d.cajas && !d.cobrar && <p className="tenue" style={{ textAlign: 'center', padding: 20 }}>Su perfil no tiene acceso a los indicadores del negocio.</p>}
        </div>
      )}
      <footer className="movil-pie">
        <Link to="/"><Monitor size={16} /> Sistema completo</Link>
        <button onClick={() => void salir()}><LogOut size={16} /> Salir</button>
        <small>KONTIVA ERP · Desarrollado por Araújo Tech Sistemas</small>
      </footer>
    </div>
  );
}
