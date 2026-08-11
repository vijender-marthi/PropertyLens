import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { coachAPI } from '../services/api'
import toast from 'react-hot-toast'
import { Send, Trash2, Sparkles } from 'lucide-react'
import MarkdownMessage from './MarkdownMessage'

const SUGGESTIONS = [
  'Which property has the best cash flow?',
  'Should I sell or hold my rentals?',
  'Which property should I exit first, and why?',
  'How can I improve my portfolio cash flow?',
]

export default function CoachChat({ compact = false }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    coachAPI.history()
      .then((r) => setMessages(r.data.messages || []))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending])

  const send = async (text) => {
    const msg = (text ?? input).trim()
    if (!msg || sending) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: msg }])
    setSending(true)
    try {
      const { data } = await coachAPI.chat(msg)
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
    } catch (e) {
      const detail = e.response?.data?.detail || 'Something went wrong.'
      toast.error(detail)
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${detail}` }])
    } finally {
      setSending(false)
    }
  }

  const clear = async () => {
    if (!window.confirm('Clear the AI Coach chat history?')) return
    try { await coachAPI.clearHistory() } catch { /* ignore */ }
    setMessages([])
    toast.success('Chat history cleared')
  }

  return (
    <div className={`flex flex-col ${compact ? 'h-[26rem]' : 'h-[68vh]'}`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loaded && messages.length === 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Sparkles className="h-4 w-4 text-blue-500" /> Ask about your portfolio — cash flow, refinancing, sell vs. hold.
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-left text-[13px] text-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/30">
                  {s}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Needs an API key — set your provider and key in <Link to="/settings" className="underline">Settings → AI Coach</Link>. Your portfolio summary is sent to the provider you choose.
            </p>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            {m.role === 'user' ? (
              <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-3 py-2 text-sm text-white">
                {m.content}
              </div>
            ) : (
              <div className="inline-block max-w-[92%] rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-left dark:border-gray-700/60 dark:bg-gray-800/60">
                <MarkdownMessage content={m.content} />
              </div>
            )}
          </div>
        ))}
        {sending ? <div className="text-xs text-gray-400 dark:text-gray-500">Coach is thinking…</div> : null}
        <div ref={endRef} />
      </div>
      {messages.length > 0 ? (
        <div className="px-3 pb-1 text-right">
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-600 dark:hover:text-red-400">
            <Trash2 className="h-3 w-3" /> Clear history
          </button>
        </div>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-center gap-2 border-t border-gray-100 p-2 dark:border-gray-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your portfolio…"
          aria-label="Message the AI Coach"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        <button type="submit" disabled={sending || !input.trim()} className="btn-primary shrink-0 px-3 py-2 disabled:opacity-50" aria-label="Send">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
