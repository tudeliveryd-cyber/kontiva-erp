import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { empresaEditar } from '@kontiva/shared';
import { Aviso, Campo, Cargando, Encabezado, ErrorApi } from '../componentes/ui';
import { api, type EmpresaDatos } from '../lib/api';
import { useSesion } from '../lib/sesion';

type Datos = z.input<typeof empresaEditar>;

export function Empresa() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['empresa'], queryFn: () => api<EmpresaDatos>('/empresa') });
  const [ok, setOk] = useState(false);
  const editable = puede('empresa.editar');
  const f = useForm<Datos>({ resolver: zodResolver(empresaEditar) });

  useEffect(() => {
    if (q.data)
      f.reset({
        razonSocial: q.data.razonSocial,
        nombreFantasia: q.data.nombreFantasia ?? '',
        ruc: q.data.ruc ?? undefined,
        telefono: q.data.telefono ?? '',
        email: q.data.email ?? null,
        direccion: q.data.direccion ?? '',
      });
  }, [q.data, f]);

  const guardar = useMutation({
    mutationFn: (d: Datos) => api<EmpresaDatos>('/empresa', { metodo: 'PATCH', cuerpo: 'permiteStockNegativo' in d && Object.keys(d).length === 1 ? d : { ...d, email: d.email || null, ruc: d.ruc || undefined } }),
    onSuccess: () => {
      setOk(true);
      void qc.invalidateQueries({ queryKey: ['empresa'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (q.isLoading || !q.data) return <Cargando />;
  const e = f.formState.errors;
  const lim = q.data.plan.limites;

  return (
    <>
      <Encabezado titulo="Empresa" />
      <div className="contenido">
        <section className="panel">
          <div className="panel-cab">
            <h2>Datos de la empresa</h2>
            {editable && (
              <div className="acciones">
                <button className="btn pri" disabled={guardar.isPending} onClick={f.handleSubmit((d) => guardar.mutate(d))}>
                  Guardar
                </button>
              </div>
            )}
          </div>
          <div className="panel-cuerpo form" onChange={() => setOk(false)}>
            <ErrorApi error={guardar.error} />
            {ok && <Aviso tipo="ok">Datos guardados.</Aviso>}
            <div className="fila-campos">
              <Campo etiqueta="Razón social" id="rs" error={e.razonSocial?.message}>
                <input id="rs" className="entrada" disabled={!editable} {...f.register('razonSocial')} />
              </Campo>
              <Campo etiqueta="Nombre de fantasía" id="nf">
                <input id="nf" className="entrada" disabled={!editable} {...f.register('nombreFantasia')} />
              </Campo>
              <Campo etiqueta="RUC" id="ruc" error={e.ruc?.message} ayuda="Con dígito verificador: 80012345-6">
                <input id="ruc" className="entrada num" disabled={!editable} {...f.register('ruc', { setValueAs: (v: string) => v || undefined })} />
              </Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Teléfono" id="tel">
                <input id="tel" className="entrada" disabled={!editable} {...f.register('telefono')} />
              </Campo>
              <Campo etiqueta="Correo" id="em" error={e.email?.message}>
                <input id="em" className="entrada" type="email" disabled={!editable} {...f.register('email', { setValueAs: (v: string) => v || null })} />
              </Campo>
            </div>
            <Campo etiqueta="Dirección" id="dir">
              <input id="dir" className="entrada" disabled={!editable} {...f.register('direccion')} />
            </Campo>
          </div>
        </section>

        <section className="panel">
          <div className="panel-cab">
            <h2>Venta</h2>
          </div>
          <div className="panel-cuerpo">
            <label className="casilla">
              <input
                type="checkbox"
                disabled={!editable || guardar.isPending}
                checked={q.data.permiteStockNegativo}
                onChange={(e) => guardar.mutate({ permiteStockNegativo: e.target.checked })}
              />
              Permitir vender sin stock (el saldo queda negativo hasta el próximo conteo)
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-cab">
            <h2>Plan {q.data.plan.codigo}</h2>
            <span className="sub">Para cambiar de plan, contacte a Araújo Tech Sistemas.</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Límite</th>
                <th className="der">En uso</th>
                <th className="der">Permitido</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Usuarios activos</td>
                <td className="der num">{q.data.plan.uso.usuarios}</td>
                <td className="der num">{lim.usuarios ?? 'Ilimitado'}</td>
              </tr>
              <tr>
                <td>Sucursales activas</td>
                <td className="der num">{q.data.plan.uso.sucursales}</td>
                <td className="der num">{lim.sucursales ?? 'Ilimitado'}</td>
              </tr>
              <tr>
                <td>Cajas PDV</td>
                <td className="der num tenue">—</td>
                <td className="der num">{lim.cajas ?? 'Ilimitado'}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
