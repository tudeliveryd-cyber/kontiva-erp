import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { email } from '@kontiva/shared';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type Alcance, type Catalogo, type PerfilFila, type SucursalFila, type UsuarioFila } from '../lib/api';
import { NOMBRE_ALCANCE } from '../lib/formato';
import { useSesion } from '../lib/sesion';

const esquema = z.object({
  email,
  nombre: z.string().trim().min(2, 'Ingrese el nombre').max(120),
  perfilId: z.string().uuid('Elija un perfil'),
  sucursalIds: z.array(z.string()),
});
type Datos = z.infer<typeof esquema>;

export function Usuarios() {
  const { puede } = useSesion();
  const [abierto, setAbierto] = useState<UsuarioFila | 'nuevo' | null>(null);
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<UsuarioFila[]>('/usuarios') });
  const perfiles = useQuery({ queryKey: ['perfiles'], queryFn: () => api<PerfilFila[]>('/perfiles'), enabled: puede('perfil.ver') });
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales'), enabled: puede('sucursal.ver') });
  const nombreSucursal = new Map((sucursales.data ?? []).map((s) => [s.id, `${s.codigo} · ${s.nombre}`]));

  return (
    <>
      <Encabezado titulo="Usuarios">
        {puede('usuario.crear') && (
          <button className="btn pri" onClick={() => setAbierto('nuevo')}>
            <UserPlus size={16} /> Nuevo usuario
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          {usuarios.isLoading ? (
            <Cargando />
          ) : usuarios.error ? (
            <div className="panel-cuerpo" style={{ paddingTop: 20 }}>
              <ErrorApi error={usuarios.error} />
            </div>
          ) : !usuarios.data?.length ? (
            <Vacio titulo="Sin usuarios" />
          ) : (
            <div className="desplazar">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Perfil</th>
                    <th>Sucursales</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.data.map((u) => (
                    <tr key={u.id} className="clic" onClick={() => setAbierto(u)}>
                      <td>
                        <b style={{ fontWeight: 600 }}>{u.nombre}</b>
                      </td>
                      <td className="tenue">{u.email}</td>
                      <td>{u.esPropietario ? <span className="insignia i-p">Propietario</span> : u.perfil.nombre}</td>
                      <td className="tenue peq">{u.sucursalIds.map((s) => nombreSucursal.get(s) ?? '').filter(Boolean).join(', ') || '—'}</td>
                      <td>
                        {!u.activo ? (
                          <span className="insignia i-n">Inactivo</span>
                        ) : u.invitacionPendiente ? (
                          <span className="insignia i-warn">Invitación pendiente</span>
                        ) : (
                          <span className="insignia i-ok">Activo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {abierto && (
        <FichaUsuario
          usuario={abierto === 'nuevo' ? null : abierto}
          perfiles={(perfiles.data ?? []).filter((p) => !p.esPropietario)}
          sucursales={(sucursales.data ?? []).filter((s) => s.activa)}
          alCerrar={() => setAbierto(null)}
        />
      )}
    </>
  );
}

function FichaUsuario(props: { usuario: UsuarioFila | null; perfiles: PerfilFila[]; sucursales: SucursalFila[]; alCerrar: () => void }) {
  const { yo, puede } = useSesion();
  const qc = useQueryClient();
  const u = props.usuario;
  const esYo = u?.id === yo?.usuario.id;
  const editable = !u ? puede('usuario.crear') : puede('usuario.editar') && !(u.esPropietario && !yo?.usuario.esPropietario);
  const [aviso, setAviso] = useState<string | null>(null);

  const f = useForm<Datos>({
    resolver: zodResolver(esquema),
    defaultValues: u
      ? { email: u.email, nombre: u.nombre, perfilId: u.perfil.id, sucursalIds: u.sucursalIds }
      : { email: '', nombre: '', perfilId: '', sucursalIds: props.sucursales.length === 1 ? [props.sucursales[0]!.id] : [] },
  });

  const guardar = useMutation({
    mutationFn: (d: Datos) =>
      u
        ? api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo: { nombre: d.nombre, ...(u.esPropietario || esYo ? {} : { perfilId: d.perfilId }), sucursalIds: d.sucursalIds } })
        : api('/usuarios', { metodo: 'POST', cuerpo: d }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['usuarios'] });
      void qc.invalidateQueries({ queryKey: ['empresa'] });
      props.alCerrar();
    },
  });
  const desactivar = useMutation({
    mutationFn: () => api(`/usuarios/${u!.id}`, { metodo: u!.activo ? 'DELETE' : 'PATCH', cuerpo: u!.activo ? undefined : { activo: true } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['usuarios'] });
      void qc.invalidateQueries({ queryKey: ['empresa'] });
      props.alCerrar();
    },
  });
  const invitar = useMutation({
    mutationFn: () => api(`/usuarios/${u!.id}/invitacion`, { metodo: 'POST' }),
    onSuccess: () => setAviso('Invitación reenviada.'),
  });

  return (
    <Cajon
      titulo={u ? u.nombre : 'Nuevo usuario'}
      alCerrar={props.alCerrar}
      pie={
        editable ? (
          <>
            <button className="btn" onClick={props.alCerrar}>
              Cancelar
            </button>
            <button className="btn pri" disabled={guardar.isPending} onClick={f.handleSubmit((d) => guardar.mutate(d))}>
              {u ? 'Guardar cambios' : 'Crear e invitar'}
            </button>
          </>
        ) : undefined
      }
    >
      <ErrorApi error={guardar.error ?? desactivar.error ?? invitar.error} />
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {!u && <Aviso tipo="info">La persona recibe un correo para crear su contraseña. Si ya usa KONTIVA en otra empresa, entra con la que tiene.</Aviso>}
      <div className="form">
        <Campo etiqueta="Nombre" id="nombre" error={f.formState.errors.nombre?.message}>
          <input id="nombre" className="entrada" disabled={!editable} {...f.register('nombre')} />
        </Campo>
        <Campo etiqueta="Correo electrónico" id="email" error={f.formState.errors.email?.message}>
          <input id="email" className="entrada" type="email" disabled={!!u} {...f.register('email')} />
        </Campo>
        {u?.esPropietario ? (
          <Campo etiqueta="Perfil">
            <input className="entrada" disabled value="Propietario" />
          </Campo>
        ) : (
          <Campo etiqueta="Perfil de acceso" id="perfil" error={f.formState.errors.perfilId?.message}>
            <select id="perfil" className="entrada" disabled={!editable || esYo} {...f.register('perfilId')}>
              <option value="">Elija un perfil</option>
              {props.perfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — alcance {NOMBRE_ALCANCE[p.alcance].toLowerCase()}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <div className="campo">
          <label>Sucursales</label>
          {props.sucursales.map((s) => (
            <label key={s.id} className="casilla">
              <input type="checkbox" value={s.id} disabled={!editable} {...f.register('sucursalIds')} />
              {s.codigo} · {s.nombre}
            </label>
          ))}
        </div>
      </div>

      {u && !u.esPropietario && !esYo && puede('usuario.editar') && <PermisosIndividuales usuario={u} />}

      {u && !u.esPropietario && !esYo && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--linea)', paddingTop: 16 }}>
          {u.invitacionPendiente && u.activo && puede('usuario.crear') && (
            <button className="btn chico" onClick={() => invitar.mutate()} disabled={invitar.isPending}>
              <Mail size={14} /> Reenviar invitación
            </button>
          )}
          {u.activo && puede('usuario.eliminar') && (
            <button className="btn chico peligro" onClick={() => confirm(`¿Desactivar a ${u.nombre}? Se cerrarán sus sesiones.`) && desactivar.mutate()}>
              Desactivar usuario
            </button>
          )}
          {!u.activo && puede('usuario.editar') && (
            <button className="btn chico" onClick={() => desactivar.mutate()}>
              Reactivar usuario
            </button>
          )}
        </div>
      )}
    </Cajon>
  );
}

function PermisosIndividuales({ usuario }: { usuario: UsuarioFila }) {
  const qc = useQueryClient();
  const catalogo = useQuery({ queryKey: ['catalogo'], queryFn: () => api<Catalogo>('/permisos'), staleTime: Infinity });
  const [lista, setLista] = useState(usuario.permisosIndividuales);
  const [nuevo, setNuevo] = useState({ permiso: '', tipo: 'conceder' as 'conceder' | 'denegar', alcance: 'propia' as Alcance });
  const guardar = useMutation({
    mutationFn: (permisos: typeof lista) => api(`/usuarios/${usuario.id}/permisos`, { metodo: 'PUT', cuerpo: { permisos } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['usuarios'] }),
  });
  const nombre = new Map((catalogo.data?.permisos ?? []).map((p) => [p.codigo, p.nombre]));
  const cambiar = (l: typeof lista) => {
    setLista(l);
    guardar.mutate(l);
  };

  return (
    <div className="seccion-form" style={{ borderTop: '1px solid var(--linea)', paddingTop: 16 }}>
      <h3>Excepciones al perfil</h3>
      <ErrorApi error={guardar.error} />
      {lista.length === 0 ? (
        <p className="tenue peq" style={{ marginTop: 0 }}>
          Sin excepciones: el usuario tiene exactamente los permisos de su perfil.
        </p>
      ) : (
        <table style={{ marginBottom: 12 }}>
          <tbody>
            {lista.map((p) => (
              <tr key={p.permiso}>
                <td className="peq">{nombre.get(p.permiso) ?? p.permiso}</td>
                <td>
                  <span className={`insignia ${p.tipo === 'conceder' ? 'i-ok' : 'i-bad'}`}>{p.tipo === 'conceder' ? `Concedido · ${NOMBRE_ALCANCE[p.alcance]}` : 'Denegado'}</span>
                </td>
                <td className="der">
                  <button className="enlace" aria-label="Quitar" onClick={() => cambiar(lista.filter((x) => x.permiso !== p.permiso))}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="entrada" style={{ flex: '2 1 200px' }} value={nuevo.permiso} onChange={(e) => setNuevo({ ...nuevo, permiso: e.target.value })}>
          <option value="">Elija un permiso…</option>
          {(catalogo.data?.permisos ?? []).map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.nombre}
            </option>
          ))}
        </select>
        <select className="entrada" style={{ flex: '1 1 110px' }} value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value as 'conceder' | 'denegar' })}>
          <option value="conceder">Conceder</option>
          <option value="denegar">Denegar</option>
        </select>
        {nuevo.tipo === 'conceder' && (
          <select className="entrada" style={{ flex: '1 1 110px' }} value={nuevo.alcance} onChange={(e) => setNuevo({ ...nuevo, alcance: e.target.value as Alcance })}>
            <option value="propia">Propia</option>
            <option value="sucursal">Sucursal</option>
            <option value="empresa">Empresa</option>
          </select>
        )}
        <button
          className="btn"
          disabled={!nuevo.permiso || guardar.isPending}
          onClick={() => {
            cambiar([...lista.filter((x) => x.permiso !== nuevo.permiso), { ...nuevo, alcance: nuevo.tipo === 'denegar' ? 'empresa' : nuevo.alcance }]);
            setNuevo({ ...nuevo, permiso: '' });
          }}
        >
          <Plus size={15} /> Agregar
        </button>
      </div>
    </div>
  );
}
