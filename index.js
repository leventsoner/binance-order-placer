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
const TICKER_PRICE_ENDPOINT = '/api/v3/ticker/price';
const HISTORY_LIMIT = 20;

const BINANCE_FUTURES_API_URL = 'https://fapi.binance.com';
const BINANCE_FUTURES_TESTNET_API_URL = 'https://testnet.binancefuture.com';
const FUTURES_ORDER_ENDPOINT = '/fapi/v1/order';
const FUTURES_ALGO_ORDER_ENDPOINT = '/fapi/v1/algoOrder';
const FUTURES_EXCHANGE_INFO_ENDPOINT = '/fapi/v1/exchangeInfo';
const FUTURES_POSITION_MODE_ENDPOINT = '/fapi/v1/positionSide/dual';
const FUTURES_MULTI_ASSETS_ENDPOINT = '/fapi/v1/multiAssetsMargin';
const FUTURES_SYMBOL_CONFIG_ENDPOINT = '/fapi/v1/symbolConfig';
const FUTURES_MARGIN_TYPE_ENDPOINT = '/fapi/v1/marginType';
const FUTURES_LEVERAGE_ENDPOINT = '/fapi/v1/leverage';
const FUTURES_ALL_ORDERS_ENDPOINT = '/fapi/v1/allOrders';
const FUTURES_USER_TRADES_ENDPOINT = '/fapi/v1/userTrades';
const FUTURES_ALL_ALGO_ORDERS_ENDPOINT = '/fapi/v1/allAlgoOrders';
const FUTURES_LEVERAGE = 3;
const FUTURES_MARGIN_TYPE = 'ISOLATED';
const NO_NEED_TO_CHANGE_MARGIN_TYPE = -4046;

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

// Each mode only ever uses its own key pair; there is no fallback to the other.
// Futures has its own key pair per mode (the futures testnet rejects spot testnet keys), again with no fallback.
const MODES = {
    live: {
        baseUrl: BINANCE_API_URL,
        apiKey: process.env.BINANCE_API_KEY,
        secretKey: process.env.BINANCE_SECRET_KEY,
        keyNames: 'BINANCE_API_KEY, BINANCE_SECRET_KEY',
        futures: {
            baseUrl: BINANCE_FUTURES_API_URL,
            apiKey: process.env.BINANCE_FUTURES_API_KEY,
            secretKey: process.env.BINANCE_FUTURES_SECRET_KEY,
            keyNames: 'BINANCE_FUTURES_API_KEY, BINANCE_FUTURES_SECRET_KEY'
        }
    },
    testnet: {
        baseUrl: BINANCE_TESTNET_API_URL,
        apiKey: process.env.BINANCE_TESTNET_API_KEY,
        secretKey: process.env.BINANCE_TESTNET_SECRET_KEY,
        keyNames: 'BINANCE_TESTNET_API_KEY, BINANCE_TESTNET_SECRET_KEY',
        futures: {
            baseUrl: BINANCE_FUTURES_TESTNET_API_URL,
            apiKey: process.env.BINANCE_FUTURES_TESTNET_API_KEY,
            secretKey: process.env.BINANCE_FUTURES_TESTNET_SECRET_KEY,
            keyNames: 'BINANCE_FUTURES_TESTNET_API_KEY, BINANCE_FUTURES_TESTNET_SECRET_KEY'
        }
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

// Public and unsigned; one request covers every pair, and the testnet has its own prices
async function fetchUsdtPrices(mode) {
    let response;
    try {
        response = await axios.get(`${mode.baseUrl}${TICKER_PRICE_ENDPOINT}`);
    } catch (error) {
        throw error.response?.data || error;
    }
    return new Map(response.data.map(({ symbol, price }) => [symbol, price]));
}

// usdValue is null for an asset with no <ASSET>USDT pair; USDT itself is worth 1
function usdValue(asset, free, locked, prices) {
    const price = asset === 'USDT' ? 1 : prices.get(`${asset}USDT`);
    return price === undefined ? null : (Number(free) + Number(locked)) * Number(price);
}

async function getAccountBalances(mode) {
    const [account, prices] = await Promise.all([
        signedRequest(mode, 'GET', ACCOUNT_ENDPOINT, { recvWindow: 20000 }),
        fetchUsdtPrices(mode)
    ]);
    return account.balances
        .filter(({ free, locked }) => Number(free) > 0 || Number(locked) > 0)
        .map(({ asset, free, locked }) => ({ asset, free, locked, usdValue: usdValue(asset, free, locked, prices) }))
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
        orders: orders.reverse().map(({ orderId, orderListId, time, side, type, status, price, origQty, executedQty }) => (
            { orderId, orderListId, time, side, type, status, price, origQty, executedQty }
        )),
        trades: trades.reverse().map(({ id, orderId, time, isBuyer, price, qty, quoteQty, commission, commissionAsset }) => (
            { id, orderId, time, side: isBuyer ? 'BUY' : 'SELL', price, qty, quoteQty, commission, commissionAsset }
        ))
    };
}

// TP/SL legs live in Binance's Algo Service, so they never appear in allOrders.
// allOrders and userTrades come oldest first like spot; allAlgoOrders already comes newest first.
async function getFuturesOrderHistory(mode, symbol) {
    const params = { symbol, limit: HISTORY_LIMIT, recvWindow: 20000 };
    const [orders, trades, algoOrders] = await Promise.all([
        signedRequest(mode.futures, 'GET', FUTURES_ALL_ORDERS_ENDPOINT, params),
        signedRequest(mode.futures, 'GET', FUTURES_USER_TRADES_ENDPOINT, params),
        signedRequest(mode.futures, 'GET', FUTURES_ALL_ALGO_ORDERS_ENDPOINT, params)
    ]);

    return {
        orders: orders.reverse().map(({ orderId, time, side, type, status, price, origQty, executedQty }) => (
            { orderId, time, side, type, status, price, origQty, executedQty }
        )),
        trades: trades.reverse().map(({ id, orderId, time, side, price, qty, quoteQty, commission, commissionAsset }) => (
            { id, orderId, time, side, price, qty, quoteQty, commission, commissionAsset }
        )),
        algoOrders: algoOrders.map(({ algoId, createTime, side, orderType, algoStatus, triggerPrice, quantity }) => (
            { algoId, time: createTime, side, type: orderType, status: algoStatus, triggerPrice, quantity }
        ))
    };
}

// The testnet lists its own symbols and filters, so exchange info follows the mode.
// Asking for one symbol avoids downloading every pair; Binance rejects unknown symbols itself.
async function fetchSymbol(mode, symbol) {
    let response;
    try {
        response = await axios.get(`${mode.baseUrl}${EXCHANGE_INFO_ENDPOINT}`, { params: { symbol } });
    } catch (error) {
        throw error.response?.data || error;
    }
    const symbolInfo = response.data.symbols[0];

    if (!symbolInfo) {
        throw new Error('Symbol not found');
    }
    return symbolInfo;
}

// Futures exchange info takes no symbol parameter, so the whole list is searched
async function fetchFuturesSymbol(mode, symbol) {
    let response;
    try {
        response = await axios.get(`${mode.futures.baseUrl}${FUTURES_EXCHANGE_INFO_ENDPOINT}`);
    } catch (error) {
        throw error.response?.data || error;
    }
    const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);

    if (!symbolInfo) {
        throw new Error('Symbol not found');
    }
    return symbolInfo;
}

// Get symbol information; spot and futures share the LOT_SIZE and PRICE_FILTER shapes
async function getSymbolInfo(mode, market, symbol) {
    try {
        const symbolInfo = market === 'futures'
            ? await fetchFuturesSymbol(mode, symbol)
            : await fetchSymbol(mode, symbol);

        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');

        return {
            quantityPrecision: getDecimalPrecision(lotSizeFilter.stepSize),
            pricePrecision: getDecimalPrecision(priceFilter.tickSize),
            minQty: lotSizeFilter.minQty,
            maxQty: lotSizeFilter.maxQty,
            minPrice: priceFilter.minPrice,
            maxPrice: priceFilter.maxPrice,
            stepSize: lotSizeFilter.stepSize,
            tickSize: priceFilter.tickSize
        };
    } catch (error) {
        throw error;
    }
}

// Decimal places up to the step's `1`; whole-unit steps such as `1.00000000` or `10.00000000` give 0
function getDecimalPrecision(stepSize) {
    const dot = stepSize.indexOf('.');
    const one = stepSize.indexOf('1');
    return dot === -1 || one < dot ? 0 : one - dot;
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

// Futures TP/SL prices, or null when neither is given. A LIMIT entry must sit between them.
function parseFuturesTpSl(body, orderParams) {
    const hasTakeProfit = isProvided(body.takeProfitPrice);
    if (hasTakeProfit !== isProvided(body.stopLossPrice)) {
        throw new Error('Enter both a take-profit and a stop-loss price, or neither');
    }
    if (!hasTakeProfit) {
        return null;
    }
    const takeProfitPrice = parsePositiveDecimal(body.takeProfitPrice, 'Take-profit price');
    const stopLossPrice = parsePositiveDecimal(body.stopLossPrice, 'Stop-loss price');
    const { side, type, price } = orderParams;
    const isBuy = side === 'BUY';
    const [low, high] = isBuy ? [stopLossPrice, takeProfitPrice] : [takeProfitPrice, stopLossPrice];
    if (Number(low) >= Number(high)) {
        throw new Error(`For a ${side} order the take-profit price must be ${isBuy ? 'above' : 'below'} the stop-loss price`);
    }
    if (type === 'LIMIT' && (Number(price) <= Number(low) || Number(price) >= Number(high))) {
        throw new Error(`For a LIMIT ${side} order the price must be between the stop-loss and take-profit prices`);
    }
    return { takeProfitPrice, stopLossPrice };
}

// Only a Binance rejection proves an exit leg was not placed. A timeout, a non-JSON reply, -1006
// or -1007 (Binance's own "execution status unknown") can follow an order that was accepted.
async function placeFuturesExit(futures, params) {
    try {
        return { status: 'placed', order: await signedRequest(futures, 'POST', FUTURES_ALGO_ORDER_ENDPOINT, params) };
    } catch (error) {
        const isUnknown = !error.msg || error.code === -1006 || error.code === -1007;
        return { status: isUnknown ? 'unknown' : 'not placed', error };
    }
}

function describeExit(label, exit) {
    const reason = exit.error && errorMessage(exit.error).replace(/\.$/, '');
    if (exit.status === 'placed') {
        return `${label} placed (algoId ${exit.order.algoId})`;
    }
    return exit.status === 'unknown'
        ? `${label} request failed (${reason}), so it may or may not have been placed`
        : `${label} not placed: ${reason}`;
}

// Every futures order runs at 3x isolated. Symbol settings are set when they differ; account-wide
// settings are never changed. Any failure before the order request means no order was placed.
// TP and SL are separate reduce-only conditional orders placed right after the entry (Binance's
// futures API cannot place them on fill), so a failed leg is always reported, never dropped.
async function placeFuturesOrder(mode, body) {
    if (body.type !== 'LIMIT' && body.type !== 'MARKET') {
        throw new Error('Futures supports only LIMIT and MARKET orders');
    }
    const orderParams = { ...buildOrderParams(body), newOrderRespType: 'RESULT' };
    const tpSl = parseFuturesTpSl(body, orderParams);
    const { symbol, side } = orderParams;
    const { futures } = mode;
    const notPlaced = (error) => new Error(`${errorMessage(error).replace(/\.$/, '')}; no order was placed.`);

    let leverage;
    try {
        const positionMode = await signedRequest(futures, 'GET', FUTURES_POSITION_MODE_ENDPOINT, { recvWindow: 20000 });
        if (positionMode.dualSidePosition) {
            throw new Error('Your futures account is in Hedge position mode. Switch it to One-way mode on Binance');
        }
        const assetsMode = await signedRequest(futures, 'GET', FUTURES_MULTI_ASSETS_ENDPOINT, { recvWindow: 20000 });
        if (assetsMode.multiAssetsMargin) {
            throw new Error('Your futures account is in Multi-Assets mode, which does not allow isolated margin. Switch it to Single-Asset mode on Binance');
        }
        // Binance rejects any margin-type request (-4067) while TP/SL algo orders are open, even one
        // that changes nothing, so it is only sent when the symbol is not isolated yet
        const [symbolConfig] = await signedRequest(futures, 'GET', FUTURES_SYMBOL_CONFIG_ENDPOINT, { symbol, recvWindow: 20000 });
        if (symbolConfig?.marginType !== FUTURES_MARGIN_TYPE) {
            try {
                await signedRequest(futures, 'POST', FUTURES_MARGIN_TYPE_ENDPOINT, { symbol, marginType: FUTURES_MARGIN_TYPE, recvWindow: 20000 });
            } catch (error) {
                if (error.code !== NO_NEED_TO_CHANGE_MARGIN_TYPE) {
                    throw error;
                }
            }
        }
        const leverageResult = await signedRequest(futures, 'POST', FUTURES_LEVERAGE_ENDPOINT, { symbol, leverage: FUTURES_LEVERAGE, recvWindow: 20000 });
        leverage = leverageResult.leverage;
    } catch (error) {
        throw notPlaced(error);
    }

    const order = await signedRequest(futures, 'POST', FUTURES_ORDER_ENDPOINT, orderParams);
    if (!tpSl) {
        return { leverage, marginType: FUTURES_MARGIN_TYPE, order };
    }

    // Futures fees are charged in the margin asset, so the whole quantity is covered
    const quantity = body.type === 'MARKET' ? order.executedQty : orderParams.quantity;
    if (Number(quantity) === 0) {
        throw new Error(`Market ${side} order ${order.orderId} did not fill (status ${order.status}); no take-profit or stop-loss was placed.`);
    }
    const exitParams = {
        algoType: 'CONDITIONAL',
        symbol,
        side: side === 'BUY' ? 'SELL' : 'BUY',
        quantity,
        reduceOnly: 'true',
        workingType: 'CONTRACT_PRICE',
        recvWindow: 20000
    };
    const stopLoss = await placeFuturesExit(futures, { ...exitParams, type: 'STOP_MARKET', triggerPrice: tpSl.stopLossPrice });
    const takeProfit = await placeFuturesExit(futures, { ...exitParams, type: 'TAKE_PROFIT_MARKET', triggerPrice: tpSl.takeProfitPrice });

    if (stopLoss.status === 'placed' && takeProfit.status === 'placed') {
        return { leverage, marginType: FUTURES_MARGIN_TYPE, order, stopLoss: stopLoss.order, takeProfit: takeProfit.order };
    }
    let advice;
    if (stopLoss.status === 'unknown' || takeProfit.status === 'unknown') {
        advice = 'Check the open orders on Binance before acting.';
    } else if (stopLoss.status === 'placed') {
        advice = 'This position has no take-profit.';
    } else if (takeProfit.status === 'placed') {
        advice = 'This position has no stop-loss.';
    } else {
        advice = 'This position has no take-profit or stop-loss.';
    }
    throw new Error(`${body.type} ${side} order ${order.orderId} for ${quantity} ${symbol} was placed. ${describeExit('Stop-loss', stopLoss)}. ${describeExit('Take-profit', takeProfit)}. ${advice}`);
}

// Binance cancels the whole order list when one of its orders is cancelled
async function cancelOrder(mode, body) {
    const symbol = parseSymbol(body.symbol);
    const orderId = parseOrderId(body.orderId);
    return signedRequest(mode, 'DELETE', ORDER_ENDPOINT, { symbol, orderId, recvWindow: 20000 });
}

// Query strings can repeat a key, which Express turns into an array, so require a plain string
function parseMode(value) {
    if (typeof value !== 'string' || !Object.hasOwn(MODES, value)) {
        throw new Error('Mode must be live or testnet');
    }
    return MODES[value];
}

function parseMarket(value) {
    if (value !== 'spot' && value !== 'futures') {
        throw new Error('Market must be spot or futures');
    }
    return value;
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

// Kept as a string: order IDs are sent to Binance exactly as received
function parseOrderId(value) {
    if (typeof value !== 'string' || !/^\d{1,20}$/.test(value) || BigInt(value) === 0n) {
        throw new Error('Order ID must be a positive whole number');
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
        const market = parseMarket(req.body.market);
        const result = market === 'futures'
            ? await placeFuturesOrder(mode, req.body)
            : await placeOrder(mode, req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.post('/cancel-order', async (req, res) => {
    try {
        const mode = parseMode(req.body.mode);
        const result = await cancelOrder(mode, req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

app.get('/symbol-info/:symbol', async (req, res) => {
    try {
        const mode = parseMode(req.query.mode);
        const market = parseMarket(req.query.market);
        const symbolInfo = await getSymbolInfo(mode, market, parseSymbol(req.params.symbol));
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
        const market = parseMarket(req.query.market ?? 'spot');
        const symbol = parseSymbol(req.params.symbol);
        const history = market === 'futures'
            ? await getFuturesOrderHistory(mode, symbol)
            : await getOrderHistory(mode, symbol);
        res.json({ success: true, data: history });
    } catch (error) {
        res.json({ success: false, error: errorMessage(error) });
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
