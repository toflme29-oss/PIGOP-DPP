import { clsx } from 'clsx'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'

type AlertVariant = 'info' | 'success' | 'warning' | 'error'

interface AlertProps {
  variant?: AlertVariant
  title?: string
  children: React.ReactNode
  className?: string
}

const CONFIGS = {
  info:    { icon: Info,          bg: 'bg-blue-50',   border: 'border-blue-200',  text: 'text-blue-800'  },
  success: { icon: CheckCircle2, bg: 'bg-green-50',  border: 'border-green-200', text: 'text-green-800' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-800' },
  error:   { icon: AlertCircle,   bg: 'bg-red-50',    border: 'border-red-200',   text: 'text-red-800'   },
}

export function Alert({ variant = 'info', title, children, className }: AlertProps) {
  const { icon: Icon, bg, border, text } = CONFIGS[variant]
  return (
    <div className={clsx('flex gap-3 p-4 rounded-lg border', bg, border, className)}>
      <Icon size={18} className={clsx('flex-shrink-0 mt-0.5', text)} />
      <div className={clsx('text-sm', text)}>
        {title && <p className="font-medium mb-1">{title}</p>}
        {children}
      </div>
    </div>
  )
}
