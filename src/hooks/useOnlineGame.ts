import { useCallback, useEffect, useRef, useState } from 'react'
import { gameAction, OnlineGame, RatingChange, supabase } from '../services/supabase'

export function useOnlineGame(id: string | null, userId: string | undefined) {
    const [game, setGame] = useState<OnlineGame | null>(null)
    const [connection, setConnection] = useState('Connecting…')
    const [error, setError] = useState('')
    const [pending, setPending] = useState(false)
    const [rating, setRating] = useState<RatingChange | null>(null)
    const busy = useRef(false)
    const activeId = useRef(id)
    const status = useRef<OnlineGame['status'] | null>(null)
    activeId.current = userId ? id : null
    const accept = useCallback((next: OnlineGame | null, nextRating?: RatingChange | null) => {
        if (!next) { setGame(null); return }
        if (next.id !== activeId.current) return
        setGame(current => current?.id === next.id && current.version > next.version ? current : next)
        if (nextRating) setRating(nextRating)
    }, [])
    useEffect(() => { status.current = game?.status ?? null }, [game?.status])
    useEffect(() => {
        setGame(null); setError(''); setRating(null); status.current = null
        if (!id || !userId || !supabase) return
        let active = true
        const refresh = async () => {
            const { data, error } = await supabase!.from('games').select('*').eq('id', id).maybeSingle()
            if (!active) return
            if (error || !data) { setError('This game is unavailable or you have not joined it.'); return }
            accept(data as OnlineGame)
        }
        const channel = supabase.channel(`game:${id}`).on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}`,
        }, payload => { if (active) accept(payload.new as OnlineGame) }).on('system', {}, payload => {
            if (active && payload.status === 'ok') void refresh()
        }).subscribe(status => {
            if (!active) return
            setConnection(status === 'SUBSCRIBED' ? 'Connected' : 'Reconnecting…')
            if (status === 'SUBSCRIBED') void refresh()
        })
        const beat = () => {
            if (!active || document.visibilityState === 'hidden' || status.current === 'finished') return
            void gameAction('heartbeat', { id }).then(result => { if (active) accept(result.game, result.rating) }).catch(() => {})
        }
        const timer = window.setInterval(beat, 10000)
        void refresh()
        const onVisible = () => { if (document.visibilityState === 'visible') { void refresh(); beat() } }
        window.addEventListener('online', refresh)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            active = false; window.clearInterval(timer); void supabase!.removeChannel(channel)
            window.removeEventListener('online', refresh)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [id, userId, accept])
    const send = async (action: string, values: Record<string, unknown> = {}) => {
        if (!id || busy.current) return null
        busy.current = true; setPending(true); setError('')
        try {
            const result = await gameAction(action, { id, version: game?.version, ...values })
            accept(result.game, result.rating)
            return result
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Move could not be saved.')
            if (supabase && id) {
                const { data } = await supabase.from('games').select('*').eq('id', id).maybeSingle()
                if (data) accept(data as OnlineGame)
            }
            return null
        } finally { busy.current = false; setPending(false) }
    }
    return {
        game, connection, error, pending, rating,
        move: (from: string, to: string, promotion = 'q') => send('move', { from, to, promotion }),
        resign: () => send('resign'),
        quit: () => send('quit'),
        offerDraw: () => send('draw'),
        answerDraw: (acceptDraw: boolean) => send('draw-answer', { accept: acceptDraw }),
    }
}
