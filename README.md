# Binance Order Placer

A web-based application that allows users to place cryptocurrency orders on Binance exchange through a simple and intuitive interface.

## Features

- Place LIMIT and MARKET orders on Binance
- Real-time symbol information validation
- Automatic quantity and price precision handling
- User-friendly interface with helpful guidelines
- Support for different order types (GTC, IOC, FOK)

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

4. The interface allows you to:
   - Switch between testnet and live mode
   - Enter the trading pair (e.g., BTCUSDT)
   - Select order side (BUY/SELL)
   - Choose order type (LIMIT/MARKET)
   - Set Time-In-Force condition
   - Enter quantity and price
   - View real-time validation for quantity and price inputs

## API Endpoints

Every route requires `mode` ("live" or "testnet"): a query parameter on the GET
routes (for example `/balances?mode=testnet`) and a form field on
`POST /place-order`. Requests without a valid mode are rejected before anything
is sent to Binance.

### Place Order
- **POST** `/place-order`
- Requires form data with:
  - mode ("live" or "testnet")
  - symbol (e.g., "BTCUSDT")
  - side ("BUY" or "SELL")
  - type ("LIMIT" or "MARKET")
  - timeInForce ("GTC", "IOC", or "FOK") - LIMIT only
  - quantity (number)
  - price (number) - LIMIT only

### Get Symbol Information
- **GET** `/symbol-info/:symbol?mode=live|testnet`
- Returns trading pair information including:
  - Quantity precision
  - Price precision
  - Quantity step size
  - Price tick size
  - Minimum quantity
  - Maximum quantity
  - Price limits
  - Tick size

### Get Balances
- **GET** `/balances?mode=live|testnet`
- Returns non-zero spot balances, sorted by asset:
  - asset (e.g., "BTC")
  - free
  - locked

### Get Order History
- **GET** `/order-history/:symbol?mode=live|testnet`
- Returns the 20 most recent orders and trades for the symbol, newest first:
  - orders: orderId, time, side, type, status, price, origQty, executedQty
  - trades: id, orderId, time, side, price, qty, quoteQty, commission, commissionAsset

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