require('ts-node/register')

const assert = require('node:assert/strict')
const BrowserFunc = require('../../src/browser/BrowserFunc').default
const { ClaimBonusPoints } = require('../../src/functions/activities/api/ClaimBonusPoints')

function createBot() {
    const warnings = []
    const requests = []

    return {
        isMobile: true,
        requestToken: '',
        rewardsVersion: 'modern',
        userData: {
            currentPoints: 0,
            geoLocale: 'cn',
            timezoneOffset: '480'
        },
        cookies: {
            mobile: [],
            desktop: []
        },
        fingerprint: {
            headers: {}
        },
        logger: {
            debug: () => {},
            info: () => {},
            warn: (_isMobile, scope, message) => warnings.push({ scope, message }),
            error: () => {}
        },
        browser: {
            func: {
                buildCookieHeader: () => '',
                getCurrentPoints: async () => 0
            }
        },
        axios: {
            request: async request => {
                requests.push(request)
                throw new Error('request should not be sent without a token')
            }
        },
        requests,
        warnings
    }
}

async function main() {
    const claimBot = createBot()
    await new ClaimBonusPoints(claimBot).claimBonusPoints()

    assert.equal(claimBot.requests.length, 0)
    assert.deepEqual(claimBot.warnings, [
        {
            scope: 'CLAIM-BONUS-POINTS',
            message: 'Skipping: Request token not available, this activity requires it!'
        }
    ])

    const streakBot = createBot()
    await new BrowserFunc(streakBot).ensureStreakProtection()

    assert.equal(streakBot.requests.length, 0)
    assert.deepEqual(streakBot.warnings, [
        {
            scope: 'ENABLE-STREAK-PROTECTION',
            message: 'Skipping: Request token not available, this action requires it!'
        }
    ])
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
