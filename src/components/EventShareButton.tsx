import { lazy, Suspense, useRef, useState } from 'react'
import { ShareNetwork } from '@phosphor-icons/react'
import type { LiveEvent } from '../events'

const StoryShareDialog = lazy(() => import('./StoryShare'))

const loadingStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 30,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(5, 6, 6, .78)',
  color: '#f7f4ef',
  font: '600 12px/1.4 "Work Sans", sans-serif',
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  backdropFilter: 'blur(4px)',
}

export function EventShareButton({
  event,
  className = 'event-action',
  label = 'Share event',
}: {
  event: LiveEvent
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  return <>
    <button ref={trigger} type="button" className={className} onClick={() => setOpen(true)}>
      <ShareNetwork size={16} aria-hidden="true" />{label}
    </button>
    {open && (
      <Suspense fallback={<div style={loadingStyle} role="status">Preparing share…</div>}>
        <StoryShareDialog event={event} onClose={() => {
          setOpen(false)
          window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
        }} />
      </Suspense>
    )}
  </>
}
