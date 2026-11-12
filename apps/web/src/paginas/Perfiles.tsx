import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ACCIONES } from '@kontiva/shared';
import { Aviso, Campo, Cargando, Encabezado, ErrorApi } from '../componentes/ui';
import { api, type Alcance, type Catalogo, type PerfilFila } from '../lib/api';
import { NOMBRE_ALCANCE } from '../lib/formato';
import { useSesion } from '../lib/sesion';

const NOMBRE_ACCION: Record<string, string> = {
  ver: 'Ver', crear: 'Crear', editar: 'Editar', eliminar: 'Eliminar', aprobar: 'Aprobar', cancelar: 'Cancelar', imprimir: 'Imprimir', exportar: 'Exportar',
};
const NOMBRE_MODULO: Record<string, string> = {
  plataforma: 'Plataforma', catalogo: 'Catálogo', inventario: 'Inventario', ventas: 'Ventas', clientes: 'Clientes', caja: 'Caja',
  compras: 'Compras', finanzas: 'Finanzas', informes: 'Informes', fiscal: 'Fiscal', rrhh: 'RRHH', logistica: 'Logística',
};

export function Perfiles() {
  const { puede } = useSesion();
  const perfiles = useQuery({ queryKey: ['perfiles'], queryFn: () => api<PerfilFila[]>('/perfiles') });
  const catalogo = useQuery({ queryKey: ['catalogo'], queryFn: () => api<Catalogo>('/permisos'), staleTime: Infinity });
  const [selId, setSelId] = useState<string | 'nuevo' | null>(null);
  const sel = selId === 'nuevo' ? null : perfiles.data?.find((p) => p.id === selId) ?? perfiles.data?.[0] ?? null;

  return (
    <>
      <Encabezado titulo="Perfiles de acceso">
        {puede('perfil.crear') && (
          <button className="btn pri" onClick={() => setSelId('nuevo')}>
            <Plus size={16} /> Nuevo perfil
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <section className="panel" style={{ flex: '1 1 260px', maxWidth: 340 }}>
            {perfiles.isLoading ? (
              <Cargando />
            ) : (
              <table>
                <tbody>
                  {perfiles.data?.map((p) => (
                    <tr key={p.id} className={`clic ${selId !== 'nuevo' && sel?.id === p.id ? 'sel' : ''}`} onClick={() => setSelId(p.id)}>
                      <td>
                        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {p.nombre} {p.esPropietario && <Lock size={13} color="var(--t3)" />}
                        </div>
                        <div className="tenue peq">
                          {p.usuarios} usuario{p.usuarios === 1 ? '' : 's'} · alcance {NOMBRE_ALCANCE[p.alcance].toLowerCase()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel" style={{ flex: '999 1 560px', minWidth: 0 }}>
            {catalogo.data && (selId === 'nuevo' || sel) && (
              <Editor key={selId === 'nuevo' ? 'nuevo' : sel!.id} perfil={selId === 'nuevo' ? null : sel} catalogo={catalogo.data} alGuardar={(id) => setSelId(id)} />
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Editor({ perfil, catalogo, alGuardar }: { perfil: PerfilFila | null; catalogo: Catalogo; alGuardar: (id: string) => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(perfil?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(perfil?.descripcion ?? '');
  const [alcance, setAlcance] = useState<Alcance>(perfil?.alcance ?? 'propia');
  const [marcados, setMarcados] = useState(new Set(perfil?.permisos ?? []));
  const [guardado, setGuardado] = useState(false);
  useEffect(() => setGuardado(false), [marcados, nombre, alcance, descripcion]);

  const editable = perfil ? !perfil.esPropietario && puede('perfil.editar') : puede('perfil.crear');
  // Solo se ofrece lo que el usuario mismo puede otorgar (el servidor lo verifica igual).
  const otorgable = (codigo: string) => yo?.usuario.esPropietario || Boolean(yo?.permisos[codigo]);

  const porModulo = useMemo(() => {
    const m = new Map<string, Catalogo['recursos']>();
    for (const r of catalogo.recursos) m.set(r.modulo, [...(m.get(r.modulo) ?? []), r]);
    return [...m.entries()];
  }, [catalogo]);

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = { nombre, descripcion: descripcion || null, alcance, permisos: [...marcados] };
      return perfil ? api<PerfilFila>(`/perfiles/${perfil.id}`, { metodo: 'PATCH', cuerpo }) : api<PerfilFila>('/perfiles', { metodo: 'POST', cuerpo });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['perfiles'] });
      setGuardado(true);
      alGuardar(p.id);
    },
  });
  const eliminar = useMutation({
    mutationFn: () => api(`/perfiles/${perfil!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['perfiles'] });
      alGuardar('');
    },
  });

  const alternar = (codigo: string) => {
    const n = new Set(marcados);
    if (n.has(codigo)) n.delete(codigo);
    else n.add(codigo);
    setMarcados(n);
  };

  return (
    <>
      <div className="panel-cab">
        <h2>{perfil ? perfil.nombre : 'Nuevo perfil'}</h2>
        {perfil?.sistema && <span className="insignia i-n">Plantilla del sistema</span>}
        <div className="acciones">
          {perfil && !perfil.sistema && puede('perfil.eliminar') && (
            <button className="btn chico peligro" onClick={() => confirm('¿Eliminar este perfil?') && eliminar.mutate()}>
              Eliminar
            </button>
          )}
          {editable && (
            <button className="btn pri chico" disabled={guardar.isPending || nombre.trim().length < 2} onClick={() => guardar.mutate()}>
              Guardar
            </button>
          )}
        </div>
      </div>
      <div className="panel-cuerpo form">
        <ErrorApi error={guardar.error ?? eliminar.error} />
        {guardado && <Aviso tipo="ok">Perfil guardado. Los cambios rigen desde la próxima acción de cada usuario.</Aviso>}
        {perfil?.esPropietario ? (
          <Aviso tipo="info">El Propietario tiene todos los permisos con alcance de empresa y no se puede restringir.</Aviso>
        ) : (
          <div className="fila-campos">
            <Campo etiqueta="Nombre" id="pn">
              <input id="pn" className="entrada" value={nombre} disabled={!editable} onChange={(e) => setNombre(e.target.value)} />
            </Campo>
            <Campo etiqueta="Alcance" id="pa" ayuda="Propia: lo que el usuario creó · Sucursal: sus sucursales · Empresa: todo">
              <select id="pa" className="entrada" value={alcance} disabled={!editable} onChange={(e) => setAlcance(e.target.value as Alcance)}>
                <option value="propia">Propia</option>
                <option value="sucursal">Sucursal</option>
                <option value="empresa">Empresa</option>
              </select>
            </Campo>
            <Campo etiqueta="Descripción" id="pd">
              <input id="pd" className="entrada" value={descripcion} disabled={!editable} onChange={(e) => setDescripcion(e.target.value)} />
            </Campo>
          </div>
        )}
      </div>
      {!perfil?.esPropietario && (
        <div className="desplazar">
          <table className="matriz">
            <thead>
              <tr>
                <th>Recurso</th>
                {ACCIONES.map((a) => (
                  <th key={a} className="acc">
                    {NOMBRE_ACCION[a]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porModulo.map(([modulo, recursos]) => (
                <Fragment key={modulo}>
                  <tr className="modulo">
                    <td colSpan={ACCIONES.length + 1}>{NOMBRE_MODULO[modulo] ?? modulo}</td>
                  </tr>
                  {recursos.map((r) => (
                    <tr key={r.clave}>
                      <td>
                        {r.nombre}
                        {r.confidencial && (
                          <span className="insignia i-warn" style={{ marginLeft: 8 }}>
                            Confidencial
                          </span>
                        )}
                      </td>
                      {ACCIONES.map((a) => {
                        const codigo = `${r.clave}.${a}`;
                        if (!r.acciones.includes(a)) return <td key={a} className="acc guion">—</td>;
                        return (
                          <td key={a} className="acc">
                            <input
                              type="checkbox"
                              aria-label={`${NOMBRE_ACCION[a]} ${r.nombre}`}
                              checked={marcados.has(codigo)}
                              disabled={!editable || !otorgable(codigo)}
                              onChange={() => alternar(codigo)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
