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
- Node.js (v12.0.0 or higher)
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

3. Create a `.env` file in the root directory with your Binance API credentials:
```bash
bapi=YOUR_BINANCE_API_KEY
bsec=YOUR_BINANCE_SECRET_KEY
```
## Usage

1. Start the server:
```bash
node index.js
```
2. Open your web browser and navigate to:

http://localhost:3000

3. The interface allows you to:
   - Enter the trading pair (e.g., BTCUSDT)
   - Select order side (BUY/SELL)
   - Choose order type (LIMIT/MARKET)
   - Set Time-In-Force condition
   - Enter quantity and price
   - View real-time validation for quantity and price inputs

## API Endpoints

### Place Order
- **POST** `/place-order`
- Requires form data with:
  - symbol (e.g., "BTCUSDT")
  - side ("BUY" or "SELL")
  - type ("LIMIT" or "MARKET")
  - timeInForce ("GTC", "IOC", or "FOK")
  - quantity (number)
  - price (number)

### Get Symbol Information
- **GET** `/symbol-info/:symbol`
- Returns trading pair information including:
  - Quantity precision
  - Price precision
  - Minimum quantity
  - Maximum quantity
  - Price limits
  - Tick size

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