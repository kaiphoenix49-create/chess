import { Chess } from 'chess.js'

export const ENGINE_RATINGS: Record<number, number> = { 0: 800, 2: 1100, 5: 1400, 8: 1700, 12: 2000, 16: 2300, 20: 2600 }

export function replayGame(moves: unknown, color: 'w' | 'b', resign: boolean) {
    if (!Array.isArray(moves) || moves.length > 1024 || moves.some(move => typeof move !== 'string' || move.length > 10)) throw new Error('Invalid game.')
    const chess = new Chess()
    for (const move of moves) {
        if (!chess.move(move)) throw new Error('Invalid move.')
    }
    const lan = chess.history({ verbose: true }).map(move => move.lan)
    if (resign) {
        if (!lan.length) throw new Error('Play a move before quitting.')
        if (chess.isGameOver()) throw new Error('This game has ended.')
        return { moves: lan, result: color === 'w' ? '0-1' : '1-0', reason: 'resign' }
    }
    if (!chess.isGameOver() && lan.length < 1024) throw new Error('This game has not ended.')
    if (chess.isCheckmate()) {
        const winner = chess.turn() === 'w' ? 'b' : 'w'
        return { moves: lan, result: winner === 'w' ? '1-0' : '0-1', reason: 'checkmate' }
    }
    return { moves: lan, result: '1/2-1/2', reason: lan.length >= 1024 ? 'move-limit' : 'draw' }
}
