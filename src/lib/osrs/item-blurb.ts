/**
 * An item description written from the numbers, not borrowed from anyone.
 *
 * Item pages used to carry a paragraph from the OSRS Wiki. That text is
 * CC BY-NC-SA 3.0, and the NC is NonCommercial — reproducing it on a page
 * carrying ads is very likely a commercial use the licence does not grant,
 * whatever the attribution says. Google takes the same view from the other
 * side: ads may not be placed on pages whose content came from somewhere
 * else.
 *
 * So the description is generated here from facts RSpill already holds and
 * is free to describe: the buy limit, the alch values, the shop value, how
 * much trades in an hour, and where the price sits. Facts are not anyone's
 * copyright, and the sentences around them are ours.
 *
 * The aim is a paragraph a person would actually want, not filler. Every
 * sentence has to earn its place by saying something that is true of THIS
 * item and would be false of most others — "it trades 420,000 times an hour"
 * is worth reading; "it is an item in Old School RuneScape" is not, and
 * four thousand pages of it is what auto-generated content means.
 */

import { formatGp } from '@/lib/osrs/ge';

export type BlurbFacts = {
  name: string;
  members: boolean;
  buyLimit: number | null;
  highalch: number | null;
  value: number | null;
  low: number | null;
  high: number | null;
  hourlyVolume: number | null;
  /** Price of a nature rune, for the alch comparison. */
  natureRune: number | null;
};

/** How busy a book is, in words, with the thresholds named once. */
export function liquidity(hourlyVolume: number | null): string | null {
  if (hourlyVolume === null || hourlyVolume <= 0) return null;
  if (hourlyVolume >= 100_000) return 'one of the most heavily traded items in the game';
  if (hourlyVolume >= 10_000) return 'very heavily traded';
  if (hourlyVolume >= 1_000) return 'traded steadily';
  if (hourlyVolume >= 100) return 'traded in moderate numbers';
  if (hourlyVolume >= 10) return 'thinly traded';
  return 'barely traded';
}

/**
 * Where this item sits in the game's price range, in the terms players
 * actually use — which are the stack colours, not arbitrary bands.
 */
export function priceBand(price: number | null): string | null {
  if (price === null || price <= 0) return null;
  if (price >= 1_000_000_000) return 'one of the most expensive items in the game';
  if (price >= 100_000_000) return 'a high-end item';
  if (price >= 10_000_000) return 'an expensive item';
  if (price >= 100_000) return 'a mid-priced item';
  if (price >= 1_000) return 'an inexpensive item';
  return 'a low-value item';
}

/**
 * Sentences about the item, each one conditional on the fact it describes
 * being present and interesting. Returned as an array so the page can lay
 * them out, and so a missing fact drops a sentence rather than producing
 * "its buy limit is null".
 */
export function itemBlurb(f: BlurbFacts): string[] {
  const out: string[] = [];
  const access = f.members ? 'members-only' : 'available to free-to-play accounts';

  // Opening: access, price and where that puts it. Phrased so the band
  // ("a mid-priced item") is not followed by the word "item" again, which
  // the first draft did on every single page.
  const price = f.low ?? f.high;
  const band = priceBand(price);
  out.push(
    band && price
      ? `${f.name} is ${access}, and at ${formatGp(price)} on the Grand Exchange it is ${band}.`
      : `${f.name} is ${access}.`
  );

  // Liquidity, which is the single most useful thing to know about an item
  // you are thinking of flipping and the thing price pages usually omit.
  const busy = liquidity(f.hourlyVolume);
  if (busy && f.hourlyVolume) {
    out.push(
      `It is ${busy}, at around ${f.hourlyVolume.toLocaleString('en-US')} units an hour across both sides of the book. ` +
        (f.hourlyVolume < 1_000
          ? 'At that rate an offer can sit for a long time, so a margin here is worth less than the same margin on something busier.'
          : 'A book that busy usually fills an offer priced at or near the last trade without a long wait.')
    );
  } else {
    out.push(
      'Nothing has traded in the last hour, so there is no volume to judge it by and any margin shown should be treated as stale.'
    );
  }

  // The buy limit, framed as the ceiling on profit rather than as trivia.
  if (f.buyLimit && f.buyLimit > 0 && f.low) {
    const capital = f.buyLimit * f.low;
    out.push(
      `The four-hour buy limit is ${f.buyLimit.toLocaleString('en-US')}, so a full window costs about ${formatGp(
        capital
      )} and caps what one cycle can make however good the margin looks.`
    );
  } else if (f.buyLimit === null) {
    out.push('No buy limit is published for it, which is normal for items that are not bought from the Grand Exchange in bulk.');
  }

  // High alchemy, but only when it is actually relevant — i.e. when it is
  // close enough to the price to act as a floor. Saying "alching loses
  // 1.5m" on a whip is true and useless.
  if (f.highalch && f.highalch > 0 && f.low && f.natureRune) {
    const proceeds = f.highalch - f.natureRune;
    const ratio = proceeds / f.low;
    if (ratio >= 0.9) {
      out.push(
        `High alchemy returns ${formatGp(proceeds)} after the nature rune, which is close to what it costs to buy — so the alch value puts a floor under the price and it rarely trades far below it.`
      );
    } else if (ratio >= 0.5) {
      out.push(
        `High alchemy returns ${formatGp(proceeds)} after the nature rune, well under the buy price, so alching is a loss and the price moves on demand alone.`
      );
    }
  }

  return out;
}
