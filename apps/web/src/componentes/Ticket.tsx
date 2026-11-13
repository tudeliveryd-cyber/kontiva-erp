import { fechaHora } from '../lib/formato';
import { cantidad, dinero, NOMBRE_MEDIO, numero, type Venta } from '../lib/operacion';

/**
 * Comprobante para impresora térmica de 80 mm.
 * Con factura electrónica: KuDE en formato ticket (representación gráfica del DE, con QR y CDC).
 * Sin ella: comprobante interno, no válido como factura.
 */
export function Ticket({ venta, empresa }: { venta: Venta; empresa: { nombre: string; razonSocial: string; ruc: string | null } }) {
  const de = venta.documentoElectronico;
  return (
    <div className="ticket">
      <div className="t-centro">
        <b style={{ fontSize: 14 }}>{empresa.nombre}</b>
        <div>{empresa.razonSocial}</div>
        {empresa.ruc && <div>RUC {empresa.ruc}</div>}
        <div>
          {venta.sucursal.nombre}
          {venta.sucursal.direccion ? ` · ${venta.sucursal.direccion}` : ''}
        </div>
      </div>
      <div className="t-linea" />
      {de ? (
        <>
          <div>Timbrado N.º {de.timbrado}</div>
          {de.timbradoInicio && <div>Inicio de vigencia: {de.timbradoInicio.split('-').reverse().join('/')}</div>}
          <div className="t-centro t-fuerte" style={{ marginTop: 4 }}>FACTURA ELECTRÓNICA</div>
          <div className="t-centro t-fuerte">N.º {de.numero}</div>
          <div>Condición de venta: Contado</div>
          {de.ambiente === 'test' && <div className="t-centro t-fuerte">AMBIENTE DE PRUEBA · SIN VALOR FISCAL</div>}
        </>
      ) : (
        <>
          <div className="t-centro t-fuerte">COMPROBANTE INTERNO</div>
          <div className="t-centro">NO VÁLIDO COMO FACTURA</div>
          <div className="t-linea" />
          <div>
            N.º {venta.sucursal.codigo}-{venta.caja.nombre}-{String(venta.numero).padStart(7, '0')}
          </div>
        </>
      )}
      <div>{fechaHora(venta.fecha)}</div>
      <div>Atendió: {venta.vendedor.nombre}</div>
      {venta.cliente ? (
        <div>
          Cliente: {venta.cliente.nombre}
          {venta.cliente.documento ? ` · ${venta.cliente.documento.includes('-') ? 'RUC' : 'CI'} ${venta.cliente.documento}` : ''}
        </div>
      ) : (
        de && <div>Cliente: Sin nombre</div>
      )}
      {venta.estado === 'anulada' && <div className="t-centro t-fuerte">*** ANULADA ***</div>}
      <div className="t-linea" />
      {venta.items.map((i) => (
        <div key={i.linea} style={{ marginBottom: 3 }}>
          <div>{i.descripcion}</div>
          <div className="t-fila">
            <span>
              {cantidad(i.cantidad)} x {numero(i.precioUnitario)}
              {i.tasaIva === 0 ? ' Ex' : ` ${i.tasaIva}%`}
            </span>
            <span>{numero(i.total)}</span>
          </div>
          {Number(i.descuento) > 0 && <div className="t-fila"><span>  Descuento</span><span>-{numero(i.descuento)}</span></div>}
        </div>
      ))}
      <div className="t-linea" />
      <div className="t-fila t-fuerte" style={{ fontSize: 15 }}>
        <span>TOTAL</span>
        <span>{dinero(venta.total)}</span>
      </div>
      {venta.pagos.map((p, i) => (
        <div className="t-fila" key={i}>
          <span>
            {NOMBRE_MEDIO[p.medio]} {p.moneda !== 'PYG' ? `${dinero(p.monto, p.moneda)} @ ${numero(p.cotizacion)}` : ''}
          </span>
          <span>{numero(p.montoPyg)}</span>
        </div>
      ))}
      {Number(venta.credito) > 0 && (
        <div className="t-fila"><span>A crédito{venta.cuentaCobrar ? ` · vence ${venta.cuentaCobrar.vencimiento.split('-').reverse().join('/')}` : ''}</span><span>{numero(venta.credito)}</span></div>
      )}
      {venta.vuelto.map((v, i) => (
        <div className="t-fila" key={`v${i}`}>
          <span>Vuelto</span>
          <span>{dinero(v.monto, v.moneda)}</span>
        </div>
      ))}
      <div className="t-linea" />
      <div className="t-fila"><span>Gravado 10 %</span><span>{numero(venta.gravado10)}</span></div>
      <div className="t-fila"><span>IVA 10 %</span><span>{numero(venta.iva10)}</span></div>
      {Number(venta.gravado5) > 0 && <div className="t-fila"><span>Gravado 5 %</span><span>{numero(venta.gravado5)}</span></div>}
      {Number(venta.gravado5) > 0 && <div className="t-fila"><span>IVA 5 %</span><span>{numero(venta.iva5)}</span></div>}
      {Number(venta.exento) > 0 && <div className="t-fila"><span>Exento</span><span>{numero(venta.exento)}</span></div>}
      {de && <div className="t-fila t-fuerte"><span>Total IVA</span><span>{numero(de.totalIva)}</span></div>}
      <div className="t-linea" />
      {de && (
        <>
          <div className="t-centro">
            <img src={de.qrImagen} alt="Código QR de consulta" style={{ width: '34mm', height: '34mm', margin: '4px auto', display: 'block' }} />
          </div>
          <div className="t-centro" style={{ fontSize: 11 }}>Consulte la validez de esta factura electrónica con el número de CDC en</div>
          <div className="t-centro" style={{ fontSize: 11 }}>https://ekuatia.set.gov.py/consultas{de.ambiente === 'test' ? '-test' : ''}</div>
          <div className="t-centro t-fuerte" style={{ fontSize: 11, marginTop: 4 }}>CDC: {de.cdc.match(/.{1,4}/g)!.join(' ')}</div>
          <div className="t-centro" style={{ fontSize: 10, marginTop: 4 }}>ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)</div>
          {de.estado === 'cancelado' && <div className="t-centro t-fuerte">*** FACTURA CANCELADA ***</div>}
          <div className="t-linea" />
        </>
      )}
      <div className="t-centro">Gracias por su compra</div>
      <div className="t-centro" style={{ fontSize: 10, marginTop: 4 }}>KONTIVA ERP · Araújo Tech Sistemas</div>
    </div>
  );
}

export interface DevolucionNc {
  id: string;
  numero: number;
  total: string;
  motivo: string;
  fecha: string;
  usuario: string;
  items: { linea: number; descripcion: string; cantidad: string; total: string }[];
  notaCredito: {
    cdc: string;
    numero: string;
    timbrado: string;
    timbradoInicio: string | null;
    estado: string;
    qrImagen: string;
    ambiente: 'test' | 'produccion';
    totalIva: string;
    receptor: string;
    receptorDocumento: string | null;
    factura: { cdc: string; numero: string } | null;
  } | null;
}

/** KuDE de la nota de crédito electrónica (formato ticket de 80 mm). */
export function TicketNotaCredito({ dev, venta, empresa }: { dev: DevolucionNc; venta: Venta; empresa: { nombre: string; razonSocial: string; ruc: string | null } }) {
  const nc = dev.notaCredito!;
  return (
    <div className="ticket">
      <div className="t-centro">
        <b style={{ fontSize: 14 }}>{empresa.nombre}</b>
        <div>{empresa.razonSocial}</div>
        {empresa.ruc && <div>RUC {empresa.ruc}</div>}
        <div>{venta.sucursal.nombre}{venta.sucursal.direccion ? ` · ${venta.sucursal.direccion}` : ''}</div>
      </div>
      <div className="t-linea" />
      <div>Timbrado N.º {nc.timbrado}</div>
      {nc.timbradoInicio && <div>Inicio de vigencia: {nc.timbradoInicio.split('-').reverse().join('/')}</div>}
      <div className="t-centro t-fuerte" style={{ marginTop: 4 }}>NOTA DE CRÉDITO ELECTRÓNICA</div>
      <div className="t-centro t-fuerte">N.º {nc.numero}</div>
      {nc.ambiente === 'test' && <div className="t-centro t-fuerte">AMBIENTE DE PRUEBA · SIN VALOR FISCAL</div>}
      <div>{fechaHora(dev.fecha)}</div>
      <div>Cliente: {nc.receptor}{nc.receptorDocumento ? ` · ${nc.receptorDocumento}` : ''}</div>
      <div>Motivo: Devolución · {dev.motivo}</div>
      {nc.factura && <div>Factura asociada: {nc.factura.numero}</div>}
      <div className="t-linea" />
      {dev.items.map((i) => (
        <div key={i.linea} style={{ marginBottom: 3 }}>
          <div>{i.descripcion}</div>
          <div className="t-fila"><span>{cantidad(i.cantidad)} unid.</span><span>{numero(i.total)}</span></div>
        </div>
      ))}
      <div className="t-linea" />
      <div className="t-fila t-fuerte" style={{ fontSize: 15 }}><span>TOTAL</span><span>{dinero(dev.total)}</span></div>
      <div className="t-fila t-fuerte"><span>Total IVA</span><span>{numero(nc.totalIva)}</span></div>
      <div className="t-linea" />
      <div className="t-centro"><img src={nc.qrImagen} alt="Código QR de consulta" style={{ width: '34mm', height: '34mm', margin: '4px auto', display: 'block' }} /></div>
      <div className="t-centro" style={{ fontSize: 11 }}>Consulte la validez con el número de CDC en https://ekuatia.set.gov.py/consultas{nc.ambiente === 'test' ? '-test' : ''}</div>
      <div className="t-centro t-fuerte" style={{ fontSize: 11, marginTop: 4 }}>CDC: {nc.cdc.match(/.{1,4}/g)!.join(' ')}</div>
      <div className="t-centro" style={{ fontSize: 10, marginTop: 4 }}>ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)</div>
      <div className="t-linea" />
      <div className="t-centro" style={{ fontSize: 10 }}>KONTIVA ERP · Araújo Tech Sistemas</div>
    </div>
  );
}
