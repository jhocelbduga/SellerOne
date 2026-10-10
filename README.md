# SellerOne

## Overview

SellerOne is a modern, cloud-native mobile and web application designed specifically
for sole traders, online sellers, social commerce entrepreneurs, and home-based
businesses. Available through the Google Play Store and Apple App Store, the
platform delivers a complete business management ecosystem that combines
Inventory Management, Online Order Processing, Customer Relationship
Management (CRM), and Integrated Accounting into a single, easy-to-use solution.
Built with a plug-and-play architecture, SellerOne enables online sellers to manage
their entire business operation from a smartphone, tablet, or computer without
requiring complex accounting knowledge or expensive enterprise software.

## Vision

To empower online sellers and small business entrepreneurs with an affordable,
intelligent, and fully integrated business management platform that simplifies
operations, improves customer engagement, and supports sustainable business
growth.

## Target Users

**Sole Traders**
- Facebook marketplace sellers
- Facebook Live sellers
- TikTok Shop sellers
- Instagram sellers
- Messenger-based sellers
- Home-based online businesses
- Resellers and distributors
- Small-scale e-commerce entrepreneurs

## Core Features

### 1. Inventory Management

Simplify inventory tracking and stock control with real-time visibility.

**Features**
- Inventory Stock-In
- Inventory Stock-Out
- Product Catalogue Management
- SKU and Barcode Management
- Batch and Lot Tracking
- Inventory Adjustment
- Stock Transfer Between Locations
- Low Stock Alerts
- Reorder Point Notifications
- Product Variants Management
  - Size
  - Colour
  - Packaging
- Inventory Valuation
- Real-Time Stock Monitoring
- Inventory History and Audit Trail

**Benefits**
- Prevent stock shortages
- Eliminate manual inventory tracking
- Improve inventory accuracy
- Reduce overstocking and stock losses

### 2. Social Commerce Order Processing

Manage orders directly from social media channels and online selling platforms.

**Supported Channels**
- TikTok Shop
- Facebook Marketplace
- Facebook Page
- Facebook Messenger
- Instagram
- Manual Order Entry
- Shareable Order Links

**Features**
- Customer Order Capture
- Social Media Order Integration
- Cart and Checkout Links
- Order Confirmation
- Invoice Generation
- Payment Validation
- Order Fulfilment
- Shipping Management
- Delivery Tracking
- Order Status Monitoring

**Order Workflow**

1. Order received
2. Payment verification
3. Inventory reservation
4. Packing
5. Shipping
6. Delivered
7. Completed

**Benefits**
- Faster order processing
- Reduced manual encoding
- Improved customer experience
- Order visibility from end to end

### 3. Customer Relationship Management (CRM)

Build stronger relationships with customers and increase repeat purchases.

**Features**
- Customer Profile Management
- Customer Purchase History
- Lead and Prospect Management
- Customer Segmentation
- Messaging and Follow-Ups
- Customer Support Tracking
- Loyalty Program Management
- Rewards and Discount Management
- Customer Notes and Preferences
- Customer Lifetime Value Analysis

**Customer Analytics**
- New Customers
- Returning Customers
- Top Buyers
- Customer Retention Rate
- Average Purchase Value
- Sales by Customer

**Benefits**
- Improve customer satisfaction
- Increase repeat sales
- Strengthen customer loyalty
- Create personalised marketing campaigns

### 4. All-in-One Accounting System

Designed specifically for online sellers with simplified accounting workflows and
automated bookkeeping.

**Features**
- Automated Journal Entries
- Sales Recording
- Expense Management
- Accounts Receivable
- Accounts Payable
- Cash Flow Monitoring
- Bank Reconciliation
- Financial Reporting
- Tax Reporting Support
- Profit and Loss Statement
- Balance Sheet
- General Ledger

**Accounting Automation**
The system automatically records accounting transactions when:
- Inventory is purchased
- Orders are completed
- Payments are received
- Delivery fees are paid
- Expenses are incurred
- Refunds are processed

**Financial Dashboard**
- Total Revenue
- Total Expenses
- Gross Profit
- Net Profit
- Cash Balance
- Outstanding Receivables
- Monthly Sales Trends

**Benefits**
- No accounting expertise required
- Reduced bookkeeping effort
- Accurate financial records
- Real-time business performance visibility

## Cloud-Native Architecture

SellerOne is built using a modern cloud-native architecture that supports scalability,
reliability, and high availability.

**Architecture Principles**

**Mobile First**
- Android Application
- iOS Application
- Responsive Web Portal

**Cloud Native**
- Microservices Architecture
- Containerized Deployment
- Auto Scaling
- High Availability
- Multi-Tenant Design

**API-Driven Platform**
- REST APIs
- Event-Driven Integration
- Third-Party Connectivity
- Social Commerce Integration

**Security**
- Role-Based Access Control (RBAC)
- Multi-Factor Authentication (MFA)
- Data Encryption
- Audit Logging
- Secure Cloud Storage

## Analytics Dashboard

Business owners can monitor their entire business from a single dashboard.

**Operational Metrics**
- Orders Today
- Orders This Month
- Pending Orders
- Completed Orders
- Cancelled Orders

**Inventory Metrics**
- Total Products
- Low Stock Items
- Out-of-Stock Items
- Inventory Value

**Customer Metrics**
- Active Customers
- New Customers
- Repeat Customers
- Customer Growth

**Financial Metrics**
- Daily Sales
- Monthly Revenue
- Gross Profit
- Net Profit
- Cash Position

## Future Enhancements

- AI-Powered Sales Forecasting
- Smart Inventory Replenishment
- Chatbot Customer Support
- Digital Wallet Integration
- QR Code Payments
- Marketplace Integrations
- Affiliate Marketing Module
- Loyalty Points System
- Multi-Warehouse Support
- Multi-Vendor Marketplace Features

## Key Value Proposition

SellerOne helps online sellers manage inventory, orders, customers, and accounting in
one unified platform. By combining social commerce integration, automated
bookkeeping, and cloud-native scalability, the solution enables entrepreneurs to focus
on growing their business while reducing operational complexity and administrative
workload.

## Microservice Repository

This repository contains starter services for the SellerOne business domains:

| Service | Default port | Health check |
| --- | ---: | --- |
| Inventory | 3001 | `GET /health` |
| Orders | 3002 | `GET /health` |
| Customers | 3003 | `GET /health` |
| Accounting | 3004 | `GET /health` |

The MVP includes a React web application and an authenticated platform API for
the requested login, registration, dashboard, product, inventory, order,
customer, sales, expense, accounting, report, settings, and user-management
screens. Inventory uses persistent SQLite storage, FIFO valuation, and prevents
negative stock. Orders and sales are recorded independently; creating an order
does not reserve or deduct inventory automatically.

### Requirements

- Node.js 24 or newer
- npm 11 or newer
- Docker and Docker Compose (optional, for containerized startup)

### Run the MVP locally

Install dependencies and build the application:

```sh
npm ci
npm run build
```

Run the authenticated API and serve the built web UI at `http://localhost:3100`:

```sh
npm run start:platform
```

For local UI development, run `npm run dev:platform` and `npm run dev:web` in
separate terminals. The Vite server proxies `/api` requests to the platform API.

On the first visit, create the workspace owner through the one-time setup
screen. Additional users must be invited by an owner or admin and complete
registration using the invitation link. Password reset links are logged to the
platform process in development when SMTP is not configured. Configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` to send
reset emails. Use HTTPS in production so session cookies remain protected.

The platform and inventory data share `DATABASE_PATH` (default
`.data/sellerone.sqlite`). Set `DATABASE_PATH` to a persistent writable path for
deployment. Do not expose the standalone inventory service publicly; the
platform API is the authenticated UI-facing service.

### Inventory API

The inventory service starts with a `Main Warehouse` location. JSON request and
response bodies use integer quantities. Monetary values are integer minor units
(for example, cents); each variant declares its three-letter ISO currency code.
Valuation uses FIFO by receipt cost, and stock cannot be reduced below zero.
The standalone inventory service does not authenticate callers; keep it on a
trusted internal network and use the platform API for authenticated UI access.
Variants can have an optional description (up to 2,000 characters). The
description appears when choosing a variant for stock-in and in stock, batch,
and movement listings. Each receipt stores a description snapshot so later
catalog edits do not rewrite its historical identification. Existing SQLite
databases are migrated automatically when the inventory store starts.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/products?search=` | List and search products |
| `POST` | `/products` | Create a product with one or more variants |
| `GET` | `/products/:id` | Read a product and variants |
| `PATCH` | `/products/:id` | Update product name, description, or active status |
| `POST` | `/products/:id/variants` | Add a variant |
| `PATCH` | `/variants/:id` | Update SKU, barcode, attributes, cost, reorder point, or status |
| `GET` | `/products/lookup?code=` | Look up a SKU or barcode |
| `GET`, `POST` | `/locations` | List or create stock locations |
| `GET` | `/stock?locationId=&variantId=` | Read real-time stock by variant and location |
| `GET` | `/batches?variantId=&locationId=&lotNumber=&includeDepleted=` | Track lots and receipt costs |
| `POST` | `/stock/in` | Receive stock, optionally with lot, expiry, and receipt cost |
| `POST` | `/stock/out` | Issue stock; optionally target a batch or lot number |
| `POST` | `/adjustments` | Set a physical counted quantity and record the difference |
| `POST` | `/transfers` | Atomically move stock between locations |
| `GET` | `/alerts/low-stock` | List variants at or below their reorder point |
| `GET` | `/valuation?locationId=` | Get FIFO inventory valuation grouped by currency |
| `GET` | `/movements?variantId=&locationId=&limit=` | Read the movement and audit history |

Create a product:

```json
{
  "name": "Coffee Beans",
  "description": "Roasted coffee",
  "variants": [
    {
      "name": "250 g",
      "description": "Resealable pouch, dark roast",
      "sku": "COFFEE-250",
      "barcode": "1000000000250",
      "attributes": { "size": "250 g", "colour": "Dark roast" },
      "unitCostMinor": 850,
      "currency": "PHP",
      "reorderPoint": 10
    }
  ]
}
```

Receive stock:

```json
{
  "variantId": "<variant-id>",
  "quantity": 25,
  "lotNumber": "LOT-2026-01",
  "expiresAt": "2027-01-31",
  "unitCostMinor": 850,
  "reference": "PO-1001"
}
```

Run the inventory service tests with `npm test`.

### Run with Docker Compose

```sh
docker compose up --build
```

The web app and platform API are served together on port `3100`, with SQLite
persisted in the `sellerone-data` volume. Configure SMTP variables in the
environment for password reset email delivery. Put the service behind an HTTPS
reverse proxy before production use.

### Repository layout

```text
apps/
  web/
services/
  accounting/
  customers/
  inventory/
  orders/
  platform/
docker-compose.yml
Dockerfile
```
