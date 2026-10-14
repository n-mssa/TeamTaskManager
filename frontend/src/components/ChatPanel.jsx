import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Search, Send, X } from 'lucide-react'
import { api } from '../api/client'

export default function ChatPanel({ currentUser, initialContactId, onClose, onUnreadChange, onConversationRead }) {
  const [contacts, setContacts] = useState([])
  const [activeContactId, setActiveContactId] = useState(initialContactId || null)
  const [messages, setMessages] = useState([])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const messageEndRef = useRef(null)
  const activeContactRef = useRef(activeContactId)
  const conversationRequestRef = useRef(0)
  activeContactRef.current = activeContactId

  const activeContact = contacts.find((contact) => contact.id === activeContactId) || null
  const visibleContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar')
    if (!query) return contacts
    return contacts.filter((contact) => (
      `${contact.full_name_ar} ${contact.department_name || ''}`.toLocaleLowerCase('ar').includes(query)
    ))
  }, [contacts, search])

  async function loadContacts(silent = false) {
    if (!silent) setLoadingContacts(true)
    try {
      const items = await api('/messages/contacts')
      setContacts(items)
      onUnreadChange(items.reduce((total, item) => total + item.unread_count, 0))
      setActiveContactId((current) => {
        if (current && items.some((item) => item.id === current)) return current
        if (initialContactId && items.some((item) => item.id === initialContactId)) return initialContactId
        return items[0]?.id || null
      })
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      if (!silent) setLoadingContacts(false)
    }
  }

  async function loadConversation(contactId, silent = false) {
    const requestId = ++conversationRequestRef.current
    const isCurrent = () => activeContactRef.current === contactId && conversationRequestRef.current === requestId
    if (!contactId) {
      setMessages([])
      return
    }
    if (!silent) setLoadingMessages(true)
    try {
      const items = await api(`/messages/${contactId}`)
      if (!isCurrent()) return
      setMessages(items)
      await api(`/messages/${contactId}/read`, { method: 'PATCH' })
      if (!isCurrent()) return
      setContacts((current) => current.map((item) => item.id === contactId ? { ...item, unread_count: 0 } : item))
      onConversationRead(contactId)
      setError('')
    } catch (err) {
      if (isCurrent()) setError(err.message)
    } finally {
      if (isCurrent()) setLoadingMessages(false)
    }
  }

  useEffect(() => {
    loadContacts()
    const interval = window.setInterval(() => loadContacts(true), 15_000)
    return () => window.clearInterval(interval)
  }, [initialContactId])

  useEffect(() => {
    setMessages([])
    setDraft('')
    setError('')
    loadConversation(activeContactId)
    if (!activeContactId) return
    const interval = window.setInterval(() => loadConversation(activeContactId, true), 8_000)
    return () => {
      window.clearInterval(interval)
      conversationRequestRef.current += 1
    }
  }, [activeContactId])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages.at(-1)?.id])

  async function sendMessage(event) {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || !activeContactId || sending) return
    const contactId = activeContactId
    setSending(true)
    setError('')
    try {
      const message = await api('/messages', {
        method: 'POST',
        body: JSON.stringify({ recipient_id: contactId, body }),
      })
      if (activeContactRef.current === contactId) {
        conversationRequestRef.current += 1
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message])
        setDraft('')
        setLoadingMessages(false)
      }
      await loadContacts(true)
    } catch (err) {
      if (activeContactRef.current === contactId) setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="modal-backdrop chat-backdrop" role="presentation" onClick={onClose}>
      <section className="chat-panel" role="dialog" aria-modal="true" aria-labelledby="chat-title" onClick={(event) => event.stopPropagation()}>
        <header className="chat-panel-header">
          <div><span className="chat-kicker">المراسلات الداخلية</span><h2 id="chat-title">المحادثات</h2></div>
          <button className="icon-button" type="button" onClick={onClose} title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="chat-layout">
          <aside className="chat-contacts" aria-label="جهات الاتصال">
            <label className="chat-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن موظف" aria-label="ابحث عن موظف" /></label>
            <div className="chat-contact-list">
              {loadingContacts ? <p className="chat-state">جارٍ تحميل المحادثات...</p> : visibleContacts.map((contact) => (
                <button className={`chat-contact${contact.id === activeContactId ? ' active' : ''}`} type="button" key={contact.id} onClick={() => setActiveContactId(contact.id)}>
                  <span className="chat-avatar">{initials(contact.full_name_ar)}</span>
                  <span className="chat-contact-copy"><strong>{contact.full_name_ar}</strong><small>{contact.last_message || contact.department_name || roleLabel(contact.role)}</small></span>
                  {contact.unread_count > 0 && <span className="chat-unread">{contact.unread_count}</span>}
                </button>
              ))}
              {!loadingContacts && !visibleContacts.length && (
                <div className="chat-empty-contacts"><MessageCircle size={22} /><span>{currentUser.role === 'employee' ? 'لا توجد محادثات بعد. سيظهر هنا أي حوار يبدأه مسؤول.' : 'لا يوجد موظفون مطابقون.'}</span></div>
              )}
            </div>
          </aside>

          <div className="chat-conversation">
            {activeContact ? (
              <>
                <div className="chat-conversation-head"><span className="chat-avatar">{initials(activeContact.full_name_ar)}</span><div><strong>{activeContact.full_name_ar}</strong><small>{activeContact.department_name || roleLabel(activeContact.role)}</small></div></div>
                <div className="chat-messages" aria-live="polite">
                  {loadingMessages ? <p className="chat-state">جارٍ تحميل الرسائل...</p> : messages.map((message) => {
                    const mine = message.sender_id === currentUser.id
                    return <article className={`chat-bubble${mine ? ' mine' : ''}`} key={message.id}><p>{message.body}</p><time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time></article>
                  })}
                  {!loadingMessages && !messages.length && <div className="chat-conversation-empty"><MessageCircle size={26} /><strong>ابدأ المحادثة</strong><span>اكتب رسالة قصيرة وواضحة للموظف.</span></div>}
                  <span ref={messageEndRef} />
                </div>
                <form className="chat-composer" onSubmit={sendMessage}>
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} maxLength={2000} rows={2} placeholder="اكتب رسالتك..." aria-label="نص الرسالة" />
                  <button className="primary chat-send" type="submit" disabled={!draft.trim() || sending} title="إرسال"><Send size={18} /><span>{sending ? 'جارٍ...' : 'إرسال'}</span></button>
                </form>
              </>
            ) : (
              <div className="chat-no-selection"><MessageCircle size={34} /><strong>اختر محادثة</strong><span>اختر موظفاً من القائمة لعرض الرسائل.</span></div>
            )}
          </div>
        </div>
        {error && <p className="error chat-error">{error}</p>}
      </section>
    </div>
  )
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('')
}

function roleLabel(role) {
  return role === 'super_admin' ? 'مدير النظام الأعلى' : role === 'admin' ? 'مدير النظام' : 'موظف'
}

function formatMessageTime(value) {
  return new Intl.DateTimeFormat('ar-JO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
