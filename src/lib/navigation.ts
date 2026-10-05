import type { LucideIcon } from 'lucide-react'
import {
  Home,
  Ellipsis,
  ShoppingBag,
  Users,
} from 'lucide-react'

export type NavigationItem = {
  label: string
  to: string
  icon: LucideIcon
  end?: boolean
}

export const primaryNavigation: NavigationItem[] = [
  { label: 'Home', to: '/dashboard', icon: Home, end: true },
  { label: 'Sales', to: '/sales', icon: ShoppingBag },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'More', to: '/more', icon: Ellipsis },
]

export const utilityNavigation: NavigationItem[] = []
