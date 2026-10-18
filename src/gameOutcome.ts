import type { Chess } from 'chess.js'

export function getGameOutcome(game: Chess, playerColor: 'w' | 'b') {
    if (game.isCheckmate()) {
        const winner = game.turn() === 'w' ? 'b' : 'w'
        return { heading: 'Checkmate', outcome: winner === playerColor ? 'won' : 'lost', winner, reason: `${winner === 'w' ? 'White' : 'Black'} wins by checkmate.` } as const
    }
    if (!game.isDraw()) return null
    const reason = game.isStalemate() ? 'Stalemate. No legal moves remain.'
        : game.isInsufficientMaterial() ? 'Neither side has enough material to checkmate.'
        : game.isThreefoldRepetition() ? 'The same position occurred three times.'
        : game.isDrawByFiftyMoves() ? 'Fifty moves without a pawn move or capture.'
        : 'The game ended in a draw.'
    return { heading: 'Draw', outcome: 'draw', winner: null, reason } as const
}

export function resolveOutcome(game: Chess, playerColor: 'w' | 'b', server?: { status?: string; result?: string | null; reason?: string | null } | null) {
    const natural = getGameOutcome(game, playerColor)
    if (natural) return natural
    if (!server || server.status !== 'finished' || !server.result) return null
    if (server.result === '1/2-1/2') {
        const agreed = server.reason === 'agreement'
        return { heading: 'Draw', outcome: 'draw' as const, winner: null, reason: agreed ? 'Both players agreed to a draw.' : 'The game ended in a draw.' }
    }
    const winner = server.result === '1-0' ? 'w' as const : 'b' as const
    const onTime = server.reason === 'time'
    return {
        heading: onTime ? 'Time' : 'Resign',
        outcome: winner === playerColor ? 'won' as const : 'lost' as const,
        winner,
        reason: onTime ? `${winner === 'w' ? 'White' : 'Black'} wins on time.` : `${winner === 'w' ? 'White' : 'Black'} wins by resignation.`,
    }
}
