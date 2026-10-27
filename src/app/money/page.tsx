import Link from 'next/link';
import type { Metadata } from 'next';
import { currentUser, cashStackFor, bestLevelsFor } from '@/lib/session';
import { loadMethodCatalogue } from '@/app/actions/methods';
import { rankMethods } from '@/lib/osrs/methods';
import { formatGp } from '@/lib/osrs/ge';
import { gpExact, plClass } from '@/lib/gp';
import { collectionSchema, jsonLdProps, SCHEMA_ITEMS } from '@/lib/structured-data';
import AppShell from '@/components/app-shell';

export const revalidate = 120;

export const metadata: Metadata = {
  alternates: { canonical: '/money' },
  title: 'Money makers',
  description:
    'OSRS money-making methods ranked by gp per hour at live Grand Exchange prices — after the 2% sale tax, capped by the four-hour buy limits on the inputs, and by what your cash stack can actually fund.',
};

type Search = { only?: string | string[] };

/** One line of recipe: "1 × Ranarr weed + 1 × Vial of water". */
function recipeLine(items: { name: string; quantity: number }[]): string {
  return items.map((i) => `${i.quantity} × ${i.name}`).join(' + ');
}

/**
 * Money makers.
 *
 * Ranked at live prices rather than from stored figures. Published guides
 * all quote a gp/hr that was true at the prices on the day the page was last
 * recalculated, and prices are the thing that moves — so nothing here stores
 * a profit, only the recipe and the rate.
 *
 * The three corrections that make these numbers differ from a guide's are in
 * lib/osrs/methods.ts: the sale tax on the output, the four-hour buy limits
 * on the inputs, and your actual cash.
 */
export default async function MoneyMakers({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const onlyRaw = Array.isArray(sp.only) ? sp.only[0] : sp.only;
  const onlyDoable = onlyRaw === 'doable';

  const user = await currentUser();
  const [cashStack, levels, catalogue] = await Promise.all([
    cashStackFor(user?.id ?? null),
    bestLevelsFor(user?.id ?? null),
    loadMethodCatalogue(),
  ]);

  const ranked = rankMethods(catalogue.methods, catalogue.priced, cashStack, levels);
  const shown = onlyDoable
    ? ranked.filter((r) => !r.locked && r.actionsPerHour > 0 && (r.profitPerHour ?? 0) > 0)
    : ranked;

  const throttled = ranked.filter((r) => r.limitedBy === 'buy limit').length;

  return (
    <AppShell current="money" signedIn={Boolean(user)} cashStack={cashStack}>
      {!onlyDoable && shown.length > 0 && (
        <script
          {...jsonLdProps(
            collectionSchema({
              name: 'OSRS money making methods ranked by gp per hour',
              description:
                'Old School RuneScape production methods priced at live Grand Exchange prices, after the 2% sale tax and capped by the four-hour buy limits on their inputs.',
              path: '/money',
              // No per-method URL: a method is a row on this page, not a page
              // of its own, and twenty ListItems all pointing here would be.
              items: shown.slice(0, SCHEMA_ITEMS).map((r) => ({ name: r.method.name })),
            })
          )}
        />
      )}
      <h1>Money makers</h1>
      <p className="lede">
        Production methods priced at today&rsquo;s Grand Exchange, not at whatever they cost the
        day a guide was written. Every figure is after the 2% sale tax, capped by the four-hour buy
        limits on the inputs, and capped again by your {formatGp(cashStack)}.
      </p>

      {catalogue.failed.length > 0 && (
        <p className="book-warn">
          <strong>
            {catalogue.failed.length} method
            {catalogue.failed.length === 1 ? '' : 's'} could not be priced.
          </strong>{' '}
          An item name in the catalogue matched nothing in the item table, so{' '}
          {catalogue.failed.length === 1 ? 'it was' : 'they were'} left out rather than priced as
          though the missing ingredient were free. Run <code>npm run check:methods</code> to see
          which names are wrong.
        </p>
      )}

      <div className="toolbar">
        <div className="seg">
          <Link href="/money" aria-current={!onlyDoable ? 'true' : undefined}>
            Everything
          </Link>
          <Link href="/money?only=doable" aria-current={onlyDoable ? 'true' : undefined}>
            What I can do now
          </Link>
        </div>
        <p className="toolbar-note">
          {shown.length} of {ranked.length} methods
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <strong>Nothing you can run right now</strong>
          <p>
            Every method is either above your level or more than your cash stack can fund. Set a
            bigger stack in the header to see what opens up, or switch back to{' '}
            <Link href="/money">everything</Link> to see what is worth training towards.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="flips">
            <thead>
              <tr>
                <th className="left">Method</th>
                <th title="At live prices, after the sale tax, at the rate you could actually sustain">
                  Profit/hr
                </th>
                <th>Per action</th>
                <th title="Inputs for one hour. You need this much on hand to run it">
                  Capital/hr
                </th>
                <th title="Actions per hour you could actually sustain">Rate</th>
                <th className="left">Capped by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.method.id} className={r.locked ? 'row-locked' : undefined}>
                  <th scope="row">
                    <span className="mm-name">
                      {r.method.name}
                      {r.method.members && <span className="members">members</span>}
                      {r.locked && (
                        <span className="mm-lock">
                          needs {r.method.skill} {r.method.level}
                        </span>
                      )}
                    </span>
                    <span className="mm-recipe">
                      {recipeLine(r.method.inputs)}
                      {r.method.coinCost > 0 ? ` + ${gpExact(r.method.coinCost)} gp` : ''} →{' '}
                      {recipeLine(r.method.outputs)}
                    </span>
                  </th>
                  <td>
                    {r.profitPerHour === null ? (
                      <span className="subtle" title={`No price for ${r.unpriced.join(', ')}`}>
                        unpriced
                      </span>
                    ) : (
                      <span className={plClass(r.profitPerHour)}>{formatGp(r.profitPerHour)}</span>
                    )}
                  </td>
                  <td>
                    {r.profitPerAction === null ? (
                      <span className="subtle">—</span>
                    ) : (
                      <span className={plClass(r.profitPerAction)}>
                        {gpExact(r.profitPerAction)}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="num subtle">{formatGp(r.capitalPerHour)}</span>
                  </td>
                  <td>
                    <span className="num">{r.actionsPerHour.toLocaleString('en-US')}</span>
                    {r.actionsPerHour < r.method.actionsPerHour && (
                      <span className="subtle">/{r.method.actionsPerHour.toLocaleString('en-US')}</span>
                    )}
                  </td>
                  <td className="left">
                    <span className={`cap cap-${r.limitedBy.replace(' ', '-')}`}>
                      {r.limitedBy === 'rate' ? 'nothing' : r.limitedBy}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card mm-notes">
        <h2>How these are worked out</h2>
        <p>
          A method stores its <strong>recipe</strong> — one ranarr weed and one vial of water make
          one unfinished potion — and the rate a focused player sustains. Nothing stores a gp
          figure, because the two things that move most are the input and output prices.
        </p>
        <ul>
          <li>
            <strong>The sale tax is charged.</strong> You pay 2% selling the output, which is
            enough to turn several of these negative on their own.
          </li>
          <li>
            <strong>Buy limits cap the rate.</strong> You cannot make 4,100 potions an hour if the
            Grand Exchange will only sell you enough herbs for 2,750.
            {throttled > 0 && (
              <>
                {' '}
                Right now {throttled} of these {throttled === 1 ? 'is' : 'are'} capped that way
                rather than by how fast you can click.
              </>
            )}
          </li>
          <li>
            <strong>An unpriced ingredient means no answer.</strong> Methods with an item the
            Grand Exchange has no current price for read &ldquo;unpriced&rdquo; rather than
            quietly pricing the missing thing at zero.
          </li>
          <li>
            <strong>Rates are estimates, prices are live.</strong> Each rate comes from the
            wiki&rsquo;s money-making guides and assumes an efficient setup and banking. Yours
            will differ; the prices will not.
          </li>
        </ul>
        <p className="subtle">
          Combat methods and plank making are deliberately absent — they need drop tables and a
          measured rate respectively, and a number invented to fill the gap would sit at the top of
          this table being wrong. Rates sourced from the{' '}
          <a
            href="https://oldschool.runescape.wiki/w/Money_making_guide"
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            OSRS Wiki money making guides
          </a>
          .
        </p>
      </section>
    </AppShell>
  );
}
