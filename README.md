# Binance Order Placer

A web-based application that allows users to place cryptocurrency orders on Binance exchange through a simple and intuitive interface.

## Features

- Spot LIMIT, MARKET, Stop Limit and OCO orders, with GTC, IOC or FOK time in force
- Optional take-profit and stop-loss prices on spot and futures LIMIT and MARKET orders
- USD-M futures LIMIT and MARKET orders at 3x leverage with isolated margin
- Real-time symbol information validation, with quantity and price inputs that
  follow each symbol's step size and tick size
- Spot balances, with balances worth under 10 USD hidden by default (on testnet,
  only BTC, ETH, XRP, BCH, BNB and SOL are shown by default)
- Order and trade history for a symbol, for spot and futures
- Cancel open orders, and open futures take-profit/stop-loss orders, from the history
- Testnet mode, so every order type can be tried without real funds

## Prerequisites

Before you begin, ensure you have met the following requirements:
- Node.js (v20.12.0 or higher)
- npm (Node Package Manager)
- Binance API key and Secret key with trading permissions

## Installation

1. Clone the repository:
```bash
git clone https://github.com/leventsoner/binance-order-placer
cd binance-order-placer
```

2. Install dependencies:
```bash
npm install
```

3. Provide your Binance API credentials as `BINANCE_API_KEY` and `BINANCE_SECRET_KEY`.
   Either set them as shell environment variables, or copy `.env.example` to `.env`
   and fill it in:
```bash
cp .env.example .env
```
   `.env` is optional and gitignored. If a variable is set in both the shell and
   `.env`, the shell value wins.

4. For testnet mode, also provide `BINANCE_TESTNET_API_KEY` and
   `BINANCE_TESTNET_SECRET_KEY` the same way. Get them from
   https://testnet.binance.vision: sign in with GitHub and generate an HMAC key.
   Testnet keys only work on the testnet, and live keys only work live.

5. Futures has its own key pairs, provided the same way:
   - Live futures: `BINANCE_FUTURES_API_KEY` and `BINANCE_FUTURES_SECRET_KEY`,
     from a Binance API key with **Enable Futures** permission.
   - Futures testnet: `BINANCE_FUTURES_TESTNET_API_KEY` and
     `BINANCE_FUTURES_TESTNET_SECRET_KEY`. Generate them on Binance Demo Trading
     (https://testnet.binancefuture.com now redirects there): sign in, then open
     https://demo.binance.com/en/my/settings/api-management. The spot testnet
     keys do not work for futures.

   Futures never falls back to the spot keys: if its pair is missing, the order
   is rejected and nothing is sent to Binance.

## Usage

1. Start the server:
```bash
node index.js
```
2. Open your web browser and navigate to:

http://127.0.0.1:3000

The server listens on `127.0.0.1` only, so other devices on your network cannot
reach it. It also rejects requests whose `Host` is not `127.0.0.1` or `localhost`
and cross-origin form posts, so other websites open in your browser cannot place
orders through it. Anything else running on your own machine can still reach it.

3. The page always opens in **testnet mode** (blue banner), where orders go to
   Binance's spot testnet and use no real funds. Switch to **Live** (red banner)
   to trade with real funds. The mode is not remembered, so every reload starts
   on testnet again.

4. The **Market** toggle starts on **Spot**. Switch it to **Futures (USD-M)** to
   place USD-M futures LIMIT and MARKET orders. Every futures order runs at
   **3x leverage with isolated margin**: before each order the server sets the
   symbol's margin type to ISOLATED and its leverage to 3. Setting the leverage
   also changes the leverage of any position already open on that symbol. If
   your futures account is in Hedge position mode or Multi-Assets mode, the
   order is rejected and nothing is changed; switch those settings on Binance.
   Stop Limit and OCO are spot-only, and the Balances section is hidden in the
   futures view.

5. **Take profit and stop loss** are optional on LIMIT and MARKET orders. Enter
   both or neither.
   - Spot LIMIT: one OTOCO order list. Once the order fully fills, Binance places
     a take-profit limit and a stop-market stop-loss for the same quantity; when
     one executes, the other is cancelled.
   - Spot MARKET: the order, then an OCO for the filled quantity (less any fee
     taken in the bought coin). If the OCO is rejected, the order stays filled
     without TP/SL and the error says so.
   - Futures: right after the order, two separate reduce-only orders are placed
     for the order's quantity, a stop-market at the stop-loss price and a
     take-profit-market at the take-profit price, both triggered by the last
     price. A LIMIT order's TP/SL is placed straight away, so it can trigger
     before the order fills. Binance does not cancel the other one when one
     triggers or when the position is closed, so cancel leftovers from History.

6. **History** lists the 20 most recent orders and trades for the symbol, and in
   the futures view also the take-profit/stop-loss orders. Open orders (and open
   futures take-profit/stop-loss orders) have a **Cancel** button. In live mode a
   confirmation dialog appears first; on testnet the order is cancelled
   straight away. Cancelling one order of a spot OCO or OTOCO cancels its whole
   order list, as Binance does. A futures order and its take-profit/stop-loss
   orders are separate, so each is cancelled on its own.

7. The interface allows you to:
   - Switch between testnet and live mode, and between spot and futures
   - Enter the trading pair (e.g., BTCUSDT)
   - Select order side (BUY/SELL)
   - Choose order type (Limit, Market, and on spot Stop Limit and OCO)
   - Set Time-In-Force condition
   - Enter quantity, price, stop prices and optional take-profit/stop-loss prices
   - View real-time validation for quantity and price inputs
   - View balances (spot) and order history, and cancel open orders

## API Endpoints

Every route requires `mode` ("live" or "testnet"): a query parameter on the GET
routes (for example `/balances?mode=testnet`) and a form field on
`POST /place-order` and `POST /cancel-order`. Requests without a valid mode are
rejected before anything is sent to Binance. Every API route answers with JSON:
`{ success: true, data }` or `{ success: false, error }`.

### Place Order
- **POST** `/place-order`
- Requires form data with:
  - mode ("live" or "testnet")
  - market ("spot" or "futures")
  - symbol (e.g., "BTCUSDT")
  - side ("BUY" or "SELL")
  - type: "LIMIT", "MARKET", "STOP_LOSS_LIMIT" or "OCO" on spot; "LIMIT" or
    "MARKET" on futures
  - quantity (number)
  - timeInForce ("GTC", "IOC", or "FOK") - LIMIT, STOP_LOSS_LIMIT and OCO
  - price (number) - LIMIT, STOP_LOSS_LIMIT and OCO (the OCO's take-profit
    limit price)
  - stopPrice (number) - STOP_LOSS_LIMIT and OCO
  - stopLimitPrice (number) - OCO only (the limit price placed when the stop
    triggers)
  - takeProfitPrice and stopLossPrice (numbers) - optional, LIMIT and MARKET
    only, both or neither
- Spot success: `data` is Binance's order response, or its order list response
  for OCO and for LIMIT with take-profit/stop-loss (OTOCO). MARKET with
  take-profit/stop-loss returns `{ entry, oco }`.
- Futures success: `data` is `{ leverage, marginType: "ISOLATED", order }`,
  where `order` is Binance's `/fapi/v1/order` response. With
  take-profit/stop-loss it also has `stopLoss` and `takeProfit`, Binance's
  `/fapi/v1/algoOrder` responses (with `algoId`). A failure while checking or
  setting the futures account and symbol settings ends with "no order was
  placed". If the order is placed but a take-profit or stop-loss is not, the
  error names the order and says which one is missing.

### Cancel Order
- **POST** `/cancel-order`
- Requires form data with:
  - mode ("live" or "testnet")
  - market ("spot" or "futures"; optional, defaults to "spot")
  - symbol (e.g., "BTCUSDT")
  - orderId - the order to cancel (spot, or a futures order), or
  - algoId - a futures take-profit/stop-loss order to cancel (futures only;
    send either orderId or algoId, not both)
- Spot: cancelling one order of an OCO or OTOCO cancels its whole order list.
- On success `data` is Binance's cancel response.

### Get Symbol Information
- **GET** `/symbol-info/:symbol?mode=live|testnet&market=spot|futures`
- Returns trading pair information:
  - quantityPrecision, pricePrecision (decimal places)
  - stepSize, minQty, maxQty (quantity filter)
  - tickSize, minPrice, maxPrice (price filter)

### Get Balances
- **GET** `/balances?mode=live|testnet`
- Returns non-zero spot balances, sorted by asset:
  - asset (e.g., "BTC")
  - free
  - locked
  - usdValue - (free + locked) valued with the `<ASSET>USDT` price (USDT counts
    as 1), or `null` when Binance has no such pair

### Get Order History
- **GET** `/order-history/:symbol?mode=live|testnet&market=spot|futures`
- `market` is optional and defaults to "spot".
- Returns the 20 most recent orders and trades for the symbol, newest first:
  - orders: orderId, time, side, type, status, price, origQty, executedQty
    (spot also has orderListId, -1 when the order is not in an order list)
  - trades: id, orderId, time, side, price, qty, quoteQty, commission, commissionAsset
  - algoOrders (futures only): algoId, time, side, type, status, triggerPrice,
    quantity - the 20 most recent take-profit/stop-loss orders

## Security Considerations

- Never commit your `.env` file or expose your API credentials
- Use environment variables for sensitive information
- Set appropriate API key permissions on Binance
- Consider implementing rate limiting for production use

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This software is for educational purposes only. Use at your own risk. The developers assume no responsibility for any financial losses incurred through the use of this software.

## Support

For support, please open an issue in the GitHub repository.