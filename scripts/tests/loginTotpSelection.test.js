/* global document */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from 'patchright'
import loginModule from '../../dist/browser/auth/Login.js'

const { Login } = loginModule
const fixture = await readFile(new URL('./fixtures/modernSignInMethods.html', import.meta.url), 'utf8')
let browser

before(async () => {
    browser = await chromium.launch({ headless: true })
})

after(async () => {
    await browser?.close()
})

async function withPicker(run) {
    const context = await browser.newContext({ offline: true })
    const page = await context.newPage()
    await page.setContent(fixture)
    const login = new Login({
        isMobile: false,
        logger: { info() {}, warn() {}, debug() {}, error() {} },
        browser: {
            utils: {
                ghostClick: async (target, selector) => {
                    await target.locator(selector).click()
                    return true
                }
            }
        }
    })
    // These fixtures do not navigate. Keep selector checks immediate; exercise real option extraction,
    // classification, method selection and DOM clicks without Microsoft or account credentials.
    login.waitForIdle = async () => {}
    login.checkSelector = async (target, selector) => target.locator(selector).first().isVisible()
    try {
        await run(login, page)
    } finally {
        await context.close()
    }
}

test('extracts the modern TOTP SVG and classifies it with a translated label', async () => {
    await withPicker(async (login, page) => {
        await page
            .locator('[data-testid="tile"]')
            .nth(1)
            .evaluate(tile => {
                tile.lastChild.textContent = '输入验证器代码'
            })
        const options = await login.getSignInMethodOptions(page)
        assert.equal(options.length, 2)
        assert.match(options[1].label, /输入验证器代码/)
        assert.deepEqual(
            options.map(option => login.classifySignInMethod(option)),
            ['AUTHENTICATOR', 'TOTP']
        )
    })
})

test('configured TOTP advances from the picker to the existing TOTP handler', async () => {
    await withPicker(async (login, page) => {
        const account = { totpSecret: 'test-only' }
        let totpHandled = false
        login.totp2FALogin.handle = async (target, secret) => {
            assert.equal(target, page)
            assert.equal(secret, account.totpSecret)
            totpHandled = true
        }

        assert.equal(await login.detectCurrentState(page), 'SIGN_IN_METHOD_PICKER')
        assert.equal(await login.handleState('SIGN_IN_METHOD_PICKER', page, account), true)
        assert.equal(await page.locator('body').getAttribute('data-selected'), 'totp')
        assert.equal(await page.locator('input[name="otc"]').isVisible(), true)
        const nextState = await login.detectCurrentState(page)
        assert.equal(nextState, '2FA_TOTP')
        assert.equal(await login.handleState(nextState, page, account), true)
        assert.equal(totpHandled, true)
    })
})

test('without a configured secret the offered push method remains selected', async () => {
    await withPicker(async (login, page) => {
        assert.equal(await login.handleState('SIGN_IN_METHOD_PICKER', page, {}), true)
        assert.equal(await page.locator('body').getAttribute('data-selected'), 'push')
    })
})

test('a configured secret does not invent a TOTP option when Microsoft offers only push', async () => {
    await withPicker(async (login, page) => {
        await page
            .locator('[data-testid="tile"]')
            .nth(1)
            .evaluate(tile => tile.remove())
        assert.equal(await login.handleState('SIGN_IN_METHOD_PICKER', page, { totpSecret: 'test-only' }), true)
        assert.equal(await page.locator('body').getAttribute('data-selected'), 'push')
    })
})

test('an offered password retains precedence when password and TOTP are both configured', async () => {
    await withPicker(async (login, page) => {
        await page.locator('body').evaluate(body => {
            const tile = document.createElement('button')
            tile.dataset.testid = 'tile'
            tile.innerHTML = '<svg><path d="m11.78 10.22a.75.75 0 0 1 1.06 0"/></svg>Use your password'
            tile.onclick = () => {
                body.dataset.selected = 'password'
            }
            body.appendChild(tile)
        })
        assert.equal(
            await login.handleState('SIGN_IN_METHOD_PICKER', page, { password: 'test-only', totpSecret: 'test-only' }),
            true
        )
        assert.equal(await page.locator('body').getAttribute('data-selected'), 'password')
    })
})

test('a failed code-tile click does not claim successful selection or send a push request', async () => {
    await withPicker(async (login, page) => {
        login.clickSignInMethodOption = async () => false
        assert.equal(await login.handleState('SIGN_IN_METHOD_PICKER', page, { totpSecret: 'test-only' }), false)
        assert.equal(await page.locator('body').getAttribute('data-selected'), null)
    })
})
