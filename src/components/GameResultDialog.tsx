import React, { useEffect, useRef } from 'react'

type Result = { heading: string; outcome: 'won' | 'lost' | 'draw'; winner: 'w' | 'b' | null; reason: string }

export default function GameResultDialog({ result, playerColor, opponent, online, onNewGame, rating }: {
    result: Result; playerColor: 'w' | 'b'; opponent: string; online: boolean; onNewGame: () => void; rating?: string | null;
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const reviewButton = useRef<HTMLButtonElement>(null)
    const previousOverflow = useRef<string | null>(null)
    const open = () => {
        if (!dialog.current || dialog.current.open) return
        previousOverflow.current = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialog.current.showModal()
        reviewButton.current?.focus()
    }
    const restoreScroll = () => {
        if (previousOverflow.current !== null) {
            document.body.style.overflow = previousOverflow.current
            previousOverflow.current = null
        }
    }
    useEffect(() => {
        open()
        return () => { dialog.current?.close(); restoreScroll() }
    }, [])
    const title = result.outcome === 'won' ? 'You won!' : result.outcome === 'lost' ? `${opponent} won` : 'Game drawn'
    const whiteResult = result.winner === null ? '½' : result.winner === 'w' ? '1' : '0'
    const blackResult = result.winner === null ? '½' : result.winner === 'b' ? '1' : '0'
    return <>
        <button className="result-reopen" onClick={open}>View result</button>
        <dialog ref={dialog} className={`game-result result-${result.outcome}`} aria-labelledby="game-result-heading" aria-describedby="game-result-description" onClose={restoreScroll} onKeyDown={event => {
                if (event.key !== 'Tab') return
                const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
                const first = buttons[0], last = buttons[buttons.length - 1]
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
                else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            }}>
            <div className="result-symbol" aria-hidden="true">{result.outcome === 'draw' ? '½' : '♚︎'}</div>
            <h2 id="game-result-heading">{result.heading}</h2>
            <p className="result-title">{title}</p>
            <p id="game-result-description">{result.reason}</p>
            {rating && <p className="rating-change">{rating}</p>}
            <div className="result-score" aria-label="Final score">
                <div><span>{playerColor === 'w' ? 'You' : opponent}</span><small>White</small><strong>{whiteResult}</strong></div>
                <span className="score-divider" aria-hidden="true">–</span>
                <div><span>{playerColor === 'b' ? 'You' : opponent}</span><small>Black</small><strong>{blackResult}</strong></div>
            </div>
            <div className="result-actions">
                <button className="primary" onClick={onNewGame}>{online ? 'Play the computer' : 'New game'}</button>
                <button ref={reviewButton} onClick={() => dialog.current?.close()}>Review board</button>
            </div>
        </dialog>
    </>
}
