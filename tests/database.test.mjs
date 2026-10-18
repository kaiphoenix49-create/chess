import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
test('PostgreSQL migration enforces seats, RLS, write permissions, versions and room caps', async () => {
 const db = new PGlite()
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create publication supabase_realtime;`)
 await db.exec(await fs.readFile(new URL('../supabase/migrations/202609140001_games.sql',import.meta.url),'utf8'))
 await db.exec(await fs.readFile(new URL('../supabase/migrations/202610180001_ratings.sql',import.meta.url),'utf8'))
 const w='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002', x='00000000-0000-4000-8000-000000000003'
 await db.query('insert into auth.users values ($1),($2),($3)',[w,b,x])
 const g=(await db.query('select * from public.create_game($1)',[w])).rows[0]
 assert.equal(g.status,'waiting')
 await db.query('select * from public.join_game($1,$2)',[g.id,b])
 await assert.rejects(db.query('select * from public.join_game($1,$2)',[g.id,x]),/seats/)
 await assert.rejects(db.query('select * from public.commit_move($1,$2,1,$3,$4,null)',[g.id,b,'e7e5','fen']),/not your turn/)
 await db.query('select * from public.commit_move($1,$2,1,$3,$4,null)',[g.id,w,'e2e4','fen'])
 await assert.rejects(db.query('select * from public.commit_move($1,$2,1,$3,$4,null)',[g.id,w,'e2e4','fen']),/board changed/)
 await db.exec('set role authenticated')
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[x])
 assert.equal((await db.query('select * from public.games')).rows.length,0)
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[w])
 assert.equal((await db.query('select * from public.games')).rows.length,1)
 await assert.rejects(db.query("update public.games set fen='forged'"),/permission denied/)
 await assert.rejects(db.query('select * from public.create_game($1)',[w]),/permission denied/)
 await assert.rejects(db.query('select * from public.commit_move($1,$2,2,$3,$4,null)',[g.id,w,'e2e4','forged']),/permission denied/)
 await db.exec('reset role')
 await db.query('select public.quit_game($1,$2)',[g.id,w])
 for(let i=0;i<9;i++) {
  const row=(await db.query('select * from public.create_game($1)',[w])).rows[0]
  await db.query('select public.quit_game($1,$2)',[row.id,w])
 }
 await assert.rejects(db.query('select * from public.create_game($1)',[w]),/Room limit/)
 await db.query("update public.games set expires_at=now()-interval '1 day' where id=$1",[g.id])
 await assert.rejects(db.query('select * from public.join_game($1,$2)',[g.id,b]),/expired/)
 } finally { await db.close() }
})

test('clocks pause when a player is away, matchmaking pairs the oldest public game, and a result is rated once', async () => {
 const db = new PGlite()
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create publication supabase_realtime;`)
  const fs = await import('node:fs/promises')
  await db.exec(await fs.readFile(new URL('../supabase/migrations/202609140001_games.sql', import.meta.url), 'utf8'))
  await db.exec(await fs.readFile(new URL('../supabase/migrations/202610180001_ratings.sql', import.meta.url), 'utf8'))
  const w = '00000000-0000-4000-8000-000000000011', b = '00000000-0000-4000-8000-000000000012'
  await db.query('insert into auth.users values ($1),($2)', [w, b])
  assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 2)
  const listed = (await db.query('select * from public.seek_game($1, 10)', [w])).rows[0]
  assert.equal(listed.listed, true)
  assert.equal(listed.white_ms, 600000)
  assert.equal(listed.expires_at, null)
  const joined = (await db.query('select * from public.seek_game($1, 5)', [b])).rows[0]
  assert.equal(joined.id, listed.id)
  assert.equal(joined.status, 'active')
  await db.query("update public.games set white_seen_at=now()-interval '5 seconds', clock_at=now()-interval '5 seconds', white_ms=30000 where id=$1", [listed.id])
  const ticked = (await db.query('select * from public.touch_game($1,$2)', [listed.id, w])).rows[0]
  assert.ok(ticked.white_ms < 30000 && ticked.white_ms > 20000)
  await db.query("update public.games set white_seen_at=now()-interval '2 minutes', clock_at=now()-interval '2 minutes', white_ms=30000, status='active', result=null, expires_at=null where id=$1", [listed.id])
  const paused = (await db.query('select * from public.touch_game($1,$2)', [listed.id, w])).rows[0]
  assert.equal(paused.white_ms, 30000)
  assert.equal(paused.status, 'active')
  const resigned = (await db.query('select * from public.resign_game($1,$2)', [listed.id, w])).rows[0]
  assert.equal(resigned.result, '0-1')
  assert.equal(resigned.reason, 'resign')
  const record = (await db.query('select * from public.apply_human_result($1,1510,300,0.06,0,1490,300,0.06,0)', [listed.id])).rows[0]
  assert.equal(record.white_after, 1510)
 const again = (await db.query('select * from public.apply_human_result($1,1600,200,0.06,0,1400,200,0.06,0)', [listed.id])).rows[0]
 assert.equal(again.white_after, 1510)
 assert.equal((await db.query('select human_games from public.profiles where user_id=$1', [w])).rows[0].human_games, 1)
 const second = (await db.query('select * from public.create_game($1)', [w])).rows[0]
 await db.query('select * from public.join_game($1,$2)', [second.id, b])
 await db.query('select * from public.resign_game($1,$2)', [second.id, w])
 await assert.rejects(db.query('select * from public.apply_human_result($1,1510,300,0.06,0,1490,300,0.06,0)', [second.id]), /retry/)
 } finally { await db.close() }
})
