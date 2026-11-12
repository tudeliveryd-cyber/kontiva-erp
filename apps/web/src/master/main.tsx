import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '../estilos.css';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ClipboardList, KeyRound, Layers, LogOut } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { FalloApi } from '../lib/api';
import { master } from './cliente';
import { AccesoMaster } from './Acceso';
import { AuditoriaMaster, CuentaMaster } from './Varios';
import { Empresas } from './Empresas';
import { Planes } from './Planes';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof FalloApi && e.estado < 500) && n < 2, refetchOnWindowFocus: false } },
});

function Disposicion({ nombre, alSalir }: { nombre: string; alSalir: () => void }) {
  const enlaces = [
    { a: '/', icono: Building2, texto: 'Empresas' },
    { a: '/planes', icono: Layers, texto: 'Planes' },
    { a: '/auditoria', icono: ClipboardList, texto: 'Auditoría' },
    { a: '/cuenta', icono: KeyRound, texto: 'Mi cuenta' },
  ];
  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <div className="marca-k">K</div>
          <div>
            <b>KONTIVA</b>
            <small>MASTER</small>
          </div>
        </div>
        <nav className="nav" aria-label="Principal">
          {enlaces.map((e) => (
            <NavLink key={e.a} to={e.a} end={e.a === '/'} className={({ isActive }) => (isActive ? 'activo' : undefined)}>
              <e.icono size={18} strokeWidth={1.8} />
              {e.texto}
            </NavLink>
          ))}
        </nav>
        <div className="quien">
          <b>{nombre}</b>
          <span>Araújo Tech Sistemas</span>
          <button onClick={alSalir}>
            <LogOut size={15} /> Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="principal">
        <Outlet />
        <footer className="pie">KONTIVA Master · Araújo Tech Sistemas</footer>
      </main>
    </div>
  );
}

function App() {
  const cliente = useQueryClient();
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  useEffect(() => {
    master.renovarSesion().then(setAutenticado);
    master.alPerderSesion(() => {
      master.fijarToken(null);
      cliente.clear();
      setAutenticado(false);
    });
  }, [cliente]);
  const yo = useQuery({ queryKey: ['master-me'], queryFn: () => master.api<{ nombre: string }>('/auth/me'), enabled: autenticado === true });

  if (autenticado === null) return null;
  if (!autenticado)
    return (
      <AccesoMaster
        alEntrar={(t) => {
          master.fijarToken(t);
          setAutenticado(true);
        }}
      />
    );
  const salir = async () => {
    await master.api('/auth/cerrar', { metodo: 'POST' }).catch(() => undefined);
    master.fijarToken(null);
    cliente.clear();
    setAutenticado(false);
  };
  return (
    <Routes>
      <Route element={<Disposicion nombre={yo.data?.nombre ?? ''} alSalir={() => void salir()} />}>
        <Route index element={<Empresas />} />
        <Route path="planes" element={<Planes />} />
        <Route path="auditoria" element={<AuditoriaMaster />} />
        <Route path="cuenta" element={<CuentaMaster />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
