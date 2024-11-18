const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');

// Constants
const BINANCE_API_URL = "https://api.binance.com";
const ORDER_ENDPOINT = "/api/v3/order";
const EXCHANGE_INFO_ENDPOINT = "/api/v3/exchangeInfo";

// Express app setup
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuration
const config = {
    apiKey: process.env.bapi,
    secretKey: process.env.bsec
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

// Express routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.post('/place-order', async (req, res) => {
    try {
        const orderParams = {
            symbol: req.body.symbol,
            side: req.body.side,
            type: req.body.type,
            timeInForce: req.body.timeInForce,
            quantity: parseFloat(req.body.quantity),
            price: parseFloat(req.body.price),
            recvWindow: 20000
        };

        const result = await placeBinanceOrder(orderParams);
        res.json({ success: true, data: result });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/symbol-info/:symbol', async (req, res) => {
    try {
        const symbolInfo = await getSymbolInfo(req.params.symbol);
        res.json({ success: true, data: symbolInfo });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
