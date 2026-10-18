import React, { useEffect, useMemo, useState } from 'react'
import Chessboard from 'chessboardjsx'
import { Chess, Square } from 'chess.js'
import { readSavedColor, readSavedDifficulty, useChessGame } from './hooks/useChessGame'
import { useStockfishWorker } from './hooks/useStockfishWorker'
import { useAuth } from './hooks/useAuth'
import { useOnlineGame } from './hooks/useOnlineGame'
import { getGameOutcome, resolveOutcome } from './gameOutcome'
import GameResultDialog from './components/GameResultDialog'
import CapturedPieces from './components/CapturedPieces'
import PieceStylePicker, { createBoardPieces, readPieceStyle } from './components/PieceStylePicker'
import BoardThemePicker, { boardThemes, readBoardTheme } from './components/BoardThemePicker'
import { GameRecord, gameAction, Profile, supabase } from './services/supabase'
import { formatClock, formatDelta, remainingMs } from './clock'

export default function App() {
    const local = useChessGame()
    const auth = useAuth()
    const invite = new URLSearchParams(window.location.search).get('game')
    const [mode, setMode] = useState<'ai' | 'multiplayer'>('ai')
    const [gameId, setGameId] = useState<string | null>(null)
    const [color, setColor] = useState<'w' | 'b'>(readSavedColor)
    const [difficulty, setDifficulty] = useState(readSavedDifficulty)
    const [minutes, setMinutes] = useState(15)
    const [pieceStyle, setPieceStyle] = useState(readPieceStyle)
    const boardPieces = useMemo(() => createBoardPieces(pieceStyle), [pieceStyle])
    const [boardTheme, setBoardTheme] = useState(readBoardTheme)
    const theme = boardThemes.find(theme => theme.id === boardTheme) ?? boardThemes[0]
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [copied, setCopied] = useState(false)
    const [moveText, setMoveText] = useState('')
    const [selected, setSelected] = useState<Square | null>(null)
    const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [records, setRecords] = useState<GameRecord[]>([])
    const [localRating, setLocalRating] = useState<{ before: number; after: number } | null>(null)
    const [now, setNow] = useState(Date.now())
    const online = useOnlineGame(mode === 'multiplayer' ? gameId : null, auth.user?.id)
    const engine = useStockfishWorker(local.fen, difficulty, color, mode === 'ai' && !local.resigned, local.makeMove)
    const game = useMemo(() => {
        if (mode === 'ai') return local.game
        const chess = new Chess()
        for (const move of online.game?.moves ?? []) chess.move(move)
        return chess
    }, [mode, local.fen, online.game?.moves])
    const playerColor = mode === 'ai' ? color : online.game?.white_id === auth.user?.id ? 'w' : 'b'
    const participant = mode === 'ai' || (!!auth.user && (online.game?.white_id === auth.user.id || online.game?.black_id === auth.user.id))
    const natural = !participant ? null : mode === 'ai' ? getGameOutcome(game, playerColor) : resolveOutcome(game, playerColor, online.game)
    const result = mode === 'ai' && local.resigned && !natural
        ? { heading: 'Resign', outcome: 'lost' as const, winner: color === 'w' ? 'b' as const : 'w' as const, reason: 'You resigned.' }
        : natural
    const expired = !!(online.game?.expires_at && Date.parse(online.game.expires_at) < Date.now())
    const canMove = !promotion && !local.resigned && !game.isGameOver() && game.turn() === playerColor && (mode === 'ai' || (!!auth.user && online.game?.status === 'active' && !online.pending && !expired))
    const history = game.history({ verbose: true })
    const captured = history.filter(move => move.captured).map(move => (move.color === 'w' ? 'b' : 'w') + move.captured)
    const last = history[history.length - 1]
    const legal = selected ? game.moves({ square: selected, verbose: true }) : []
    const squareStyles: Record<string, React.CSSProperties> = {}
    if (last) { squareStyles[last.from] = { backgroundColor: theme.highlight }; squareStyles[last.to] = { backgroundColor: theme.highlight } }
    for (const move of legal) squareStyles[move.to] = { backgroundImage: 'radial-gradient(circle, #24293355 18%, transparent 20%)' }
    const status = game.isCheckmate() ? `Checkmate · ${result?.outcome === 'won' ? 'You won' : mode === 'ai' ? 'Stockfish won' : 'Your opponent won'}` : game.isDraw() ? 'Draw' : result?.heading === 'Time' || result?.heading === 'Resign' ? result.reason : mode === 'multiplayer' && online.game?.status === 'waiting' ? (online.game.listed ? 'Waiting for an opponent' : 'Waiting for your friend') : engine.thinking && mode === 'ai' ? 'Stockfish is thinking…' : `${game.turn() === 'w' ? 'White' : 'Black'} to move${game.isCheck() ? ' · Check' : ''}`
    const ratingText = (mode === 'ai' ? localRating : online.rating) ? formatDelta((mode === 'ai' ? localRating : online.rating)!.before, (mode === 'ai' ? localRating : online.rating)!.after) : null
    const topClock = mode === 'multiplayer' ? remainingMs(online.game, playerColor === 'w' ? 'b' : 'w', now) : null
    const bottomClock = mode === 'multiplayer' ? remainingMs(online.game, playerColor, now) : null
    const loadProfile = async () => {
        if (!supabase || !auth.user) { setProfile(null); setRecords([]); return }
        try {
            const userId = auth.user.id
            const [profiles, history] = await Promise.all([
                supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
                supabase.from('game_records').select('*').or(`white_id.eq.${userId},black_id.eq.${userId}`).order('created_at', { ascending: false }).limit(12),
            ])
            if (profiles.data && typeof profiles.data.human_rating === 'number') setProfile(profiles.data as Profile)
            if (Array.isArray(history.data)) setRecords(history.data as GameRecord[])
        } catch { /* The board stays usable when the profile request fails. */ }
    }
    useEffect(() => { void loadProfile() }, [auth.user?.id, local.recorded, online.game?.status])
    useEffect(() => {
        if (mode !== 'multiplayer') return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [mode])
    useEffect(() => {
        if (!auth.user || !supabase || invite) return
        const client = supabase
        const userId = auth.user.id
        let active = true
        const resume = async () => {
            try {
                const { data } = await client.from('games').select('id').or(`white_id.eq.${userId},black_id.eq.${userId}`).in('status', ['waiting', 'active']).limit(1)
                const row = Array.isArray(data) ? data[0] : null
                if (!active || !row?.id) return
                setGameId(row.id); setMode('multiplayer')
                window.history.replaceState(null, '', `/?game=${row.id}`)
            } catch { /* A missing unfinished game just leaves the player on the computer board. */ }
        }
        void resume()
        return () => { active = false }
    }, [auth.user, invite])
    useEffect(() => {
        if (mode !== 'ai' || !result || !auth.user || !supabase || local.recorded) return
        let active = true
        const moves = local.game.history({ verbose: true }).map(move => move.lan)
        gameAction('record', { id: local.recordId, moves, difficulty: local.ratedDifficulty, color, resign: local.resigned })
            .then(response => { if (!active || !response.rating) return; local.markRecorded(); setLocalRating(response.rating) })
            .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Rating could not be saved.') })
        return () => { active = false }
    }, [mode, result?.heading, result?.outcome, auth.user?.id, local.recorded, local.recordId, local.resigned, local.ratedDifficulty, color])
    const submit = (from: string, to: string, piece = 'q') => {
        setSelected(null); setPromotion(null)
        if (mode === 'ai') local.makeMove({ from, to, promotion: piece })
        else void online.move(from, to, piece)
    }
    const attempt = (from: string, to: string) => {
        if (!canMove || from === to) return
        const candidates = game.moves({ square: from as Square, verbose: true }).filter(move => move.to === to)
        if (!candidates.length) return
        if (candidates.some(move => move.promotion)) setPromotion({ from, to })
        else submit(from, to)
    }
    const openGame = async (action: 'create' | 'join' | 'seek') => {
        setBusy(true); setError('')
        try {
            const opened = await gameAction(action, action === 'join' ? { id: invite } : { minutes })
            if (!opened.game) return
            setGameId(opened.game.id); setMode('multiplayer'); setSelected(null); setPromotion(null)
            window.history.replaceState(null, '', `/?game=${opened.game.id}`)
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this game.') }
        finally { setBusy(false) }
    }
    const startLocal = () => {
        local.reset(color, difficulty); setLocalRating(null); setMode('ai'); setGameId(null); setSelected(null); setPromotion(null); setError('')
        window.history.replaceState(null, '', '/')
    }
    const share = async () => {
        try { await navigator.clipboard.writeText(`${window.location.origin}/?game=${gameId}`); setCopied(true) }
        catch { setError('Copy the invitation from your address bar.') }
    }
    const clock = (ms: number | null) => ms === null ? null : <span className={ms < 30000 ? 'clock low' : 'clock'}>{formatClock(ms)}</span>
    return <main className="app-shell">
        <header className="site-header"><h1 className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Chess Studio</h1></header>
        <section className="game-layout">
            <div className="board-panel">
                <div className="board-toolbar"><p role="status" className="game-status">{expired ? 'This game has expired' : status}</p><span className="mode-label">{mode === 'ai' ? 'Computer' : 'Online'}</span></div>
                <div className="player-bar"><span className="player-identity"><span aria-hidden="true" className={`player-avatar ${playerColor === 'w' ? 'piece-black' : 'piece-white'}`}>♟︎</span>{mode === 'ai' ? 'Stockfish' : 'Your friend'}</span><span className="bar-meta">{clock(topClock)}<span>{playerColor === 'w' ? 'Black' : 'White'}</span></span></div>
                <CapturedPieces pieceStyle={pieceStyle} pieces={captured} color={playerColor} />
                <div className="board" aria-label="Chess board">
                    <Chessboard key={pieceStyle} pieces={boardPieces} position={game.fen()} orientation={playerColor === 'w' ? 'white' : 'black'} draggable={canMove}
                        onDrop={({ sourceSquare, targetSquare }) => attempt(sourceSquare, targetSquare)}
                        onSquareClick={square => {
                            if (!canMove) return
                            if (selected) attempt(selected, square)
                            setSelected(game.get(square as Square)?.color === playerColor ? square as Square : null)
                        }}
                        calcWidth={({ screenWidth }) => Math.max(200, Math.min(560, screenWidth - 64))}
                        lightSquareStyle={{ backgroundColor: theme.light }} darkSquareStyle={{ backgroundColor: theme.dark }}
                        squareStyles={squareStyles} />
                </div>
                <div className="player-bar"><span className="player-identity"><span aria-hidden="true" className={`player-avatar ${playerColor === 'w' ? 'piece-white' : 'piece-black'}`}>♟︎</span>You · {playerColor === 'w' ? 'White' : 'Black'}</span><span className="bar-meta">{clock(bottomClock)}<span>{mode === 'ai' ? 'Computer game' : online.connection}</span></span></div>
                <CapturedPieces pieceStyle={pieceStyle} pieces={captured} color={playerColor === 'w' ? 'b' : 'w'} />
                {result && <GameResultDialog key={`${mode}:${gameId}:${local.resigned}:${game.fen()}`} result={result} playerColor={playerColor}
                    opponent={mode === 'ai' ? 'Stockfish' : 'Your opponent'} online={mode === 'multiplayer'} rating={ratingText} onNewGame={startLocal} />}
                <BoardThemePicker value={boardTheme} onChange={value => {
                    setBoardTheme(value)
                    try { localStorage.setItem('gnap-board-theme', value) } catch {}
                }} />
                <PieceStylePicker value={pieceStyle} onChange={value => {
                    setPieceStyle(value)
                    try { localStorage.setItem('gnap-piece-style', value) } catch {}
                }} />
                {promotion && <div role="dialog" aria-modal="true" aria-label="Promote pawn" className="promotion"><p>Promote your pawn</p>{[['q','Queen'],['r','Rook'],['b','Bishop'],['n','Knight']].map(([piece,label]) => <button autoFocus={piece === 'q'} key={piece} onClick={() => submit(promotion.from, promotion.to, piece)}>{label}</button>)}</div>}
            </div>
            <aside className="sidebar">
                <section className="card" aria-label="Game controls">
                    <h2>{mode === 'ai' ? 'Play the computer' : 'Play a friend'}</h2>
                    {mode === 'ai' && <><div className="settings-grid"><div><label htmlFor="color">Your pieces</label><select id="color" value={color} onChange={e => { const next = e.target.value as 'w' | 'b'; setColor(next); try { sessionStorage.setItem('gnap-color', next) } catch {} local.reset(next, difficulty); setLocalRating(null); setSelected(null); setPromotion(null) }}><option value="w">White</option><option value="b">Black</option></select></div>
                    <div><label htmlFor="difficulty">Difficulty</label><select id="difficulty" value={difficulty} disabled={history.length > 0} onChange={e => { const level = Number(e.target.value); setDifficulty(level); local.noteDifficulty(level) }}>{[0,2,5,8,12,16,20].map(level => <option key={level} value={level}>Level {level}</option>)}</select></div></div>
                    <div className="button-row"><button onClick={() => { local.undo(color); setSelected(null); setPromotion(null) }} disabled={!history.length || game.isGameOver() || local.resigned}>Undo</button><button onClick={() => local.resign()} disabled={!history.length || !!result}>Quit</button><button className="primary" onClick={startLocal}>New game</button></div></>}
                    {mode === 'multiplayer' && online.game?.status === 'active' && online.game.draw_by && online.game.draw_by !== auth.user?.id && <div className="draw-offer"><p>Your friend offered a draw.</p><div className="button-row"><button onClick={() => void online.answerDraw(true)}>Accept draw</button><button onClick={() => void online.answerDraw(false)}>Decline</button></div></div>}
                    {mode === 'multiplayer' && online.game?.draw_by === auth.user?.id && <p className="draw-offer">Draw offer sent.</p>}
                    {mode === 'multiplayer' && <><button onClick={share}>{copied ? 'Invitation copied' : 'Copy invitation'}</button>
                    {online.game?.status === 'active' && <button onClick={() => void online.offerDraw()} disabled={!!online.game.draw_by || !!result}>Offer draw</button>}
                    {online.game?.status === 'active' && <button onClick={() => void online.resign()} disabled={!!result}>Resign</button>}
                    {online.game?.status !== 'finished' && <button onClick={() => void online.quit().then(response => { if (!response?.game) startLocal() })}>Quit</button>}
                    <button onClick={startLocal}>Play the computer</button></>}
                </section>
                {(error || auth.error || online.error || engine.error) && <p role="alert" className="error">{error || auth.error || online.error || engine.error}</p>}
                <section className="card moves-card"><h2>Moves</h2><form onSubmit={e => {
                    e.preventDefault()
                    if (!canMove) return
                    try { const parsed = new Chess(game.fen()).move(moveText); submit(parsed.from, parsed.to, parsed.promotion); setMoveText(''); setError('') }
                    catch { setError('Enter a legal move, such as e4 or Nf3.') }
                }}><label htmlFor="move-entry">Enter a move (for example, e4)</label><div className="button-row"><input id="move-entry" value={moveText} onChange={e => setMoveText(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e4, Nf3…" /><button type="submit" disabled={!canMove || !moveText}>Move</button></div></form><p className="move-list" aria-label="Move history">{history.length ? history.map((move, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}${move.san}`).join(' ') : 'No moves yet.'}</p>
                    <button disabled={!history.length} onClick={() => { const url = URL.createObjectURL(new Blob([game.pgn()], { type: 'application/x-chess-pgn' })); const a = document.createElement('a'); a.href = url; a.download = 'game.pgn'; a.click(); URL.revokeObjectURL(url) }}>Download PGN</button>
                </section>
                <section className="card online-card" aria-label="Online play"><h2>Play a friend</h2>
                    {!supabase ? <p>Online play is unavailable.</p> : !auth.ready ? <p>Checking sign-in…</p> : auth.user ? <><p>Signed in as {profile?.display_name || auth.user.user_metadata.full_name || auth.user.email}</p>
                    {profile && <div className="profile-stats">
                        <div><span>People</span><strong>{Math.round(profile.human_rating)}</strong><small>{profile.human_rd > 110 ? 'Provisional · ' : ''}{profile.human_wins}W {profile.human_losses}L {profile.human_draws}D</small></div>
                        <div><span>Computer</span><strong>{Math.round(profile.engine_rating)}</strong><small>{profile.engine_rd > 110 ? 'Provisional · ' : ''}{profile.engine_wins}W {profile.engine_losses}L {profile.engine_draws}D</small></div>
                    </div>}
                    {!!records.length && <ul className="history-list">{records.map(record => {
                        const mineWhite = record.white_id === auth.user?.id
                        const draw = record.result === '1/2-1/2'
                        const win = (mineWhite && record.result === '1-0') || (!mineWhite && record.result === '0-1')
                        const before = mineWhite ? record.white_before : record.black_before
                        const after = mineWhite ? record.white_after : record.black_after
                        return <li key={record.id}><span>{record.pool === 'engine' ? `Computer ${record.difficulty}` : 'Opponent'} · {draw ? 'Draw' : win ? 'Win' : 'Loss'}</span><span>{formatDelta(before, after)}</span></li>
                    })}</ul>}
                    <div className="settings-grid"><div><label htmlFor="minutes">Minutes each</label><select id="minutes" value={minutes} onChange={e => setMinutes(Number(e.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={15}>15</option></select></div></div>
                    {invite && <button disabled={busy} onClick={() => void openGame('join')}>Join / resume invited game</button>}
                    <button className="primary" disabled={busy} onClick={() => void openGame('seek')}>Find a game</button>
                    <button disabled={busy} onClick={() => void openGame('create')}>Invite a friend</button><button onClick={() => { void auth.signOut(); startLocal() }}>Sign out</button></> : <><p>Sign in with a Gmail or school Google account.</p><button className="social-button google-button" onClick={() => void auth.signIn('google')}><img src="/ui/google-g.png" width="20" height="20" alt="" />Sign in with Google</button><button className="social-button" onClick={() => void auth.signIn('github')}><img src="/ui/github.svg" width="20" height="20" alt="" />Continue with GitHub</button></>}
                </section>
            </aside>
        </section>
    </main>
}
