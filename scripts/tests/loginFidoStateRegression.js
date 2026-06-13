require('ts-node/register')

const assert = require('node:assert/strict')
const { Login } = require('../../src/browser/auth/Login')

function createBot() {
    const noop = () => {}
    const warnings = []

    return {
        isMobile: false,
        logger: {
            debug: noop,
            info: noop,
            warn: (_isMobile, _scope, message) => warnings.push(message),
            error: noop
        },
        utils: {
            wait: async () => {}
        },
        browser: {
            utils: {
                ghostClick: async () => {},
                tryDismissAllMessages: async () => {},
                loadInCheerio: async html => {
                    const cheerio = require('cheerio')
                    return cheerio.load(html)
                }
            }
        },
        config: {
            baseURL: 'https://rewards.bing.com'
        },
        rewardsVersion: 'legacy',
        warnings
    }
}

function createPage(url, options = {}) {
    let currentUrl = url

    return {
        url: () => currentUrl,
        goto: async target => {
            if (options.gotoUrl) {
                currentUrl = options.gotoUrl
            } else {
                currentUrl = target
            }
        },
        content: async () => options.html || '',
        waitForLoadState: async () => {},
        waitForSelector: async selector => {
            if (options.signInAnotherWaySelector && selector === options.signInAnotherWaySelector) {
                return {
                    click: async () => {
                        options.clicked.push(selector)
                    }
                }
            }
            if (options.visibleSelectors?.includes(selector)) {
                return {}
            }
            throw new Error('not visible')
        },
        isClosed: () => false
    }
}

async function main() {
    const bot = createBot()
    const login = new Login(bot)

    const state = await login.detectCurrentState(
        createPage('https://login.microsoft.com/consumers/fido/get'),
        { password: 'configured' }
    )

    assert.equal(state, 'PASSKEY_ERROR')

    const clicked = []
    await login.handleState(
        'PASSKEY_ERROR',
        createPage('https://login.microsoft.com/consumers/fido/get', {
            signInAnotherWaySelector: 'a:has-text("Sign in another way"), a:has-text("sign in another way")',
            clicked
        }),
        {}
    )

    assert.deepEqual(clicked, ['a:has-text("Sign in another way"), a:has-text("sign in another way")'])

    await login.verifyBingSession(
        createPage('https://www.bing.com/', {
            gotoUrl: 'https://cn.bing.com/',
            visibleSelectors: ['#id_n']
        })
    )
    assert.equal(bot.warnings.includes('Could not verify Bing session, continuing anyway'), false)

    await login.getRewardsSession(
        createPage('https://rewards.bing.com/about', {
            html: '<input name="__RequestVerificationToken" value="token-from-about-page">'
        })
    )
    assert.equal(bot.requestToken, 'token-from-about-page')

    const modernBot = createBot()
    const modernLogin = new Login(modernBot)
    await modernLogin.getRewardsSession(
        createPage('https://rewards.bing.com/dashboard', {
            html: '<section id="dailyset"></section>'
        })
    )
    assert.equal(modernBot.rewardsVersion, 'modern')
    assert.equal(
        modernBot.warnings.includes('No RequestVerificationToken found, some activities may not work'),
        false
    )
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
