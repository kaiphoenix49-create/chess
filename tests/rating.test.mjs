import test from 'node:test'
import assert from 'node:assert/strict'
import { updateGlicko } from '../supabase/functions/_shared/glicko2.ts'
import { replayGame } from '../supabase/functions/_shared/replayGame.ts'
import { formatDelta, remainingMs } from '../src/clock.ts'

test('Glicko-2 matches the published worked example', () => {
    const next = updateGlicko({ rating: 1500, rd: 200, vol: 0.06 }, [
        { rating: 1400, rd: 30, score: 1 },
        { rating: 1550, rd: 100, score: 0 },
        { rating: 1700, rd: 300, score: 0 },
    ])
    assert.ok(Math.abs(next.rating - 1464.06) < 0.2, `rating ${next.rating}`)
    assert.ok(Math.abs(next.rd - 151.52) < 0.3, `rd ${next.rd}`)
    assert.ok(Math.abs(next.vol - 0.05999) < 0.00002, `vol ${next.vol}`)
})

test('a single game moves a new rating and keeps it inside the deviation bounds', () => {
    const next = updateGlicko({ rating: 1500, rd: 350, vol: 0.06 }, [{ rating: 1500, rd: 80, score: 1 }])
    assert.ok(next.rating > 1500)
    assert.ok(next.rd < 350 && next.rd >= 30)
})

test('computer games are replayed and a quit is a loss', () => {
    const mate = replayGame(['f3', 'e5', 'g4', 'Qh4'], 'w', false)
    assert.equal(mate.result, '0-1')
    assert.equal(mate.reason, 'checkmate')
    const quit = replayGame(['e2e4'], 'w', true)
    assert.equal(quit.result, '0-1')
    assert.equal(quit.reason, 'resign')
    assert.throws(() => replayGame([], 'w', true), /Play a move/)
    assert.throws(() => replayGame(['e2e4', 'not-a-move'], 'b', false), /Invalid move/)
})

test('clock display pauses when the player has been away', () => {
    const now = Date.parse('2026-10-18T12:00:00Z')
    const game = { moves: [], status: 'active', white_ms: 60000, black_ms: 60000, clock_at: new Date(now - 5000).toISOString(), white_seen_at: new Date(now - 5000).toISOString(), black_seen_at: null }
    assert.equal(remainingMs(game, 'w', now), 55000)
    assert.equal(remainingMs(game, 'b', now), 60000)
    assert.equal(remainingMs(game, 'w', now + 30000), 60000)
    assert.equal(formatDelta(1500.4, 1516.6), '1500 → 1517 (+17)')
})
