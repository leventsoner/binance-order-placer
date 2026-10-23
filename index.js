const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');

// Constants
const BINANCE_API_URL = "https://api.binance.com";
const BINANCE_TESTNET_API_URL = 'https://testnet.binance.vision';
const ORDER_ENDPOINT = "/api/v3/order";
const ORDER_LIST_OCO_ENDPOINT = '/api/v3/orderList/oco';
const ORDER_LIST_OTOCO_ENDPOINT = '/api/v3/orderList/otoco';
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

// Each mode only ever uses its own key pair; there is no fallback to the other
const MODES = {
    live: {
        baseUrl: BINANCE_API_URL,
        apiKey: process.env.BINANCE_API_KEY,
        secretKey: process.env.BINANCE_SECRET_KEY,
        keyNames: 'BINANCE_API_KEY, BINANCE_SECRET_KEY'
    },
    testnet: {
        baseUrl: BINANCE_TESTNET_API_URL,
        apiKey: process.env.BINANCE_TESTNET_API_KEY,
        secretKey: process.env.BINANCE_TESTNET_SECRET_KEY,
        keyNames: 'BINANCE_TESTNET_API_KEY, BINANCE_TESTNET_SECRET_KEY'
    }
};

// Create signature
const createSignature = (queryString, secretKey) => {
    return crypto
        .createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
};

async function signedRequest(mode, method, endpoint, params) {
    if (!mode.apiKey || !mode.secretKey) {
        throw new Error(`Binance API keys are not configured (${mode.keyNames})`);
    }

    try {
        const timestamp = Date.now();
        const queryString = new URLSearchParams({
            ...params,
            timestamp
        }).toString();

        const signature = createSignature(queryString, mode.secretKey);

        const response = await axios({
            method,
            url: `${mode.baseUrl}${endpoint}?${queryString}&signature=${signature}`,
            headers: {
                'X-MBX-APIKEY': mode.apiKey
            }
        });

        return response.data;

    } catch (error) {
        throw error.response?.data || error;
    }
}

async function getAccountBalances(mode) {
    const account = await signedRequest(mode, 'GET', ACCOUNT_ENDPOINT, { recvWindow: 20000 });
    return account.balances
        .filter(({ free, locked }) => Number(free) > 0 || Number(locked) > 0)
        .map(({ asset, free, locked }) => ({ asset, free, locked }))
        .sort((a, b) => a.asset.localeCompare(b.asset));
}

// Without orderId/fromId, Binance returns the most recent entries oldest first
async function getOrderHistory(mode, symbol) {
    const params = { symbol, limit: HISTORY_LIMIT, recvWindow: 20000 };
    const [orders, trades] = await Promise.all([
        signedRequest(mode, 'GET', ALL_ORDERS_ENDPOINT, params),
        signedRequest(mode, 'GET', MY_TRADES_ENDPOINT, params)
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

// The testnet lists its own symbols and filters, so exchange info follows the mode
async function fetchSymbol(mode, symbol) {
    const response = await axios.get(`${mode.baseUrl}${EXCHANGE_INFO_ENDPOINT}`);
    const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);

    if (!symbolInfo) {
        throw new Error('Symbol not found');
    }
    return symbolInfo;
}

// Get symbol information
async function getSymbolInfo(mode, symbol) {
    try {
        const symbolInfo = await fetchSymbol(mode, symbol);

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

// Binance rejects MARKET orders that carry price or timeInForce; only STOP_LOSS_LIMIT carries stopPrice
function buildOrderParams(body) {
    if (!['LIMIT', 'MARKET', 'STOP_LOSS_LIMIT'].includes(body.type)) {
        throw new Error('Order type must be LIMIT, MARKET, STOP_LOSS_LIMIT, or OCO');
    }
    const symbol = parseSymbol(body.symbol);
    if (body.side !== 'BUY' && body.side !== 'SELL') {
        throw new Error('Side must be BUY or SELL');
    }
    const isLimitStyle = body.type !== 'MARKET';
    if (isLimitStyle && !['GTC', 'IOC', 'FOK'].includes(body.timeInForce)) {
        throw new Error('Time in force must be GTC, IOC, or FOK');
    }

    const orderParams = {
        symbol,
        side: body.side,
        type: body.type,
        quantity: parsePositiveDecimal(body.quantity, 'Quantity'),
        recvWindow: 20000
    };

    if (isLimitStyle) {
        orderParams.timeInForce = body.timeInForce;
        orderParams.price = parsePositiveDecimal(body.price, 'Price');
    }
    if (body.type === 'STOP_LOSS_LIMIT') {
        orderParams.stopPrice = parsePositiveDecimal(body.stopPrice, 'Stop price');
    }

    return orderParams;
}

// Classic OCO: a LIMIT_MAKER take-profit leg at price and a STOP_LOSS_LIMIT leg
// triggered at stopPrice that places a limit at stopLimitPrice. A SELL takes profit
// above the market and stops below it; a BUY is the mirror image.
function buildOcoParams(body) {
    const symbol = parseSymbol(body.symbol);
    if (body.side !== 'BUY' && body.side !== 'SELL') {
        throw new Error('Side must be BUY or SELL');
    }
    if (!['GTC', 'IOC', 'FOK'].includes(body.timeInForce)) {
        throw new Error('Time in force must be GTC, IOC, or FOK');
    }
    const quantity = parsePositiveDecimal(body.quantity, 'Quantity');
    const price = parsePositiveDecimal(body.price, 'Price');
    const stopPrice = parsePositiveDecimal(body.stopPrice, 'Stop price');
    const stopLimitPrice = parsePositiveDecimal(body.stopLimitPrice, 'Stop limit price');

    const takeProfitLeg = { Type: 'LIMIT_MAKER', Price: price };
    const stopLeg = { Type: 'STOP_LOSS_LIMIT', StopPrice: stopPrice, Price: stopLimitPrice, TimeInForce: body.timeInForce };
    const [aboveLeg, belowLeg] = body.side === 'SELL' ? [takeProfitLeg, stopLeg] : [stopLeg, takeProfitLeg];

    const orderParams = { symbol, side: body.side, quantity, recvWindow: 20000 };
    Object.entries(aboveLeg).forEach(([key, value]) => { orderParams[`above${key}`] = value; });
    Object.entries(belowLeg).forEach(([key, value]) => { orderParams[`below${key}`] = value; });
    return orderParams;
}

// Exit legs for an entry: the TP is a LIMIT_MAKER and the SL is stop-market. A BUY entry exits by
// selling above (TP) or below (SL) the market; a SELL entry is the mirror image.
function tpSlLegs(entrySide, takeProfitPrice, stopLossPrice) {
    const takeProfitLeg = { Type: 'LIMIT_MAKER', Price: takeProfitPrice };
    const stopLossLeg = { Type: 'STOP_LOSS', StopPrice: stopLossPrice };
    return entrySide === 'BUY' ? [takeProfitLeg, stopLossLeg] : [stopLossLeg, takeProfitLeg];
}

// LIMIT entry with a take-profit/stop-loss OCO placed once it fully fills; the SL is stop-market
function buildOtocoParams(body) {
    const entry = buildOrderParams(body);
    const takeProfitPrice = parsePositiveDecimal(body.takeProfitPrice, 'Take-profit price');
    const stopLossPrice = parsePositiveDecimal(body.stopLossPrice, 'Stop-loss price');

    const [aboveLeg, belowLeg] = tpSlLegs(entry.side, takeProfitPrice, stopLossPrice);

    const orderParams = {
        symbol: entry.symbol,
        workingType: 'LIMIT',
        workingSide: entry.side,
        workingPrice: entry.price,
        workingQuantity: entry.quantity,
        workingTimeInForce: entry.timeInForce,
        pendingSide: entry.side === 'BUY' ? 'SELL' : 'BUY',
        pendingQuantity: entry.quantity,
        recvWindow: 20000
    };
    Object.entries(aboveLeg).forEach(([key, value]) => { orderParams[`pendingAbove${key}`] = value; });
    Object.entries(belowLeg).forEach(([key, value]) => { orderParams[`pendingBelow${key}`] = value; });
    return orderParams;
}

// An enabled but empty form input posts '', which counts as not provided
function isProvided(value) {
    return value !== undefined && value !== '';
}

// Exact decimal arithmetic on Binance's decimal strings: a value becomes a BigInt count of 10^-scale units
function decimalPlaces(value) {
    const dot = value.indexOf('.');
    return dot === -1 ? 0 : value.length - dot - 1;
}

function toUnits(value, scale) {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(scale, '0'));
}

function fromUnits(units, scale) {
    const digits = units.toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

// The filled quantity, less any BUY fee taken in the base asset, rounded down to the LOT_SIZE step;
// null when nothing is left. Binance charges SELL fees in the quote asset or BNB.
function ocoQuantity(entry, side, baseAsset, stepSize) {
    const baseFees = side === 'BUY'
        ? entry.fills.filter(f => f.commissionAsset === baseAsset).map(f => f.commission)
        : [];
    const scale = Math.max(...[entry.executedQty, stepSize, ...baseFees].map(decimalPlaces));

    let units = toUnits(entry.executedQty, scale);
    baseFees.forEach((fee) => { units -= toUnits(fee, scale); });
    units -= units % toUnits(stepSize, scale);
    return units > 0n ? fromUnits(units, scale) : null;
}

// Not atomic: the entry can fill and the OCO still be rejected. Everything that can be checked
// runs before the entry, and an entry left without its OCO is always reported, as unprotected only
// when the OCO certainly was not placed.
async function placeMarketWithTpSl(mode, body) {
    const entryParams = buildOrderParams(body);
    const takeProfitPrice = parsePositiveDecimal(body.takeProfitPrice, 'Take-profit price');
    const stopLossPrice = parsePositiveDecimal(body.stopLossPrice, 'Stop-loss price');
    const { symbol, side } = entryParams;
    const isBuy = side === 'BUY';
    if (isBuy ? Number(takeProfitPrice) <= Number(stopLossPrice) : Number(takeProfitPrice) >= Number(stopLossPrice)) {
        throw new Error(`For a ${side} order the take-profit price must be ${isBuy ? 'above' : 'below'} the stop-loss price`);
    }

    const symbolInfo = await fetchSymbol(mode, symbol);
    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    if (!lotSizeFilter) {
        throw new Error(`${symbol} has no LOT_SIZE filter, so the take-profit/stop-loss quantity cannot be calculated; no order was placed.`);
    }
    const entry = await signedRequest(mode, 'POST', ORDER_ENDPOINT, { ...entryParams, newOrderRespType: 'FULL' });
    if (Number(entry.executedQty) === 0) {
        throw new Error(`Market ${side} order ${entry.orderId} did not fill (status ${entry.status}); no take-profit or stop-loss was placed.`);
    }

    const filled = `Market ${side} order ${entry.orderId} filled ${entry.executedQty} ${symbol}`;
    const reason = (error) => errorMessage(error).replace(/\.$/, '');
    const notPlaced = (error) => new Error(`${filled}, but the take-profit/stop-loss OCO was not placed: ${reason(error)}. This position has no take-profit or stop-loss.`);

    let ocoParams;
    try {
        const quantity = ocoQuantity(entry, side, symbolInfo.baseAsset, lotSizeFilter.stepSize);
        if (!quantity) {
            throw new Error('the quantity left after fees is zero');
        }
        const [aboveLeg, belowLeg] = tpSlLegs(side, takeProfitPrice, stopLossPrice);
        ocoParams = { symbol, side: isBuy ? 'SELL' : 'BUY', quantity, recvWindow: 20000 };
        Object.entries(aboveLeg).forEach(([key, value]) => { ocoParams[`above${key}`] = value; });
        Object.entries(belowLeg).forEach(([key, value]) => { ocoParams[`below${key}`] = value; });
    } catch (error) {
        throw notPlaced(error);
    }

    try {
        const oco = await signedRequest(mode, 'POST', ORDER_LIST_OCO_ENDPOINT, ocoParams);
        return { entry, oco };
    } catch (error) {
        // Only a Binance rejection proves the OCO was not placed. A timeout, a non-JSON reply, or
        // -1007 (Binance's own "execution status unknown") can follow an OCO that was accepted.
        if (error.msg && error.code !== -1007) {
            throw notPlaced(error);
        }
        throw new Error(`${filled}, but the take-profit/stop-loss OCO request failed (${reason(error)}), so it may or may not have been placed. Check the ${symbol} orders in History before acting.`);
    }
}

// TP/SL never gets dropped silently: an order that carries it is either protected or rejected
async function placeOrder(mode, body) {
    const hasTakeProfit = isProvided(body.takeProfitPrice);
    if (hasTakeProfit !== isProvided(body.stopLossPrice)) {
        throw new Error('Enter both a take-profit and a stop-loss price, or neither');
    }
    if (hasTakeProfit) {
        if (body.type === 'MARKET') {
            return placeMarketWithTpSl(mode, body);
        }
        if (body.type !== 'LIMIT') {
            throw new Error('Take-profit and stop-loss prices are only supported on LIMIT and MARKET orders');
        }
        return signedRequest(mode, 'POST', ORDER_LIST_OTOCO_ENDPOINT, buildOtocoParams(body));
    }
    if (body.type === 'OCO') {
        return signedRequest(mode, 'POST', ORDER_LIST_OCO_ENDPOINT, buildOcoParams(body));
    }
    return signedRequest(mode, 'POST', ORDER_ENDPOINT, buildOrderParams(body));
}

// Query strings can repeat a key, which Express turns into an array, so require a plain string
function parseMode(value) {
    if (typeof value !== 'string' || !Object.hasOwn(MODES, value)) {
        throw new Error('Mode must be live or testnet');
    }
    return MODES[value];
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
        const mode = parseMode(req.body.mode);
        const result = await placeOrder(mode, req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/symbol-info/:symbol', async (req, res) => {
    try {
        const mode = parseMode(req.query.mode);
        const symbolInfo = await getSymbolInfo(mode, req.params.symbol);
        res.json({ success: true, data: symbolInfo });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/balances', async (req, res) => {
    try {
        const balances = await getAccountBalances(parseMode(req.query.mode));
        res.json({ success: true, data: balances });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/order-history/:symbol', async (req, res) => {
    try {
        const mode = parseMode(req.query.mode);
        const history = await getOrderHistory(mode, parseSymbol(req.params.symbol));
        res.json({ success: true, data: history });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
