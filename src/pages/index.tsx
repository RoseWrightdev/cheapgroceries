import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Mail, ReceiptText, Repeat, ShoppingCart } from 'lucide-react'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const EXAMPLE_SWAPS = [
  {
    bought: 'Tide Liquid Detergent 92 oz',
    paid: '$12.99',
    swap: 'Amazon Basics Concentrated 100 oz',
    swapPrice: '$8.49',
    saved: '$4.50',
  },
  {
    bought: "Rao's Homemade Marinara 24 oz",
    paid: '$8.99',
    swap: '365 Organic Marinara 25 oz',
    swapPrice: '$4.49',
    saved: '$4.50',
  },
  {
    bought: 'Chobani Greek Yogurt 32 oz',
    paid: '$6.49',
    swap: 'Amazon Fresh Greek Yogurt 32 oz',
    swapPrice: '$3.99',
    saved: '$2.50',
  },
  {
    bought: 'Quaker Old Fashioned Oats 42 oz',
    paid: '$5.99',
    swap: 'Amazon Fresh Rolled Oats 42 oz',
    swapPrice: '$3.49',
    saved: '$2.50',
  },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card/80">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <div className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ReceiptText className="h-4 w-4" aria-hidden />
              </span>
              <span>CheapGroceries Club</span>
            </div>
            <Link
              to="/home"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Join Free
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
          <div className="grid items-start gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                Free grocery savings checker
              </p>
              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                Stop paying the brand tax on groceries.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                Check your digital grocery receipts from Target, Instacart, Walmart, Kroger, and
                Amazon Fresh to instantly see cheaper local store swaps, coupons, and when a
                subscription actually pays for itself.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/home"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Join the CheapGroceries Club — Free
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>

              <div className="mt-10 grid grid-cols-3 gap-4 border-t border-border pt-8">
                <div>
                  <div className="font-mono text-2xl font-bold tabular-nums text-primary">Live</div>
                  <div className="mt-1 text-xs text-muted-foreground">Verified local store prices</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-bold tabular-nums text-foreground">1 click</div>
                  <div className="mt-1 text-xs text-muted-foreground">Import receipts from Gmail</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-bold tabular-nums text-foreground">$0</div>
                  <div className="mt-1 text-xs text-muted-foreground">Free to join and check</div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-dashed border-border pb-4">
                  <div>
                    <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Example Savings
                    </div>
                    <div className="mt-0.5 text-sm font-semibold">Weekly Grocery Run</div>
                  </div>
                  <div className="rounded-md bg-accent px-3 py-1.5 text-right">
                    <div className="text-[11px] font-medium text-accent-foreground">Found Savings</div>
                    <div className="font-mono text-lg font-bold tabular-nums text-primary">$14.00</div>
                  </div>
                </div>

                <div className="mt-4 divide-y divide-border">
                  {EXAMPLE_SWAPS.map((row) => (
                    <div key={row.bought} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{row.bought}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">Swap: {row.swap}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-mono tabular-nums">
                        <div className="text-xs text-muted-foreground line-through">{row.paid}</div>
                        <div className="text-sm font-semibold text-primary">
                          {row.swapPrice}{' '}
                          <span className="rounded bg-accent px-1.5 py-0.5 text-[11px]">
                            -{row.saved}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-lg bg-secondary/70 px-3.5 py-2.5 text-xs text-muted-foreground">
                  <span>Estimated yearly savings</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-primary">$728.00 / yr</span>
                </div>
              </div>
            </div>
          </div>

          <section id="how-it-works" className="mt-20 border-t border-border pt-14">
            <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-5">
                <Mail className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">1. Check your email receipts</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Pick a time frame and pull your Target, Instacart, Walmart, Kroger, or Amazon
                  Fresh orders automatically.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-5">
                <Repeat className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">2. See local swaps &amp; subscriptions</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Only compares stores near your ZIP code, factors in shipping, and shows when
                  coupons or subscriptions pay for themselves.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-5">
                <ShoppingCart className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">3. Save on your next trip</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Jump straight to cheaper store-brand alternatives, clip matching coupons, and
                  catch price increases over time.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  )
}
