const Browser = require('../../dist/browser/Browser').default
const BrowserUtils = require('../../dist/browser/BrowserUtils').default
const Utils = require('../../dist/util/Utils').default
const { Login } = require('../../dist/browser/auth/Login')

const config = require('../../dist/config.json')
const accounts = require('../../dist/accounts.json')

function parseArgs(argv = process.argv.slice(2)) {
    const args = {}
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg.startsWith('-')) continue
        const key = arg.slice(1)
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
            args[key] = argv[++i]
        } else {
            args[key] = true
        }
    }
    return args
}

function maskEmail(email) {
    const [name, domain] = String(email).split('@')
    if (!name || !domain) return '<email>'
    return `${name.slice(0, 2)}***@${domain}`
}

function createLogger() {
    const write = level => (isMobile, scope, message) => {
        const channel = typeof isMobile === 'boolean' ? (isMobile ? 'MOBILE' : 'DESKTOP') : String(isMobile).toUpperCase()
        console.log(`[${level}] ${channel} [${scope}] ${String(message).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>')}`)
    }

    return {
        debug: write('DEBUG'),
        info: write('INFO'),
        warn: write('WARN'),
        error: write('ERROR')
    }
}

async function main() {
    const args = parseArgs()
    const account = args.email
        ? accounts.find(candidate => candidate.email?.toLowerCase() === String(args.email).toLowerCase())
        : accounts[Number(args.index || 0)]

    if (!account?.email) {
        console.error('[ERROR] Account not found. Use -email or -index.')
        process.exit(1)
    }

    const bot = {
        isMobile: false,
        config: {
            ...config,
            headless: !args.headed
        },
        requestToken: '',
        cookies: { mobile: [], desktop: [] },
        logger: createLogger(),
        utils: new Utils()
    }

    bot.browser = {
        utils: new BrowserUtils(bot)
    }

    const browserFactory = new Browser(bot)
    const login = new Login(bot)

    console.log(`[INFO] Verifying desktop login for ${maskEmail(account.email)} | headless=${bot.config.headless}`)

    const session = await browserFactory.createBrowser(account)
    const page = await session.context.newPage()

    try {
        await login.login(page, account)
        console.log('[SUCCESS] Desktop login completed')
    } finally {
        await session.context.close().catch(() => {})
    }

    process.exit(0)
}

main().catch(error => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
})
