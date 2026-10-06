import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex max-w-full items-center justify-center rounded-[10px] text-sm font-semibold transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[.985] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
         primary: 'bg-accent text-white hover:bg-accent/90 active:bg-accent-pressed',
        secondary: 'border border-line bg-transparent text-ink hover:bg-line/40 active:bg-line/70',
        ghost: 'text-muted hover:bg-paper hover:text-ink active:bg-line/60',
         danger: 'border border-accent bg-accent text-white hover:bg-accent/90 active:bg-accent-pressed',
      },
      size: {
        sm: 'min-h-11 gap-1.5 px-3 text-sm',
        md: 'min-h-11 gap-2 px-4',
        lg: 'min-h-12 gap-2 px-5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & {
  loading?: boolean
  icon?: ReactNode
}

export function Button({ className, variant, size, loading, icon, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
