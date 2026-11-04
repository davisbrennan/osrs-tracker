/**
 * The written guides.
 *
 * Content as data rather than as nine page components: one renderer, one
 * sitemap entry per slug, one place to check that every guide has a title
 * and a summary. The prose is the deliverable, so it should not be tangled
 * up in JSX.
 *
 * Everything here is written for this site. It is the part a price tracker
 * usually does not have — four thousand generated item pages are a database
 * with a skin on it, and a reader (or a reviewer) can tell. These are the
 * things I had to work out while building the tax arithmetic, written down
 * properly.
 *
 * Accuracy matters more than usual: people act on this with their own gp.
 * Every number here is the one the code implements, and if the game changes
 * the rule, both move together.
 */

export type GuideSection = {
  heading: string;
  /** Paragraphs. Plain strings — no markup, so nothing can be injected. */
  body: string[];
};

export type Guide = {
  slug: string;
  title: string;
  /** One sentence, used on the index, in metadata and as the description. */
  summary: string;
  /** Roughly how long it takes to read, in minutes. */
  minutes: number;
  sections: GuideSection[];
};

export const GUIDES: Guide[] = [
  {
    slug: 'grand-exchange-tax',
    title: 'The Grand Exchange tax, exactly',
    summary:
      'The 2% sale tax decides which flips are possible at all. Here is precisely how it is calculated, including the two places it stops behaving like 2%.',
    minutes: 6,
    sections: [
      {
        heading: 'What gets taken, and from whom',
        body: [
          'Since 2021 the Grand Exchange charges a 2% tax on items sold. It comes out of the sale, not the purchase — the buyer pays exactly what they offered, and the seller receives 2% less than the item went for. The gp is removed from the game entirely rather than paid to anyone.',
          'That asymmetry is the whole reason flipping arithmetic is not obvious. If the tax were split across both sides, or charged on the purchase, you could reason about a spread by halving it. You cannot. Everything you lose happens at the moment you sell, which is also the moment furthest from when you made the decision.',
        ],
      },
      {
        heading: 'It rounds down, always',
        body: [
          'The tax is floored to whole gp. A sale at 1,100 is taxed 2% of 1,100 = 22 exactly. A sale at 1,090 is taxed 2% of 1,090 = 21.8, which becomes 21.',
          'That rounding is in your favour, and it has a consequence people miss: dropping your sale price by 10gp does not cost you 10gp. It costs 9, because the tax fell by one at the same time. On cheap items where you are undercutting by small amounts, a meaningful fraction of what you give up comes back.',
        ],
      },
      {
        heading: 'Nothing under 50gp is taxed',
        body: [
          'Items that sell for less than 50gp are exempt. Sell at 49 and you keep 49; sell at 50 and you keep 49, because 2% of 50 floors to 1.',
          'The boundary catches people out in a specific way. If you bought at 49, selling at 50 does not make you a gp — it breaks you even, because that first gp of tax appears exactly when you cross the threshold. The lowest price that actually profits is 51. It is a tiny amount of money and a good illustration of why the rule is worth implementing exactly rather than approximately.',
        ],
      },
      {
        heading: 'And nothing above 5,000,000gp',
        body: [
          'The tax is capped at 5,000,000gp per item. Two per cent of 250,000,000 is 5,000,000, so for anything selling above 250m the tax stops growing.',
          'This changes the shape of expensive flips completely. On a 1m item you need roughly a 2.05% spread before you make anything. On an 8.5b item you need 5,000,001gp — which is less than a tenth of one per cent. The tax goes from being the main obstacle to being a rounding error, and the viable spread on high-end items is proportionally far narrower than anywhere else in the game.',
          'It is also the easiest thing to get wrong in code. A breakeven calculated as "buy price divided by 0.98" is correct up to 250m and badly wrong above it — it will tell you to hold out for far more than you need.',
        ],
      },
      {
        heading: 'Exemptions',
        body: [
          'Old school bonds are not taxed, and neither are a handful of items that function as tools rather than goods — chisels, gardening trowels, hammers, needles, rakes, saws, secateurs, seed dibbers, shears, spades and watering cans among them. The list is short and it exists so that the tax does not penalise ordinary skilling.',
          'For an exempt item the arithmetic collapses to the obvious one: your profit is the spread, and any sale above your purchase price makes money.',
        ],
      },
      {
        heading: 'The number that actually matters',
        body: [
          'For any price you buy at, there is a lowest price you can sell at and still come out ahead. Below roughly a 2.05% spread on ordinary items, every flip is a loss no matter how healthy the margin column looks. Buy at 100 and sell at 101 and you are down a gp.',
          'RSpill shows that breakeven on every item page and carries it into the flip finder, because it is the one piece of arithmetic that decides whether a trade is possible before anything else about it matters.',
        ],
      },
    ],
  },

  {
    slug: 'reading-a-margin',
    title: 'How to read a margin',
    summary:
      'A big margin is the most misleading number in flipping. What to check before you trust one, and why most tools show you the trap.',
    minutes: 7,
    sections: [
      {
        heading: 'A margin is a claim about two things that already happened',
        body: [
          'The Grand Exchange reports two prices for every item: the most recent price somebody sold at instantly, and the most recent price somebody bought at instantly. The gap between them is the spread, and the margin is that spread after tax.',
          'Both numbers are history. Neither is an offer, and neither is a promise that you can trade at it. The margin is the profit you would have made if you had been on both sides of those two specific trades — which you were not.',
        ],
      },
      {
        heading: 'Volume is the first thing to check',
        body: [
          'A 2,000gp margin on an item that trades four times a day is not an opportunity. You will place your offer and sit on it, and the price will move before you fill. The margin was real; your ability to capture it was not.',
          'The question to ask is how much of the hour’s total volume you would need to consume to fill one buy limit. If you need a meaningful fraction of everything that trades, you are competing with every other person reading the same screen for the same few trades. If the item turns over tens of thousands an hour, your order is noise and will fill.',
          'This is the single biggest difference between a margin that works and one that does not, and it is the thing most flip finders leave out of the sort order.',
        ],
      },
      {
        heading: 'Then price age',
        body: [
          'If one side of the book last traded forty minutes ago and the other traded one minute ago, the spread between them is not a spread. You are comparing a current price against a stale one, and the gap may be entirely explained by the market having moved in between.',
          'The slower side governs. An item whose buy side is fresh and sell side is an hour old will let you in quickly and then leave you holding it, which is the worst outcome available — your capital is tied up in the thing you were least sure about.',
        ],
      },
      {
        heading: 'Then whether you can afford it',
        body: [
          'A 28,000gp margin on an item costing 1.5m is zero profit on a 500k stack, because you cannot buy one. Margins per unit are meaningless until multiplied by the units you can actually fund, and then capped by the buy limit.',
          'Profit per four-hour window is the honest figure: margin times the smaller of what your cash can buy and what the limit allows. It reorders the table completely, and it tends to promote cheap, busy items over the expensive ones that look exciting.',
        ],
      },
      {
        heading: 'And finally, the spread you need to clear',
        body: [
          'Every item has a minimum spread below which the tax eats the entire gap. On most items that is around 2.05%. If the current spread is under it, the margin column is already negative and no amount of patience changes that.',
          'Put together, these four checks kill most of what looks like free money on a price tracker. What survives is usually smaller, duller and far more repeatable — which is what flipping actually is.',
        ],
      },
    ],
  },

  {
    slug: 'buy-limits',
    title: 'Buy limits and the four-hour window',
    summary:
      'Why the most profitable-looking item on the page can be the least profitable to trade, how the limit actually resets, and the offer-slot ceiling nobody mentions.',
    minutes: 7,
    sections: [
      {
        heading: 'What the limit is',
        body: [
          'Every tradeable item has a cap on how many you may buy through the Grand Exchange in a four-hour period. The limit is per item, per account, and it ranges from a handful for high-end gear to tens of thousands for runes and ammunition.',
          'There is no limit on selling. You can sell as many as you can acquire; the cap is only on buying, which is what makes it a ceiling on flipping specifically.',
        ],
      },
      {
        heading: 'How the window works',
        body: [
          'The four hours run from your first purchase of that item, not from a fixed clock. Buy one at 14:00 and your window for that item closes at 18:00, whether you buy the rest immediately or spread them out.',
          'Because it is per item, the windows run independently. There is no global budget — you can be capped on one item and completely free on everything else, which is why trading several items at once is the normal way to use a large stack.',
        ],
      },
      {
        heading: 'Why it reorders the whole table',
        body: [
          'The limit converts a margin into a maximum. An item with a 500,000gp margin and a limit of 8 can make 4m a window. An item with a 19gp margin and a limit of 13,000 can make 247k. The first number is sixty times larger per unit and five times larger per window — but the second one fills in minutes and the first may not fill at all.',
          'Once you also account for what your cash stack can fund, high-margin low-limit items tend to fall a long way down the list. They are the rows that look best and trade worst, and they are at the top of most flip finders because nothing has been divided by anything.',
        ],
      },
      {
        heading: 'The other ceiling: offer slots',
        body: [
          'Buy limits are not the only cap. You also have a fixed number of Grand Exchange offer slots — three on a free account, eight with membership — and every open buy or sell occupies one until it completes or is cancelled.',
          'For flipping specifically this binds harder than people expect, because each item in flight needs two slots over its life: one while you are buying and one while you are selling. Running eight items at once is not possible if half of them are still trying to sell. In practice four or five concurrent items is the realistic ceiling on a members account.',
          'It also makes stuck offers expensive in a way that does not show up as a loss. An offer that will never fill is not costing you gp directly, but it is holding a slot that could be running a trade that would. Cancelling early on a dead offer is usually right, even though cancelling early on a slow but live offer usually is not.',
        ],
      },
      {
        heading: 'Planning around it',
        body: [
          'The practical shape of a session is: find several items whose limits and prices fit your stack, buy a full window of each, then sell while the windows run down. The limit stops being a constraint and starts being a schedule.',
          'RSpill tracks the limit used per item from your own logged trades and shows how long until each window resets, because the figure that matters mid-session is not the limit but what is left of it.',
        ],
      },
    ],
  },

  {
    slug: 'what-price-to-offer',
    title: 'What price to actually offer',
    summary:
      'The two prices on a price tracker are the last trades, not offers. Here is how far above and below them you can go before a flip stops paying, worked through with real numbers.',
    minutes: 8,
    sections: [
      {
        heading: 'The prices you see are already spent',
        body: [
          'A price tracker shows you the most recent instant-sell and instant-buy prices. Enter those exact numbers into the Grand Exchange and you join the back of a queue at a price that has already cleared. Sometimes that fills. Often it does not, because other people are offering a gp more.',
          'So the useful question is not "what is the price" but "how far can I move off it and still make money".',
        ],
      },
      {
        heading: 'Both directions cost you',
        body: [
          'There are two ways to get filled faster: pay more when buying, and accept less when selling. Each comes straight out of the margin, and they come out of the same margin — spend it outbidding and there is none left for undercutting.',
          'People consistently underestimate this because they think about one side at a time. Paying 5 more and accepting 5 less is not a 5gp decision. It is close to 10, slightly less because the lower sale price is taxed slightly less.',
        ],
      },
      {
        heading: 'The band',
        body: [
          'For any pair of prices there is a highest price you can pay and still profit, and a lowest price you can accept and still profit. Between the two sits dead ground: more than you may pay, less than you may accept.',
          'When the margin is wide those two ranges overlap, and you have slack whichever side you push. When it is thin they sit at opposite ends with a large gap between them, and you have almost no room at all. When it is one gp, there is exactly one pair of prices that works and nothing else does.',
          'That band is a statement about arithmetic, not a prediction. It tells you where the trade stops paying. It cannot tell you whether an offer will fill.',
        ],
      },
      {
        heading: 'A worked example',
        body: [
          'Take an item that last sold instantly at 1,000,000 and last bought instantly at 1,050,000. The spread is 50,000. The tax on a 1,050,000 sale is 2% floored, which is 21,000, so the margin is 29,000 per unit.',
          'The most you can pay and still profit is 1,028,999 — a gp under what the sale nets. That is 28,999 of room to outbid other buyers. The least you can accept is 1,020,409, which is the lowest price that clears your 1,000,000 purchase after its own tax, leaving 29,591 of room to undercut other sellers.',
          'Those two ranges overlap in the middle, between 1,020,409 and 1,028,999, which tells you the margin is comfortable: you could push hard on either side and still be fine. On a thinner item the two ranges separate and the gap between them is ground you cannot trade in at all — more than you may pay, less than you may accept.',
          'What you must not do is read 28,999 and 29,591 as a budget of 58,590. They are the same 29,000 margin counted from each end. Spend 20,000 outbidding and you have roughly 9,000 of undercut room left, not 29,591.',
        ],
      },
      {
        heading: 'Nobody can tell you whether it will fill',
        body: [
          'The Grand Exchange does not publish order book depth. Nobody outside Jagex can see how many buyers are queued at a given price, how large their offers are, or how long they have been waiting. Every public price source, this one included, is working from last-traded prices and hourly volumes.',
          'Any tool that tells you an offer will fill in a particular time is guessing, however confidently it is presented. Volume is the honest proxy — a busy book fills offers near the last trade and a quiet one does not — and that is as far as the data goes.',
        ],
      },
    ],
  },

  {
    slug: 'flipping-for-beginners',
    title: 'Flipping for beginners',
    summary:
      'What flipping is, what it is not, and the smallest sensible way to start without losing money learning.',
    minutes: 7,
    sections: [
      {
        heading: 'What it is',
        body: [
          'Flipping is buying an item on the Grand Exchange below what it sells for and selling it on. There is no skill requirement, no combat, no travel. You place a buy offer, wait, place a sell offer, wait.',
          'That is the whole mechanic, which is why it attracts people and why most of them lose patience. The difficulty is not in the trading. It is in choosing which items to trade and resisting the ones that look best.',
        ],
      },
      {
        heading: 'What it is not',
        body: [
          'It is not fast. A full cycle on a well-chosen item is tens of minutes and often hours, and the time is spent waiting rather than clicking.',
          'It is not reliably profitable on expensive items just because the margins are bigger. High-value gear has thin volume, and the margin that attracted you is frequently the reason nobody is trading at those prices.',
          'And it is not risk-free. Prices move while you hold. A margin that existed when you bought can be gone when you come to sell, and the way to lose money at this is to buy something with a wide spread and no volume and then need to get out.',
        ],
      },
      {
        heading: 'Start with busy and boring',
        body: [
          'The best first items are cheap, heavily traded and unglamorous — runes, logs, ores, bones, food, ammunition. They trade tens of thousands of units an hour, which means your offers fill quickly and you find out whether you understood the trade within minutes rather than hours.',
          'The margins are small. That is fine, and it is the point: you are buying information about whether your process works, and you want the feedback loop to be short and the downside to be a few thousand gp.',
        ],
      },
      {
        heading: 'A first session',
        body: [
          'Set your cash stack honestly, including nothing you are not prepared to have tied up for a few hours. Pick two or three items whose full buy limit costs a comfortable fraction of it. Check volume before margin, every time.',
          'Buy a full window of each. Place the sell offers a little under the last instant-buy price rather than at it. Then leave it alone — refreshing does not make offers fill, and the most common beginner mistake after choosing the wrong item is cancelling a good offer too early and re-placing it worse.',
          'Log what you actually traded rather than what you expected to. The gap between the two is where all the useful learning is, and it is almost always explained by tax, by the buy limit, or by having chosen something that does not trade.',
        ],
      },
      {
        heading: 'What to expect',
        body: [
          'A realistic early return is a small percentage per window on the capital you put to work, compounding slowly as your stack grows and more items become affordable. Nobody turns a small stack into a large one in an afternoon doing this.',
          'The accounts that do well at flipping are the ones treating it as a routine — a few items, checked a few times a day, with records — rather than the ones hunting for a single enormous margin. The enormous margins are visible to everybody and are usually visible because they are not real.',
        ],
      },
    ],
  },
];

/** One guide by slug, or undefined. */
export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Total words of prose, which is how the content budget is actually measured. */
export function guideWords(g: Guide): number {
  return g.sections.reduce(
    (n, s) => n + s.body.reduce((m, p) => m + p.split(/\s+/).filter(Boolean).length, 0),
    0
  );
}
