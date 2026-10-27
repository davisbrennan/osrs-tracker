import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { db } from '@/database';
import { users, session, account, verification } from '@/database/schema';
import { sendEmail, magicLinkEmail } from '@/lib/email';

export const auth = betterAuth({
  baseURL: process.env.AUTH_URL ?? process.env.APP_URL,
  secret: process.env.AUTH_SECRET,
  trustedOrigins: [process.env.APP_URL ?? 'http://localhost:3000'],

  database: drizzleAdapter(db, {
    provider: 'pg',
    // Map Better Auth’s model names onto our tables. `user` is plural here
    // because 20 domain tables already reference users(id).
    schema: { user: users, session, account, verification },
  }),

  advanced: {
    database: {
      // Our id columns are uuid, so let Better Auth mint uuids rather than
      // its default text ids.
      generateId: 'uuid',
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh at most daily
  },

  // No password auth at all — nothing to leak, nothing to reset.
  emailAndPassword: { enabled: false },

  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        const msg = magicLinkEmail(url);
        await sendEmail({ to: email, ...msg });
      },
    }),
  ],
});
