require('ts-node/register')

const assert = require('node:assert/strict')

const axiosPath = require.resolve('axios')
const originalAxios = require(axiosPath)
const requests = []

require.cache[axiosPath].exports = async request => {
    requests.push(request.url)
    if (request.url.includes('chrome-for-testing')) {
        throw new Error('read ECONNRESET')
    }
    if (request.url.includes('edgeupdates')) {
        return {
            data: [
                {
                    Product: 'Stable',
                    Releases: [
                        { Platform: 'Android', ProductVersion: '149.0.4022.67' },
                        { Platform: 'Windows', Architecture: 'x64', ProductVersion: '149.0.4022.69' }
                    ]
                }
            ]
        }
    }
    throw new Error(`unexpected URL: ${request.url}`)
}

const { UserAgentManager } = require('../../src/browser/UserAgent')

function createBot() {
    const errors = []
    const warnings = []
    return {
        logger: {
            error: (_isMobile, scope, message) => errors.push({ scope, message }),
            warn: (_isMobile, scope, message) => warnings.push({ scope, message })
        },
        errors,
        warnings
    }
}

async function main() {
    try {
        const bot = createBot()
        const manager = new UserAgentManager(bot)

        const components = await manager.getAppComponents(true)

        assert.equal(components.edge_version, '149.0.4022.67')
        assert.equal(components.chrome_major_version, '149')
        assert.equal(components.chrome_reduced_version, '149.0.0.0')
        assert.equal(bot.errors.length, 1)
        assert.equal(bot.errors[0].scope, 'USERAGENT-CHROME-VERSION')
        assert.ok(bot.warnings.some(item => item.scope === 'USERAGENT-CHROME-VERSION-FALLBACK'))
        assert.deepEqual(requests, [
            'https://edgeupdates.microsoft.com/api/products',
            'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
        ])
    } finally {
        require.cache[axiosPath].exports = originalAxios
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
