import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Encabezado } from '../componentes/ui';
import { api, type EmpresaDatos, type UsuarioFila } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

function Uso({ etiqueta, uso, limite }: { etiqueta: string; uso: number; limite: number | null }) {
  return (
    <div className="cifra">
      <span>{etiqueta}</span>
      <b className="num">
        {uso}
        <span style={{ fontSize: 14, color: 'var(--t3)', fontWeight: 500 }}> / {limite ?? 'ilimitado'}</span>
      </b>
      {limite !== null && (
        <div className="barra">
          <i style={{ width: `${Math.min(100, (uso / limite) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function Inicio() {
  const { yo, puede } = useSesion();
  const empresa = useQuery({ queryKey: ['empresa'], queryFn: () => api<EmpresaDatos>('/empresa'), enabled: puede('empresa.ver') });
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<UsuarioFila[]>('/usuarios'), enabled: puede('usuario.ver') });
  const productos = useQuery({ queryKey: ['productos-conteo'], queryFn: () => api<{ total: number }>('/productos?limite=1'), enabled: puede('producto.ver') });
  const cajas = useQuery({ queryKey: ['cajas'], queryFn: () => api<{ id: string }[]>('/cajas'), enabled: puede('caja.ver') });
  const ventasHoy = useQuery({
    queryKey: ['ventas-hoy'],
    queryFn: () => {
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
      return api<{ items: { total: string; estado: string }[] }>(`/ventas?limite=200&estado=confirmada&desde=${new Date(`${hoy}T00:00:00-03:00`).toISOString()}`);
    },
    enabled: puede('venta.ver'),
    refetchInterval: 60_000,
  });
  if (!yo) return null;

  // Asistente de configuración inicial: se basa solo en datos reales de la empresa.
  const pasos = [
    puede('empresa.editar') && {
      hecho: Boolean(empresa.data?.ruc),
      titulo: 'Completar los datos de la empresa',
      detalle: 'RUC, dirección y teléfono. Son necesarios para la facturación electrónica.',
      a: '/empresa',
    },
    puede('sucursal.ver') && {
      hecho: (empresa.data?.plan.uso.sucursales ?? 0) > 0,
      titulo: 'Revisar sucursales',
      detalle: 'Cada sucursal es un establecimiento con su código de 3 dígitos (001, 002…).',
      a: '/sucursales',
    },
    puede('usuario.crear') && {
      hecho: (usuarios.data?.length ?? 0) > 1,
      titulo: 'Invitar a su equipo',
      detalle: 'Cada persona entra con su propio usuario y perfil de acceso.',
      a: '/usuarios',
    },
    puede('producto.crear') && {
      hecho: (productos.data?.total ?? 0) > 0,
      titulo: 'Cargar productos y su stock inicial',
      detalle: 'Con precio, IVA y código de barras. El stock inicial se carga en Stock → Cargar conteo.',
      a: '/productos',
    },
    puede('caja.editar') && {
      hecho: (cajas.data?.length ?? 0) > 0,
      titulo: 'Crear la caja y la cotización del día',
      detalle: 'Si cobra en dólares o reales, cargue la cotización de compra y venta.',
      a: '/cajas',
    },
    {
      hecho: yo.usuario.tienePin,
      titulo: 'Definir su PIN de autorización',
      detalle: 'Lo usará para autorizar cancelaciones y descuentos en la caja sin cerrar la sesión del cajero.',
      a: '/cuenta',
    },
  ].filter(Boolean) as { hecho: boolean; titulo: string; detalle: string; a: string }[];
  const pendientes = pasos.filter((p) => !p.hecho).length;

  return (
    <>
      <Encabezado titulo={`Hola, ${yo.usuario.nombre.split(' ')[0]}`}>
        <span className="insignia i-p">Plan {yo.empresa.plan}</span>
      </Encabezado>
      <div className="contenido">
        {pasos.length > 0 && (
          <section className="panel">
            <div className="panel-cab">
              <h2>Configuración inicial</h2>
              <span className="sub">{pendientes === 0 ? 'Todo listo' : `${pendientes} paso${pendientes === 1 ? '' : 's'} pendiente${pendientes === 1 ? '' : 's'}`}</span>
            </div>
            <div className="pasos">
              {pasos.map((p) => (
                <Link key={p.titulo} to={p.a} className="paso" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className={`icono ${p.hecho ? 'hecho' : 'pend'}`}>{p.hecho ? <Check size={16} /> : <Circle size={14} strokeWidth={2} />}</div>
                  <div className="texto">
                    <b>{p.titulo}</b>
                    <span>{p.detalle}</span>
                  </div>
                  <ChevronRight size={16} color="var(--t3)" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {empresa.data && (
          <section className="panel">
            <div className="panel-cab">
              <h2>Uso del plan {empresa.data.plan.codigo}</h2>
            </div>
            <div className="cifras">
              <Uso etiqueta="Usuarios activos" uso={empresa.data.plan.uso.usuarios} limite={empresa.data.plan.limites.usuarios} />
              <Uso etiqueta="Sucursales activas" uso={empresa.data.plan.uso.sucursales} limite={empresa.data.plan.limites.sucursales} />
            </div>
          </section>
        )}

        {ventasHoy.data && (
          <section className="panel">
            <div className="panel-cab">
              <h2>Hoy</h2>
              <Link to="/ventas" className="enlace" style={{ marginLeft: 'auto' }}>Ver ventas</Link>
            </div>
            {ventasHoy.data.items.length === 0 ? (
              <div className="vacio">
                <b>Todavía no hay ventas hoy</b>
              </div>
            ) : (
              <div className="cifras">
                <div className="cifra">
                  <span>Ventas</span>
                  <b className="num">{ventasHoy.data.items.length}</b>
                </div>
                <div className="cifra">
                  <span>Total vendido</span>
                  <b className="num">{dinero(ventasHoy.data.items.reduce((a, v) => a + Number(v.total), 0))}</b>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
