import { MapPin } from 'lucide-react'
import { Button, Input } from '../ui'
import { getRegionalStoresForZip } from '../../lib/locality'

interface LocalityBarProps {
  zipInput: string
  savedZip: string
  allowedStores: string[]
  detectedMemberships: string[]
  savingLocality: boolean
  onZipChange: (zip: string) => void
  onSubmitZip: (zip: string, regionalStores: string[]) => void
  onToggleStore: (store: string) => void
}

export function LocalityBar({
  zipInput,
  savedZip,
  allowedStores,
  detectedMemberships,
  savingLocality,
  onZipChange,
  onSubmitZip,
  onToggleStore,
}: LocalityBarProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmitZip(zipInput, getRegionalStoresForZip(zipInput))
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="font-medium text-foreground">Your ZIP:</span>
          <Input
            value={zipInput}
            onChange={(e) => onZipChange(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="e.g. 55414"
            className="h-7 w-24 font-mono text-xs"
            aria-label="ZIP code"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={savingLocality || zipInput.length < 5}
          >
            {savingLocality ? 'Saving...' : 'Set Area'}
          </Button>
        </form>

        {detectedMemberships.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Active from your email:</span>
            {detectedMemberships.map((m) => (
              <span
                key={m}
                className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-primary"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Comparing near you:</span>
        {getRegionalStoresForZip(zipInput || savedZip).map((store) => {
          const active = allowedStores.includes(store)
          return (
            <button
              key={store}
              type="button"
              onClick={() => onToggleStore(store)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-accent text-primary'
                  : 'bg-secondary/60 text-muted-foreground line-through hover:bg-secondary'
              }`}
            >
              {store}
            </button>
          )
        })}
      </div>
    </div>
  )
}
