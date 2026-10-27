import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? 'Wedding Planner <hello@example.com>';
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
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#fbfaf8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1a19">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e0da;border-radius:8px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${heading}</h1>
    <div style="color:#6b6560;font-size:15px;line-height:1.6">${body}</div>
    ${
      cta
        ? `<p style="margin:28px 0"><a href="${cta.url}" style="display:inline-block;background:#1b1a19;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">${cta.label}</a></p>
    <p style="color:#9a938c;font-size:13px;word-break:break-all">Or paste this into your browser:<br>${cta.url}</p>`
        : ''
    }
  </div></body></html>`;
}

export function magicLinkEmail(url: string) {
  return {
    subject: 'Your sign-in link',
    html: layout(
      'Sign in to your wedding planner',
      '<p>Click below to sign in. This link works once and expires in 15 minutes.</p>',
      { label: 'Sign in', url }
    ),
    text: `Sign in to your wedding planner:\n\n${url}\n\nThis link works once and expires in 15 minutes.`,
  };
}

export function inviteEmail(opts: { url: string; inviterName: string; coupleNames: string }) {
  return {
    subject: `${opts.inviterName} invited you to help plan a wedding`,
    html: layout(
      `${opts.inviterName} invited you`,
      `<p>You’ve been invited to the planning workspace for <strong>${opts.coupleNames}</strong>. You’ll be able to see and edit the checklist, budget, and guest list together — changes show up for both of you right away.</p>`,
      { label: 'Accept invitation', url: opts.url }
    ),
    text: `${opts.inviterName} invited you to the planning workspace for ${opts.coupleNames}.\n\nAccept: ${opts.url}`,
  };
}

export function rsvpInviteEmail(opts: {
  url: string;
  couple: string;
  household: string;
  date: string | null;
  venue: string | null;
  deadline: string | null;
}) {
  const when = [opts.date, opts.venue].filter(Boolean).join(' · ');
  return {
    subject: `Please RSVP — ${opts.couple}`,
    html: layout(
      `${opts.couple}`,
      `<p>Hello ${opts.household},</p>
       <p>You’re invited${when ? ` — <strong>${when}</strong>` : ''}.</p>
       <p>Tap below to let us know who can make it. It takes about thirty seconds, and there’s nothing to sign up for.</p>
       ${opts.deadline ? `<p>Please reply by <strong>${opts.deadline}</strong>.</p>` : ''}`,
      { label: 'RSVP now', url: opts.url }
    ),
    text: `${opts.couple}\n\nHello ${opts.household},\n\nYou’re invited${when ? ` — ${when}` : ''}.\n\nRSVP here: ${opts.url}\n${opts.deadline ? `\nPlease reply by ${opts.deadline}.` : ''}`,
  };
}
