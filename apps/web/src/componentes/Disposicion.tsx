import {
  ArrowLeftRight,
  FileCheck2,
  ClipboardCheck,
  FileText,
  Tags,
  Boxes,
  Package,
  Receipt,
  Store,
  UsersRound,
  Building2,
  ClipboardList,
  House,
  LogOut,
  MapPin,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSesion } from '../lib/sesion';
import { Marca } from './ui';

export function Disposicion() {
  const { yo, salir, puede } = useSesion();
  if (!yo) return null;

  const operacion = [
    { a: '/cajas', icono: Store, texto: 'Cajas y PDV', visible: puede('caja.ver') },
    { a: '/ventas', icono: Receipt, texto: 'Ventas', visible: puede('venta.ver') },
    { a: '/presupuestos', icono: FileText, texto: 'Presupuestos', visible: puede('presupuesto.ver') },
    { a: '/pedidos', icono: ClipboardCheck, texto: 'Pedidos', visible: puede('pedido.ver') },
    { a: '/productos', icono: Package, texto: 'Productos', visible: puede('producto.ver') },
    { a: '/precios', icono: Tags, texto: 'Listas de precios', visible: puede('precio.ver') },
    { a: '/stock', icono: Boxes, texto: 'Stock', visible: puede('stock.ver') },
    { a: '/transferencias', icono: ArrowLeftRight, texto: 'Transferencias', visible: puede('transferencia.ver') },
    { a: '/clientes', icono: UsersRound, texto: 'Clientes', visible: puede('cliente.ver') },
  ];
  const enlaces = [
    { a: '/usuarios', icono: Users, texto: 'Usuarios', visible: puede('usuario.ver') },
    { a: '/perfiles', icono: ShieldCheck, texto: 'Perfiles de acceso', visible: puede('perfil.ver') },
    { a: '/sucursales', icono: MapPin, texto: 'Sucursales', visible: puede('sucursal.ver') },
    { a: '/auditoria', icono: ClipboardList, texto: 'Auditoría', visible: puede('auditoria.ver') },
    { a: '/facturacion', icono: FileCheck2, texto: 'Facturación electrónica', visible: puede('config_fiscal.ver') || puede('documento_fiscal.ver') },
    { a: '/empresa', icono: Building2, texto: 'Empresa', visible: puede('empresa.ver') },
  ];

  return (
    <div className="app">
      <aside className="lateral">
        <Marca claro />
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'activo' : undefined)}>
            <House size={18} strokeWidth={1.8} />
            Inicio
          </NavLink>
          {operacion.some((e) => e.visible) && <div className="nav-titulo">OPERACIÓN</div>}
          {operacion
            .filter((e) => e.visible)
            .map((e) => (
              <NavLink key={e.a} to={e.a} className={({ isActive }) => (isActive ? 'activo' : undefined)}>
                <e.icono size={18} strokeWidth={1.8} />
                {e.texto}
              </NavLink>
            ))}
          {enlaces.some((e) => e.visible) && <div className="nav-titulo">ADMINISTRACIÓN</div>}
          {enlaces
            .filter((e) => e.visible)
            .map((e) => (
              <NavLink key={e.a} to={e.a} end={e.a === '/'} className={({ isActive }) => (isActive ? 'activo' : undefined)}>
                <e.icono size={18} strokeWidth={1.8} />
                {e.texto}
              </NavLink>
            ))}
          <div className="nav-titulo">CUENTA</div>
          <NavLink to="/cuenta" className={({ isActive }) => (isActive ? 'activo' : undefined)}>
            <UserRound size={18} strokeWidth={1.8} />
            Mi cuenta
          </NavLink>
        </nav>
        <div className="quien">
          <b>{yo.usuario.nombre}</b>
          <span>
            {yo.usuario.perfil.nombre} · {yo.empresa.nombre}
          </span>
          <button onClick={() => void salir()}>
            <LogOut size={15} /> Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="principal">
        <Outlet />
        <footer className="pie">KONTIVA ERP · Desarrollado por Araújo Tech Sistemas</footer>
      </main>
    </div>
  );
}
