// Mark Glickman's Glicko-2, one rating period at a time. τ = 0.5 is the example value from the paper.
const SCALE = 173.7178
export type Glicko = { rating: number; rd: number; vol: number }
export type Contest = { rating: number; rd: number; score: number }

function g(phi: number) {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function expectation(mu: number, muJ: number, phiJ: number) {
    return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

export function updateGlicko(player: Glicko, games: Contest[], tau = 0.5): Glicko {
    if (!games.length) return { ...player }
    const mu = (player.rating - 1500) / SCALE
    const phi = player.rd / SCALE
    const opponents = games.map(game => ({
        mu: (game.rating - 1500) / SCALE,
        phi: game.rd / SCALE,
        score: game.score,
    }))
    const variance = 1 / opponents.reduce((sum, game) => {
        const e = expectation(mu, game.mu, game.phi)
        return sum + g(game.phi) ** 2 * e * (1 - e)
    }, 0)
    const delta = variance * opponents.reduce((sum, game) => sum + g(game.phi) * (game.score - expectation(mu, game.mu, game.phi)), 0)
    const a = Math.log(player.vol ** 2)
    const f = (x: number) => {
        const expX = Math.exp(x)
        const base = phi ** 2 + variance + expX
        return (expX * (delta ** 2 - phi ** 2 - variance - expX)) / (2 * base ** 2) - (x - a) / tau ** 2
    }
    let A = a
    let B: number
    if (delta ** 2 > phi ** 2 + variance) B = Math.log(delta ** 2 - phi ** 2 - variance)
    else {
        let k = 1
        while (f(a - k * tau) < 0 && k < 100) k += 1
        B = a - k * tau
    }
    let fA = f(A)
    let fB = f(B)
    while (Math.abs(B - A) > 0.000001) {
        const C = A + ((A - B) * fA) / (fB - fA)
        const fC = f(C)
        if (fC * fB < 0) { A = B; fA = fB } else fA /= 2
        B = C
        fB = fC
    }
    const vol = Math.exp(A / 2)
    const phiStar = 1 / Math.sqrt(1 / phi ** 2 + 1 / variance)
    const phiNext = Math.sqrt(phiStar ** 2 + vol ** 2)
    const muNext = mu + phiNext ** 2 * opponents.reduce((sum, game) => sum + g(game.phi) * (game.score - expectation(mu, game.mu, game.phi)), 0)
    return {
        rating: SCALE * muNext + 1500,
        rd: Math.min(350, Math.max(30, SCALE * phiNext)),
        vol,
    }
}
