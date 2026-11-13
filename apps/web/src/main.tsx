import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './estilos.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Disposicion } from './componentes/Disposicion';
import { FalloApi } from './lib/api';
import { ProveedorSesion, useSesion } from './lib/sesion';
import { Acceso, Restablecer } from './paginas/Acceso';
import { Auditoria } from './paginas/Auditoria';
import { Cuenta } from './paginas/Cuenta';
import { Empresa } from './paginas/Empresa';
import { Inicio } from './paginas/Inicio';
import { Perfiles } from './paginas/Perfiles';
import { Sucursales } from './paginas/Sucursales';
import { Usuarios } from './paginas/Usuarios';
import { Cajas } from './paginas/Cajas';
import { Clientes } from './paginas/Clientes';
import { Pdv } from './paginas/Pdv';
import { Productos } from './paginas/Productos';
import { Stock } from './paginas/Stock';
import { Ventas } from './paginas/Ventas';
import { Importar } from './paginas/Importar';
import { Transferencias } from './paginas/Transferencias';
import { Precios } from './paginas/Precios';
import { Pedidos, Presupuestos } from './paginas/Pedidos';
import { Facturacion } from './paginas/Facturacion';
import { Compras, CuentasPagar, OrdenesCompra, Proveedores } from './paginas/Compras';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof FalloApi && e.estado < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function Rutas() {
  const { listo, yo, puede } = useSesion();
  const { pathname } = useLocation();
  if (pathname === '/restablecer') return <Restablecer />;
  if (!listo) return null;
  if (!yo) return <Acceso />;
  return (
    <Routes>
      {puede('venta.crear') && <Route path="pdv/:cajaId" element={<Pdv />} />}
      <Route element={<Disposicion />}>
        <Route index element={<Inicio />} />
        {puede('caja.ver') && <Route path="cajas" element={<Cajas />} />}
        {puede('venta.ver') && <Route path="ventas" element={<Ventas />} />}
        {puede('producto.ver') && <Route path="productos" element={<Productos />} />}
        {puede('stock.ver') && <Route path="stock" element={<Stock />} />}
        {puede('transferencia.ver') && <Route path="transferencias" element={<Transferencias />} />}
        {puede('precio.ver') && <Route path="precios" element={<Precios />} />}
        {puede('presupuesto.ver') && <Route path="presupuestos" element={<Presupuestos />} />}
        {puede('pedido.ver') && <Route path="pedidos" element={<Pedidos />} />}
        {(puede('config_fiscal.ver') || puede('documento_fiscal.ver')) && <Route path="facturacion" element={<Facturacion />} />}
        {puede('proveedor.ver') && <Route path="proveedores" element={<Proveedores />} />}
        {puede('orden_compra.ver') && <Route path="ordenes-compra" element={<OrdenesCompra />} />}
        {puede('recepcion.ver') && <Route path="compras" element={<Compras />} />}
        {puede('cuenta_pagar.ver') && <Route path="cuentas-pagar" element={<CuentasPagar />} />}
        {puede('cliente.ver') && <Route path="clientes" element={<Clientes />} />}
        {(puede('producto.crear') || puede('cliente.crear')) && <Route path="importar/:tipo" element={<Importar />} />}
        {puede('usuario.ver') && <Route path="usuarios" element={<Usuarios />} />}
        {puede('perfil.ver') && <Route path="perfiles" element={<Perfiles />} />}
        {puede('sucursal.ver') && <Route path="sucursales" element={<Sucursales />} />}
        {puede('auditoria.ver') && <Route path="auditoria" element={<Auditoria />} />}
        {puede('empresa.ver') && <Route path="empresa" element={<Empresa />} />}
        <Route path="cuenta" element={<Cuenta />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ProveedorSesion>
          <Rutas />
        </ProveedorSesion>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
