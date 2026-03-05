/**
 * UPPBadge — Muestra el código de UPP con el nombre completo de la dependencia.
 * Realiza un lookup automático en el catálogo de UPPs 2026.
 */
import { useQuery } from '@tanstack/react-query'
import { uppsApi, CLASIFICACION_COLORS } from '../api/upps'

interface Props {
  codigo: string
  /** true = muestra nombre completo debajo del código */
  showNombre?: boolean
  /** true = muestra badge de clasificación (CENTRALIZADA, etc.) */
  showClasificacion?: boolean
  /** Variante de presentación */
  variant?: 'inline' | 'stacked' | 'compact'
}

export function UPPBadge({
  codigo,
  showNombre = true,
  showClasificacion = false,
  variant = 'stacked',
}: Props) {
  const { data: upp } = useQuery({
    queryKey: ['upp', codigo],
    queryFn: () => uppsApi.lookup(codigo),
    enabled: !!codigo && codigo !== 'N/A',
    staleTime: 60 * 60_000,  // 1 hora — el catálogo cambia raramente
    retry: false,
  })

  const clasifStyle = upp ? CLASIFICACION_COLORS[upp.clasificacion_admin] : null

  if (variant === 'compact') {
    return (
      <span
        title={upp?.nombre ?? codigo}
        style={{ fontFamily: 'monospace', fontWeight: 700 }}
      >
        {upp?.sigla ?? codigo}
      </span>
    )
  }

  if (variant === 'inline') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#111827' }}>
          {codigo}
        </span>
        {upp && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            · {upp.sigla ?? upp.nombre.split(' ').slice(0, 4).join(' ')}
          </span>
        )}
      </span>
    )
  }

  // variant === 'stacked' (default)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#111827',
        }}>
          {codigo}
        </span>
        {showClasificacion && upp && clasifStyle && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
            background: clasifStyle.bg, color: clasifStyle.text,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {upp.clasificacion_admin}
          </span>
        )}
      </div>
      {showNombre && upp && (
        <p style={{
          margin: '2px 0 0', fontSize: 11, color: '#6b7280',
          lineHeight: 1.3, fontWeight: 500,
        }}>
          {upp.nombre}
        </p>
      )}
      {showNombre && !upp && (
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>
          Unidad Programática
        </p>
      )}
    </div>
  )
}

export default UPPBadge
