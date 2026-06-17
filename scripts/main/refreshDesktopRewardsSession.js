import fs from 'fs'
import path from 'path'
import { chromium } from 'patchright'
import { newInjectedContext } from 'fingerprint-injector'
import {
    getDirname,
    getProjectRoot,
    log,
    parseArgs,
    loadConfig,
    loadAccounts,
    findAccountByEmail,
    getRuntimeBase,
    getSessionPath,
    loadCookies,
    loadFingerprint,
    buildProxyConfig,
    setupCleanupHandlers
} from '../utils.js'

const __dirname = getDirname(import.meta.url)
const projectRoot = getProjectRoot(__dirname)

const args = parseArgs()
args.dev = args.dev || false

const { data: config } = loadConfig(projectRoot, args.dev)
const { data: accounts } = loadAccounts(projectRoot, args.dev)

const account = args.email ? findAccountByEmail(accounts, args.email) : accounts[Number(args.index || 0)]
if (!account?.email) {
    log('ERROR', 'Account not found. Use -email or -index.')
    process.exit(1)
}

function maskEmail(email) {
    const [name, domain] = String(email).split('@')
    if (!name || !domain) return '<redacted>'
    return `${name.slice(0, 2)}***@${domain}`
}

async function visibleCount(locator) {
    const count = await locator.count()
    let visible = 0
    for (let i = 0; i < count; i++) {
        if (await locator.nth(i).isVisible().catch(() => false)) visible++
    }
    return visible
}

async function findSignIn(page) {
    const candidates = [
        page.getByRole('link', { name: /^sign in$/i }),
        page.getByRole('button', { name: /^sign in$/i }),
        page.locator('a,button,[role="button"]', { hasText: /^Sign in$/i }),
        page.locator('text=/^Sign in$/i')
    ]

    for (const locator of candidates) {
        if ((await visibleCount(locator)) > 0) return locator.first()
    }

    return null
}

async function waitForRewardsSession(page, timeoutMs) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
        const url = page.url()
        const signIn = await findSignIn(page)
        const passwordInputs = await visibleCount(page.locator('input[type="password"]'))
        const onRewards = /^https:\/\/rewards\.bing\.com/i.test(url)

        if (onRewards && !signIn) {
            return { ok: true, reason: 'rewards-session-attached' }
        }

        if (passwordInputs > 0) {
            return { ok: false, reason: 'password-page' }
        }

        if (/\/login\.srf|\/oauth20_authorize\.srf|\/consumers\/fido\//i.test(url)) {
            log('INFO', 'Waiting for Microsoft auth redirect to settle...')
        }

        await page.waitForTimeout(2000)
    }

    return { ok: false, reason: 'timeout' }
}

async function saveDesktopCookies(context, sessionBase) {
    const sessionFile = path.join(sessionBase, 'session_desktop.json')
    const cookies = await context.cookies()

    if (fs.existsSync(sessionFile)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await fs.promises.copyFile(sessionFile, `${sessionFile}.bak-${stamp}`)
    }

    await fs.promises.mkdir(sessionBase, { recursive: true })
    await fs.promises.writeFile(sessionFile, JSON.stringify(cookies))
    return cookies.length
}

async function captureDiagnostic(page, reason) {
    const dir = path.join(projectRoot, 'diagnostics')
    await fs.promises.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const screenshot = path.join(dir, `refresh-desktop-${reason}-${stamp}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    return screenshot
}

let browser

async function main() {
    const runtimeBase = getRuntimeBase(projectRoot, args.dev)
    const sessionBase = getSessionPath(runtimeBase, config.sessionPath, account.email)
    const cookies = await loadCookies(sessionBase, 'desktop')

    if (cookies.length === 0) {
        log('ERROR', 'No desktop session cookies found; refusing to enter password flow.')
        process.exit(1)
    }

    const fingerprintEnabled = account.saveFingerprint?.desktop
    const fingerprint = fingerprintEnabled ? await loadFingerprint(sessionBase, 'desktop') : null
    if (fingerprintEnabled && !fingerprint) {
        log('ERROR', 'Desktop fingerprint is enabled but missing; refusing to change browser identity.')
        process.exit(1)
    }

    const proxy = buildProxyConfig(account)
    browser = await chromium.launch({
        headless: false,
        ...(proxy ? { proxy } : {}),
        args: [
            '--no-sandbox',
            '--mute-audio',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--ignore-ssl-errors',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-user-media-security=true',
            '--disable-blink-features=Attestation',
            '--disable-features=WebAuthentication,PasswordManagerOnboarding,PasswordManager,EnablePasswordsAccountStorage,Passkeys',
            '--disable-save-password-bubble'
        ]
    })

    let context
    if (fingerprint) {
        context = await newInjectedContext(browser, { fingerprint })
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'credentials', {
                value: {
                    create: () => Promise.reject(new Error('WebAuthn disabled')),
                    get: () => Promise.reject(new Error('WebAuthn disabled'))
                }
            })
        })
    } else {
        context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    }

    await context.addCookies(cookies)

    const page = await context.newPage()
    log('INFO', `Refreshing desktop Rewards session for ${maskEmail(account.email)}`)
    await page.goto(config.baseURL || 'https://rewards.bing.com', { waitUntil: 'domcontentloaded' })

    const signIn = await findSignIn(page)
    if (signIn) {
        log('INFO', 'Rewards page Sign in control found; clicking silent SSO entrypoint.')
        await Promise.all([
            page.waitForLoadState('domcontentloaded').catch(() => undefined),
            signIn.click({ timeout: 10000 })
        ])
    } else {
        log('INFO', 'No Rewards Sign in control visible; checking whether session is already attached.')
    }

    const result = await waitForRewardsSession(page, Number(args.timeout || 300000))
    if (!result.ok) {
        const screenshot = await captureDiagnostic(page, result.reason)
        log('ERROR', `Rewards session was not attached (${result.reason}). No cookies saved.`)
        log('ERROR', `Diagnostic screenshot: ${screenshot}`)
        log('ERROR', 'The diagnostic only validates silent SSO; it does not enter passwords.')
        process.exitCode = 2
        await browser.close()
        return
    }

    const count = await saveDesktopCookies(context, sessionBase)
    log('SUCCESS', `Saved refreshed desktop cookies (${count})`)

    if (!args.keepOpen) {
        await browser.close()
    } else {
        log('INFO', 'Browser left open because -keepOpen was set.')
    }
}

setupCleanupHandlers(async () => {
    if (browser?.isConnected?.()) {
        await browser.close()
    }
})
main().catch(error => {
    log('ERROR', error?.message || String(error))
    process.exit(1)
})
