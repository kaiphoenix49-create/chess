import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
export function useAuth() {
    const [user, setUser] = useState<User | null>(null)
    const [ready, setReady] = useState(!supabase)
    const [error, setError] = useState('')
    useEffect(() => {
        if (!supabase) return
        let active = true
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (active) { setUser(session?.user ?? null); setReady(true) }
        })
        supabase.auth.getSession().then(({ data, error }) => {
            if (!active) return
            setUser(data.session?.user ?? null)
            if (error) setError('Sign-in could not be completed. Please try again.')
            setReady(true)
        }).catch(() => { if (active) { setError('Sign-in is unavailable.'); setReady(true) } })
        return () => { active = false; subscription.unsubscribe() }
    }, [])
    const signIn = async (provider: 'github' | 'google') => {
        if (!supabase) return
        setError('')
        const redirect = new URL('/', window.location.origin)
        const gameId = new URLSearchParams(window.location.search).get('game')
        if (gameId) redirect.searchParams.set('game', gameId)
        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo: redirect.href, ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}) },
        })
        if (error) setError('Sign-in is unavailable. Please try again.')
    }
    const signOut = async () => {
        const result = await supabase?.auth.signOut()
        if (result?.error) setError('Could not sign out. Please try again.')
    }
    return { user, ready, error, signIn, signOut }
}
