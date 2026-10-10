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

The services currently provide basic HTTP and health-check endpoints. Business
operations, persistence, authentication, and integrations described above are not
implemented yet.

### Requirements

- Node.js 24 or newer
- npm 11 or newer
- Docker and Docker Compose (optional, for containerized startup)

### Run locally

Install dependencies and compile all services:

```sh
npm install
npm run build
```

Start one service in its own terminal:

```sh
npm run start:inventory
npm run start:orders
npm run start:customers
npm run start:accounting
```

Each service responds to `GET /health` and `GET /`. The `PORT` environment
variable can override a service's default port.

### Run with Docker Compose

```sh
docker compose up --build
```

### Repository layout

```text
services/
  accounting/
  customers/
  inventory/
  orders/
docker-compose.yml
Dockerfile
```
