import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Cargando, Encabezado, ErrorApi } from '../componentes/ui';
import { dinero, master, type PlanMaster } from './cliente';

export function Planes() {
  const q = useQuery({ queryKey: ['m-planes'], queryFn: () => master.api<PlanMaster[]>('/planes') });
  return (
    <>
      <Encabezado titulo="Planes" />
      <div className="contenido">
        <p className="tenue" style={{ margin: 0 }}>
          Los límites se aplican en el servidor y rigen de inmediato en todas las empresas del plan. Vacío = ilimitado.
        </p>
        {q.isLoading ? <Cargando /> : q.data?.map((p) => <FichaPlan key={p.id} plan={p} />)}
      </div>
    </>
  );
}

function FichaPlan({ plan }: { plan: PlanMaster }) {
  const qc = useQueryClient();
  const inicial = {
    nombre: plan.nombre,
    maxUsuarios: plan.maxUsuarios?.toString() ?? '',
    maxSucursales: plan.maxSucursales?.toString() ?? '',
    maxCajas: plan.maxCajas?.toString() ?? '',
    precioMensual: plan.precioMensual ? String(Number(plan.precioMensual)) : '',
    precioAnual: plan.precioAnual ? String(Number(plan.precioAnual)) : '',
    exige2faPropietario: plan.exige2faPropietario,
    activo: plan.activo,
  };
  const [d, setD] = useState(inicial);
  const cambiado = JSON.stringify(d) !== JSON.stringify(inicial);
  const num = (v: string) => (v.trim() === '' ? null : v);
  const guardar = useMutation({
    mutationFn: () =>
      master.api(`/planes/${plan.id}`, {
        metodo: 'PATCH',
        cuerpo: { ...d, maxUsuarios: num(d.maxUsuarios), maxSucursales: num(d.maxSucursales), maxCajas: num(d.maxCajas), precioMensual: num(d.precioMensual), precioAnual: num(d.precioAnual) },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['m-planes'] }),
  });
  const campo = (k: keyof typeof d, etiqueta: string, ayuda?: string) => (
    <div className="campo">
      <label htmlFor={`${plan.id}-${k}`}>{etiqueta}</label>
      <input id={`${plan.id}-${k}`} className="entrada num" inputMode="numeric" placeholder="Ilimitado" value={d[k] as string} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-cab">
        <h2>{plan.codigo}</h2>
        <span className="sub">
          {plan.empresas} empresa{plan.empresas === 1 ? '' : 's'}
        </span>
        {!plan.activo && <span className="insignia i-n">Inactivo</span>}
        <div className="acciones">
          <button className="btn pri chico" disabled={!cambiado || guardar.isPending} onClick={() => guardar.mutate()}>
            Guardar
          </button>
        </div>
      </div>
      <div className="panel-cuerpo form">
        <ErrorApi error={guardar.error} />
        <div className="fila-campos">
          <div className="campo">
            <label htmlFor={`${plan.id}-nombre`}>Nombre comercial</label>
            <input id={`${plan.id}-nombre`} className="entrada" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} />
          </div>
          {campo('maxUsuarios', 'Usuarios')}
          {campo('maxSucursales', 'Sucursales')}
          {campo('maxCajas', 'Cajas PDV')}
        </div>
        <div className="fila-campos">
          {campo('precioMensual', 'Precio mensual (₲)', d.precioMensual ? dinero(d.precioMensual) : undefined)}
          {campo('precioAnual', 'Precio anual (₲)', d.precioAnual ? dinero(d.precioAnual) : undefined)}
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <label className="casilla">
            <input type="checkbox" checked={d.exige2faPropietario} onChange={(e) => setD({ ...d, exige2faPropietario: e.target.checked })} /> Exigir verificación en dos pasos al Propietario
          </label>
          <label className="casilla">
            <input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} /> Disponible para nuevas empresas
          </label>
        </div>
      </div>
    </section>
  );
}
