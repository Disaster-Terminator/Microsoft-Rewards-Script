require('ts-node/register')

const assert = require('node:assert/strict')
const { QueryCore } = require('../../src/functions/QueryEngine')

function createBot() {
    const warnings = []

    return {
        isMobile: false,
        config: {
            proxy: {
                queryEngine: false
            }
        },
        fingerprint: {
            headers: {}
        },
        logger: {
            debug: () => {},
            warn: (_isMobile, scope, message) => warnings.push({ scope, message })
        },
        utils: {
            shuffleArray: array => array
        },
        axios: {
            request: () => new Promise(() => {})
        },
        warnings
    }
}

async function main() {
    const bot = createBot()
    const queryCore = new QueryCore(bot)
    queryCore.getLocalQueryList = () => ['local query one', 'local query two']

    const started = Date.now()
    const queries = await Promise.race([
        queryCore.queryManager({
            related: true,
            sourceOrder: ['local'],
            requestTimeoutMs: 5,
            relatedExpansionBudgetMs: 1,
            relatedExpansionLimit: 10
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('queryManager did not resolve before deadline')), 250))
    ])

    assert.ok(Date.now() - started < 250)
    assert.deepEqual(queries, ['local query one', 'local query two'])
    assert.ok(bot.warnings.some(item => item.scope === 'QUERY-MANAGER'))
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
