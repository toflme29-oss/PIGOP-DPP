import { Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

const SIZES = { sm: 16, md: 24, lg: 40 }

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <div className={clsx('flex flex-col items-center gap-2', className)}>
      <Loader2 size={SIZES[size]} className="animate-spin text-blue-600" />
      {label && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  )
}

export function PageSpinner({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Spinner size="lg" label={label} />
    </div>
  )
}
