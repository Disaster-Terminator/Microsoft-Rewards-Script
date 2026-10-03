const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Login } = require('../../dist/browser/auth/Login.js')

function fixture() {
    const clicks = []
    const login = new Login({
        isMobile: false,
        logger: { info() {}, warn() {}, debug() {}, error() {} },
        browser: {
            utils: {
                ghostClick: async (_, selector) => {
                    clicks.push(selector)
                    return true
                }
            }
        }
    })
    login.waitForIdle = async () => {}
    login.checkSelector = async () => false
    login.clickSignInMethodOption = async (_, option) => {
        clicks.push(option.index)
        return true
    }
    login.getSignInMethodOptions = async () => [
        { index: 0, label: 'Approve sign-in request', signature: 'phoneappnotification' },
        { index: 1, label: 'Enter an authenticator code', signature: 'phoneappotp' }
    ]
    return { login, clicks }
}

test('configured TOTP selects code verification instead of push approval', async () => {
    const { login, clicks } = fixture()
    assert.equal(await login.handleState('SIGN_IN_METHOD_PICKER', {}, { totpSecret: 'test' }), true)
    assert.deepEqual(clicks, [1])
})

test('modern authenticator-code SVG is recognized without relying on translated text', () => {
    const { login } = fixture()
    assert.equal(
        login.classifySignInMethod({
            label: '验证码',
            signature: 'data-testid=tile d=m8.25 9c.97 0 1.75.78 1.75 1.75v9.5'
        }),
        'TOTP'
    )
})

test('without a TOTP secret the offered push method remains available', async () => {
    const { login, clicks } = fixture()
    login.checkSelector = async (_, selector) => selector.includes('deviceShield')
    assert.equal(await login.handleState('SIGN_IN_METHOD_PICKER', {}, {}), true)
    assert.deepEqual(clicks, [0])
})

test('alternative verification is tried once so missing TOTP does not loop', async () => {
    const { login, clicks } = fixture()
    login.checkSelector = async () => true
    let approvals = 0
    login.passwordlessLogin.handle = async () => {
        approvals++
    }
    await login.handleState('LOGIN_PASSWORDLESS', {}, { totpSecret: 'test' })
    await login.handleState('LOGIN_PASSWORDLESS', {}, { totpSecret: 'test' })
    assert.equal(clicks.length, 1)
    assert.equal(approvals, 1)
})
