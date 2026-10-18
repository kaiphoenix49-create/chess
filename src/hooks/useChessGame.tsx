import { useCallback, useRef, useState } from 'react'
import { Chess } from 'chess.js'

export const savedGameKey = 'gnap-chess-local-v1'

type Save = { pgn: string; recordId: string; recorded: boolean; color: 'w' | 'b'; difficulty: number; resigned: boolean }

function readRaw(): Partial<Save> {
    try {
        const local = localStorage.getItem(savedGameKey)
        if (local) {
            const parsed = JSON.parse(local)
            if (parsed && typeof parsed.pgn === 'string') return parsed
        }
    } catch { /* A blocked store falls through to the older session save. */ }
    try {
        const pgn = sessionStorage.getItem(savedGameKey)
        if (pgn) return { pgn }
    } catch { /* Play still works without storage. */ }
    return {}
}

export function readSavedColor(): 'w' | 'b' {
    try {
        const session = sessionStorage.getItem('gnap-color')
        if (session === 'w' || session === 'b') return session
    } catch { /* ignore */ }
    return readRaw().color === 'b' ? 'b' : 'w'
}

export function readSavedDifficulty() {
    const difficulty = readRaw().difficulty
    return typeof difficulty === 'number' ? difficulty : 5
}

export function useChessGame() {
    const initial = useState(readRaw)[0]
    const [game] = useState(() => {
        const chess = new Chess()
        try { if (initial.pgn) chess.loadPgn(initial.pgn) } catch { chess.reset() }
        return chess
    })
    const meta = useRef<Save>({
        pgn: game.pgn(),
        recordId: initial.recordId || crypto.randomUUID(),
        recorded: initial.recorded === true,
        color: readSavedColor(),
        difficulty: typeof initial.difficulty === 'number' ? initial.difficulty : 5,
        resigned: initial.resigned === true,
    })
    const [fen, setFen] = useState(game.fen())
    const [recorded, setRecorded] = useState(meta.current.recorded)
    const [resigned, setResigned] = useState(meta.current.resigned)
    const [ratedDifficulty, setRatedDifficulty] = useState(meta.current.difficulty)
    const [recordId, setRecordId] = useState(meta.current.recordId)
    const persist = useCallback(() => {
        meta.current.pgn = game.pgn()
        setFen(game.fen())
        try { localStorage.setItem(savedGameKey, JSON.stringify(meta.current)) } catch { /* Play still works without storage. */ }
    }, [game])
    const makeMove = useCallback((move: { from: string; to: string; promotion?: string }) => {
        try { game.move(move); persist() } catch { /* Illegal drops leave the position unchanged. */ }
    }, [game, persist])
    const reset = (color: 'w' | 'b', difficulty: number) => {
        game.reset()
        meta.current = { pgn: '', recordId: crypto.randomUUID(), recorded: false, color, difficulty, resigned: false }
        setRecorded(false); setResigned(false); setRatedDifficulty(difficulty); setRecordId(meta.current.recordId)
        persist()
    }
    const undo = (playerColor: string) => {
        if (game.isGameOver() || meta.current.recorded || meta.current.resigned) return
        game.undo()
        if (game.turn() !== playerColor) game.undo()
        persist()
    }
    const markRecorded = () => { meta.current.recorded = true; setRecorded(true); persist() }
    const noteDifficulty = (level: number) => {
        if (game.history().length) return
        meta.current.difficulty = level
        setRatedDifficulty(level)
        persist()
    }
    const resign = () => { meta.current.resigned = true; setResigned(true); persist() }
    return { game, fen, makeMove, reset, undo, markRecorded, noteDifficulty, resign, recorded, resigned, recordId, ratedDifficulty }
}
