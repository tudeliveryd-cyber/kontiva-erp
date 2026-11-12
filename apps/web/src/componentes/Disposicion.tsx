import {
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

  const enlaces = [
    { a: '/', icono: House, texto: 'Inicio', visible: true },
    { a: '/usuarios', icono: Users, texto: 'Usuarios', visible: puede('usuario.ver') },
    { a: '/perfiles', icono: ShieldCheck, texto: 'Perfiles de acceso', visible: puede('perfil.ver') },
    { a: '/sucursales', icono: MapPin, texto: 'Sucursales', visible: puede('sucursal.ver') },
    { a: '/auditoria', icono: ClipboardList, texto: 'Auditoría', visible: puede('auditoria.ver') },
    { a: '/empresa', icono: Building2, texto: 'Empresa', visible: puede('empresa.ver') },
  ];

  return (
    <div className="app">
      <aside className="lateral">
        <Marca claro />
        <nav className="nav" aria-label="Principal">
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
