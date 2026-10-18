import { Chess } from 'chess.js'
export type Position = { white_id: string; black_id: string | null; moves: string[]; version: number; status: string; expires_at: string | null }
export function validateMove(game: Position, userId: string, input: { version: number; from: string; to: string; promotion?: string }) {
    if (userId !== game.white_id && userId !== game.black_id) throw new Error('You are not a player in this game.')
    if (game.expires_at && Date.parse(game.expires_at) <= Date.now()) throw new Error('Game expired.')
    if (game.status !== 'active') throw new Error('This game is not active.')
    if (input.version !== game.version) throw new Error('The board changed. Please try your move again.')
    if (game.moves.length >= 1024) throw new Error('Move limit reached.')
    const chess = new Chess()
    // Replay preserves repetition detection, castling rights and move history.
    for (const move of game.moves) chess.move(move)
    if (chess.isGameOver()) throw new Error('This game has ended.')
    const color = userId === game.white_id ? 'w' : 'b'
    if (chess.turn() !== color) throw new Error('It is not your turn.')
    const move = chess.move({ from: input.from, to: input.to, promotion: input.promotion || 'q' })
    const result = chess.isCheckmate() ? (color === 'w' ? '1-0' : '0-1') : chess.isDraw() || game.moves.length + 1 >= 1024 ? '1/2-1/2' : null
    return { move: move.lan, fen: chess.fen(), result }
}
