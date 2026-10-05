import { createContext, useContext } from 'react'
import type { ProductShowcase } from '../api'

/** Chat state the rest of the page needs: whether the panel is open, and the products it found. */
export interface ChatState {
  open: boolean
  setOpen: (open: boolean) => void
  /** The latest browse results from the chat, shown on the page by <ChatShowcase>. */
  showcase: ProductShowcase | null
  /** Goes up by one whenever the shelf should open and scroll into view. */
  revealCount: number
  showOnPage: (showcase: ProductShowcase) => void
  reveal: () => void
  clearShowcase: () => void
}

export const ChatContext = createContext<ChatState | null>(null)

export function useChat(): ChatState {
  const chat = useContext(ChatContext)
  if (!chat) throw new Error('useChat must be used inside <ChatProvider>')
  return chat
}
