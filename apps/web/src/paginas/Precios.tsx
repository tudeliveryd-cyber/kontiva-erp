import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Search, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Aviso, Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api, type SucursalFila } from '../lib/api';
import { dinero } from '../lib/operacion';
import { useSesion } from '../lib/sesion';

export interface ListaPrecio {
  id: string;
  nombre: string;
  predeterminada: boolean;
  activa: boolean;
  precios: number;
  clientes: number;
}

interface FilaPrecio {
  varianteId: string;
  descripcion: string;
  sku: string | null;
  normal: string;
  general: string | null;
  especial: string | null;
}

const POR_PAGINA = 100;

export function Precios() {
  const { puede } = useSesion();
  const listas = useQuery({ queryKey: ['listas-precio'], queryFn: () => api<ListaPrecio[]>('/listas-precio') });
  const [selId, setSelId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<ListaPrecio | 'nueva' | null>(null);
  const sel = listas.data?.find((l) => l.id === selId) ?? listas.data?.find((l) => !l.predeterminada && l.activa) ?? listas.data?.[0];

  return (
    <>
      <Encabezado titulo="Listas de precios">
        {puede('precio.editar') && (
          <button className="btn pri" onClick={() => setFicha('nueva')}>
            <Plus size={16} /> Nueva lista
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        {listas.isLoading ? (
          <Cargando />
        ) : (
          <>
            <section className="panel">
              <table>
                <thead>
                  <tr>
                    <th>Lista</th>
                    <th className="der">Productos con precio</th>
                    <th className="der">Clientes</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listas.data?.map((l) => (
                    <tr key={l.id} className="clic" onClick={() => setSelId(l.id)} style={sel?.id === l.id ? { background: 'var(--p1)' } : undefined}>
                      <td style={{ fontWeight: 600 }}>
                        <Tag size={14} style={{ verticalAlign: -2, marginRight: 8, color: 'var(--t3)' }} />
                        {l.nombre}
                        {l.predeterminada && <span className="tenue peq" style={{ fontWeight: 400 }}> · precio normal de venta</span>}
                      </td>
                      <td className="der num">{l.precios}</td>
                      <td className="der num">{l.predeterminada ? '—' : l.clientes}</td>
                      <td>{l.activa ? <span className="insignia i-ok">Activa</span> : <span className="insignia i-n">Inactiva</span>}</td>
                      <td className="der">
                        {puede('precio.editar') && (
                          <button
                            className="btn"
                            style={{ height: 30 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setFicha(l);
                            }}
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {listas.data?.length === 1 && (
                <div style={{ padding: '14px 20px' }}>
                  <Aviso tipo="info">
                    Cree listas adicionales (mayorista, revendedor, empleados…) y asígnelas a los clientes desde su ficha. Al elegir el cliente en la caja, el PDV cobra el precio de su lista; los productos sin precio en la lista se cobran al precio normal.
                  </Aviso>
                </div>
              )}
            </section>
            {sel && <PreciosDeLista key={sel.id} lista={sel} />}
          </>
        )}
      </div>
      {ficha && <FichaLista lista={ficha === 'nueva' ? null : ficha} alCerrar={(id) => { setFicha(null); if (id) setSelId(id); }} />}
    </>
  );
}

function PreciosDeLista({ lista }: { lista: ListaPrecio }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const editable = puede('precio.editar');
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: () => api<SucursalFila[]>('/sucursales'), enabled: puede('sucursal.ver') });
  const [sucursalId, setSucursalId] = useState('');
  const [q, setQ] = useState('');
  const [qDiferida, setQDiferida] = useState('');
  const [soloEspeciales, setSoloEspeciales] = useState(false);
  const [desde, setDesde] = useState(0);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [ajuste, setAjuste] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDiferida(q);
      setDesde(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ limite: String(POR_PAGINA), desde: String(desde) });
  if (qDiferida) params.set('q', qDiferida);
  if (sucursalId) params.set('sucursalId', sucursalId);
  if (soloEspeciales) params.set('soloEspeciales', 'true');
  const precios = useQuery({
    queryKey: ['precios-lista', lista.id, params.toString()],
    queryFn: () => api<{ total: number; items: FilaPrecio[] }>(`/listas-precio/${lista.id}/precios?${params}`),
    placeholderData: (p) => p,
  });

  const pendientes = Object.keys(cambios).length;
  const guardar = useMutation({
    mutationFn: () =>
      api<{ cambiados: number }>(`/listas-precio/${lista.id}/precios`, {
        metodo: 'PUT',
        cuerpo: {
          sucursalId: sucursalId || null,
          items: Object.entries(cambios).map(([varianteId, v]) => ({ varianteId, precio: v.trim() === '' ? null : Number(v) })),
        },
      }),
    onSuccess: () => {
      setCambios({});
      void qc.invalidateQueries({ queryKey: ['precios-lista', lista.id] });
      void qc.invalidateQueries({ queryKey: ['listas-precio'] });
      void qc.invalidateQueries({ queryKey: ['productos'] });
    },
  });

  const cambiarFiltro = (f: () => void) => {
    if (pendientes && !window.confirm('Hay precios sin guardar. ¿Descartarlos?')) return;
    setCambios({});
    f();
  };

  // En la lista normal sin sucursal, el campo editable es el propio precio de venta: no admite vacío.
  const esNormalGeneral = lista.predeterminada && !sucursalId;
  const total = precios.data?.total ?? 0;

  return (
    <section className="panel">
      <div className="panel-cab">
        <h2>{lista.nombre}</h2>
        <span className="sub">
          {esNormalGeneral
            ? 'Precio de venta de cada producto en todas las sucursales.'
            : lista.predeterminada
              ? 'Precio distinto para esta sucursal; vacío = rige el precio normal.'
              : sucursalId
                ? 'Precio de esta lista solo para la sucursal elegida; vacío = rige el de la lista en general.'
                : 'Vacío = se cobra el precio normal.'}
        </span>
        <div className="acciones">
          {editable && !lista.predeterminada && (
            <button className="btn" onClick={() => setAjuste(true)}>
              <Percent size={16} /> Cargar por porcentaje
            </button>
          )}
          {editable && (
            <button className="btn pri" disabled={!pendientes || guardar.isPending} onClick={() => guardar.mutate()}>
              Guardar{pendientes ? ` (${pendientes})` : ''}
            </button>
          )}
        </div>
      </div>
      <div className="filtros">
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 380 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
          <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Producto o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(sucursales.data?.length ?? 0) > 1 && (
          <select className="entrada" value={sucursalId} onChange={(e) => { const v = e.target.value; cambiarFiltro(() => { setSucursalId(v); setDesde(0); }); }}>
            <option value="">Todas las sucursales</option>
            {sucursales.data?.filter((s) => s.activa).map((s) => (
              <option key={s.id} value={s.id}>
                Solo {s.nombre}
              </option>
            ))}
          </select>
        )}
        {!esNormalGeneral && (
          <label className="casilla">
            <input type="checkbox" checked={soloEspeciales} onChange={(e) => { const v = e.target.checked; cambiarFiltro(() => { setSoloEspeciales(v); setDesde(0); }); }} />
            Solo con precio cargado
          </label>
        )}
      </div>
      <ErrorApi error={guardar.error} />
      {guardar.isSuccess && !pendientes && (
        <div style={{ padding: '0 20px 12px' }}>
          <Aviso tipo="ok">Precios guardados ({guardar.data.cambiados}).</Aviso>
        </div>
      )}
      {precios.isLoading ? (
        <Cargando />
      ) : !precios.data?.items.length ? (
        <Vacio titulo={qDiferida || soloEspeciales ? 'Sin resultados' : 'Todavía no hay productos'} />
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                {!esNormalGeneral && <th className="der">Precio normal</th>}
                {!lista.predeterminada && sucursalId && <th className="der">Lista en general</th>}
                <th className="der" style={{ width: 170 }}>{esNormalGeneral ? 'Precio de venta' : 'Precio en esta lista'}</th>
                {!esNormalGeneral && <th className="der">Diferencia</th>}
              </tr>
            </thead>
            <tbody>
              {precios.data.items.map((f) => {
                const valor = cambios[f.varianteId] ?? (esNormalGeneral ? f.normal : f.especial) ?? '';
                const efectivo = valor.trim() !== '' ? Number(valor) : null;
                const referencia = Number(sucursalId && !lista.predeterminada ? (f.general ?? f.normal) : f.normal);
                const dif = efectivo !== null && referencia > 0 && !esNormalGeneral ? ((efectivo - Number(f.normal)) / Number(f.normal)) * 100 : null;
                const sucio = f.varianteId in cambios;
                return (
                  <tr key={f.varianteId}>
                    <td>
                      {f.descripcion}
                      {f.sku && <span className="tenue peq"> · {f.sku}</span>}
                    </td>
                    {!esNormalGeneral && <td className="der num tenue">{dinero(f.normal)}</td>}
                    {!lista.predeterminada && sucursalId && <td className="der num tenue">{f.general ? dinero(f.general) : '—'}</td>}
                    <td className="der">
                      {editable ? (
                        <input
                          className="entrada num"
                          style={{ width: 150, height: 32, textAlign: 'right', ...(sucio ? { borderColor: 'var(--p5)', background: 'var(--p1)' } : {}) }}
                          inputMode="numeric"
                          placeholder={esNormalGeneral ? '' : dinero(referencia).replace('Gs. ', '')}
                          value={valor === '' ? '' : formatearEntrada(valor)}
                          onChange={(e) => {
                            const limpio = e.target.value.replace(/[^0-9]/g, '');
                            const original = (esNormalGeneral ? f.normal : f.especial) ?? '';
                            const igual = limpio === '' ? original === '' : original !== '' && Number(limpio) === Number(original);
                            setCambios((c) => {
                              const n = { ...c };
                              if (igual) delete n[f.varianteId];
                              else n[f.varianteId] = limpio;
                              return n;
                            });
                          }}
                        />
                      ) : (
                        <span className="num">{efectivo !== null ? dinero(efectivo) : '—'}</span>
                      )}
                    </td>
                    {!esNormalGeneral && (
                      <td className="der num">
                        {dif === null ? <span className="tenue">—</span> : <span className={dif < 0 ? '' : 'tenue'}>{dif > 0 ? '+' : ''}{dif.toFixed(1).replace('.', ',')} %</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > POR_PAGINA && (
            <div className="filtros" style={{ paddingTop: 12, alignItems: 'center' }}>
              <span className="tenue peq">
                {desde + 1}–{Math.min(desde + POR_PAGINA, total)} de {total}
              </span>
              <button className="btn" disabled={desde === 0} onClick={() => cambiarFiltro(() => setDesde(desde - POR_PAGINA))}>Anterior</button>
              <button className="btn" disabled={desde + POR_PAGINA >= total} onClick={() => cambiarFiltro(() => setDesde(desde + POR_PAGINA))}>Siguiente</button>
            </div>
          )}
        </>
      )}
      {ajuste && <AjustePorcentaje lista={lista} alCerrar={() => setAjuste(false)} />}
    </section>
  );
}

/** 9500 → "9.500" mientras se escribe. */
function formatearEntrada(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('es-PY') : v;
}

function AjustePorcentaje({ lista, alCerrar }: { lista: ListaPrecio; alCerrar: () => void }) {
  const qc = useQueryClient();
  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<{ id: string; nombre: string }[]>('/categorias') });
  const [signo, setSigno] = useState<'-' | '+'>('-');
  const [pct, setPct] = useState('10');
  const [redondeo, setRedondeo] = useState('100');
  const [categoriaId, setCategoriaId] = useState('');
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const porcentaje = (signo === '-' ? -1 : 1) * Number(pct.replace(',', '.'));
  const ejemplo = Math.max(Math.round((100000 * (100 + porcentaje)) / 100 / Number(redondeo)) * Number(redondeo), 0);
  const aplicar = useMutation({
    mutationFn: () => api<{ actualizados: number }>(`/listas-precio/${lista.id}/ajuste`, { metodo: 'POST', cuerpo: { porcentaje, redondeo: Number(redondeo), categoriaId: categoriaId || null, soloSinPrecio } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['precios-lista', lista.id] });
      void qc.invalidateQueries({ queryKey: ['listas-precio'] });
    },
  });
  const valido = Number.isFinite(porcentaje) && Number(pct) > 0 && porcentaje >= -90 && porcentaje <= 500;
  return (
    <Cajon
      titulo={`Cargar "${lista.nombre}" por porcentaje`}
      alCerrar={alCerrar}
      pie={
        aplicar.isSuccess ? (
          <button className="btn pri" onClick={alCerrar}>Listo</button>
        ) : (
          <>
            <button className="btn" onClick={alCerrar}>Cancelar</button>
            <button className="btn pri" disabled={!valido || aplicar.isPending} onClick={() => aplicar.mutate()}>Aplicar</button>
          </>
        )
      }
    >
      <ErrorApi error={aplicar.error} />
      {aplicar.isSuccess ? (
        <Aviso tipo="ok">Se cargaron {aplicar.data.actualizados} precios en la lista.</Aviso>
      ) : (
        <div className="form">
          <p className="tenue" style={{ margin: 0 }}>
            Calcula el precio de la lista a partir del precio normal de venta. Los precios cargados a mano se reemplazan, salvo que marque la última opción.
          </p>
          <div className="fila-campos">
            <Campo etiqueta="Respecto del precio normal" id="aj-s">
              <select id="aj-s" className="entrada" value={signo} onChange={(e) => setSigno(e.target.value as '-' | '+')}>
                <option value="-">Descuento (más barato)</option>
                <option value="+">Recargo (más caro)</option>
              </select>
            </Campo>
            <Campo etiqueta="Porcentaje" id="aj-p">
              <input id="aj-p" className="entrada num" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9,.]/g, ''))} />
            </Campo>
          </div>
          <div className="fila-campos">
            <Campo etiqueta="Redondear a" id="aj-r">
              <select id="aj-r" className="entrada" value={redondeo} onChange={(e) => setRedondeo(e.target.value)}>
                <option value="1">Sin redondeo</option>
                <option value="50">Gs. 50</option>
                <option value="100">Gs. 100</option>
                <option value="500">Gs. 500</option>
                <option value="1000">Gs. 1.000</option>
              </select>
            </Campo>
            <Campo etiqueta="Productos" id="aj-c">
              <select id="aj-c" className="entrada" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categorias.data?.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </Campo>
          </div>
          <label className="casilla">
            <input type="checkbox" checked={soloSinPrecio} onChange={(e) => setSoloSinPrecio(e.target.checked)} />
            Solo productos que todavía no tienen precio en esta lista
          </label>
          {valido && <p style={{ margin: 0 }}>Ejemplo: un producto de {dinero(100000)} queda en <b>{dinero(ejemplo)}</b>.</p>}
        </div>
      )}
    </Cajon>
  );
}

function FichaLista({ lista, alCerrar }: { lista: ListaPrecio | null; alCerrar: (nuevaId?: string) => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState(lista?.nombre ?? '');
  const [activa, setActiva] = useState(lista?.activa ?? true);
  const guardar = useMutation({
    mutationFn: () =>
      lista ? api<ListaPrecio>(`/listas-precio/${lista.id}`, { metodo: 'PATCH', cuerpo: { nombre, activa } }) : api<ListaPrecio>('/listas-precio', { metodo: 'POST', cuerpo: { nombre } }),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['listas-precio'] });
      alCerrar(lista ? undefined : l.id);
    },
  });
  return (
    <Cajon
      titulo={lista ? lista.nombre : 'Nueva lista de precios'}
      alCerrar={() => alCerrar()}
      pie={
        <>
          <button className="btn" onClick={() => alCerrar()}>Cancelar</button>
          <button className="btn pri" disabled={nombre.trim().length < 2 || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
        </>
      }
    >
      <ErrorApi error={guardar.error} />
      <div className="form">
        <Campo etiqueta="Nombre" id="ln" ayuda={lista ? undefined : 'Por ejemplo: Mayorista, Revendedor, Empleados.'}>
          <input id="ln" className="entrada" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Campo>
        {lista && !lista.predeterminada && (
          <>
            <label className="casilla">
              <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
              Lista activa
            </label>
            {!activa && lista.clientes > 0 && <Aviso tipo="info">Los {lista.clientes} clientes con esta lista pasan a pagar el precio normal mientras esté inactiva.</Aviso>}
          </>
        )}
      </div>
    </Cajon>
  );
}
