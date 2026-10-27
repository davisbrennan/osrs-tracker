import { NextResponse } from 'next/server';
import { pool } from '@/database';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    await pool.query('SELECT 1');
    checks.db = 'up';
  } catch {
    checks.db = 'down';
  }

  try {
    await redis.ping();
    checks.redis = 'up';
  } catch {
    checks.redis = 'down';
  }

  const ok = Object.values(checks).every((v) => v === 'up');

  return NextResponse.json(
    {
      ok,
      sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
      uptime: Math.round(process.uptime()),
      ...checks,
    },
    { status: ok ? 200 : 503 }
  );
}
