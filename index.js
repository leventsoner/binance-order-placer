const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');

// Constants
const BINANCE_API_URL = "https://api.binance.com";
const ORDER_ENDPOINT = "/api/v3/order";
const EXCHANGE_INFO_ENDPOINT = "/api/v3/exchangeInfo";

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

// Place order function
async function placeBinanceOrder(orderParams) {
    try {
        const timestamp = Date.now();
        const queryString = Object.entries({
            ...orderParams,
            timestamp
        })
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

        const signature = createSignature(queryString, config.secretKey);

        const response = await axios({
            method: 'POST',
            url: `${BINANCE_API_URL}${ORDER_ENDPOINT}?${queryString}&signature=${signature}`,
            headers: {
                'X-MBX-APIKEY': config.apiKey
            }
        });

        return response.data;

    } catch (error) {
        throw error.response?.data || error;
    }
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

    const orderParams = {
        symbol: body.symbol,
        side: body.side,
        type: body.type,
        quantity: parsePositiveNumber(body.quantity, 'Quantity'),
        recvWindow: 20000
    };

    if (body.type === 'LIMIT') {
        orderParams.timeInForce = body.timeInForce;
        orderParams.price = parsePositiveNumber(body.price, 'Price');
    }

    return orderParams;
}

function parsePositiveNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`${label} must be a number greater than 0`);
    }
    return number;
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

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
