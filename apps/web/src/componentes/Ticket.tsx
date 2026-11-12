import { fechaHora } from '../lib/formato';
import { cantidad, dinero, NOMBRE_MEDIO, numero, type Venta } from '../lib/operacion';

/**
 * Comprobante interno para impresora térmica de 80 mm.
 * No es una factura: sin certificado digital y CSC no se emiten documentos fiscales.
 */
export function Ticket({ venta, empresa }: { venta: Venta; empresa: { nombre: string; razonSocial: string; ruc: string | null } }) {
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
      <div className="t-centro t-fuerte">COMPROBANTE INTERNO</div>
      <div className="t-centro">NO VÁLIDO COMO FACTURA</div>
      <div className="t-linea" />
      <div>
        N.º {venta.sucursal.codigo}-{venta.caja.nombre}-{String(venta.numero).padStart(7, '0')}
      </div>
      <div>{fechaHora(venta.fecha)}</div>
      <div>Atendió: {venta.vendedor.nombre}</div>
      {venta.cliente && (
        <div>
          Cliente: {venta.cliente.nombre}
          {venta.cliente.documento ? ` · ${venta.cliente.documento}` : ''}
        </div>
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
      <div className="t-linea" />
      <div className="t-centro">Gracias por su compra</div>
      <div className="t-centro" style={{ fontSize: 10, marginTop: 4 }}>KONTIVA ERP · Araújo Tech Sistemas</div>
    </div>
  );
}
