type ClockGame = {
    moves: string[]; status: string; white_ms?: number; black_ms?: number
    clock_at?: string | null; white_seen_at?: string | null; black_seen_at?: string | null
}

export function remainingMs(game: ClockGame | null | undefined, side: 'w' | 'b', now: number) {
    const base = side === 'w' ? game?.white_ms : game?.black_ms
    if (!game || typeof base !== 'number') return null
    if (game.status !== 'active' || !game.clock_at) return base
    const turn = game.moves.length % 2 === 0 ? 'w' : 'b'
    if (turn !== side) return base
    const seen = side === 'w' ? game.white_seen_at : game.black_seen_at
    if (!seen || now - Date.parse(seen) > 20000) return base
    return Math.max(0, base - (now - Date.parse(game.clock_at)))
}

export function formatClock(ms: number) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function formatDelta(before: number, after: number) {
    const from = Math.round(before)
    const to = Math.round(after)
    const delta = to - from
    return `${from} → ${to} (${delta > 0 ? '+' : ''}${delta})`
}
