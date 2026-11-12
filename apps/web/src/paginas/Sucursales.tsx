import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { sucursalCrear } from '@kontiva/shared';
import { Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type SucursalFila } from '../lib/api';
import { useSesion } from '../lib/sesion';

type Datos = z.input<typeof sucursalCrear>;

export function Sucursales() {
  const { puede, yo } = useSesion();
  const [abierta, setAbierta] = useState<SucursalFila | 'nueva' | null>(null);
  const q = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales') });
  return (
    <>
      <Encabezado titulo="Sucursales">
        {puede('sucursal.crear') && yo?.permisos['sucursal.crear'] === 'empresa' && (
          <button className="btn pri" onClick={() => setAbierta('nueva')}>
            <Plus size={16} /> Nueva sucursal
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          {q.isLoading ? (
            <Cargando />
          ) : !q.data?.length ? (
            <Vacio titulo="Sin sucursales asignadas" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Dirección</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((s) => (
                  <tr key={s.id} className="clic" onClick={() => setAbierta(s)}>
                    <td className="num mono">{s.codigo}</td>
                    <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                    <td className="tenue">{s.direccion ?? '—'}</td>
                    <td className="tenue">{s.telefono ?? '—'}</td>
                    <td>{s.activa ? <span className="insignia i-ok">Activa</span> : <span className="insignia i-n">Inactiva</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {abierta && <Ficha sucursal={abierta === 'nueva' ? null : abierta} alCerrar={() => setAbierta(null)} />}
    </>
  );
}

function Ficha({ sucursal, alCerrar }: { sucursal: SucursalFila | null; alCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const editable = sucursal ? puede('sucursal.editar') : true;
  const f = useForm<Datos>({
    resolver: zodResolver(sucursalCrear),
    defaultValues: sucursal ? { nombre: sucursal.nombre, codigo: sucursal.codigo, direccion: sucursal.direccion ?? '', telefono: sucursal.telefono ?? '' } : { codigo: '' },
  });
  const fin = () => {
    void qc.invalidateQueries({ queryKey: ['sucursales'] });
    void qc.invalidateQueries({ queryKey: ['empresa'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
    alCerrar();
  };
  const guardar = useMutation({
    mutationFn: (d: Datos) => (sucursal ? api(`/sucursales/${sucursal.id}`, { metodo: 'PATCH', cuerpo: d }) : api('/sucursales', { metodo: 'POST', cuerpo: d })),
    onSuccess: fin,
  });
  const estado = useMutation({
    mutationFn: () => (sucursal!.activa ? api(`/sucursales/${sucursal!.id}`, { metodo: 'DELETE' }) : api(`/sucursales/${sucursal!.id}`, { metodo: 'PATCH', cuerpo: { activa: true } })),
    onSuccess: fin,
  });
  const e = f.formState.errors;
  return (
    <Cajon
      titulo={sucursal ? sucursal.nombre : 'Nueva sucursal'}
      alCerrar={alCerrar}
      pie={
        editable && (
          <>
            <button className="btn" onClick={alCerrar}>
              Cancelar
            </button>
            <button className="btn pri" disabled={guardar.isPending} onClick={f.handleSubmit((d) => guardar.mutate(d))}>
              Guardar
            </button>
          </>
        )
      }
    >
      <ErrorApi error={guardar.error ?? estado.error} />
      <div className="form">
        <div className="fila-campos">
          <Campo etiqueta="Nombre" id="sn" error={e.nombre?.message}>
            <input id="sn" className="entrada" disabled={!editable} {...f.register('nombre')} />
          </Campo>
          <Campo etiqueta="Código de establecimiento" id="sc" error={e.codigo?.message} ayuda="Tres dígitos, como figura en el timbrado (001).">
            <input id="sc" className="entrada num" maxLength={3} disabled={!editable} {...f.register('codigo')} />
          </Campo>
        </div>
        <Campo etiqueta="Dirección" id="sd">
          <input id="sd" className="entrada" disabled={!editable} {...f.register('direccion')} />
        </Campo>
        <Campo etiqueta="Teléfono" id="st">
          <input id="st" className="entrada" disabled={!editable} {...f.register('telefono')} />
        </Campo>
      </div>
      {sucursal && (sucursal.activa ? puede('sucursal.eliminar') : puede('sucursal.editar')) && (
        <div style={{ borderTop: '1px solid var(--linea)', paddingTop: 16 }}>
          <button className={`btn chico ${sucursal.activa ? 'peligro' : ''}`} onClick={() => estado.mutate()}>
            {sucursal.activa ? 'Desactivar sucursal' : 'Reactivar sucursal'}
          </button>
        </div>
      )}
    </Cajon>
  );
}
