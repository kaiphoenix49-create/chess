import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMove } from '../supabase/functions/_shared/validateMove.ts'
const base = { white_id:'white', black_id:'black', moves:[], version:1, status:'active', expires_at:'2099-01-01T00:00:00Z' }
const move = {version:1,from:'e2',to:'e4'}
test('legal move returns canonical move and position', () => {
  const result=validateMove(base,'white',move)
  assert.equal(result.move,'e2e4'); assert.match(result.fen,/ b KQkq /); assert.equal(result.result,null)
})
test('reject outsider, wrong turn, stale version, illegal move and expired game', () => {
  assert.throws(()=>validateMove(base,'intruder',move),/not a player/)
  assert.throws(()=>validateMove(base,'black',move),/not your turn/)
  assert.throws(()=>validateMove(base,'white',{...move,version:0}),/board changed/)
  assert.throws(()=>validateMove(base,'white',{...move,to:'e5'}),/Invalid move/)
  assert.throws(()=>validateMove({...base,expires_at:'2000-01-01'},'white',move),/expired/)
  assert.equal(validateMove({...base,expires_at:null},'white',move).move,'e2e4')
  assert.throws(()=>validateMove({...base,status:'waiting'},'white',move),/not active/)
})
test('checkmate records the correct result', () => {
  const result=validateMove({...base,moves:['f2f3','e7e5','g2g4']},'black',{version:1,from:'d8',to:'h4'})
  assert.equal(result.result,'0-1')
})
test('replaying history preserves threefold repetition', () => {
  const result=validateMove({...base,moves:['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1']},'black',{version:1,from:'f6',to:'g8'})
  assert.equal(result.result,'1/2-1/2')
})
