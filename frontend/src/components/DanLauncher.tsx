import { useEffect, useState, type Ref } from 'react'
import { useLocation } from 'react-router'
import DanAvatar from './DanAvatar'
import { CloseIcon, PawIcon } from './Icons'

const GREETED_KEY = 'cc-dan-greeted'
const POP_DELAY_MS = 1400
const POP_FOR_MS = 12000

function alreadyGreeted(): boolean {
  try {
    return window.sessionStorage.getItem(GREETED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberGreeted(): void {
  try {
    window.sessionStorage.setItem(GREETED_KEY, '1')
  } catch {
    // Storage blocked: Dan may say hello again next page load. No harm done.
  }
}

/** What Dan says when he pops up, depending on the page. */
function bubbleText(pathname: string): string {
  if (pathname.startsWith('/products/')) return 'Want help picking your size? Just ask!'
  if (pathname === '/cart') return 'Need something to go with that? I can help!'
  return "I'm Dan, the Campus Customs bulldog. How can I help?"
}

interface Props {
  onOpen: () => void
  buttonRef: Ref<HTMLButtonElement>
}

/**
 * The closed chat: Dan in a bubble at the bottom right. Once per visit he pops
 * up with a "Woof woof!" speech bubble and a trail of paw prints; hovering him
 * brings the bubble back.
 */
export default function DanLauncher({ onOpen, buttonRef }: Props) {
  const { pathname } = useLocation()
  const [bubble, setBubble] = useState(false)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (alreadyGreeted()) return
    const show = window.setTimeout(() => {
      setBubble(true)
      rememberGreeted()
    }, POP_DELAY_MS)
    const hide = window.setTimeout(() => setBubble(false), POP_DELAY_MS + POP_FOR_MS)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(hide)
    }
  }, [])

  const showBubble = bubble || hovered

  return (
    <div className="dan-launcher" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {showBubble && (
        <div className="dan-bubble" role="status">
          <button type="button" className="dan-bubble__body" onClick={onOpen}>
            <strong className="dan-bubble__woof">Woof woof!</strong>
            <span>{bubbleText(pathname)}</span>
          </button>
          <button
            type="button"
            className="dan-bubble__close"
            aria-label="Dismiss Dan's message"
            onClick={() => {
              setBubble(false)
              setHovered(false)
            }}
          >
            <CloseIcon size={14} />
          </button>
          <span className="dan-paws" aria-hidden="true">
            <PawIcon size={14} />
            <PawIcon size={12} />
            <PawIcon size={10} />
          </span>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="dan-launcher__button"
        aria-expanded="false"
        aria-controls="chat-panel"
        aria-label="Chat with Dan, the Campus Customs bulldog"
        onClick={onOpen}
      >
        <DanAvatar size={60} mood={showBubble ? 'happy' : 'idle'} />
        <span className="dan-launcher__label">Ask Dan</span>
      </button>
    </div>
  )
}
