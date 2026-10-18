import { createClient } from '@supabase/supabase-js'
const url = process.env.SUPABASE_URL || ''
const key = process.env.SUPABASE_PUBLISHABLE_KEY || ''
export const supabase = url && key ? createClient(url, key, {
    auth: { flowType: 'pkce', detectSessionInUrl: true },
}) : null
export type OnlineGame = {
    id: string; white_id: string; black_id: string | null; moves: string[]
    fen: string; version: number; status: 'waiting' | 'active' | 'finished'
    result: string | null; expires_at: string | null
    white_ms: number; black_ms: number; clock_at: string | null
    white_seen_at: string | null; black_seen_at: string | null
    listed: boolean; draw_by: string | null; reason: string | null
}
export type RatingChange = { before: number; after: number; rd: number }
export type GameResponse = { game: OnlineGame | null; rating: RatingChange | null }
export type Profile = {
    user_id: string; display_name: string | null
    human_rating: number; human_rd: number; human_games: number; human_wins: number; human_losses: number; human_draws: number
    engine_rating: number; engine_rd: number; engine_games: number; engine_wins: number; engine_losses: number; engine_draws: number
}
export type GameRecord = {
    id: string; game_id: string | null; pool: 'human' | 'engine'; result: string; reason: string | null
    white_id: string | null; black_id: string | null; difficulty: number | null
    white_before: number; white_after: number; black_before: number; black_after: number; created_at: string
}
export async function gameAction(action: string, values: Record<string, unknown> = {}): Promise<GameResponse> {
    if (!supabase) throw new Error('Online play is not configured yet. You can still play the computer.')
    const { data, error } = await supabase.functions.invoke('game', { body: { action, ...values } })
    if (error) {
        let message = 'Online play is unavailable. Please try again.'
        try { message = (await error.context.json()).error || message } catch { /* network failure */ }
        throw new Error(message)
    }
    return data
}
