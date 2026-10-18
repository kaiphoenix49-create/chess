import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { validateMove } from '../_shared/validateMove.ts'
import { updateGlicko, type Glicko } from '../_shared/glicko2.ts'
import { ENGINE_RATINGS, replayGame } from '../_shared/replayGame.ts'

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Profile = {
    user_id: string
    human_rating: number; human_rd: number; human_vol: number; human_games: number
    engine_rating: number; engine_rd: number; engine_vol: number; engine_games: number
}
type RecordRow = {
    white_id: string | null; black_id: string | null; pool: string; result: string
    white_before: number; white_after: number; black_before: number; black_after: number
}
type GameRow = {
    id: string; white_id: string; black_id: string | null; status: string; result: string | null
    moves: string[]; version: number; expires_at: string | null
}

function score(result: string, color: 'w' | 'b') {
    if (result === '1/2-1/2') return 0.5
    return (result === '1-0' && color === 'w') || (result === '0-1' && color === 'b') ? 1 : 0
}
function minutesOf(value: unknown) {
    return value === 5 || value === 10 || value === 15 ? value : 15
}

async function ensureProfile(admin: SupabaseClient, user: { id: string; user_metadata?: { full_name?: string }; email?: string }) {
    const name = user.user_metadata?.full_name || user.email || ''
    const { error } = await admin.rpc('ensure_profile', { p_user: user.id, p_name: name })
    if (error) throw new Error('Profile could not be saved.')
}
async function loadProfile(admin: SupabaseClient, userId: string) {
    const { data, error } = await admin.from('profiles').select('*').eq('user_id', userId).single()
    if (error || !data) throw new Error('Profile could not be loaded.')
    return data as Profile
}
function ratingOf(row: RecordRow, userId: string, profile: Profile, pool: 'human' | 'engine') {
    const white = row.white_id === userId
    return {
        before: white ? row.white_before : row.black_before,
        after: white ? row.white_after : row.black_after,
        rd: pool === 'human' ? (white ? profile.human_rd : profile.human_rd) : profile.engine_rd,
    }
}

async function rateHuman(admin: SupabaseClient, game: GameRow, userId: string) {
    if (game.status !== 'finished' || !game.black_id || !game.result) return null
    for (let attempt = 0; attempt < 4; attempt++) {
        const white = await loadProfile(admin, game.white_id)
        const black = await loadProfile(admin, game.black_id)
        const nextWhite = updateGlicko(
            { rating: white.human_rating, rd: white.human_rd, vol: white.human_vol },
            [{ rating: black.human_rating, rd: black.human_rd, score: score(game.result, 'w') }],
        )
        const nextBlack = updateGlicko(
            { rating: black.human_rating, rd: black.human_rd, vol: black.human_vol },
            [{ rating: white.human_rating, rd: white.human_rd, score: score(game.result, 'b') }],
        )
        const applied = await admin.rpc('apply_human_result', {
            p_game: game.id,
            p_white_rating: nextWhite.rating, p_white_rd: nextWhite.rd, p_white_vol: nextWhite.vol, p_white_games: white.human_games,
            p_black_rating: nextBlack.rating, p_black_rd: nextBlack.rd, p_black_vol: nextBlack.vol, p_black_games: black.human_games,
        })
        if (!applied.error) {
            const saved = await loadProfile(admin, userId)
            return ratingOf(applied.data as RecordRow, userId, saved, 'human')
        }
        if (!/retry/i.test(applied.error.message)) throw new Error(applied.error.message)
    }
    throw new Error('Rating could not be saved.')
}

async function rateEngine(admin: SupabaseClient, userId: string, recordId: string, color: 'w' | 'b', difficulty: number, played: { moves: string[]; result: string; reason: string }) {
    const opponent = ENGINE_RATINGS[difficulty]
    for (let attempt = 0; attempt < 4; attempt++) {
        const player = await loadProfile(admin, userId)
        const current: Glicko = { rating: player.engine_rating, rd: player.engine_rd, vol: player.engine_vol }
        const next = updateGlicko(current, [{ rating: opponent, rd: 60, score: score(played.result, color) }])
        const applied = await admin.rpc('apply_engine_result', {
            p_record: recordId, p_user: userId, p_color: color, p_result: played.result, p_reason: played.reason,
            p_moves: played.moves, p_difficulty: difficulty, p_rating: next.rating, p_rd: next.rd, p_vol: next.vol,
            p_games: player.engine_games, p_before: player.engine_rating, p_opponent: opponent,
        })
        if (!applied.error) return ratingOf(applied.data as RecordRow, userId, { ...player, engine_rd: next.rd }, 'engine')
        if (!/retry/i.test(applied.error.message)) throw new Error(applied.error.message)
    }
    throw new Error('Rating could not be saved.')
}

Deno.serve(async req => {
    const origin = req.headers.get('Origin') || ''
    const headers = {
        'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'null',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
    }
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })
    if (origin && !allowedOrigins.includes(origin)) return reply({ error: 'Origin not allowed.' }, 403)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return reply({ error: 'Sign in to play online.' }, 401)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return reply({ error: 'Sign in to play online.' }, 401)
    try {
        const reader = req.body?.getReader()
        if (!reader) return reply({ error: 'Missing request body.' }, 400)
        const chunks: Uint8Array[] = []; let length = 0
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            length += value.byteLength
            if (length > 32768) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413) }
            chunks.push(value)
        }
        const bytes = new Uint8Array(length); let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        const input = JSON.parse(new TextDecoder().decode(bytes))
        if (!input || typeof input !== 'object') return reply({ error: 'Invalid request.' }, 400)
        if (input.action !== 'record' && length > 2048) return reply({ error: 'Request too large.' }, 413)
        await ensureProfile(admin, user)
        let response
        let rating = null
        if (input.action === 'create') response = await admin.rpc('create_game', { p_user: user.id, p_minutes: minutesOf(input.minutes) })
        else if (input.action === 'seek') response = await admin.rpc('seek_game', { p_user: user.id, p_minutes: minutesOf(input.minutes) })
        else if (input.action === 'record') {
            if (typeof input.id !== 'string' || !uuid.test(input.id)) return reply({ error: 'Invalid game.' }, 400)
            if (input.color !== 'w' && input.color !== 'b') return reply({ error: 'Invalid game.' }, 400)
            if (!Object.hasOwn(ENGINE_RATINGS, input.difficulty)) return reply({ error: 'Unknown difficulty.' }, 400)
            const played = replayGame(input.moves, input.color, input.resign === true)
            rating = await rateEngine(admin, user.id, input.id, input.color, input.difficulty, played)
            return reply({ game: null, rating })
        } else {
            if (typeof input.id !== 'string' || !uuid.test(input.id)) return reply({ error: 'Invalid game invitation.' }, 400)
            if (input.action === 'join') response = await admin.rpc('join_game', { p_id: input.id, p_user: user.id })
            else if (input.action === 'move') {
                if (!Number.isInteger(input.version) || !/^[a-h][1-8]$/.test(input.from) || !/^[a-h][1-8]$/.test(input.to) || (input.promotion && !/^[qrbn]$/.test(input.promotion))) return reply({ error: 'Invalid move.' }, 400)
                const { data: game, error } = await admin.from('games').select('*').eq('id', input.id).single()
                if (error || !game) return reply({ error: 'Game unavailable.' }, 404)
                const accepted = validateMove(game, user.id, input)
                response = await admin.rpc('commit_move', { p_id: input.id, p_user: user.id, p_version: input.version, p_move: accepted.move, p_fen: accepted.fen, p_result: accepted.result })
            } else if (input.action === 'heartbeat') response = await admin.rpc('touch_game', { p_id: input.id, p_user: user.id })
            else if (input.action === 'resign' || input.action === 'quit') response = await admin.rpc(input.action === 'resign' ? 'resign_game' : 'quit_game', { p_id: input.id, p_user: user.id })
            else if (input.action === 'draw') response = await admin.rpc('offer_draw', { p_id: input.id, p_user: user.id })
            else if (input.action === 'draw-answer') response = await admin.rpc('answer_draw', { p_id: input.id, p_user: user.id, p_accept: input.accept === true })
            else return reply({ error: 'Unknown action.' }, 400)
        }
        if (response.error) return reply({ error: response.error.code === 'P0001' ? response.error.message : 'Game could not be saved.' }, 409)
        const game = response.data as GameRow | null
        if (game?.status === 'finished') {
            try { rating = await rateHuman(admin, game, user.id) } catch { rating = null }
        }
        return reply({ game, rating })
    } catch (error) {
        return reply({ error: error instanceof Error ? error.message : 'Invalid request.' }, 400)
    }
})
