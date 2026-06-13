require('ts-node/register')

const assert = require('node:assert/strict')
const { Login } = require('../../src/browser/auth/Login')

function createBot() {
    const noop = () => {}

    return {
        isMobile: false,
        logger: {
            debug: noop,
            info: noop,
            warn: noop,
            error: noop
        },
        utils: {
            wait: async () => {}
        },
        browser: {
            utils: {
                ghostClick: async () => {}
            }
        },
        config: {
            baseURL: 'https://rewards.bing.com'
        }
    }
}

function createPage(url, options = {}) {
    return {
        url: () => url,
        waitForLoadState: async () => {},
        waitForSelector: async selector => {
            if (options.signInAnotherWaySelector && selector === options.signInAnotherWaySelector) {
                return {
                    click: async () => {
                        options.clicked.push(selector)
                    }
                }
            }
            throw new Error('not visible')
        }
    }
}

async function main() {
    const login = new Login(createBot())

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
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
