import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? 'RSpill <hello@rspill.com>';
const resend = apiKey ? new Resend(apiKey) : null;

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  // No key configured (local dev): log the link instead of failing, so the
  // whole flow is still testable without touching a real mailbox.
  if (!resend) {
    console.log('\n=== EMAIL (not sent — RESEND_API_KEY unset) ===');
    console.log('To:     ', opts.to);
    console.log('Subject:', opts.subject);
    console.log(opts.text);
    console.log('=== end email ===\n');
    return;
  }

  const { error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });

  if (error) {
    // Throwing here surfaces the failure to the caller rather than silently
    // pretending a magic link was delivered.
    throw new Error(`Resend failed: ${error.message}`);
  }
}

function layout(heading: string, body: string, cta?: { label: string; url: string }) {
  // Dark and warm, like the site. Inline styles only — every mail client
  // strips <style> blocks, and half of them ignore media queries too.
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#17120d;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#ece3d4">
  <div style="max-width:520px;margin:0 auto;background:#211a13;border:1px solid #3a2d20;border-radius:6px;padding:32px">
    <p style="margin:0 0 20px;font-size:17px;font-weight:600;color:#ece3d4">RS<span style="color:#e0a32e">pill</span></p>
    <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#ece3d4">${heading}</h1>
    <div style="color:#a39682;font-size:15px;line-height:1.6">${body}</div>
    ${
      cta
        ? `<p style="margin:28px 0"><a href="${cta.url}" style="display:inline-block;background:#e0a32e;color:#1c1409;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">${cta.label}</a></p>
    <p style="color:#6d6252;font-size:13px;word-break:break-all">Or paste this into your browser:<br>${cta.url}</p>`
        : ''
    }
  </div></body></html>`;
}

export function magicLinkEmail(url: string) {
  return {
    subject: 'Your RSpill sign-in link',
    html: layout(
      'Sign in to RSpill',
      '<p>Click below to sign in. This link works once and expires in 15 minutes.</p><p>If you didn\u2019t ask for it, ignore this \u2014 nobody can sign in without the link.</p>',
      { label: 'Sign in', url }
    ),
    text: `Sign in to RSpill:\n\n${url}\n\nThis link works once and expires in 15 minutes.\nIf you didn't ask for it, ignore this email.`,
  };
}

/**
 * Welcome, sent on first sign-in.
 *
 * Deliberately short and about one next action. A new account has no tracked
 * RSN, which means no progress, no goals and no personalised flip advice —
 * so that is the only thing worth asking for.
 */
export function welcomeEmail(url: string) {
  return {
    subject: 'Welcome to RSpill',
    html: layout(
      'You\u2019re in',
      `<p>RSpill prices every Grand Exchange flip against the tax, the four-hour buy limit and the cash you actually have.</p>
       <p>Add your RuneScape name and it also tracks your skills, works out goal ETAs from your own measured XP rate, and tells you which money-makers you can actually do.</p>
       <p style="color:#6d6252;font-size:13px">It only reads the public hiscores. There is no game login, and nothing here touches your account.</p>`,
      { label: 'Add your RSN', url }
    ),
    text: `You're in.\n\nRSpill prices every Grand Exchange flip against the tax, the buy limit and the cash you actually have.\n\nAdd your RuneScape name to track skills and goals too: ${url}\n\nIt only reads the public hiscores — no game login, nothing touching your account.`,
  };
}
