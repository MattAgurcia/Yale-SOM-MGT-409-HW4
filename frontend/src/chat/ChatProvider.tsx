import { useMemo, useState, type ReactNode } from 'react'
import type { ProductShowcase } from '../api'
import { useAuth } from '../auth/useAuth'
import { ChatContext, type ChatState } from './chatContext'

export default function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [showcase, setShowcase] = useState<ProductShowcase | null>(null)
  const [revealCount, setRevealCount] = useState(0)

  // A different shopper (log in, log out) gets a clean page: nothing from the
  // last person's chat stays on screen. Adjusted while rendering, not in an effect.
  const userId = user?.id ?? null
  const [owner, setOwner] = useState(userId)
  if (owner !== userId) {
    setOwner(userId)
    setShowcase(null)
  }

  const value = useMemo<ChatState>(
    () => ({
      open,
      setOpen,
      showcase,
      revealCount,
      showOnPage: (next) => {
        setShowcase(next)
        setRevealCount((count) => count + 1)
      },
      reveal: () => setRevealCount((count) => count + 1),
      clearShowcase: () => setShowcase(null),
    }),
    [open, showcase, revealCount],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
