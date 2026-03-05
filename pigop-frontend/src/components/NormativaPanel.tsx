/**
 * NormativaPanel — Panel deslizante (slide-over) con:
 *   Tab 1: Checklist de Revisión Documental (por tipo de trámite)
 *   Tab 2: Documentos Normativos (listado + descarga de PDFs)
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  BookOpen,
  CheckSquare,
  FileText,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  Scale,
  Clock,
  ShieldCheck,
  FileCheck,
  Download,
} from 'lucide-react'

import {
  normativasApi,
  TRAMITE_LABELS,
  TIPO_NORMATIVA_LABELS,
  VERIFICACION_COLOR,
  type Normativa,
  type ChecklistSeccion,
} from '../api/normativas'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  /** Tipo de trámite del DEPP actual — preselecciona tab de checklist */
  tipoTramite?: string
  /** Clasificación del DEPP (I.1, II.1…) — muestra contexto */
  clasificacion?: string
  /** Folio del DEPP */
  folio?: string
}

type Tab = 'checklist' | 'normativas'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const VERIFICACION_ICONS: Record<string, React.ReactNode> = {
  fiscal:       <Scale size={12} />,
  documental:   <FileCheck size={12} />,
  presupuestal: <ShieldCheck size={12} />,
  plazo:        <Clock size={12} />,
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function ChecklistSeccionCard({ seccion }: { seccion: ChecklistSeccion }) {
  const [expanded, setExpanded] = useState(true)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const toggle = (id: string) =>
    setChecked((p) => ({ ...p, [id]: !p[id] }))

  const total = seccion.items.length
  const done = seccion.items.filter((i) => checked[i.id]).length

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      {/* Header de sección */}
      <button
        onClick={() => setExpanded((p) => !p)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: '#f9fafb', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={14} color="#6b7280" /> : <ChevronRight size={14} color="#6b7280" />}
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', flex: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {seccion.nombre}
        </span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 10,
          background: done === total ? '#dcfce7' : '#f3f4f6',
          color: done === total ? '#15803d' : '#6b7280',
          fontWeight: 600,
        }}>
          {done}/{total}
        </span>
      </button>

      {/* Ítems */}
      {expanded && (
        <div style={{ padding: '8px 0' }}>
          {seccion.items.map((item) => {
            const isChecked = checked[item.id] ?? false
            const color = VERIFICACION_COLOR[item.tipo_verificacion] || '#374151'
            const icon = VERIFICACION_ICONS[item.tipo_verificacion]

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex', gap: 10, padding: '8px 14px',
                  paddingLeft: item.is_subitem ? 36 : 14,
                  background: isChecked ? '#f0fdf4' : 'white',
                  borderLeft: item.is_subitem ? '3px solid #d1fae5' : '3px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggle(item.id)}
                  style={{
                    width: 18, height: 18, minWidth: 18, borderRadius: 4, marginTop: 1,
                    border: `2px solid ${isChecked ? '#16a34a' : '#d1d5db'}`,
                    background: isChecked ? '#16a34a' : 'white',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  {isChecked && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {/* Contenido */}
                <div style={{ flex: 1 }}>
                  <p style={{
                    margin: 0, fontSize: 13, color: isChecked ? '#6b7280' : '#111827',
                    textDecoration: isChecked ? 'line-through' : 'none',
                    lineHeight: 1.4,
                  }}>
                    {item.pregunta}
                  </p>

                  {/* Detalle expandible */}
                  {item.detalle && (
                    <pre style={{
                      margin: '6px 0 0', fontSize: 11, color: '#6b7280',
                      background: '#f9fafb', padding: '6px 8px', borderRadius: 4,
                      whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.5,
                    }}>
                      {item.detalle}
                    </pre>
                  )}

                  {/* Tags de metadata */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                    {/* Tipo verificación */}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: 10, padding: '2px 6px', borderRadius: 4,
                      background: `${color}18`, color,
                      fontWeight: 600, textTransform: 'capitalize',
                    }}>
                      {icon}
                      {item.tipo_verificacion}
                    </span>

                    {/* Artículo normativo */}
                    {item.articulo_referencia && (
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        background: '#eff6ff', color: '#1d4ed8', fontWeight: 600,
                      }}>
                        {item.articulo_referencia}
                      </span>
                    )}

                    {/* Normativa clave */}
                    {item.normativa_clave && (
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        background: '#f5f3ff', color: '#6d28d9', fontWeight: 500,
                      }}>
                        {item.normativa_clave.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


function NormativaCard({ normativa }: { normativa: Normativa }) {
  const tipoInfo = TIPO_NORMATIVA_LABELS[normativa.tipo] ?? { label: normativa.tipo, color: '#6b7280' }

  const handleView = () => {
    const token = localStorage.getItem('access_token') ?? ''
    const url = `/api/v1/normativas/${normativa.clave}/pdf`
    // Fetch con token y abrir en nueva ventana
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob)
        window.open(objUrl, '_blank')
      })
  }

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px',
      marginBottom: 10, background: 'white',
    }}>
      {/* Tipo badge + orden */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
          background: `${tipoInfo.color}18`, color: tipoInfo.color,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {tipoInfo.label}
        </span>
        {normativa.tamano_bytes && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {formatBytes(normativa.tamano_bytes)}
          </span>
        )}
      </div>

      {/* Título */}
      <p style={{
        margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: '#111827',
        lineHeight: 1.4,
      }}>
        {normativa.titulo}
      </p>

      {/* Descripción */}
      {normativa.descripcion && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>
          {normativa.descripcion}
        </p>
      )}

      {/* Referencias clave */}
      {normativa.referencias_clave && normativa.referencias_clave.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>
            Artículos clave
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {normativa.referencias_clave.map((ref, i) => (
              <span key={i} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4,
                background: '#eff6ff', color: '#1d4ed8', fontWeight: 600,
                cursor: 'default',
                title: ref.desc,
              }} title={ref.desc}>
                {ref.art}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Botón ver PDF */}
      {normativa.url_descarga && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleView}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: '7px 12px', borderRadius: 6, border: '1px solid #d1d5db',
              background: 'white', color: '#374151', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
          >
            <ExternalLink size={13} />
            Ver documento
          </button>
          <button
            onClick={() => {
              const token = localStorage.getItem('access_token') ?? ''
              const url = `/api/v1/normativas/${normativa.clave}/pdf`
              fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                .then((r) => r.blob())
                .then((blob) => {
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = normativa.filename?.split('/').pop() ?? `${normativa.clave}.pdf`
                  a.click()
                })
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: 6,
              border: '1px solid #911A3A',
              background: 'white', color: '#911A3A', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'white' }}
          >
            <Download size={13} />
            PDF
          </button>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function NormativaPanel({ open, onClose, tipoTramite, clasificacion, folio }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('checklist')
  const [selectedTramite, setSelectedTramite] = useState<string>(
    tipoTramite ?? 'beneficiarios_directos'
  )

  // Queries
  const { data: normativas, isLoading: loadingNorm } = useQuery({
    queryKey: ['normativas'],
    queryFn: () => normativasApi.list(),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  const { data: checklist, isLoading: loadingCL } = useQuery({
    queryKey: ['checklist', selectedTramite],
    queryFn: () => normativasApi.getChecklist(selectedTramite),
    enabled: open && activeTab === 'checklist',
    staleTime: 5 * 60_000,
  })

  if (!open) return null

  const tabStyle = (tab: Tab): React.CSSProperties => ({
    flex: 1, padding: '10px 0', border: 'none', background: 'none',
    cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab ? 700 : 500,
    color: activeTab === tab ? '#911A3A' : '#6b7280',
    borderBottom: activeTab === tab ? '2px solid #911A3A' : '2px solid transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    transition: 'all 0.15s',
  })

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          zIndex: 50, transition: 'opacity 0.2s',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 520, maxWidth: '95vw',
        background: '#f9fafb',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        zIndex: 51, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          background: '#6B1029', color: 'white',
          padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <BookOpen size={20} style={{ marginTop: 2, opacity: 0.85 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Base de Conocimiento · DPP
            </p>
            <h2 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700 }}>
              Normativa y Revisión Documental
            </h2>
            {folio && (
              <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.75 }}>
                DEPP: {folio}{clasificacion ? ` · Clasificación ${clasificacion}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6,
              padding: 6, cursor: 'pointer', color: 'white',
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: 'flex', background: 'white',
          borderBottom: '1px solid #e5e7eb',
        }}>
          <button style={tabStyle('checklist')} onClick={() => setActiveTab('checklist')}>
            <CheckSquare size={14} />
            Checklist de Revisión
          </button>
          <button style={tabStyle('normativas')} onClick={() => setActiveTab('normativas')}>
            <FileText size={14} />
            Documentos Normativos
            {normativas && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10,
                background: '#f3f4f6', color: '#6b7280', fontWeight: 600,
              }}>
                {normativas.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Contenido ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px' }}>

          {/* === TAB: CHECKLIST === */}
          {activeTab === 'checklist' && (
            <>
              {/* Selector de tipo trámite */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                  Tipo de Trámite
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {Object.entries(TRAMITE_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSelectedTramite(key)}
                      style={{
                        padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                        border: selectedTramite === key ? '2px solid #911A3A' : '2px solid #e5e7eb',
                        background: selectedTramite === key ? '#fff1f2' : 'white',
                        color: selectedTramite === key ? '#911A3A' : '#374151',
                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Info del checklist */}
              {checklist && !loadingCL && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 8,
                  background: '#fff1f2', marginBottom: 14,
                  border: '1px solid #fecdd3',
                }}>
                  <AlertCircle size={14} color="#911A3A" />
                  <span style={{ fontSize: 12, color: '#7f1d1d', fontWeight: 500 }}>
                    {checklist.titulo} · {checklist.total_items} puntos de verificación en {checklist.secciones.length} secciones
                  </span>
                </div>
              )}

              {/* Loading */}
              {loadingCL && (
                <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
                  Cargando checklist…
                </div>
              )}

              {/* Secciones */}
              {checklist && !loadingCL && checklist.secciones.map((sec) => (
                <ChecklistSeccionCard key={sec.nombre} seccion={sec} />
              ))}
            </>
          )}

          {/* === TAB: NORMATIVAS === */}
          {activeTab === 'normativas' && (
            <>
              {loadingNorm && (
                <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                  Cargando documentos…
                </div>
              )}

              {/* Info */}
              {normativas && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, marginBottom: 14,
                  background: '#f0f9ff', border: '1px solid #bae6fd',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <FileText size={14} color="#0369a1" />
                  <span style={{ fontSize: 12, color: '#075985', fontWeight: 500 }}>
                    {normativas.length} documentos normativos · Haz clic en "Ver documento" para consultar o descargar en PDF.
                  </span>
                </div>
              )}

              {normativas?.map((n) => (
                <NormativaCard key={n.id} normativa={n} />
              ))}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '10px 20px', background: 'white',
          borderTop: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            Dirección de Programación y Presupuesto · Ejercicio 2026
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px', borderRadius: 6,
              background: '#911A3A', color: 'white',
              border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </>
  )
}
