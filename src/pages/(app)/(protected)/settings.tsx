import { useState } from 'react'
import { signOut, useUser } from 'deepspace'
import { Trash2 } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { invokeAction } from '@/lib/actions-client'

export default function SettingsPage() {
  const { user } = useUser()
  const { success, error } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteData() {
    setDeleting(true)
    try {
      const res = await invokeAction('deleteUserData')
      if (!res.success) {
        error('Could not delete data', res.error ?? 'Unknown error')
        return
      }
      success('All data deleted', 'Your receipts and preferences have been permanently removed.')
      await signOut()
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Your account</h2>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>

        <section className="rounded-xl border border-destructive/30 bg-card p-6">
          <div className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" aria-hidden />
            <h2 className="text-lg font-semibold">Delete my data</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Permanently delete all your imported grocery receipts, swaps, ZIP settings, and
            detected memberships from CheapGroceries and sign out.
          </p>

          {!confirming ? (
            <Button
              variant="destructive"
              data-testid="delete-data-btn"
              className="mt-4"
              onClick={() => setConfirming(true)}
            >
              Delete account data
            </Button>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                data-testid="confirm-delete-data-btn"
                disabled={deleting}
                onClick={() => void handleDeleteData()}
              >
                {deleting ? 'Deleting...' : 'Yes, permanently delete everything'}
              </Button>
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
