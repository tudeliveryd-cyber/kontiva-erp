import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import type { Cliente } from '../lib/operacion';
import type { ListaPrecio } from './Precios';
import { EstadoCuentaCliente } from './Cobrar';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export function Clientes() {
  const { puede } = useSesion();
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<Cliente | 'nuevo' | null>(null);
  const lista = useQuery({ queryKey: ['clientes', q], queryFn: () => api<Cliente[]>(`/clientes?q=${encodeURIComponent(q)}&limite=200`), placeholderData: (p) => p });
  return (
    <>
      <Encabezado titulo="Clientes">
        {puede('cliente.crear') && (
          <Link className="btn" to="/importar/clientes">
            <Upload size={16} /> Importar desde Excel
          </Link>
        )}
        {puede('cliente.crear') && (
          <button className="btn pri" onClick={() => setAbierto('nuevo')}>
            <Plus size={16} /> Nuevo cliente
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 440 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Nombre, RUC, cédula o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.length ? (
            <Vacio titulo={q ? 'Sin resultados' : 'Todavía no hay clientes'} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>RUC / Cédula</th>
                  <th>Teléfono</th>
                  <th>Correo</th>
                  {puede('cuenta_cobrar.ver') && <th className="der">Deuda</th>}
                </tr>
              </thead>
              <tbody>
                {lista.data.map((c) => (
                  <tr key={c.id} className="clic" onClick={() => setAbierto(c)}>
                    <td style={{ fontWeight: 600 }}>{c.nombre}</td>
                    <td className="num">{c.documento ?? '—'}</td>
                    <td className="tenue">{c.telefono ?? '—'}</td>
                    <td className="tenue">{c.email ?? '—'}</td>
                    {puede('cuenta_cobrar.ver') && <td className="der num">{Number(c.saldo) > 0 ? dinero(c.saldo!) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {abierto && <FichaCliente cliente={abierto === 'nuevo' ? null : abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

function FichaCliente({ cliente, alCerrar }: { cliente: Cliente | null; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const editable = cliente ? puede('cliente.editar') : puede('cliente.crear');
  const [d, setD] = useState({ nombre: cliente?.nombre ?? '', documento: cliente?.documento ?? '', telefono: cliente?.telefono ?? '', email: cliente?.email ?? '', direccion: cliente?.direccion ?? '' });
  const [listaPrecioId, setListaPrecioId] = useState(cliente?.listaPrecioId ?? '');
  const [credito, setCredito] = useState({ limite: cliente ? String(Math.round(Number(cliente.limiteCredito))) : '0', plazo: String(cliente?.plazoCreditoDias ?? 30) });
  const [verCuenta, setVerCuenta] = useState(false);
  const listas = useQuery({ queryKey: ['listas-precio'], queryFn: () => api<ListaPrecio[]>('/listas-precio'), enabled: puede('precio.ver') });
  const adicionales = listas.data?.filter((l) => !l.predeterminada && (l.activa || l.id === listaPrecioId)) ?? [];
  const cuerpo = {
    ...d,
    ...(puede('precio.ver') && { listaPrecioId: listaPrecioId || null }),
    ...(puede('credito_cliente.editar') && { limiteCredito: Number(credito.limite) || 0, plazoCreditoDias: Number(credito.plazo) || 30 }),
  };
  const guardar = useMutation({
    mutationFn: () => (cliente ? api(`/clientes/${cliente.id}`, { metodo: 'PATCH', cuerpo }) : api('/clientes', { metodo: 'POST', cuerpo })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clientes'] });
      alCerrar();
    },
  });
  const campo = (k: keyof typeof d, etiqueta: string, extra?: { ayuda?: string; tipo?: string }) => (
    <Campo etiqueta={etiqueta} id={`c${k}`} ayuda={extra?.ayuda}>
      <input id={`c${k}`} className="entrada" type={extra?.tipo ?? 'text'} disabled={!editable} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </Campo>
  );
  return (
    <Cajon
      titulo={cliente ? cliente.nombre : 'Nuevo cliente'}
      alCerrar={alCerrar}
      pie={editable && (<><button className="btn" onClick={alCerrar}>Cancelar</button><button className="btn pri" disabled={d.nombre.trim().length < 2 || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button></>)}
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        {campo('nombre', 'Nombre o razón social')}
        <div className="fila-campos">
          {campo('documento', 'RUC o cédula', { ayuda: 'RUC con dígito verificador: 80012345-6' })}
          {campo('telefono', 'Teléfono / WhatsApp')}
        </div>
        {campo('email', 'Correo', { tipo: 'email' })}
        {campo('direccion', 'Dirección')}
        {(puede('credito_cliente.editar') || puede('credito_cliente.ver')) && (
          <div className="fila-campos">
            <Campo etiqueta="Límite de crédito (Gs.)" id="clc" ayuda="0 = sin crédito. Permite vender a cuenta en el PDV hasta este monto.">
              <input id="clc" className="entrada num" disabled={!puede('credito_cliente.editar')} value={credito.limite === '' ? '' : Number(credito.limite).toLocaleString('es-PY')} onChange={(e) => setCredito({ ...credito, limite: e.target.value.replace(/[^0-9]/g, '') })} />
            </Campo>
            <Campo etiqueta="Plazo de pago (días)" id="clp2">
              <input id="clp2" className="entrada num" disabled={!puede('credito_cliente.editar')} value={credito.plazo} onChange={(e) => setCredito({ ...credito, plazo: e.target.value.replace(/[^0-9]/g, '') })} />
            </Campo>
          </div>
        )}
        {cliente && puede('cuenta_cobrar.ver') && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span>Deuda actual: <b>{dinero(cliente.saldo ?? 0)}</b></span>
            <button className="btn" onClick={() => setVerCuenta(true)}>Estado de cuenta</button>
          </div>
        )}
        {verCuenta && cliente && <EstadoCuentaCliente clienteId={cliente.id} alCerrar={() => setVerCuenta(false)} />}
        {adicionales.length > 0 && (
          <Campo etiqueta="Lista de precios" id="clp" ayuda="En la caja, al elegir este cliente se cobran los precios de su lista.">
            <select id="clp" className="entrada" disabled={!editable} value={listaPrecioId} onChange={(e) => setListaPrecioId(e.target.value)}>
              <option value="">Precio normal</option>
              {adicionales.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}{l.activa ? '' : ' (inactiva)'}</option>
              ))}
            </select>
          </Campo>
        )}
      </div>
    </Cajon>
  );
}
