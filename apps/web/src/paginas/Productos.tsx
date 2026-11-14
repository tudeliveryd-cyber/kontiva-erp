import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3x3, Plus, Search, Upload, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cajon, Campo, Cargando, Encabezado, ErrorApi, Vacio } from '../componentes/ui';
import { api } from '../lib/api';
import { dinero, UNIDADES, type Producto } from '../lib/operacion';
import { useSesion } from '../lib/sesion';
import { ArmarGrade, TablaGrade, type FilaGrade } from '../componentes/Ropa';
import { compararTalles } from '@kontiva/shared';

export function Productos() {
  const { puede } = useSesion();
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [abierto, setAbierto] = useState<Producto | 'nuevo' | null>(null);
  const lista = useQuery({
    queryKey: ['productos', q, pagina],
    queryFn: () => api<{ total: number; items: Producto[] }>(`/productos?q=${encodeURIComponent(q)}&pagina=${pagina}`),
    placeholderData: (prev) => prev,
  });
  const verCosto = puede('costo_producto.ver');

  return (
    <>
      <Encabezado titulo="Productos">
        {puede('producto.crear') && (
          <Link className="btn" to="/importar/productos">
            <Upload size={16} /> Importar desde Excel
          </Link>
        )}
        {puede('producto.crear') && (
          <button className="btn pri" onClick={() => setAbierto('nuevo')}>
            <Plus size={16} /> Nuevo producto
          </button>
        )}
      </Encabezado>
      <div className="contenido">
        <section className="panel">
          <div className="filtros" style={{ paddingTop: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 440 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--t3)' }} />
              <input className="entrada" style={{ paddingLeft: 36, width: '100%' }} placeholder="Nombre, SKU o código de barras" value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} />
            </div>
            {lista.data && <span className="tenue peq" style={{ alignSelf: 'center' }}>{lista.data.total} productos</span>}
          </div>
          {lista.isLoading ? (
            <Cargando />
          ) : !lista.data?.items.length ? (
            <Vacio titulo={q ? 'Sin resultados' : 'Todavía no hay productos'} accion={!q && puede('producto.crear') && <button className="btn pri" onClick={() => setAbierto('nuevo')}>Cargar el primero</button>} />
          ) : (
            <div className="desplazar">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>IVA</th>
                    <th className="der">Precio</th>
                    {verCosto && <th className="der">Costo</th>}
                    <th>Código</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.data.items.map((p) => {
                    const v = p.variantes.filter((x) => x.activa);
                    const precios = [...new Set(v.map((x) => Number(x.precio)))];
                    return (
                      <tr key={p.id} className="clic" onClick={() => setAbierto(p)}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                          <div className="tenue peq">
                            {v.some((x) => x.talle || x.color) ? `${new Set(v.map((x) => x.talle ?? '')).size} talles × ${new Set(v.map((x) => x.color ?? '')).size} colores` : v.length > 1 ? `${v.length} variantes` : p.marca?.nombre ?? ''}
                            {p.tipo === 'servicio' ? 'Servicio' : ''}
                          </div>
                        </td>
                        <td className="tenue">{p.categoria?.nombre ?? '—'}</td>
                        <td>{p.tasaIva === 0 ? 'Exento' : `${p.tasaIva} %`}</td>
                        <td className="der num">{precios.length === 1 ? dinero(precios[0]!) : `${dinero(Math.min(...precios))} – ${dinero(Math.max(...precios))}`}</td>
                        {verCosto && <td className="der num tenue">{v[0]?.costo ? dinero(v[0].costo) : '—'}</td>}
                        <td className="mono tenue">{v[0]?.codigos[0] ?? v[0]?.sku ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {lista.data && lista.data.total > 50 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 14 }}>
              <button className="btn chico" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span className="tenue peq" style={{ alignSelf: 'center' }}>Página {pagina} de {Math.ceil(lista.data.total / 50)}</span>
              <button className="btn chico" disabled={pagina * 50 >= lista.data.total} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
            </div>
          )}
        </section>
      </div>
      {abierto && <FichaProducto producto={abierto === 'nuevo' ? null : abierto} alCerrar={() => setAbierto(null)} />}
    </>
  );
}

interface VarianteForm {
  id?: string;
  nombre: string;
  sku: string;
  codigos: string;
  precio: string;
  costo: string;
  stockMinimo: string;
  activa: boolean;
}

function FichaProducto({ producto, alCerrar }: { producto: Producto | null; alCerrar: () => void }) {
  const { puede, yo } = useSesion();
  const qc = useQueryClient();
  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<{ id: string; nombre: string }[]>('/categorias') });
  const editable = producto ? puede('producto.editar') : puede('producto.crear');
  const verCosto = puede('costo_producto.ver');
  const editarCosto = puede('costo_producto.editar');
  const editarPrecio = !producto || puede('precio.editar');
  const [d, setD] = useState({
    nombre: producto?.nombre ?? '',
    categoriaId: producto?.categoria?.id ?? '',
    tipo: producto?.tipo ?? 'producto',
    unidad: producto?.unidad ?? 'unidad',
    tasaIva: String(producto?.tasaIva ?? 10),
    controlaStock: producto?.controlaStock ?? true,
    controlaLote: producto?.controlaLote ?? false,
    principioActivo: producto?.principioActivo ?? '',
    concentracion: producto?.concentracion ?? '',
    forma: producto?.forma ?? '',
    registroSanitario: producto?.registroSanitario ?? '',
    condicionVenta: producto?.condicionVenta ?? 'libre',
    estacion: producto?.estacion ?? '',
  });
  const [medicamento, setMedicamento] = useState(!!(producto?.principioActivo || (producto?.condicionVenta && producto.condicionVenta !== 'libre')));
  const [variantes, setVariantes] = useState<VarianteForm[]>(
    producto?.variantes.filter((v) => v.activa).map((v) => ({ id: v.id, nombre: v.nombre ?? '', sku: v.sku ?? '', codigos: v.codigos.join(', '), precio: String(Number(v.precio)), costo: v.costo ? String(Number(v.costo)) : '', stockMinimo: v.stockMinimo && Number(v.stockMinimo) ? String(Number(v.stockMinimo)) : '', activa: true })) ?? [
      { nombre: '', sku: '', codigos: '', precio: '', costo: '', stockMinimo: '', activa: true },
    ],
  );
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  // Grade talle × color (ropa y calzado): reemplaza la lista de variantes por una tabla.
  const activas = producto?.variantes.filter((v) => v.activa) ?? [];
  const [grade, setGrade] = useState<FilaGrade[] | null>(
    activas.some((v) => v.talle || v.color)
      ? activas
          .map((v) => ({ id: v.id, talle: v.talle ?? '', color: v.color ?? '', sku: v.sku ?? '', codigos: v.codigos.join(', '), precio: String(Number(v.precio)), costo: v.costo ? String(Number(v.costo)) : '' }))
          .sort((a, b) => compararTalles(a.talle, b.talle) || a.color.localeCompare(b.color, 'es'))
      : null,
  );
  const [armando, setArmando] = useState(false);

  const crearCategoria = useMutation({
    mutationFn: () => api<{ id: string }>('/categorias', { metodo: 'POST', cuerpo: { nombre: nuevaCategoria } }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['categorias'] });
      setD({ ...d, categoriaId: c.id });
      setNuevaCategoria('');
    },
  });
  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        nombre: d.nombre,
        categoriaId: d.categoriaId || null,
        tipo: d.tipo,
        unidad: d.unidad,
        tasaIva: Number(d.tasaIva),
        controlaStock: d.tipo === 'servicio' ? false : d.controlaStock,
        controlaLote: d.tipo !== 'servicio' && d.controlaStock && d.controlaLote,
        estacion: d.tipo === 'servicio' || !d.estacion ? null : d.estacion,
        ...(medicamento
          ? { principioActivo: d.principioActivo.trim() || null, concentracion: d.concentracion.trim() || null, forma: d.forma.trim() || null, registroSanitario: d.registroSanitario.trim() || null, condicionVenta: d.condicionVenta }
          : { principioActivo: null, concentracion: null, forma: null, registroSanitario: null, condicionVenta: 'libre' }),
        variantes: grade
          ? grade.map((f) => ({
              ...(f.id ? { id: f.id } : {}),
              talle: f.talle || null,
              color: f.color || null,
              sku: f.sku || null,
              codigos: f.codigos.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean),
              precio: Number(f.precio || 0),
              ...(editarCosto && f.costo !== '' ? { costo: Number(f.costo) } : {}),
            }))
          : variantes.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          nombre: v.nombre || null,
          sku: v.sku || null,
          codigos: v.codigos.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean),
          precio: Number(v.precio || 0),
          ...(editarCosto && v.costo !== '' ? { costo: Number(v.costo) } : {}),
          stockMinimo: Number(v.stockMinimo || 0),
        })),
      };
      return producto ? api(`/productos/${producto.id}`, { metodo: 'PATCH', cuerpo }) : api('/productos', { metodo: 'POST', cuerpo });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['productos'] });
      alCerrar();
    },
  });
  const desactivar = useMutation({
    mutationFn: () => api(`/productos/${producto!.id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['productos'] });
      alCerrar();
    },
  });
  const setV = (i: number, c: Partial<VarianteForm>) => setVariantes((vs) => vs.map((v, j) => (j === i ? { ...v, ...c } : v)));
  const varias = variantes.length > 1;

  return (
    <Cajon
      titulo={producto ? producto.nombre : 'Nuevo producto'}
      ancho={grade || armando ? 900 : undefined}
      alCerrar={alCerrar}
      pie={
        editable && (
          <>
            {producto && puede('producto.eliminar') && (
              <button className="btn peligro" style={{ marginRight: 'auto' }} onClick={() => confirm('¿Desactivar el producto? Deja de aparecer en la caja.') && desactivar.mutate()}>
                Desactivar
              </button>
            )}
            <button className="btn" onClick={alCerrar}>Cancelar</button>
            <button className="btn pri" disabled={!d.nombre.trim() || guardar.isPending} onClick={() => guardar.mutate()}>Guardar</button>
          </>
        )
      }
    >
      <ErrorApi error={guardar.error ?? desactivar.error} />
      <div className="form">
        <Campo etiqueta="Nombre" id="pn">
          <input id="pn" className="entrada" autoFocus disabled={!editable} value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} />
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Categoría" id="pc">
            <select id="pc" className="entrada" disabled={!editable} value={d.categoriaId} onChange={(e) => setD({ ...d, categoriaId: e.target.value })}>
              <option value="">Sin categoría</option>
              {categorias.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </Campo>
          {editable && (
            <Campo etiqueta="Nueva categoría" id="pnc">
              <div style={{ display: 'flex', gap: 6 }}>
                <input id="pnc" className="entrada" value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} />
                <button type="button" className="btn" disabled={!nuevaCategoria.trim()} onClick={() => crearCategoria.mutate()}>Crear</button>
              </div>
            </Campo>
          )}
        </div>
        <div className="fila-campos">
          <Campo etiqueta="IVA (incluido en el precio)" id="pi">
            <select id="pi" className="entrada" disabled={!editable} value={d.tasaIva} onChange={(e) => setD({ ...d, tasaIva: e.target.value })}>
              <option value="10">10 %</option>
              <option value="5">5 %</option>
              <option value="0">Exento</option>
            </select>
          </Campo>
          <Campo etiqueta="Se vende por" id="pu">
            <select id="pu" className="entrada" disabled={!editable} value={d.unidad} onChange={(e) => setD({ ...d, unidad: e.target.value })}>
              {Object.entries(UNIDADES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Tipo" id="pt">
            <select id="pt" className="entrada" disabled={!editable} value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as 'producto' | 'servicio' })}>
              <option value="producto">Producto</option>
              <option value="servicio">Servicio (sin stock)</option>
            </select>
          </Campo>
        </div>
        {d.tipo === 'producto' && (
          <label className="casilla">
            <input type="checkbox" disabled={!editable} checked={d.controlaStock} onChange={(e) => setD({ ...d, controlaStock: e.target.checked })} /> Controlar stock
          </label>
        )}
        {d.tipo === 'producto' && d.controlaStock && (
          <label className="casilla">
            <input type="checkbox" disabled={!editable} checked={d.controlaLote} onChange={(e) => setD({ ...d, controlaLote: e.target.checked })} /> Controlar lotes y vencimientos
            <span className="tenue peq">(la compra pide lote o vencimiento; se vende primero lo que vence antes y nunca lo vencido)</span>
          </label>
        )}
        {d.tipo === 'producto' && ['restaurante', 'panaderia'].includes(yo?.empresa.rubro ?? '') && (
          <Campo etiqueta="Se prepara en (restaurante)" id="pr-es" ayuda="Su comanda aparece en esa pantalla; sin estación, el mozo lo sirve directo.">
            <select id="pr-es" className="entrada" disabled={!editable} value={d.estacion} onChange={(e) => setD({ ...d, estacion: e.target.value as typeof d.estacion })}>
              <option value="">Se sirve directo</option>
              <option value="cocina">Cocina</option>
              <option value="bar">Bar</option>
            </select>
          </Campo>
        )}
        {d.tipo === 'producto' && (
          <label className="casilla">
            <input type="checkbox" disabled={!editable} checked={medicamento} onChange={(e) => setMedicamento(e.target.checked)} /> Es un medicamento
          </label>
        )}
      </div>

      {medicamento && d.tipo === 'producto' && (
        <div className="seccion-form">
          <h3>Medicamento</h3>
          <div className="form">
            <div className="fila-campos">
              <Campo etiqueta="Principio activo" id="pr-pa"><input id="pr-pa" className="entrada" disabled={!editable} placeholder="Paracetamol" value={d.principioActivo} onChange={(e) => setD({ ...d, principioActivo: e.target.value })} /></Campo>
              <Campo etiqueta="Concentración" id="pr-co"><input id="pr-co" className="entrada" disabled={!editable} placeholder="500 mg" value={d.concentracion} onChange={(e) => setD({ ...d, concentracion: e.target.value })} /></Campo>
              <Campo etiqueta="Forma" id="pr-fo"><input id="pr-fo" className="entrada" disabled={!editable} placeholder="Comprimido, jarabe" value={d.forma} onChange={(e) => setD({ ...d, forma: e.target.value })} /></Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Condición de venta" id="pr-cv">
                <select id="pr-cv" className="entrada" disabled={!editable} value={d.condicionVenta} onChange={(e) => setD({ ...d, condicionVenta: e.target.value as typeof d.condicionVenta })}>
                  <option value="libre">Venta libre</option>
                  <option value="receta">Bajo receta</option>
                  <option value="receta_archivada">Bajo receta archivada (psicotrópicos y estupefacientes)</option>
                </select>
              </Campo>
              <Campo etiqueta="Registro sanitario (DNVS)" id="pr-rs"><input id="pr-rs" className="entrada" disabled={!editable} value={d.registroSanitario} onChange={(e) => setD({ ...d, registroSanitario: e.target.value })} /></Campo>
            </div>
            {d.condicionVenta !== 'libre' && <p className="tenue peq" style={{ margin: 0 }}>El PDV pide los datos de la receta{d.condicionVenta === 'receta_archivada' ? ', la cédula del paciente y que la receta quede retenida' : ''}. La venta queda en el libro recetario.</p>}
            {!d.controlaLote && <p className="tenue peq" style={{ margin: 0 }}>Recomendado: active "Controlar lotes y vencimientos" para la trazabilidad por lote.</p>}
          </div>
        </div>
      )}

      {(grade || armando) && (
        <div className="seccion-form">
          <h3>Talles y colores</h3>
          <div className="form">
            {armando ? (
              <>
                <ArmarGrade
                  nombre={d.nombre}
                  actuales={grade ?? []}
                  verCosto={verCosto && editarCosto}
                  alArmar={(f) => {
                    setGrade(f);
                    setArmando(false);
                  }}
                />
                <button type="button" className="btn chico" style={{ alignSelf: 'flex-start' }} onClick={() => setArmando(false)}>Volver</button>
              </>
            ) : (
              grade && (
                <>
                  <TablaGrade filas={grade} editable={editable} editarPrecio={editarPrecio} verCosto={verCosto} editarCosto={editarCosto} alCambiar={setGrade} />
                  {editable && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn chico" onClick={() => setArmando(true)}><Grid3x3 size={14} /> Cambiar talles y colores</button>
                      {!producto && <button type="button" className="btn chico" onClick={() => setGrade(null)}>Sin grade</button>}
                    </div>
                  )}
                </>
              )
            )}
          </div>
        </div>
      )}

      {!grade && !armando && (
      <div className="seccion-form">
        <h3>{varias ? 'Variantes' : 'Precio y códigos'}</h3>
        <div className="form">
          {variantes.map((v, i) => (
            <div key={v.id ?? i} className={varias ? 'panel' : undefined} style={varias ? { padding: 14 } : undefined}>
              <div className="form">
                {varias && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <Campo etiqueta="Variante" id={`vn${i}`}>
                        <input id={`vn${i}`} className="entrada" placeholder="Talle M · Rojo" disabled={!editable} value={v.nombre} onChange={(e) => setV(i, { nombre: e.target.value })} />
                      </Campo>
                    </div>
                    {editable && (
                      <button type="button" className="enlace" style={{ marginBottom: 12 }} aria-label="Quitar variante" onClick={() => setVariantes((vs) => vs.filter((_, j) => j !== i))}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
                <div className="fila-campos">
                  <Campo etiqueta="Precio de venta (Gs.)" id={`vp${i}`} ayuda={v.precio ? dinero(v.precio) : undefined}>
                    <input id={`vp${i}`} className="entrada num" inputMode="numeric" disabled={!editable || !editarPrecio} value={v.precio} onChange={(e) => setV(i, { precio: e.target.value.replace(/[^0-9]/g, '') })} />
                  </Campo>
                  {verCosto && (
                    <Campo etiqueta="Costo (Gs.)" id={`vc${i}`} ayuda={v.costo && v.precio ? `Margen ${Math.round(((Number(v.precio) - Number(v.costo)) / Number(v.precio)) * 100)} %` : undefined}>
                      <input id={`vc${i}`} className="entrada num" inputMode="numeric" disabled={!editable || !editarCosto} value={v.costo} onChange={(e) => setV(i, { costo: e.target.value.replace(/[^0-9]/g, '') })} />
                    </Campo>
                  )}
                </div>
                <div className="fila-campos">
                  <Campo etiqueta="Código de barras" id={`vb${i}`} ayuda="Escanee o escriba. Varios: separados por coma.">
                    <input id={`vb${i}`} className="entrada mono" disabled={!editable} value={v.codigos} onChange={(e) => setV(i, { codigos: e.target.value })} />
                  </Campo>
                  <Campo etiqueta="SKU / código interno" id={`vs${i}`}>
                    <input id={`vs${i}`} className="entrada mono" disabled={!editable} value={v.sku} onChange={(e) => setV(i, { sku: e.target.value })} />
                  </Campo>
                  {d.tipo !== 'servicio' && (
                    <Campo etiqueta="Stock mínimo" id={`vm${i}`} ayuda="Aviso de reposición por depósito.">
                      <input id={`vm${i}`} className="entrada num" inputMode="decimal" disabled={!editable} value={v.stockMinimo} onChange={(e) => setV(i, { stockMinimo: e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.') })} />
                    </Campo>
                  )}
                </div>
              </div>
            </div>
          ))}
          {editable && (
            <button type="button" className="btn chico" style={{ alignSelf: 'flex-start' }} onClick={() => setVariantes((vs) => [...vs, { nombre: '', sku: '', codigos: '', precio: vs[0]?.precio ?? '', costo: vs[0]?.costo ?? '', stockMinimo: vs[0]?.stockMinimo ?? '', activa: true }])}>
              <Plus size={14} /> Agregar variante (presentación, sabor)
            </button>
          )}
          {editable && d.tipo === 'producto' && (
            <button type="button" className="btn chico" style={{ alignSelf: 'flex-start' }} onClick={() => setArmando(true)}>
              <Grid3x3 size={14} /> Armar grade de talles y colores
            </button>
          )}
        </div>
      </div>
      )}
    </Cajon>
  );
}
