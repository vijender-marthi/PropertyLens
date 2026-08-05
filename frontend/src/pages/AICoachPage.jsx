import { Sparkles } from 'lucide-react'
import CoachChat from '../components/CoachChat'

export default function AICoachPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">AI Coach</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Ask questions about your portfolio — cash flow, refinancing, and exit scenarios.
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <CoachChat />
      </div>
    </div>
  )
}
