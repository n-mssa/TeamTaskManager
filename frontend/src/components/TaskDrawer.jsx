import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function TaskDrawer({ onClose, children }) {
  const dialog = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const focused = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector('button')?.focus()
    function keyboard(event) {
      if (event.key === 'Escape') closeRef.current()
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus()}
      if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus()}
    }
    document.addEventListener('keydown', keyboard)
    return () => {document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); focused?.focus()}
  }, [])
  return <div className="ux-drawer-backdrop" onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label="تفاصيل المهمة" className="ux-drawer" onClick={event => event.stopPropagation()}>
      <div className="ux-drawer-head"><strong>تفاصيل المهمة</strong><button onClick={onClose} aria-label="إغلاق التفاصيل"><X size={18}/></button></div>
      {children}
    </section>
  </div>
}
