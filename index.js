const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');

// Constants
const BINANCE_API_URL = "https://api.binance.com";
const ORDER_ENDPOINT = "/api/v3/order";
const EXCHANGE_INFO_ENDPOINT = "/api/v3/exchangeInfo";
const ACCOUNT_ENDPOINT = '/api/v3/account';
const ALL_ORDERS_ENDPOINT = '/api/v3/allOrders';
const MY_TRADES_ENDPOINT = '/api/v3/myTrades';
const HISTORY_LIMIT = 20;

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];

// Express app setup
const app = express();

// Loopback binding alone does not stop other web pages (cross-site form posts,
// DNS rebinding) from reaching this server through the owner's browser
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isForeignOrigin = origin && !ALLOWED_HOSTS.some((host) => origin === `http://${host}`);
    const isStateChanging = req.method !== 'GET' && req.method !== 'HEAD';

    if (!ALLOWED_HOSTS.includes(req.headers.host) || (isStateChanging && isForeignOrigin)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// .env is optional; variables already set in the shell take precedence
try {
    process.loadEnvFile();
} catch (error) {
    if (error.code !== 'ENOENT') {
        throw error;
    }
}

// Configuration
const config = {
    apiKey: process.env.BINANCE_API_KEY,
    secretKey: process.env.BINANCE_SECRET_KEY
};

// Create signature
const createSignature = (queryString, secretKey) => {
    return crypto
        .createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
};

async function signedRequest(method, endpoint, params) {
    if (!config.apiKey || !config.secretKey) {
        throw new Error('Binance API keys are not configured (BINANCE_API_KEY, BINANCE_SECRET_KEY)');
    }

    try {
        const timestamp = Date.now();
        const queryString = new URLSearchParams({
            ...params,
            timestamp
        }).toString();

        const signature = createSignature(queryString, config.secretKey);

        const response = await axios({
            method,
            url: `${BINANCE_API_URL}${endpoint}?${queryString}&signature=${signature}`,
            headers: {
                'X-MBX-APIKEY': config.apiKey
            }
        });

        return response.data;

    } catch (error) {
        throw error.response?.data || error;
    }
}

async function placeBinanceOrder(orderParams) {
    return signedRequest('POST', ORDER_ENDPOINT, orderParams);
}

async function getAccountBalances() {
    const account = await signedRequest('GET', ACCOUNT_ENDPOINT, { recvWindow: 20000 });
    return account.balances
        .filter(({ free, locked }) => Number(free) > 0 || Number(locked) > 0)
        .map(({ asset, free, locked }) => ({ asset, free, locked }))
        .sort((a, b) => a.asset.localeCompare(b.asset));
}

// Without orderId/fromId, Binance returns the most recent entries oldest first
async function getOrderHistory(symbol) {
    const params = { symbol, limit: HISTORY_LIMIT, recvWindow: 20000 };
    const [orders, trades] = await Promise.all([
        signedRequest('GET', ALL_ORDERS_ENDPOINT, params),
        signedRequest('GET', MY_TRADES_ENDPOINT, params)
    ]);

    return {
        orders: orders.reverse().map(({ orderId, time, side, type, status, price, origQty, executedQty }) => (
            { orderId, time, side, type, status, price, origQty, executedQty }
        )),
        trades: trades.reverse().map(({ id, orderId, time, isBuyer, price, qty, quoteQty, commission, commissionAsset }) => (
            { id, orderId, time, side: isBuyer ? 'BUY' : 'SELL', price, qty, quoteQty, commission, commissionAsset }
        ))
    };
}

// Get symbol information
async function getSymbolInfo(symbol) {
    try {
        const response = await axios.get(`${BINANCE_API_URL}${EXCHANGE_INFO_ENDPOINT}`);
        const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);
        
        if (!symbolInfo) {
            throw new Error('Symbol not found');
        }

        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');

        return {
            quantityPrecision: getDecimalPrecision(lotSizeFilter.stepSize),
            pricePrecision: getDecimalPrecision(priceFilter.tickSize),
            minQty: lotSizeFilter.minQty,
            maxQty: lotSizeFilter.maxQty,
            minPrice: priceFilter.minPrice,
            maxPrice: priceFilter.maxPrice,
            tickSize: priceFilter.tickSize
        };
    } catch (error) {
        throw error;
    }
}

// Helper function to get decimal precision
function getDecimalPrecision(stepSize) {
    const decimalIndex = stepSize.indexOf('1') - 1;
    return Math.abs(decimalIndex);
}

// Binance rejects MARKET orders that carry price or timeInForce
function buildOrderParams(body) {
    if (body.type !== 'LIMIT' && body.type !== 'MARKET') {
        throw new Error('Order type must be LIMIT or MARKET');
    }
    const symbol = parseSymbol(body.symbol);
    if (body.side !== 'BUY' && body.side !== 'SELL') {
        throw new Error('Side must be BUY or SELL');
    }
    if (body.type === 'LIMIT' && !['GTC', 'IOC', 'FOK'].includes(body.timeInForce)) {
        throw new Error('Time in force must be GTC, IOC, or FOK');
    }

    const orderParams = {
        symbol,
        side: body.side,
        type: body.type,
        quantity: parsePositiveDecimal(body.quantity, 'Quantity'),
        recvWindow: 20000
    };

    if (body.type === 'LIMIT') {
        orderParams.timeInForce = body.timeInForce;
        orderParams.price = parsePositiveDecimal(body.price, 'Price');
    }

    return orderParams;
}

function parseSymbol(value) {
    if (typeof value !== 'string' || !/^[A-Z0-9]{1,20}$/.test(value)) {
        throw new Error('Symbol must be 1-20 uppercase letters or digits, e.g. BTCUSDT');
    }
    return value;
}

// Returns the string as typed: converting to a Number would send tiny values as `1e-7`, which Binance rejects
function parsePositiveDecimal(value, label) {
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) {
        throw new Error(`${label} must be a plain decimal number greater than 0, e.g. 0.001`);
    }
    return value;
}

// Binance error bodies carry `msg`; non-JSON failures (e.g. an HTML 5xx page) carry neither
function errorMessage(error) {
    return error.msg || error.message || 'Binance request failed';
}

// Express routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.post('/place-order', async (req, res) => {
    try {
        const result = await placeBinanceOrder(buildOrderParams(req.body));
        res.json({ success: true, data: result });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/symbol-info/:symbol', async (req, res) => {
    try {
        const symbolInfo = await getSymbolInfo(req.params.symbol);
        res.json({ success: true, data: symbolInfo });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/balances', async (req, res) => {
    try {
        const balances = await getAccountBalances();
        res.json({ success: true, data: balances });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/order-history/:symbol', async (req, res) => {
    try {
        const history = await getOrderHistory(parseSymbol(req.params.symbol));
        res.json({ success: true, data: history });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
